-- ===========================================================================
-- 0036 - Fixes from the production-readiness audit
--
--   1. Uganda time. The database ran in UTC, so between midnight and 3 a.m. in
--      Kampala `current_date` was still yesterday: a payment dated today was
--      refused as "in the future", and "today" on the dashboard and in reports
--      was the wrong day. The SACCO's calendar is East Africa Time.
--   2. dashboard_metrics(): income and expenses this month counted entries
--      whose transaction had been reversed, so the dashboard disagreed with the
--      cashbook, which already excluded them.
--   3. reverse_transaction():
--        - reversing a loan disbursement left the loan active with its full
--          schedule (the member owed money that had been taken back) and left
--          the fees booked with it in place (the bank balance ended higher than
--          the bank). It now refuses while repayments stand, reverses the fees
--          with the disbursement, and returns the loan to Approved.
--        - reversing a repayment that reopens a completed loan left its
--          guarantors released; they are bound again.
--   4. Savings plans were written with two separate statements straight from
--      the app: a second change on the same day hit the unique key after the
--      old plan had been closed, leaving the member with no plan, and any
--      holder of the write policy could edit a past plan with no audit trail.
--      One audited function now does it atomically; direct writes are revoked.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Uganda time for every new session. Timestamps are stored as timestamptz
--    and are unaffected; only "what day is it" and date arithmetic change.
-- ---------------------------------------------------------------------------
do $$
begin
  execute format('alter database %I set timezone to %L', current_database(), 'Africa/Kampala');
end $$;
set timezone to 'Africa/Kampala';

-- ---------------------------------------------------------------------------
-- 2. Dashboard income and expenses exclude reversed entries.
-- ---------------------------------------------------------------------------
create or replace function dashboard_metrics()
returns jsonb
language plpgsql
stable security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  perform assert_capability(can_view_operations(), 'view the dashboard');

  select jsonb_build_object(
    'total_members',      (select count(*) from members where status = 'active'),
    'members_this_month', (select count(*) from members
                            where joined_on >= date_trunc('month', current_date)),
    'share_capital',      (select coalesce(sum(sl.total_value), 0)
                             from share_lots sl
                             join transactions t on t.id = sl.transaction_id
                            where t.status = 'posted'),
    'total_savings',      (select coalesce(sum(
                              case when type in ('weekly_savings', 'monthly_savings', 'deposit')
                                   then amount else -amount end), 0)
                             from transactions
                            where status = 'posted'
                              and type in ('weekly_savings', 'monthly_savings', 'deposit', 'withdrawal')),
    'active_loan_count',  (select count(*) from loans where status in ('active', 'disbursed')),
    'active_loan_value',  (select coalesce(sum(principal), 0) from loans
                            where status in ('active', 'disbursed')),
    'outstanding_loans',  (select coalesce(sum(outstanding), 0) from loan_balances
                            where status in ('active', 'disbursed', 'defaulted')),
    'overdue_loans',      (select coalesce(sum(overdue_amount), 0) from loan_balances
                            where status in ('active', 'disbursed', 'defaulted')),
    'overdue_count',      (select count(*) from loan_balances
                            where status in ('active', 'disbursed', 'defaulted')
                              and overdue_amount > 0),
    'pending_loans',      (select count(*) from loans where status in ('applied', 'under_review')),
    'todays_collections', (select coalesce(sum(amount), 0) from transactions
                            where status = 'posted' and occurred_on = current_date
                              and type in ('weekly_savings', 'monthly_savings', 'deposit',
                                           'share_purchase', 'loan_repayment')),
    -- Same rule as cashbook(): an entry whose transaction was reversed is not
    -- income or expense any more.
    'income_mtd',         (select coalesce(sum(i.amount), 0)
                             from income_entries i
                             left join transactions t on t.id = i.transaction_id
                            where i.received_on >= date_trunc('month', current_date)
                              and coalesce(t.status, 'posted') = 'posted'),
    'expenses_mtd',       (select coalesce(sum(e.amount), 0)
                             from expense_entries e
                             left join transactions t on t.id = e.transaction_id
                            where e.approval = 'approved'
                              and e.spent_on >= date_trunc('month', current_date)
                              and coalesce(t.status, 'posted') = 'posted'),
    'pending_expenses',   (select count(*) from expense_entries where approval = 'pending'),

    'savings_categories', (select count(*) from savings_categories where status = 'active'),
    'share_categories',   (select count(*) from share_categories where status = 'active'),
    'members_uncategorised', (select count(*) from members
                               where status = 'active' and savings_category_id is null),
    'schedules_due_today',(select count(*) from savings_periods
                            where coalesce(due_on, period_end) = current_date
                              and status in ('pending', 'partial')),
    'savings_arrears',    (select coalesce(sum(greatest(expected_amount - paid_amount, 0)), 0)
                             from savings_periods
                            where status in ('partial', 'missed'))
  ) into v;

  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Reversals that keep loans honest.
-- ---------------------------------------------------------------------------
create or replace function reverse_transaction(p_transaction_id uuid, p_reason text,
                                               p_reversal_date date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
  values (next_document_no('TX'), v_orig.member_id, v_orig.type, 'reversal', v_orig.amount,
          v_orig.method, v_on,
          'Reversal of ' || v_orig.reference, v_orig.loan_id, v_orig.savings_id,
          v_orig.share_lot_id, v_orig.income_id, v_orig.expense_id,
          v_orig.id, p_reason, auth.uid())
  returning * into v_rev;

  update transactions
     set status = 'reversed', reversed_by_id = v_rev.id, reversal_reason = p_reason
   where id = v_orig.id;

  if v_orig.type in ('weekly_savings', 'monthly_savings') and v_orig.savings_id is not null then
    select period_id into v_period_id from savings_payments where id = v_orig.savings_id;
    if v_period_id is not null then
      select coalesce(sum(sp.amount), 0) into v_paid
        from savings_payments sp
        join transactions t on t.id = sp.transaction_id
       where sp.period_id = v_period_id and t.status = 'posted';

      select expected_amount into v_exp from savings_periods where id = v_period_id;

      update savings_periods
         set paid_amount = v_paid,
             status = case
               when v_exp > 0 and v_paid >= v_exp then 'paid'
               when v_paid > 0 then 'partial'
               when v_exp = 0 then 'pending'
               when period_end < current_date then 'missed'
               else 'pending' end
       where id = v_period_id;
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
$$;

-- ---------------------------------------------------------------------------
-- 4. Savings plans: one audited, atomic door.
-- ---------------------------------------------------------------------------
create or replace function set_savings_plan(p_member_id uuid, p_kind savings_kind,
                                            p_target_amount numeric, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member members;
  v_old    savings_plans;
  v_new    savings_plans;
begin
  perform assert_capability(can_record_savings(), 'set savings targets');

  if p_target_amount is null or p_target_amount < 0 then
    raise exception 'Enter a target of zero or more.' using errcode = 'check_violation';
  end if;

  select * into v_member from members where id = p_member_id for update;
  if not found then
    raise exception 'Member not found.' using errcode = 'no_data_found';
  end if;

  select * into v_old from savings_plans
   where member_id = p_member_id and kind = p_kind and active_to is null
   order by active_from desc limit 1
   for update;

  if found and v_old.target_amount = p_target_amount then
    return jsonb_build_object('id', v_old.id, 'changed', false);
  end if;

  if found and v_old.active_from >= current_date then
    -- A second change on the same day corrects today's plan rather than
    -- stacking a plan that was never in force.
    update savings_plans set target_amount = p_target_amount
     where id = v_old.id returning * into v_new;
  else
    if found then
      -- Past periods keep the target they were actually judged against.
      update savings_plans set active_to = current_date - 1 where id = v_old.id;
    end if;
    insert into savings_plans (member_id, kind, target_amount, active_from)
    values (p_member_id, p_kind, p_target_amount, current_date)
    returning * into v_new;
  end if;

  perform write_audit('savings.plan_set', 'Savings', p_member_id::text,
    format('%s savings target for %s (%s) set to %s', initcap(p_kind::text), v_member.full_name,
           v_member.member_no, ugx(p_target_amount)),
    to_jsonb(v_old), to_jsonb(v_new), nullif(btrim(coalesce(p_reason, '')), ''));

  return jsonb_build_object('id', v_new.id, 'changed', true);
end;
$$;

revoke all on function set_savings_plan(uuid, savings_kind, numeric, text) from public, anon;
grant execute on function set_savings_plan(uuid, savings_kind, numeric, text) to authenticated;

-- Nothing writes plans directly any more.
revoke insert, update, delete on savings_plans from authenticated;
drop policy if exists savings_plans_staff_write on savings_plans;

-- ---------------------------------------------------------------------------
-- 5. The session timeout is enforced by the application (middleware idle
--    sign-out); its description said Supabase Auth enforced it, which it did
--    not, so the setting did nothing.
-- ---------------------------------------------------------------------------
update system_settings
   set description = 'Minutes a signed-in session may sit idle before it is signed out. Takes effect from each person''s next sign-in.'
 where key = 'security.session_timeout_minutes';
