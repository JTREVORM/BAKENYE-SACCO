-- ===========================================================================
-- BND-SACCO - 0003 - Derived balances, summaries and reporting
--
-- Every figure the UI shows is computed here from the ledger. Nothing in the
-- application layer adds money up in JavaScript.
--
-- All views are `security_invoker` so row-level security still applies: a
-- member selecting from `member_financials` sees exactly one row - their own.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Per-member share position
-- ---------------------------------------------------------------------------
create or replace view member_shares
with (security_invoker = true) as
select
  m.id                                    as member_id,
  coalesce(sum(sl.quantity), 0)::integer  as share_count,
  coalesce(sum(sl.total_value), 0)::numeric(16,2) as share_value,
  max(sl.purchased_on)                    as last_purchase_on
from members m
left join share_lots sl on sl.member_id = m.id
left join transactions t on t.id = sl.transaction_id and t.status = 'posted'
where sl.id is null or t.id is not null
group by m.id;

-- ---------------------------------------------------------------------------
-- Per-member savings position.
--   balance = weekly + monthly + deposits - withdrawals
-- Share capital is deliberately excluded: it is not a savings balance.
-- ---------------------------------------------------------------------------
create or replace view member_savings
with (security_invoker = true) as
select
  m.id as member_id,
  coalesce(sum(case when t.type = 'weekly_savings'  then t.amount else 0 end), 0)::numeric(16,2) as weekly_total,
  coalesce(sum(case when t.type = 'monthly_savings' then t.amount else 0 end), 0)::numeric(16,2) as monthly_total,
  coalesce(sum(case when t.type = 'deposit'         then t.amount else 0 end), 0)::numeric(16,2) as deposits_total,
  coalesce(sum(case when t.type = 'withdrawal'      then t.amount else 0 end), 0)::numeric(16,2) as withdrawals_total,
  coalesce(sum(
    case when t.type in ('weekly_savings', 'monthly_savings', 'deposit') then t.amount
         when t.type = 'withdrawal' then -t.amount
         else 0 end), 0)::numeric(16,2) as savings_balance
from members m
left join transactions t
       on t.member_id = m.id
      and t.status = 'posted'
      and t.type in ('weekly_savings', 'monthly_savings', 'deposit', 'withdrawal')
group by m.id;

-- ---------------------------------------------------------------------------
-- Per-loan position - the single place loan arithmetic happens.
--   outstanding = total_payable - posted repayments
-- ---------------------------------------------------------------------------
create or replace view loan_balances
with (security_invoker = true) as
select
  l.id                as loan_id,
  l.loan_no,
  l.member_id,
  l.status,
  l.principal,
  l.interest_amount,
  l.processing_fee,
  l.total_payable,
  l.installment_amount,
  l.period_months,
  l.disbursed_on,
  coalesce(p.paid, 0)::numeric(16,2)                            as amount_paid,
  (l.total_payable - coalesce(p.paid, 0))::numeric(16,2)        as outstanding,
  case when l.total_payable > 0
       then round(coalesce(p.paid, 0) / l.total_payable * 100, 1)
       else 0 end                                               as percent_repaid,
  n.next_due_on,
  n.next_due_amount,
  -- Overdue = a scheduled installment fell due and cumulative payments still
  -- fall short of everything that was due by that date.
  case
    when l.status in ('active', 'disbursed', 'defaulted')
     and o.overdue_amount > 0 then o.overdue_amount
    else 0 end::numeric(16,2)                                   as overdue_amount,
  o.days_overdue
from loans l
left join lateral (
  select sum(r.amount) as paid
    from loan_repayments r
    join transactions t on t.id = r.transaction_id
   where r.loan_id = l.id and t.status = 'posted'
) p on true
left join lateral (
  select s.due_on as next_due_on, s.total_due as next_due_amount
    from loan_schedule s
   where s.loan_id = l.id and s.due_on >= current_date
   order by s.due_on
   limit 1
) n on true
left join lateral (
  select
    greatest(coalesce(sum(s.total_due), 0) - coalesce(p.paid, 0), 0) as overdue_amount,
    (current_date - min(s.due_on))                                   as days_overdue
    from loan_schedule s
   where s.loan_id = l.id and s.due_on < current_date
) o on true;

-- ---------------------------------------------------------------------------
-- Per-member loan roll-up
-- ---------------------------------------------------------------------------
create or replace view member_loans_summary
with (security_invoker = true) as
select
  m.id as member_id,
  count(*) filter (where lb.status in ('active', 'disbursed', 'defaulted')) as active_loans,
  count(*) filter (where lb.status in ('applied', 'under_review'))          as pending_loans,
  coalesce(sum(lb.outstanding) filter (
    where lb.status in ('active', 'disbursed', 'defaulted')), 0)::numeric(16,2) as loan_balance,
  coalesce(sum(lb.overdue_amount) filter (
    where lb.status in ('active', 'disbursed', 'defaulted')), 0)::numeric(16,2) as overdue_amount,
  min(lb.next_due_on) filter (where lb.status in ('active', 'disbursed'))       as next_due_on,
  (array_agg(lb.next_due_amount order by lb.next_due_on nulls last)
     filter (where lb.status in ('active', 'disbursed')))[1]                    as next_due_amount
from members m
left join loan_balances lb on lb.member_id = m.id
group by m.id;

-- ---------------------------------------------------------------------------
-- The one view the member dashboard, member list and statements all read.
-- ---------------------------------------------------------------------------
create or replace view member_financials
with (security_invoker = true) as
select
  m.id,
  m.member_no,
  m.user_id,
  m.full_name,
  m.phone,
  m.email,
  m.national_id,
  m.photo_url,
  m.status,
  m.joined_on,
  m.address,
  m.occupation,
  m.next_of_kin_name,
  m.next_of_kin_phone,
  m.next_of_kin_relation,
  m.date_of_birth,
  m.gender,
  coalesce(ms.savings_balance, 0)  as savings_balance,
  coalesce(ms.weekly_total, 0)     as weekly_total,
  coalesce(ms.monthly_total, 0)    as monthly_total,
  coalesce(ms.deposits_total, 0)   as deposits_total,
  coalesce(ms.withdrawals_total, 0) as withdrawals_total,
  coalesce(sh.share_count, 0)      as share_count,
  coalesce(sh.share_value, 0)      as share_value,
  coalesce(ml.loan_balance, 0)     as loan_balance,
  coalesce(ml.overdue_amount, 0)   as overdue_amount,
  coalesce(ml.active_loans, 0)     as active_loans,
  coalesce(ml.pending_loans, 0)    as pending_loans,
  ml.next_due_on,
  ml.next_due_amount,
  (coalesce(ms.savings_balance, 0) + coalesce(sh.share_value, 0))::numeric(16,2) as total_equity
from members m
left join member_savings        ms on ms.member_id = m.id
left join member_shares         sh on sh.member_id = m.id
left join member_loans_summary  ml on ml.member_id = m.id;

-- ---------------------------------------------------------------------------
-- Transaction feed with the member's name resolved - used by every list and
-- statement so the UI never needs a second round trip.
-- ---------------------------------------------------------------------------
create or replace view transaction_feed
with (security_invoker = true) as
select
  t.id,
  t.reference,
  t.member_id,
  m.member_no,
  m.full_name       as member_name,
  m.photo_url       as member_photo,
  t.type,
  t.status,
  t.amount,
  t.method,
  t.occurred_on,
  t.description,
  t.loan_id,
  t.reverses_id,
  t.reversed_by_id,
  t.reversal_reason,
  t.created_at,
  t.recorded_by,
  u.full_name       as recorded_by_name,
  -- Direction from the member's point of view: money in (+) or money out (-).
  case when t.type in ('weekly_savings', 'monthly_savings', 'deposit',
                       'share_purchase', 'loan_repayment', 'fee', 'penalty', 'expense')
       then 'debit' else 'credit' end as direction
from transactions t
left join members   m on m.id = t.member_id
left join app_users u on u.id = t.recorded_by;

-- ---------------------------------------------------------------------------
-- Staff dashboard metrics - one round trip, all numbers.
-- ---------------------------------------------------------------------------
create or replace function dashboard_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  perform assert_role('super_admin', 'manager', 'loan_officer', 'cashier');

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
    'income_mtd',         (select coalesce(sum(amount), 0) from income_entries
                            where received_on >= date_trunc('month', current_date)),
    'expenses_mtd',       (select coalesce(sum(e.amount), 0) from expense_entries e
                            where e.approval = 'approved'
                              and e.spent_on >= date_trunc('month', current_date)),
    'pending_expenses',   (select count(*) from expense_entries where approval = 'pending')
  ) into v;

  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Collections trend for the dashboard chart - 12 buckets, computed in the DB
-- so the phone never downloads a year of raw transactions to draw a sparkline.
-- ---------------------------------------------------------------------------
create or replace function collections_trend(p_months integer default 6)
returns table (bucket date, label text, savings numeric, repayments numeric, shares numeric)
language sql
stable
security definer
set search_path = public
as $$
  with months as (
    select generate_series(
      date_trunc('month', current_date) - ((greatest(p_months, 1) - 1) || ' month')::interval,
      date_trunc('month', current_date),
      '1 month'
    )::date as bucket
  )
  select
    mo.bucket,
    to_char(mo.bucket, 'Mon') as label,
    coalesce(sum(t.amount) filter (where t.type in ('weekly_savings', 'monthly_savings', 'deposit')), 0),
    coalesce(sum(t.amount) filter (where t.type = 'loan_repayment'), 0),
    coalesce(sum(t.amount) filter (where t.type = 'share_purchase'), 0)
  from months mo
  left join transactions t
         on t.status = 'posted'
        and date_trunc('month', t.occurred_on)::date = mo.bucket
  group by mo.bucket
  order by mo.bucket;
$$;

-- ---------------------------------------------------------------------------
-- Member statement - opening balance, movements, closing balance.
-- ---------------------------------------------------------------------------
create or replace function member_statement(
  p_member_id uuid,
  p_from      date,
  p_to        date
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_open  numeric(16,2);
  v_rows  jsonb;
  v_member jsonb;
begin
  if not (has_role('super_admin', 'manager', 'loan_officer', 'cashier')
          or current_member_id() = p_member_id) then
    raise exception 'You may only view your own statement.' using errcode = 'insufficient_privilege';
  end if;

  select to_jsonb(mf) into v_member from member_financials mf where mf.id = p_member_id;
  if v_member is null then
    raise exception 'Member not found.' using errcode = 'no_data_found';
  end if;

  select coalesce(sum(case when type in ('weekly_savings', 'monthly_savings', 'deposit')
                           then amount else -amount end), 0)
    into v_open
    from transactions
   where member_id = p_member_id and status = 'posted'
     and type in ('weekly_savings', 'monthly_savings', 'deposit', 'withdrawal')
     and occurred_on < p_from;

  select coalesce(jsonb_agg(r order by r.occurred_on, r.created_at), '[]'::jsonb)
    into v_rows
    from (
      select t.reference, t.occurred_on, t.type, t.description, t.amount, t.method,
             t.status, t.created_at,
             sum(case when t.type in ('weekly_savings', 'monthly_savings', 'deposit')
                      then t.amount
                      when t.type = 'withdrawal' then -t.amount
                      else 0 end)
               over (order by t.occurred_on, t.created_at
                     rows between unbounded preceding and current row) + v_open as running_balance
        from transactions t
       where t.member_id = p_member_id
         and t.status in ('posted', 'reversed', 'reversal')
         and t.occurred_on between p_from and p_to
    ) r;

  return jsonb_build_object(
    'member',          v_member,
    'from',            p_from,
    'to',              p_to,
    'opening_balance', v_open,
    'rows',            v_rows,
    'generated_at',    now()
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Cashbook - income vs expense by category over a window.
-- ---------------------------------------------------------------------------
create or replace function cashbook(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v jsonb;
begin
  perform assert_role('super_admin', 'manager');

  select jsonb_build_object(
    'from', p_from,
    'to',   p_to,
    'income', (
      select coalesce(jsonb_agg(x order by x.total desc), '[]'::jsonb) from (
        select c.name as category, sum(i.amount) as total, count(*) as entries
          from income_entries i
          join income_categories c on c.id = i.category_id
         where i.received_on between p_from and p_to
         group by c.name
      ) x
    ),
    'expenses', (
      select coalesce(jsonb_agg(x order by x.total desc), '[]'::jsonb) from (
        select c.name as category, sum(e.amount) as total, count(*) as entries
          from expense_entries e
          join expense_categories c on c.id = e.category_id
         where e.spent_on between p_from and p_to and e.approval = 'approved'
         group by c.name
      ) x
    ),
    'total_income',  (select coalesce(sum(amount), 0) from income_entries
                       where received_on between p_from and p_to),
    'total_expenses', (select coalesce(sum(amount), 0) from expense_entries
                        where spent_on between p_from and p_to and approval = 'approved')
  ) into v;

  return v || jsonb_build_object(
    'net_surplus', (v ->> 'total_income')::numeric - (v ->> 'total_expenses')::numeric
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Nightly hygiene: mark elapsed unpaid savings periods as missed and flag
-- loans that have gone past due. Schedule with pg_cron or an external cron.
-- ---------------------------------------------------------------------------
create or replace function run_daily_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_missed integer;
  v_default integer;
begin
  update savings_periods
     set status = 'missed'
   where period_end < current_date
     and paid_amount = 0
     and expected_amount > 0
     and status = 'pending';
  get diagnostics v_missed = row_count;

  update loans l
     set status = 'defaulted'
    from loan_balances lb
   where lb.loan_id = l.id
     and l.status = 'active'
     and lb.days_overdue > 90
     and lb.overdue_amount > 0;
  get diagnostics v_default = row_count;

  return jsonb_build_object('periods_marked_missed', v_missed, 'loans_defaulted', v_default);
end;
$$;
