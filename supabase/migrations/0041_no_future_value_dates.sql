-- ===========================================================================
-- 0041 — No money may be recorded with a value date in the future (finding V-6)
--
-- record_scheduled_savings(), record_member_collection(), record_other_receipt(),
-- record_expense(), create_internal_transfer(), create_payment() and
-- record_reconciliation() all refused a date after today. Six other functions
-- that post money did not:
--
--   record_loan_repayment, record_savings_payment, buy_shares,
--   record_cash_movement, record_income, disburse_loan
--
-- The guard had been added one function at a time, and these were missed. The
-- repository's own demo seed walked straight into it and produced two loan
-- repayments dated a month and two months ahead.
--
-- The damage is to the books rather than to the ledger. A Cash & Bank report,
-- an account statement and a reconciliation are all worked out AS AT a date,
-- so they correctly leave a future-dated entry out; the account's live balance
-- includes it. The two then disagree, and the difference looks exactly like a
-- reconciliation variance that nobody can explain. The treasury test suite
-- caught it: "opening + in - out = closing = ledger balance, for every
-- account" failed on two accounts, by UGX 88,333.33 and by two cents.
--
-- Rather than add the same three lines in six more places, the rule now lives
-- in one function. Money is recorded when it has actually been received or
-- paid; a date after today means somebody has mistyped the year, and the entry
-- would quietly unbalance every report that is drawn up to a date.
-- ===========================================================================

create or replace function assert_not_future(p_on date, p_label text default 'An entry')
returns void
language plpgsql
immutable
set search_path = public
as $fn$
begin
  if p_on is not null and p_on > current_date then
    raise exception '% cannot be dated in the future.', p_label
      using errcode = 'check_violation';
  end if;
end;
$fn$;

comment on function assert_not_future(date, text) is
  'Refuses a value date after today. The single owner of that rule for every money-posting function (0041).';

revoke all on function assert_not_future(date, text) from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- record_loan_repayment
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_loan_repayment(p_loan_id uuid, p_amount numeric, p_paid_on date DEFAULT CURRENT_DATE, p_method payment_method DEFAULT 'cash'::payment_method, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_loan       loans;
  v_old        jsonb;
  v_member     members;
  v_txn        transactions;
  v_rep        loan_repayments;
  v_paid       numeric(16,2);
  v_outstanding numeric(16,2);
  v_int_paid   numeric(16,2);
  v_int_part   numeric(16,2);
  v_prin_part  numeric(16,2);
  v_next_due   date;
  v_completed  boolean := false;
  v_inc_cat    uuid;
begin
  perform assert_permission('loans.repay');
  perform assert_not_future(p_paid_on, 'A repayment');

  if p_amount is null or p_amount <= 0 then
    raise exception 'Repayment amount must be greater than zero.' using errcode = 'check_violation';
  end if;

  select * into v_loan from loans where id = p_loan_id for update;
  if not found then
    raise exception 'Loan not found.' using errcode = 'no_data_found';
  end if;
  v_old := to_jsonb(v_loan);

  if v_loan.status not in ('active', 'disbursed', 'defaulted') then
    raise exception 'Repayments can only be recorded against an active loan (this one is %).',
      v_loan.status using errcode = 'check_violation';
  end if;

  select coalesce(sum(r.amount), 0) into v_paid
    from loan_repayments r
    join transactions t on t.id = r.transaction_id
   where r.loan_id = p_loan_id and t.status = 'posted';

  v_outstanding := v_loan.total_payable - v_paid;

  if p_amount > v_outstanding + 0.005 then
    raise exception 'Payment of UGX % exceeds the outstanding balance of UGX %.',
      to_char(p_amount, 'FM999,999,999'), to_char(v_outstanding, 'FM999,999,999')
      using errcode = 'check_violation';
  end if;

  select * into v_member from members where id = v_loan.member_id;

  v_txn := post_transaction(
    v_loan.member_id, 'loan_repayment', p_amount, p_method, p_paid_on,
    format('Repayment on loan %s', v_loan.loan_no), p_idempotency_key
  );

  select * into v_rep from loan_repayments where transaction_id = v_txn.id;
  if not found then
    update transactions set loan_id = v_loan.id where id = v_txn.id;

    -- Interest first, then principal - the standard SACCO allocation order.
    select coalesce(sum(r.interest_portion), 0) into v_int_paid
      from loan_repayments r
      join transactions t on t.id = r.transaction_id
     where r.loan_id = p_loan_id and t.status = 'posted';

    v_int_part  := least(p_amount, greatest(v_loan.interest_amount - v_int_paid, 0));
    v_prin_part := p_amount - v_int_part;

    insert into loan_repayments (loan_id, member_id, amount, principal_portion,
                                 interest_portion, paid_on, method, transaction_id, recorded_by)
    values (p_loan_id, v_loan.member_id, p_amount, v_prin_part, v_int_part,
            coalesce(p_paid_on, current_date), p_method, v_txn.id, auth.uid())
    returning * into v_rep;

    -- Interest actually collected is SACCO income.
    if v_int_part > 0 then
      select id into v_inc_cat from income_categories where name = 'Loan interest';
      if v_inc_cat is not null then
        insert into income_entries (category_id, amount, description, received_on, method,
                                    member_id, loan_id, transaction_id, recorded_by)
        values (v_inc_cat, v_int_part,
                format('Interest collected on loan %s', v_loan.loan_no),
                coalesce(p_paid_on, current_date), p_method,
                v_loan.member_id, v_loan.id, v_txn.id, auth.uid());
      end if;
    end if;

    v_paid        := v_paid + p_amount;
    v_outstanding := v_loan.total_payable - v_paid;
    v_completed   := v_outstanding <= 0.005;

    update loans
       set status       = case when v_completed then 'completed'::loan_status else 'active'::loan_status end,
           completed_on = case when v_completed then coalesce(p_paid_on, current_date) else null end
     where id = p_loan_id;

    -- Release guarantors once the debt is cleared.
    if v_completed then
      update loan_guarantors set status = 'released', responded_on = current_date
       where loan_id = p_loan_id and status in ('pending', 'accepted');
    end if;

    perform write_audit('loan.repayment', 'Loans', v_rep.id::text,
      format('Repayment of UGX %s on loan %s by %s', to_char(p_amount, 'FM999,999,999'),
             v_loan.loan_no, v_member.full_name),
      v_old, to_jsonb(v_rep), null);
  else
    v_completed   := (v_loan.total_payable - v_paid) <= 0.005;
    v_outstanding := v_loan.total_payable - v_paid;
  end if;

  select min(s.due_on) into v_next_due
    from loan_schedule s
   where s.loan_id = p_loan_id
     and s.due_on > coalesce(p_paid_on, current_date);

  return jsonb_build_object(
    'transaction_id', v_txn.id,
    'reference',      v_txn.reference,
    'repayment_id',   v_rep.id,
    'amount',         p_amount,
    'total_paid',     v_paid,
    'outstanding',    greatest(v_outstanding, 0),
    'completed',      v_completed,
    'next_due_on',    v_next_due
  );
end;
$function$;

-- --------------------------------------------------------------------------
-- record_savings_payment
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_savings_payment(p_member_id uuid, p_kind savings_kind, p_amount numeric, p_paid_on date DEFAULT CURRENT_DATE, p_method payment_method DEFAULT 'cash'::payment_method, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_period  savings_periods;
  v_member  members;
  v_res     jsonb;
begin
  perform assert_capability(can_record_savings(), 'record savings');
  perform assert_not_future(p_paid_on, 'A payment');

  if p_amount is null or p_amount <= 0 then
    raise exception 'Savings amount must be greater than zero.' using errcode = 'check_violation';
  end if;

  select * into v_member from members where id = p_member_id;
  if not found then
    raise exception 'Member not found.' using errcode = 'no_data_found';
  end if;
  if v_member.status <> 'active' then
    raise exception 'Savings cannot be recorded for a % member.', v_member.status
      using errcode = 'check_violation';
  end if;

  v_period := ensure_savings_period(p_member_id, p_kind, coalesce(p_paid_on, current_date));

  if v_period.status = 'waived' then
    raise exception 'This period has been waived. Remove the waiver before recording a payment.'
      using errcode = 'check_violation';
  end if;

  -- One collection path, so the two entry points cannot drift apart.
  v_res := record_scheduled_savings(v_period.id, p_amount, coalesce(p_paid_on, current_date),
                                    p_method, null, null, p_idempotency_key);

  return v_res || jsonb_build_object(
    'period_id', v_period.id,
    'balance',   v_res -> 'outstanding'
  );
end;
$function$;

-- --------------------------------------------------------------------------
-- buy_shares
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.buy_shares(p_member_id uuid, p_quantity integer, p_method payment_method DEFAULT 'cash'::payment_method, p_purchased_on date DEFAULT CURRENT_DATE, p_note text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_price numeric(16,2);
  v_total numeric(16,2);
  v_txn   transactions;
  v_lot   share_lots;
  v_member members;
begin
  perform assert_permission('shares.sell');
  perform assert_not_future(p_purchased_on, 'A share purchase');

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Number of shares must be at least 1.' using errcode = 'check_violation';
  end if;

  select * into v_member from members where id = p_member_id for update;
  if not found then
    raise exception 'Member not found.' using errcode = 'no_data_found';
  end if;
  if v_member.status <> 'active' then
    raise exception 'Shares cannot be sold to a % member.', v_member.status
      using errcode = 'check_violation';
  end if;

  v_price := share_unit_price();
  if v_price is null or v_price <= 0 then
    raise exception 'The share price has not been set. Set it under Settings before recording a purchase.'
      using errcode = 'check_violation';
  end if;

  v_total := v_price * p_quantity;

  v_txn := post_transaction(
    p_member_id, 'share_purchase', v_total, p_method, p_purchased_on,
    format('Purchase of %s share(s) at UGX %s each', p_quantity, to_char(v_price, 'FM999,999,999')),
    p_idempotency_key
  );

  -- Idempotent replay: the ledger row already existed, so does the lot.
  select * into v_lot from share_lots where transaction_id = v_txn.id;
  if not found then
    insert into share_lots (member_id, quantity, unit_price, purchased_on,
                            transaction_id, note, recorded_by)
    values (p_member_id, p_quantity, v_price, coalesce(p_purchased_on, current_date),
            v_txn.id, p_note, auth.uid())
    returning * into v_lot;

    update transactions set share_lot_id = v_lot.id where id = v_txn.id;

    perform write_audit('shares.purchased', 'Shares', v_lot.id::text,
      format('%s bought %s share(s) for UGX %s', v_member.full_name, p_quantity,
             to_char(v_total, 'FM999,999,999')),
      null, to_jsonb(v_lot), p_note);
  end if;

  return jsonb_build_object(
    'transaction_id', v_txn.id,
    'reference',      v_txn.reference,
    'share_lot_id',   v_lot.id,
    'quantity',       v_lot.quantity,
    'unit_price',     v_lot.unit_price,
    'total_value',    v_lot.total_value
  );
end;
$function$;

-- --------------------------------------------------------------------------
-- record_cash_movement
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_cash_movement(p_member_id uuid, p_type txn_type, p_amount numeric, p_method payment_method DEFAULT 'cash'::payment_method, p_occurred_on date DEFAULT CURRENT_DATE, p_description text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_txn     transactions;
  v_member  members;
  v_balance numeric(16,2);
  v_limit   numeric;
  v_min     numeric;
begin
  perform assert_permission('cash.movement');
  perform assert_not_future(p_occurred_on, 'A deposit or withdrawal');

  if p_type not in ('deposit', 'withdrawal') then
    raise exception 'Only deposits and withdrawals are handled here.'
      using errcode = 'check_violation';
  end if;

  select * into v_member from members where id = p_member_id for update;
  if not found then
    raise exception 'Member not found.' using errcode = 'no_data_found';
  end if;

  -- ---- Configured limits ------------------------------------------------
  --
  -- Checked before anything is written, and phrased so the cashier is told the
  -- rule as well as the refusal: "the smallest deposit is UGX 5,000" is
  -- actionable in a way that "invalid amount" is not.

  if p_type = 'deposit' then
    v_min := setting_number('financial.min_deposit');
    if v_min > 0 and p_amount < v_min then
      raise exception 'The smallest deposit this SACCO accepts is UGX %.',
        to_char(v_min, 'FM999,999,999') using errcode = 'check_violation';
    end if;
  else
    v_min := setting_number('financial.min_withdrawal');
    if v_min > 0 and p_amount < v_min then
      raise exception 'The smallest withdrawal this SACCO allows is UGX %.',
        to_char(v_min, 'FM999,999,999') using errcode = 'check_violation';
    end if;

    v_limit := setting_number('financial.max_withdrawal_per_transaction');
    if v_limit > 0 and p_amount > v_limit then
      raise exception 'A single withdrawal may not exceed UGX %. Split it or seek approval.',
        to_char(v_limit, 'FM999,999,999') using errcode = 'check_violation';
    end if;
  end if;

  -- Cash specifically, whichever direction it moves. Larger sums are expected
  -- to go through the bank or mobile money, where there is a second record.
  if p_method = 'cash' then
    v_limit := setting_number('financial.max_cash_transaction');
    if v_limit > 0 and p_amount > v_limit then
      raise exception
        'Cash transactions are limited to UGX %. Use a bank transfer or mobile money for more.',
        to_char(v_limit, 'FM999,999,999') using errcode = 'check_violation';
    end if;
  end if;

  -- ---- Balance ----------------------------------------------------------

  if p_type = 'withdrawal' then
    -- Withdrawals are settled against savings only; share capital is not liquid.
    select coalesce(sum(case when t.type in ('weekly_savings', 'monthly_savings', 'deposit')
                             then t.amount else -t.amount end), 0)
      into v_balance
      from transactions t
     where t.member_id = p_member_id
       and t.status = 'posted'
       and t.type in ('weekly_savings', 'monthly_savings', 'deposit', 'withdrawal');

    if p_amount > v_balance then
      raise exception 'Withdrawal of UGX % exceeds the available savings balance of UGX %.',
        to_char(p_amount, 'FM999,999,999'), to_char(v_balance, 'FM999,999,999')
        using errcode = 'check_violation';
    end if;

    -- Settings -> Members -> the savings balance a member must keep.
    v_min := coalesce(setting_number('members.min_savings_balance'), 0);
    if v_min > 0 and v_balance - p_amount < v_min then
      raise exception 'Members must keep at least UGX % in savings. The most that can be withdrawn now is UGX %.',
        to_char(v_min, 'FM999,999,999'), to_char(greatest(v_balance - v_min, 0), 'FM999,999,999')
        using errcode = 'check_violation';
    end if;
  end if;

  v_txn := post_transaction(p_member_id, p_type, p_amount, p_method, p_occurred_on,
                            coalesce(p_description, initcap(p_type::text)), p_idempotency_key);

  perform write_audit('cash.' || p_type::text, 'Financials', v_txn.id::text,
    format('%s of UGX %s for %s', initcap(p_type::text),
           to_char(p_amount, 'FM999,999,999'), v_member.full_name),
    null, to_jsonb(v_txn), p_description);

  return jsonb_build_object('transaction_id', v_txn.id, 'reference', v_txn.reference,
                            'amount', p_amount, 'type', p_type);
end;
$function$;

-- --------------------------------------------------------------------------
-- record_income
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_income(p_category_id uuid, p_amount numeric, p_description text, p_received_on date DEFAULT CURRENT_DATE, p_method payment_method DEFAULT 'cash'::payment_method, p_member_id uuid DEFAULT NULL::uuid, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_txn transactions;
  v_row income_entries;
begin
  perform assert_capability(can_record_finance(), 'record income');
  perform assert_not_future(p_received_on, 'Income');

  v_txn := post_transaction(p_member_id, 'income', p_amount, p_method, p_received_on,
                            p_description, p_idempotency_key);

  select * into v_row from income_entries where transaction_id = v_txn.id;
  if not found then
    insert into income_entries (category_id, amount, description, received_on, method,
                                member_id, transaction_id, recorded_by)
    values (p_category_id, p_amount, p_description, coalesce(p_received_on, current_date),
            p_method, p_member_id, v_txn.id, auth.uid())
    returning * into v_row;

    update transactions set income_id = v_row.id where id = v_txn.id;

    perform write_audit('income.recorded', 'Financials', v_row.id::text,
      format('Income of UGX %s recorded', to_char(p_amount, 'FM999,999,999')),
      null, to_jsonb(v_row), p_description);
  end if;

  return jsonb_build_object('transaction_id', v_txn.id, 'reference', v_txn.reference,
                            'income_id', v_row.id);
end;
$function$;

-- --------------------------------------------------------------------------
-- disburse_loan
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.disburse_loan(p_loan_id uuid, p_method payment_method DEFAULT 'cash'::payment_method, p_disbursed_on date DEFAULT NULL::date, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_loan    loans;
  v_old     jsonb;
  v_txn     transactions;
  v_member  members;
  v_first   date;
  v_on      date;
  v_i       integer;
  v_n       integer;
  v_step    interval;
  v_prin    numeric(16,2);
  v_int     numeric(16,2);
  v_fee_txn transactions;
  v_inc_cat uuid;
  v_fee     record;
begin
  perform assert_permission('loans.disburse');
  perform assert_not_future(p_disbursed_on, 'A disbursement');

  select * into v_loan from loans where id = p_loan_id for update;
  if not found then
    raise exception 'Loan not found.' using errcode = 'no_data_found';
  end if;
  v_old := to_jsonb(v_loan);

  if v_loan.status <> 'approved' then
    raise exception 'Only an approved loan can be disbursed (this one is %).', v_loan.status
      using errcode = 'check_violation';
  end if;

  select * into v_member from members where id = v_loan.member_id;
  v_on := coalesce(p_disbursed_on, current_date);

  v_txn := post_transaction(
    v_loan.member_id, 'loan_disbursement', v_loan.principal, p_method, v_on,
    format('Disbursement of loan %s', v_loan.loan_no), p_idempotency_key
  );
  update transactions set loan_id = v_loan.id where id = v_txn.id;

  select id into v_inc_cat from income_categories where name = 'Service charges';

  -- The three fees the loan carries, each booked only if it is charged. They
  -- are read from the loan, not the product: a fee raised since this loan was
  -- agreed is not a fee this member consented to.
  for v_fee in
    select * from (values
      ('Processing fee',  v_loan.processing_fee,  'fee'),
      ('Insurance fee',   v_loan.insurance_fee,   'ins'),
      ('Application fee', v_loan.application_fee, 'app')
    ) as t(label, amount, suffix)
    where t.amount > 0
  loop
    v_fee_txn := post_transaction(
      v_loan.member_id, 'fee', v_fee.amount, 'internal', v_on,
      format('%s on loan %s', v_fee.label, v_loan.loan_no),
      case when p_idempotency_key is null then null
           else p_idempotency_key || ':' || v_fee.suffix end
    );
    update transactions set loan_id = v_loan.id where id = v_fee_txn.id;

    if v_inc_cat is not null then
      insert into income_entries (category_id, amount, description, received_on, method,
                                  member_id, loan_id, transaction_id, recorded_by)
      values (v_inc_cat, v_fee.amount,
              format('%s on loan %s', v_fee.label, v_loan.loan_no),
              v_on, 'internal', v_loan.member_id, v_loan.id, v_fee_txn.id, auth.uid())
      on conflict do nothing;
    end if;
  end loop;

  v_n    := coalesce(v_loan.installment_count,
                     loan_installments_for(v_loan.period_months, v_loan.repayment_frequency));
  v_step := loan_installment_step(v_loan.repayment_frequency);

  -- The first payment falls one whole period after disbursement, plus any
  -- grace period the product granted.
  v_first := (v_on + v_step + (v_loan.grace_period_days || ' days')::interval)::date;

  update loans
     set status       = 'active',
         disbursed_on = v_on,
         disbursed_by = auth.uid(),
         first_due_on = v_first,
         installment_count = v_n
   where id = p_loan_id
   returning * into v_loan;

  -- Build the amortisation schedule once, at disbursement.
  delete from loan_schedule where loan_id = v_loan.id;
  v_prin := round(v_loan.principal / v_n, 2);
  v_int  := round(v_loan.interest_amount / v_n, 2);
  for v_i in 1 .. v_n loop
    insert into loan_schedule (loan_id, installment_no, due_on,
                               principal_due, interest_due, total_due)
    values (
      v_loan.id, v_i,
      (v_first + (v_step * (v_i - 1)))::date,
      -- The last installment absorbs rounding so the schedule sums exactly.
      case when v_i < v_n then v_prin
           else v_loan.principal - v_prin * (v_n - 1) end,
      case when v_i < v_n then v_int
           else v_loan.interest_amount - v_int * (v_n - 1) end,
      case when v_i < v_n then v_prin + v_int
           else v_loan.total_payable - (v_prin + v_int) * (v_n - 1) end
    );
  end loop;

  perform write_audit('loan.disbursed', 'Loans', v_loan.id::text,
    format('Loan %s of UGX %s disbursed to %s', v_loan.loan_no,
           to_char(v_loan.principal, 'FM999,999,999'), v_member.full_name),
    v_old, to_jsonb(v_loan), null);

  insert into notifications (user_id, title, body, kind, link)
  select v_member.user_id, 'Loan disbursed',
         format('UGX %s has been disbursed. Your first payment of UGX %s is due %s.',
                to_char(v_loan.principal, 'FM999,999,999'),
                to_char(v_loan.installment_amount, 'FM999,999,999'),
                to_char(v_first, 'DD Mon YYYY')),
         'success', '/loans/' || v_loan.id
   where v_member.user_id is not null;

  return jsonb_build_object('loan_id', v_loan.id, 'loan_no', v_loan.loan_no,
                            'status', v_loan.status, 'reference', v_txn.reference,
                            'transaction_id', v_txn.id, 'first_due_on', v_first,
                            'installments', v_n);
end;
$function$;

-- ---------------------------------------------------------------------------
-- The grants these carry are unchanged; restated so a replay of this file
-- alone leaves the API surface exactly as 0030 §14 set it.
-- ---------------------------------------------------------------------------
do $grants$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('record_loan_repayment', 'record_savings_payment', 'buy_shares',
                         'record_cash_movement', 'record_income', 'disburse_loan')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end
$grants$;
