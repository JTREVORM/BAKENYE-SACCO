-- ===========================================================================
-- 0039 — Savings period recompute, and the reversal it unblocks (finding V-1)
--
-- Reversing a savings payment raised:
--
--   ERROR: column "status" is of type savings_status but expression is of
--          type text
--
-- reverse_transaction() rewrote the savings period's status from a CASE of
-- bare string literals. PostgreSQL types such a CASE as `text` and will not
-- assign it to an enum column. No savings payment could be reversed at all,
-- which is the SACCO's documented way of correcting money recorded against
-- the wrong member.
--
-- The same "recompute a period from its payment rows" arithmetic also existed
-- a second time, in record_scheduled_savings(), and the two had already
-- drifted apart: for a period expecting nothing that had money paid into it,
-- collection said `paid` and reversal said `partial`.
--
-- So the fix is one typed function that owns the arithmetic, called from both
-- paths. Behaviour is preserved exactly, with that one divergence resolved in
-- favour of the collection path (`paid`): a period that expects nothing has
-- nothing outstanding.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The arithmetic, in one place, correctly typed.
-- ---------------------------------------------------------------------------
create or replace function recompute_savings_period(p_period_id uuid)
returns table (paid_amount numeric, status savings_status)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_paid   numeric(16,2);
  v_exp    numeric(16,2);
  v_end    date;
  v_status savings_status;
begin
  select coalesce(sum(sp.amount), 0) into v_paid
    from savings_payments sp
    join transactions t on t.id = sp.transaction_id
   where sp.period_id = p_period_id and t.status = 'posted';

  select sp.expected_amount, sp.period_end into v_exp, v_end
    from savings_periods sp where sp.id = p_period_id;

  if not found then
    raise exception 'Savings period not found.' using errcode = 'no_data_found';
  end if;

  -- A waived period stays waived: a manager excused it in writing, and money
  -- arriving or being reversed afterwards does not overturn that decision.
  if exists (select 1 from savings_periods sp
              where sp.id = p_period_id and sp.status = 'waived') then
    update savings_periods sp set paid_amount = v_paid where sp.id = p_period_id;
    return query select v_paid, 'waived'::savings_status;
    return;
  end if;

  v_status := case
    -- Nothing was expected, and something came in: there is nothing outstanding.
    when v_exp = 0 and v_paid > 0                then 'paid'
    when v_exp > 0 and v_paid >= v_exp           then 'paid'
    when v_paid > 0                              then 'partial'
    -- Nothing expected and nothing paid is not a shortfall.
    when v_exp = 0                               then 'pending'
    when v_end < current_date                    then 'missed'
    else                                              'pending'
  end::savings_status;

  update savings_periods sp
     set paid_amount = v_paid, status = v_status
   where sp.id = p_period_id;

  return query select v_paid, v_status;
end;
$fn$;

comment on function recompute_savings_period(uuid) is
  'Recomputes one savings period''s paid amount and status from the payment rows still posted against it. The single owner of that arithmetic: collection and reversal both call it (0039).';

-- Internal. Only the money functions below call it, and they check their own
-- caller first, so it is not granted to the API roles.
revoke all on function recompute_savings_period(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The collection path, now calling it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_scheduled_savings(p_schedule_id uuid, p_amount numeric, p_paid_on date DEFAULT CURRENT_DATE, p_method payment_method DEFAULT 'cash'::payment_method, p_external_ref text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sched   savings_periods;
  v_member  members;
  v_txn     transactions;
  v_payment savings_payments;
  v_ref     text := nullif(trim(coalesce(p_external_ref, '')), '');
  v_paid    numeric(16,2);
  v_status  savings_status;
  v_cat     text;
begin
  perform assert_capability(can_record_savings(), 'record savings');

  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount greater than zero.' using errcode = 'check_violation';
  end if;
  -- A fat-fingered extra zero on a UGX 100,000 contribution should not become a
  -- ten-billion-shilling ledger entry that has to be reversed.
  if p_amount > 500000000 then
    raise exception 'That amount looks incorrect. Record amounts above UGX 500,000,000 as separate entries.'
      using errcode = 'check_violation';
  end if;

  select * into v_sched from savings_periods where id = p_schedule_id for update;
  if not found then
    raise exception 'That savings schedule no longer exists.' using errcode = 'no_data_found';
  end if;

  if v_sched.status = 'waived' then
    raise exception 'This schedule has been waived. Remove the waiver before recording a payment.'
      using errcode = 'check_violation';
  end if;

  select * into v_member from members where id = v_sched.member_id;
  if v_member.status <> 'active' then
    raise exception 'Savings cannot be recorded for a % member.', v_member.status
      using errcode = 'check_violation';
  end if;

  if p_paid_on > current_date then
    raise exception 'A payment cannot be dated in the future.' using errcode = 'check_violation';
  end if;

  -- Same external reference, different transaction: refuse before posting so
  -- the message names the problem rather than leaking a constraint.
  if v_ref is not null and exists (
    select 1 from transactions
     where upper(external_ref) = upper(v_ref) and status <> 'reversed'
  ) then
    raise exception 'Reference % has already been recorded against another transaction.', v_ref
      using errcode = 'unique_violation';
  end if;

  select name into v_cat from savings_categories where id = v_sched.savings_category_id;

  v_txn := post_transaction(
    v_sched.member_id,
    case when v_sched.kind = 'weekly' then 'weekly_savings'::txn_type
         else 'monthly_savings'::txn_type end,
    p_amount, p_method, p_paid_on,
    coalesce(v_cat, initcap(v_sched.kind::text) || ' savings')
      || ' - ' || v_sched.period_label,
    p_idempotency_key
  );

  select * into v_payment from savings_payments where transaction_id = v_txn.id;

  if not found then
    if v_ref is not null then
      update transactions set external_ref = v_ref where id = v_txn.id;
    end if;

    insert into savings_payments (period_id, schedule_id, member_id, savings_category_id,
                                  amount, paid_on, method, transaction_id,
                                  external_ref, note, recorded_by)
    values (v_sched.id, v_sched.id, v_sched.member_id, v_sched.savings_category_id,
            p_amount, p_paid_on, p_method, v_txn.id, v_ref,
            nullif(trim(coalesce(p_note, '')), ''), auth.uid())
    returning * into v_payment;

    update transactions set savings_id = v_payment.id where id = v_txn.id;

    -- Recomputed from the payment rows, through the one shared function that
    -- owns this arithmetic (0039). Never an incremented column.
    select paid_amount, status into v_paid, v_status
      from recompute_savings_period(v_sched.id);

    perform settle_manual_payment(
      v_sched.member_id,
      case when v_sched.kind = 'weekly' then 'weekly_savings'::txn_type
           else 'monthly_savings'::txn_type end,
      p_amount, p_method, v_sched.id, null, v_txn.id, v_ref, p_idempotency_key
    );

    perform write_audit('savings.recorded', 'Savings', v_payment.id::text,
      format('%s recorded UGX %s savings for %s (%s), %s',
             coalesce((select full_name from app_users where id = auth.uid()), 'system'),
             to_char(p_amount, 'FM999,999,999'), v_member.full_name, v_member.member_no,
             v_sched.period_label),
      null, to_jsonb(v_payment), p_note);
  else
    select paid_amount, status into v_paid, v_status from savings_periods where id = v_sched.id;
  end if;

  return jsonb_build_object(
    'transaction_id', v_txn.id,
    'reference',      v_txn.reference,
    'payment_id',     v_payment.id,
    'schedule_id',    v_sched.id,
    'member_id',      v_sched.member_id,
    'member_name',    v_member.full_name,
    'savings_category', v_cat,
    'period_label',   v_sched.period_label,
    'expected',       v_sched.expected_amount,
    'paid',           v_paid,
    'outstanding',    greatest(v_sched.expected_amount - v_paid, 0),
    'status',         v_status
  );
end;
$function$;


-- ---------------------------------------------------------------------------
-- 3. The reversal path, now calling it — this is the statement that failed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reverse_transaction(p_transaction_id uuid, p_reason text, p_reversal_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_orig      transactions;
  v_rev       transactions;
  v_loan      loans;
  v_fee       record;
  v_on        date := coalesce(p_reversal_date, current_date);
  v_period_id uuid;
  v_paid      numeric(16,2);
  v_exp       numeric(16,2);
begin
  perform assert_permission('transactions.reverse');

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to reverse a transaction.' using errcode = 'check_violation';
  end if;

  select * into v_orig from transactions where id = p_transaction_id for update;
  if not found then
    raise exception 'Transaction not found.' using errcode = 'no_data_found';
  end if;
  if v_orig.status <> 'posted' then
    raise exception 'Transaction % is already %.', v_orig.reference, v_orig.status
      using errcode = 'check_violation';
  end if;
  if v_on > current_date then
    raise exception 'A reversal cannot be dated in the future.' using errcode = 'check_violation';
  end if;
  if v_on < v_orig.occurred_on then
    raise exception 'A reversal cannot be dated before the transaction it reverses (%).',
      to_char(v_orig.occurred_on, 'DD Mon YYYY') using errcode = 'check_violation';
  end if;

  -- A disbursement can only be taken back while nothing has been repaid on it;
  -- otherwise the repayments would be left paying off a loan that never paid out.
  if v_orig.type = 'loan_disbursement' and v_orig.loan_id is not null then
    select * into v_loan from loans where id = v_orig.loan_id for update;
    if exists (select 1 from loan_repayments r
                 join transactions t on t.id = r.transaction_id
                where r.loan_id = v_orig.loan_id and t.status = 'posted') then
      raise exception 'Loan % has repayments recorded against it. Reverse those first, then the disbursement.',
        v_loan.loan_no using errcode = 'check_violation';
    end if;
  end if;

  insert into transactions (reference, member_id, type, status, amount, method,
                            occurred_on, description, loan_id, savings_id, share_lot_id,
                            income_id, expense_id, reverses_id, reversal_reason, recorded_by)
  values (next_document_no('REV'), v_orig.member_id, v_orig.type, 'reversal', v_orig.amount,
          v_orig.method, v_on,
          'Reversal of ' || v_orig.reference, v_orig.loan_id, v_orig.savings_id,
          v_orig.share_lot_id, v_orig.income_id, v_orig.expense_id,
          v_orig.id, p_reason, auth.uid())
  returning * into v_rev;

  update transactions
     set status = 'reversed', reversed_by_id = v_rev.id, reversal_reason = p_reason
   where id = v_orig.id;

  -- The savings period the reversed payment belonged to is recomputed from the
  -- payment rows that are still posted, through the one shared function that
  -- owns this arithmetic (0039). Before that fix this statement built an
  -- untyped CASE and could not assign it to savings_periods.status at all, so
  -- no savings payment could be reversed.
  if v_orig.type in ('weekly_savings', 'monthly_savings') and v_orig.savings_id is not null then
    select period_id into v_period_id from savings_payments where id = v_orig.savings_id;
    if v_period_id is not null then
      perform recompute_savings_period(v_period_id);
    end if;
  end if;

  if v_orig.type = 'loan_repayment' and v_orig.loan_id is not null then
    select * into v_loan from loans where id = v_orig.loan_id for update;
    if v_loan.status = 'completed' then
      update loans set status = 'active', completed_on = null where id = v_loan.id;
      -- The guarantors released when the loan was cleared are bound again,
      -- because the loan is owed again - each back to the standing they really
      -- had: accepted only if their acceptance is on record, otherwise still
      -- waiting for their answer. Consent is never invented.
      update loan_guarantors g
         set status = case when exists (select 1 from audit_logs a
                                         where a.action = 'guarantor.accepted'
                                           and a.record_id = g.id::text)
                           then 'accepted'::guarantor_status
                           else 'pending'::guarantor_status end
       where g.loan_id = v_loan.id and g.status = 'released'
         and g.responded_on is not distinct from v_loan.completed_on;
    end if;
  end if;

  if v_orig.type = 'loan_disbursement' and v_orig.loan_id is not null then
    -- The fees booked out of this disbursement go back with it.
    for v_fee in
      select id from transactions
       where loan_id = v_orig.loan_id and type = 'fee' and method = 'internal'
         and status = 'posted' and occurred_on = v_orig.occurred_on
    loop
      perform reverse_transaction(v_fee.id, p_reason, v_on);
    end loop;

    update loans
       set status = 'approved', disbursed_on = null, disbursed_by = null, first_due_on = null
     where id = v_orig.loan_id;
    delete from loan_schedule where loan_id = v_orig.loan_id;
  end if;

  perform write_audit('transaction.reversed', 'Financials', v_orig.id::text,
    format('Transaction %s (%s) reversed by %s on %s', v_orig.reference, ugx(v_orig.amount),
           v_rev.reference, to_char(v_on, 'DD Mon YYYY')),
    to_jsonb(v_orig), to_jsonb(v_rev), p_reason);

  return jsonb_build_object('original_reference', v_orig.reference,
                            'reversal_reference', v_rev.reference,
                            'reversal_id', v_rev.id);
end;
$function$;


-- ---------------------------------------------------------------------------
-- 4. The grants these two carry are unchanged; restated so a replay of this
--    file alone leaves the API surface exactly as 0030 §14 set it.
-- ---------------------------------------------------------------------------
revoke all on function record_scheduled_savings(uuid, numeric, date, payment_method, text, text, text) from public, anon;
grant execute on function record_scheduled_savings(uuid, numeric, date, payment_method, text, text, text) to authenticated;

revoke all on function reverse_transaction(uuid, text, date) from public, anon;
grant execute on function reverse_transaction(uuid, text, date) to authenticated;
