-- ===========================================================================
-- 0037 - Every setting on the Settings screen does what it says
--
-- The audit found sixteen settings that were shown and editable but read by
-- nothing: changing them changed nothing. A control that silently does nothing
-- is worse than no control, so each one is now either enforced or removed.
--
-- Enforced here (the application enforces three more: the receipt balance
-- line, the statement footer and the loan-product defaults):
--   notifications.notify_on_loan_decision   set_loan_status()
--   members.min_savings_balance             record_cash_movement()
--   savings.allow_partial_payment           savings_payment_minimum_gate()
--
-- Removed, because nothing implements them and implementing them would be new
-- features rather than fixes (reminder jobs, penalty postings, fees on
-- withdrawals, automatic loan approval, a business-day calendar, a
-- financial-year setting no report reads, an undefined "advance payment"
-- rule, and a duplicate of members.registration_requires_categories).
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.set_loan_status(p_loan_id uuid, p_status loan_status, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_loan loans;
  v_old  jsonb;
begin
  select * into v_loan from loans where id = p_loan_id for update;
  if not found then
    raise exception 'Loan not found.' using errcode = 'no_data_found';
  end if;
  v_old := to_jsonb(v_loan);

  -- Who may move the loan to which state.
  case p_status
    when 'under_review' then perform assert_permission('loans.assess');
    when 'approved'     then perform assert_permission('loans.approve');
    when 'rejected'     then perform assert_permission('loans.assess');
    else raise exception 'Use the dedicated function for the % state.', p_status
           using errcode = 'check_violation';
  end case;

  -- Legal transitions only.
  if p_status = 'under_review' and v_loan.status <> 'applied' then
    raise exception 'Only an applied loan can be moved to review.' using errcode = 'check_violation';
  end if;
  if p_status = 'approved' and v_loan.status not in ('applied', 'under_review') then
    raise exception 'Only a loan under review can be approved.' using errcode = 'check_violation';
  end if;
  if p_status = 'rejected' and v_loan.status not in ('applied', 'under_review') then
    raise exception 'Only a pending loan can be rejected.' using errcode = 'check_violation';
  end if;
  if p_status = 'rejected' and coalesce(trim(p_reason), '') = '' then
    raise exception 'A rejection reason is required.' using errcode = 'check_violation';
  end if;

  update loans
     set status      = p_status,
         reviewed_on = case when p_status = 'under_review' then current_date else reviewed_on end,
         approved_on = case when p_status = 'approved'     then current_date else approved_on end,
         approved_by = case when p_status = 'approved'     then auth.uid()   else approved_by end,
         rejected_on = case when p_status = 'rejected'     then current_date else rejected_on end,
         rejected_by = case when p_status = 'rejected'     then auth.uid()   else rejected_by end,
         rejection_reason = case when p_status = 'rejected' then p_reason else rejection_reason end,
         review_notes = case when p_status = 'under_review' then coalesce(p_reason, review_notes)
                             else review_notes end
   where id = p_loan_id
   returning * into v_loan;

  perform write_audit('loan.' || p_status::text, 'Loans', v_loan.id::text,
    format('Loan %s moved to %s', v_loan.loan_no, replace(p_status::text, '_', ' ')),
    v_old, to_jsonb(v_loan), p_reason);

  -- Tell the member.
  insert into notifications (user_id, title, body, kind, link)
  select m.user_id,
         case when p_status = 'approved' then 'Loan approved'
              when p_status = 'rejected' then 'Loan application declined'
              else 'Loan under review' end,
         case when p_status = 'approved'
                then format('Your loan %s for UGX %s has been approved.', v_loan.loan_no,
                            to_char(v_loan.principal, 'FM999,999,999'))
              when p_status = 'rejected'
                then format('Your loan %s was not approved. Reason: %s', v_loan.loan_no, p_reason)
              else format('Your loan %s is being reviewed.', v_loan.loan_no) end,
         case when p_status = 'approved' then 'success'
              when p_status = 'rejected' then 'error' else 'info' end,
         '/loans/' || v_loan.id
    from members m
   where m.id = v_loan.member_id and m.user_id is not null
     -- Settings -> Notifications -> "Notify members of loan decisions".
     and (p_status = 'under_review'
          or coalesce(setting_bool('notifications.notify_on_loan_decision'), true));

  return jsonb_build_object('loan_id', v_loan.id, 'loan_no', v_loan.loan_no, 'status', v_loan.status);
end;
$function$;

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

CREATE OR REPLACE FUNCTION public.savings_payment_minimum_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_kind savings_kind;
  v_min  numeric;
  v_exp  numeric;
  v_paid numeric;
begin
  select kind, expected_amount into v_kind, v_exp from savings_periods where id = new.period_id;
  if v_kind is null then
    return new;
  end if;

  v_min := case v_kind
             when 'weekly'  then setting_number('savings.min_weekly_amount')
             else                setting_number('savings.min_monthly_amount')
           end;

  if v_min > 0 and new.amount < v_min then
    raise exception 'The smallest % saving this SACCO accepts is UGX %.',
      v_kind, to_char(v_min, 'FM999,999,999') using errcode = 'check_violation';
  end if;

  -- Settings -> Savings -> "Allow part payments". When off, a payment must
  -- bring the schedule up to what the member is expected to save.
  if v_exp > 0 and not coalesce(setting_bool('savings.allow_partial_payment'), true) then
    select coalesce(sum(sp.amount), 0) into v_paid
      from savings_payments sp
      join transactions t on t.id = sp.transaction_id
     where sp.period_id = new.period_id and t.status = 'posted';
    if v_paid + new.amount < v_exp then
      raise exception 'Part payments are switched off. This schedule needs UGX % more to be paid in full.',
        to_char(v_exp - v_paid, 'FM999,999,999') using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$function$;

delete from system_settings where key in (
  'categories.require_savings_category',
  'financial.financial_year_start_month',
  'financial.withdrawal_fee',
  'loans.auto_approve_limit',
  'notifications.collection_reminder_days',
  'notifications.loan_due_reminder_days',
  'savings.allow_advance_payment',
  'savings.missed_period_penalty',
  'system.business_days'
);

-- ---------------------------------------------------------------------------
-- Loan products are the SACCO's to define (Loans -> Products). 0005 seeded four
-- with invented rates; a fresh installation replaying the migrations must not
-- open with prices nobody set. Only those seed rows that were never edited and
-- never lent on are removed, so a SACCO that adopted one keeps it.
-- ---------------------------------------------------------------------------
delete from loan_products p
 where p.code in ('BIZ', 'EMG', 'SCH', 'AGR')
   and p.updated_by is null
   and not exists (select 1 from loans l where l.product_id = p.id);
