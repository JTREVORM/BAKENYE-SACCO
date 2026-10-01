-- ===========================================================================
-- BUD-SACCO - 0046 - One receiving account for every shilling that moves
--
-- WHY THIS MIGRATION EXISTS
--
-- The counter screens used to ask "Payment method" and offer a fixed list -
-- Cash, Mobile Money, Bank Transfer, Cheque - typed into four different React
-- components. A method is not a destination: "Mobile Money" cannot say *which*
-- merchant wallet took the money when the SACCO runs an Airtel code today and
-- an MTN code next month, and "Bank Transfer" cannot say which bank account
-- when there are two. The ledger guessed, by falling back to the default
-- account for the method (`resolve_posting_account`).
--
-- From here the person at the counter chooses the account itself, and the list
-- they choose from is the SACCO's own `financial_accounts` rows. Nothing in the
-- application knows the names of providers or banks any more.
--
-- NOTHING NEW IS BUILT. 0027 already has the ledger, the accounts, the
-- per-account entries and `record_member_collection()` - the one function that
-- takes a chosen account, hands it to the posting trigger and lets the
-- long-standing member-side functions do the member side. This migration only:
--
--   1. widens `collection_accounts()` so every role that handles money can
--      read the list, and returns the identifiers the selector shows;
--   2. restates `record_member_collection()` to
--        a. check the permission of the branch being used, rather than one
--           blanket check that excluded the roles which have always been
--           allowed to do the work (a Loan Officer has `loans.repay` but
--           neither `savings.record` nor `finance.record`, so the blanket
--           check made the one central path unusable for repayments);
--        b. accept a savings period directly (`p_period_id`), so the savings
--           collection screen - which settles a named month - can use the same
--           path as everything else;
--        c. carry money OUT as well as in (`withdrawal`,
--           `loan_disbursement`), so the two remaining screens with a
--           hard-coded method list choose a real account to pay out of;
--        d. accept the share quantity the counter screen showed
--           (`p_quantity`), so a share price that moved mid-sale refuses the
--           sale instead of silently selling a different number of shares;
--        e. return the inner function's own payload alongside the account
--           fields, so callers keep the figures they already read.
--
-- NO TABLE, COLUMN, TYPE, POLICY OR GRANT CHANGES. No existing row is touched.
-- Historical transactions keep the `method`, `source_account_id` and
-- `destination_account_id` they were posted with; nothing here rewrites,
-- reclassifies or backfills anything.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The accounts a person at the counter may choose
--
-- Still "active accounts, their kind and their public identifiers. No balance,
-- no ledger" (0031). Two changes:
--
--   * every permission that records a money movement may read it. 0031 listed
--     four; `shares.sell`, `loans.repay`, `loans.disburse` and `cash.movement`
--     were missing, which is why the Loan Officer and Cashier screens could not
--     offer the list at all.
--   * `account_identifier` and `branch` come back too - a wallet number and a
--     branch are part of how a person tells two accounts apart - and cash is
--     ordered first, because at a counter it is the common answer.
--
-- `financial_accounts` holds only merchant, bank and cash accounts
-- (`finance_account_type`), and all three can receive member money, so there is
-- no account type to exclude. What is excluded is any account that is not
-- `active`: a suspended or closed account cannot be chosen for a new receipt,
-- while every entry already posted against it stays exactly as it is.
-- ---------------------------------------------------------------------------
drop function if exists collection_accounts();

create or replace function collection_accounts()
returns table (
  id                 uuid,
  code               text,
  name               text,
  account_type       finance_account_type,
  is_default         boolean,
  provider           text,
  merchant_code      text,
  account_identifier text,
  bank_name          text,
  branch             text,
  account_number     text
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_capability(
    has_permission('members.create') or has_permission('fees.collect')
      or has_permission('savings.record') or has_permission('finance.record')
      or has_permission('shares.sell') or has_permission('loans.repay')
      or has_permission('loans.disburse') or has_permission('cash.movement'),
    'see the accounts money is received into');

  return query
  select a.id, a.code, a.name, a.account_type, a.is_default,
         a.provider, a.merchant_code, a.account_identifier,
         a.bank_name, a.branch, a.account_number
    from financial_accounts a
   where a.status = 'active'
   order by case a.account_type when 'cash' then 0 when 'merchant' then 1 else 2 end,
            a.is_default desc, a.name;
end;
$$;

revoke execute on function collection_accounts() from public, anon;
grant execute on function collection_accounts() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The one counter for member money, in either direction
--
-- The old 13-argument signature is dropped rather than overloaded: a 14th
-- argument with a default would leave two candidates that every existing
-- named-argument call matches, and PostgreSQL would refuse the call as
-- ambiguous. Nothing in the database calls this function - only the
-- application does - so dropping it changes no dependency.
-- ---------------------------------------------------------------------------
drop function if exists record_member_collection(
  uuid, text, numeric, uuid, date, payment_method, text, text, text,
  savings_kind, uuid, uuid, text);

/**
 * Record money a member paid, or money paid to a member, against a chosen
 * account.
 *
 * The member side is done by the function that has always done it -
 * `record_scheduled_savings`, `buy_shares`, `record_loan_repayment`,
 * `record_cash_movement`, `record_income`, `disburse_loan` - so the savings
 * period, the share lot, the loan allocation, the limits and the member's
 * balance all move exactly as they do from every other screen, and each of
 * those functions still performs its own authoritative permission check. This
 * function adds the account: it validates it, hands it to the posting trigger
 * for this database transaction only, confirms afterwards that the ledger row
 * really did land on it, and returns the receipt.
 *
 * `p_collection_type`
 *   savings | shares | loan_repayment | deposit | fee    money received
 *   withdrawal | loan_disbursement                       money paid out
 *
 * The provider reference is recorded as typed. Nothing here contacts MTN,
 * Airtel or a bank, and nothing marks a payment verified by a provider.
 */
create or replace function record_member_collection(
  p_member_id          uuid,
  p_collection_type    text,
  p_amount             numeric,
  p_account_id         uuid,
  p_paid_on            date default null,
  p_method             payment_method default null,
  p_external_ref       text default null,
  p_description        text default null,
  p_notes              text default null,
  p_savings_kind       savings_kind default null,
  p_loan_id            uuid default null,
  p_income_category_id uuid default null,
  p_idempotency_key    text default null,
  p_period_id          uuid default null,
  p_quantity           integer default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_acct     financial_accounts;
  v_member   members;
  v_method   payment_method;
  v_ref      text := nullif(btrim(coalesce(p_external_ref, '')), '');
  v_on       date := coalesce(p_paid_on, current_date);
  v_replay   boolean := false;
  v_out      boolean := p_collection_type in ('withdrawal', 'loan_disbursement');
  v_res      jsonb;
  v_txn_id   uuid;
  v_txn      transactions;
  v_kind     savings_kind;
  v_period   savings_periods;
  v_price    numeric;
  v_qty      integer;
  v_loan_id  uuid;
  v_cat      income_categories;
  v_receipt  text;
  v_label    text;
  v_posted   uuid;
begin
  -- The branch's own function carries the authoritative check; this one refuses
  -- early with a clearer message and must say exactly the same thing. 0027 used
  -- one blanket check here, which locked roles out of the central path for work
  -- their own permission already allows.
  perform assert_capability(
    case p_collection_type
      when 'savings'           then can_record_savings()
      when 'shares'            then has_permission('shares.sell')
      when 'loan_repayment'    then has_permission('loans.repay')
      when 'deposit'           then has_permission('cash.movement')
      when 'withdrawal'        then has_permission('cash.movement')
      when 'loan_disbursement' then has_permission('loans.disburse')
      when 'fee'               then can_record_finance()
      else false
    end,
    case p_collection_type
      when 'savings'           then 'record savings'
      when 'shares'            then 'record share purchases'
      when 'loan_repayment'    then 'record loan repayments'
      when 'deposit'           then 'record deposits'
      when 'withdrawal'        then 'record withdrawals'
      when 'loan_disbursement' then 'disburse loans'
      when 'fee'               then 'record fee collections'
      else 'record this entry'
    end);

  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount greater than zero.' using errcode = 'check_violation';
  end if;
  perform assert_not_future(v_on, 'A payment');

  select * into v_acct from financial_accounts where id = p_account_id;
  if not found then
    raise exception '%',
      case when v_out then 'Choose the account the money is paid out of.'
           else 'Choose the account the money was received into.' end
      using errcode = 'no_data_found';
  end if;

  v_method := coalesce(p_method, method_for_account_type(v_acct.account_type));
  v_acct   := assert_account_usable(p_account_id, v_method);

  select * into v_member from members where id = p_member_id;
  if not found then
    raise exception 'Member not found.' using errcode = 'no_data_found';
  end if;

  if p_idempotency_key is not null
     and exists (select 1 from transactions where idempotency_key = p_idempotency_key) then
    v_replay := true;
  end if;

  if not v_replay then
    if v_acct.account_type in ('merchant', 'bank') and v_ref is null then
      raise exception '%',
        case when v_acct.account_type = 'merchant'
             then 'Enter the mobile money transaction reference from the confirmation message.'
             else 'Enter the bank transfer or deposit slip reference.' end
        using errcode = 'check_violation';
    end if;
    if v_ref is not null and exists (
      select 1 from transactions where upper(external_ref) = upper(v_ref) and status <> 'reversed'
    ) then
      raise exception 'Reference % has already been recorded against another transaction.', v_ref
        using errcode = 'unique_violation';
    end if;
  end if;

  -- Hand the chosen account to the posting trigger for this database
  -- transaction only.
  perform set_config('bnd.account_id', p_account_id::text, true);

  case p_collection_type
    when 'savings' then
      if v_member.status <> 'active' then
        raise exception 'Savings cannot be recorded for a % member.', v_member.status
          using errcode = 'check_violation';
      end if;
      -- A collection screen settles a named month and passes that period. With
      -- no period named, savings go to the month the payment date falls in;
      -- a caller may still name a cadence, which is how a historical weekly
      -- period is paid into.
      if p_period_id is not null then
        select * into v_period from savings_periods where id = p_period_id;
        if not found then
          raise exception 'That savings period no longer exists.' using errcode = 'no_data_found';
        end if;
        if v_period.member_id <> p_member_id then
          raise exception 'That savings period belongs to another member.'
            using errcode = 'check_violation';
        end if;
      else
        v_kind   := coalesce(p_savings_kind, 'monthly'::savings_kind);
        v_period := ensure_savings_period(p_member_id, v_kind, v_on);
      end if;
      if v_period.status = 'waived' then
        raise exception 'This period has been waived. Remove the waiver before recording a payment.'
          using errcode = 'check_violation';
      end if;
      -- On a replay the original row already carries the reference, and the
      -- duplicate-reference check inside would mistake the retry for a second
      -- payment; the idempotency key alone finds the original.
      v_res := record_scheduled_savings(v_period.id, p_amount, v_on, v_method,
                                        case when v_replay then null else v_ref end,
                                        coalesce(p_notes, p_description), p_idempotency_key);
      v_label := 'savings';

    when 'shares' then
      v_price := share_unit_price();
      if v_price is null or v_price <= 0 then
        raise exception 'The share price has not been set.' using errcode = 'check_violation';
      end if;
      if mod(p_amount, v_price) <> 0 then
        raise exception '% is not a whole number of shares at % each.', ugx(p_amount), ugx(v_price)
          using errcode = 'check_violation';
      end if;
      v_qty := (p_amount / v_price)::integer;
      -- The counter screen counts shares, not shillings, and sends both. If the
      -- price moved between the page loading and the sale being confirmed, the
      -- two no longer agree and the sale is refused rather than quietly
      -- becoming a different number of shares than the member was shown.
      if p_quantity is not null and p_quantity <> v_qty then
        raise exception 'The share price changed while this sale was open. Reload and record it again.'
          using errcode = 'check_violation';
      end if;
      v_res := buy_shares(p_member_id, v_qty, v_method, v_on,
                          coalesce(p_notes, p_description), p_idempotency_key, p_amount);
      v_label := 'share purchase';

    when 'loan_repayment' then
      v_loan_id := p_loan_id;
      if v_loan_id is null then
        select id into v_loan_id from loans
         where member_id = p_member_id and status in ('active', 'disbursed', 'defaulted')
         order by disbursed_on desc nulls last
         limit 1;
      end if;
      if v_loan_id is null then
        raise exception 'This member has no loan being repaid.' using errcode = 'check_violation';
      end if;
      if not exists (select 1 from loans where id = v_loan_id and member_id = p_member_id) then
        raise exception 'That loan does not belong to this member.' using errcode = 'check_violation';
      end if;
      v_res := record_loan_repayment(v_loan_id, p_amount, v_on, v_method, p_idempotency_key);
      v_label := 'loan repayment';

    when 'deposit' then
      v_res := record_cash_movement(p_member_id, 'deposit', p_amount, v_method, v_on,
                                    coalesce(p_description, 'Deposit'), p_idempotency_key);
      v_label := 'deposit';

    when 'withdrawal' then
      -- The balance rule, the minimum, the per-transaction ceiling and the
      -- retained balance all live in `record_cash_movement`, unchanged.
      v_res := record_cash_movement(p_member_id, 'withdrawal', p_amount, v_method, v_on,
                                    coalesce(p_description, 'Withdrawal'), p_idempotency_key);
      v_label := 'withdrawal';

    when 'loan_disbursement' then
      if p_loan_id is null then
        raise exception 'Name the loan being disbursed.' using errcode = 'check_violation';
      end if;
      if not exists (select 1 from loans where id = p_loan_id and member_id = p_member_id) then
        raise exception 'That loan does not belong to this member.' using errcode = 'check_violation';
      end if;
      v_res := disburse_loan(p_loan_id, v_method, v_on, p_idempotency_key);
      v_label := 'loan disbursement';

    when 'fee' then
      select * into v_cat from income_categories where id = p_income_category_id;
      if not found or not v_cat.is_active then
        raise exception 'Choose what the member is paying for.' using errcode = 'check_violation';
      end if;
      v_res := record_income(v_cat.id, p_amount,
                             coalesce(nullif(btrim(coalesce(p_description, '')), ''),
                                      v_cat.name || ' - ' || v_member.full_name),
                             v_on, v_method, p_member_id, p_idempotency_key);
      v_label := lower(v_cat.name);

    else
      raise exception 'Unknown collection type %.', p_collection_type using errcode = 'check_violation';
  end case;

  perform set_config('bnd.account_id', '', true);

  v_txn_id := (v_res ->> 'transaction_id')::uuid;
  select * into v_txn from transactions where id = v_txn_id;

  -- The account the ledger actually used. Money received credits the
  -- destination; money paid out debits the source.
  v_posted := case when v_out then v_txn.source_account_id else v_txn.destination_account_id end;
  if v_posted is distinct from p_account_id then
    raise exception 'This % was already recorded against %, not the account chosen now.',
      v_label, coalesce((select name from financial_accounts where id = v_posted), 'another account')
      using errcode = 'check_violation';
  end if;

  if v_ref is not null and v_txn.external_ref is null then
    update transactions set external_ref = v_ref where id = v_txn_id;
  end if;

  select receipt_no into v_receipt from receipts where transaction_id = v_txn_id;

  -- Only a posting made now is audited; an idempotent replay returns the
  -- original without writing a second line to the log.
  if v_txn.created_at = now() then
    perform write_audit('treasury.collection', 'Finance', v_txn_id::text,
      format('%s %s %s (%s) %s %s%s',
             initcap(v_label) || ' of ' || ugx(p_amount),
             case when v_out then 'paid to' else 'received for' end,
             v_member.full_name, v_member.member_no,
             case when v_out then 'out of' else 'into' end,
             v_acct.name,
             case when v_ref is not null then ', ref ' || v_ref else '' end),
      null,
      jsonb_build_object('transaction_id', v_txn_id, 'reference', v_txn.reference,
                         'receipt_no', v_receipt, 'account_id', p_account_id,
                         'account', v_acct.name, 'amount', p_amount, 'method', v_method,
                         'external_ref', v_ref, 'collection_type', p_collection_type,
                         'direction', case when v_out then 'out' else 'in' end),
      p_notes);
  end if;

  -- The inner function's own payload first, so a caller that reads
  -- `period_label`, `outstanding`, `loan_no` or `quantity` still finds it; the
  -- account fields are authoritative and override.
  return coalesce(v_res, '{}'::jsonb) || jsonb_build_object(
    'transaction_id',  v_txn_id,
    'reference',       v_txn.reference,
    'receipt_no',      v_receipt,
    'account_id',      p_account_id,
    'account_name',    v_acct.name,
    'account_type',    v_acct.account_type,
    'account_balance', account_balance_at(p_account_id),
    'method',          v_method,
    'member_id',       p_member_id,
    'member_name',     v_member.full_name,
    'member_no',       v_member.member_no,
    'collection_type', p_collection_type,
    'direction',       case when v_out then 'out' else 'in' end,
    'amount',          p_amount,
    'duplicate',       v_txn.created_at <> now()
  );
end;
$$;

revoke all on function record_member_collection(
  uuid, text, numeric, uuid, date, payment_method, text, text, text,
  savings_kind, uuid, uuid, text, uuid, integer) from public, anon;
grant execute on function record_member_collection(
  uuid, text, numeric, uuid, date, payment_method, text, text, text,
  savings_kind, uuid, uuid, text, uuid, integer) to authenticated;
