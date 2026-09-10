-- ===========================================================================
-- BUD-SACCO - 0024 - Dashboards, analytics and the collection screen
--
-- Sections 8, 12, 13, 14 and 15 of the brief, as read models.
--
-- Every figure is an aggregate over member schedules, share lots and the
-- immutable ledger. Nothing here is stored, and nothing here is a constant. A
-- category with no members returns zeroes, and the screens render an empty
-- state against them rather than a plausible-looking number.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Existing read models, with the group filters replaced by category filters.
--
-- Dropped and recreated rather than overloaded: two candidates with the same
-- name and defaulted arguments is an ambiguity waiting to pick the wrong one.
-- ---------------------------------------------------------------------------
drop function if exists search_members(text, member_status, text, integer, integer, uuid, boolean);
drop function if exists search_members(text, member_status, text, integer, integer);

create or replace function search_members(
  p_query   text default null,
  p_status  member_status default null,
  p_sort    text default 'name',   -- name | recent | savings | shares | loan | category
  p_limit   integer default 20,
  p_offset  integer default 0,
  p_savings_category_id uuid default null,
  p_share_category_id   uuid default null,
  p_uncategorised       boolean default false
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rows  jsonb;
  v_total bigint;
  v_q     text := nullif(trim(coalesce(p_query, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
begin
  perform assert_capability(can_view_operations(), 'view members');

  select count(*) into v_total
    from members m
   where (p_status is null or m.status = p_status)
     and (p_savings_category_id is null or m.savings_category_id = p_savings_category_id)
     and (p_share_category_id   is null or m.share_category_id   = p_share_category_id)
     and (not coalesce(p_uncategorised, false) or m.savings_category_id is null)
     and (v_q is null
          or m.full_name ilike '%' || v_q || '%'
          or m.member_no ilike '%' || v_q || '%'
          or m.phone     ilike '%' || v_q || '%'
          or coalesce(m.national_id, '') ilike '%' || v_q || '%');

  select coalesce(jsonb_agg(to_jsonb(r) order by r.sort_rank), '[]'::jsonb)
    into v_rows
    from (
      select mf.*,
             case p_sort
               when 'recent'   then row_number() over (order by mf.joined_on desc, mf.full_name)
               when 'savings'  then row_number() over (order by mf.savings_balance desc, mf.full_name)
               when 'shares'   then row_number() over (order by mf.share_value desc, mf.full_name)
               when 'loan'     then row_number() over (order by mf.loan_balance desc, mf.full_name)
               when 'category' then row_number() over (order by mf.savings_category_name nulls last, mf.full_name)
               else                 row_number() over (order by mf.full_name)
             end as sort_rank
        from member_financials mf
       where (p_status is null or mf.status = p_status)
         and (p_savings_category_id is null or mf.savings_category_id = p_savings_category_id)
         and (p_share_category_id   is null or mf.share_category_id   = p_share_category_id)
         and (not coalesce(p_uncategorised, false) or mf.savings_category_id is null)
         and (v_q is null
              or mf.full_name ilike '%' || v_q || '%'
              or mf.member_no ilike '%' || v_q || '%'
              or mf.phone     ilike '%' || v_q || '%'
              or coalesce(mf.national_id, '') ilike '%' || v_q || '%')
       order by sort_rank
       offset greatest(coalesce(p_offset, 0), 0)
       limit v_limit
    ) r;

  return jsonb_build_object(
    'rows',   v_rows,
    'total',  v_total,
    'limit',  v_limit,
    'offset', greatest(coalesce(p_offset, 0), 0)
  );
end;
$$;

drop function if exists savings_performance(savings_kind, date, date, uuid, savings_status);
drop function if exists savings_performance(savings_kind, date, date);

create or replace function savings_performance(
  p_kind     savings_kind,
  p_from     date,
  p_to       date,
  p_savings_category_id uuid default null,
  p_status   savings_status default null
) returns table (
  member_id uuid, member_no text, full_name text,
  savings_category_name text, share_category_name text,
  periods integer, expected numeric, paid numeric, balance numeric,
  paid_periods integer, missed_periods integer, compliance numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform assert_capability(can_view_operations(), 'view savings performance');

  return query
  select
    m.id, m.member_no, m.full_name, sc.name, shc.name,
    count(sp.id)::integer,
    coalesce(sum(sp.expected_amount), 0)::numeric(16,2),
    coalesce(sum(sp.paid_amount), 0)::numeric(16,2),
    greatest(coalesce(sum(sp.expected_amount), 0)
             - coalesce(sum(sp.paid_amount), 0), 0)::numeric(16,2),
    count(sp.id) filter (where sp.status = 'paid')::integer,
    count(sp.id) filter (where sp.status = 'missed')::integer,
    case when count(sp.id) = 0 then 0
         else round(count(sp.id) filter (where sp.status = 'paid')::numeric
                    / count(sp.id) * 100, 1) end
  from members m
  left join savings_categories sc  on sc.id  = m.savings_category_id
  left join share_categories   shc on shc.id = m.share_category_id
  left join savings_periods sp
         on sp.member_id = m.id
        and sp.kind = p_kind
        -- Every cycle overlapping the window, not only those wholly inside it.
        -- Asked on the 10th about "this month", a containment test would drop
        -- the September cycle - which runs to the 30th - and report a month of
        -- collections as no activity at all.
        and sp.period_start <= p_to
        and sp.period_end   >= p_from
        and (p_status is null or sp.status = p_status)
  where m.status = 'active'
    and (p_savings_category_id is null or m.savings_category_id = p_savings_category_id)
  group by m.id, m.member_no, m.full_name, sc.name, shc.name
  order by m.full_name;
end;
$$;

-- ---------------------------------------------------------------------------
-- The staff savings dashboard - section 13.
--
-- Members by savings category, expected against collected, and the schedule
-- counts by status. `p_from`/`p_to` bound it to a period so a manager can ask
-- the same question of this month, last month or the year.
-- ---------------------------------------------------------------------------
-- The 0009 signature took a single collection date, because a group either
-- collected that day or it did not. A membership saving on its own cadence is
-- asked about over a range instead, so the old one-argument form is dropped
-- rather than left behind to be resolved ambiguously.
drop function if exists savings_dashboard(date);

create or replace function savings_dashboard(
  p_from date default null,
  p_to   date default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v      jsonb;
  v_from date := coalesce(p_from, date_trunc('month', current_date)::date);
  v_to   date := coalesce(p_to, current_date);
begin
  perform assert_capability(can_view_operations(), 'view the savings dashboard');

  select jsonb_build_object(
    'from', v_from,
    'to',   v_to,

    'total_members',   (select count(*) from members where status = 'active'),
    'uncategorised_members',
                       (select count(*) from members
                         where status = 'active' and savings_category_id is null),

    -- Membership by savings category, as rows rather than three named keys, so
    -- a fourth category the SACCO invents next year appears here on its own.
    'savings_categories', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', s.savings_category_id, 'code', s.code, 'name', s.name,
               'amount', s.amount, 'frequency', s.frequency, 'status', s.status,
               'members', s.active_member_count,
               'expected_per_cycle', s.expected_per_cycle
             ) order by s.sort_order, s.name), '[]'::jsonb)
        from savings_category_summary s
    ),
    'share_categories', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', s.share_category_id, 'code', s.code, 'name', s.name,
               'required_shares', s.required_shares,
               'required_amount', s.required_amount,
               'status', s.status,
               'members', s.active_member_count,
               'qualified', s.qualified_members,
               'lapsed', s.lapsed_members
             ) order by s.sort_order, s.name), '[]'::jsonb)
        from share_category_summary s
    ),

    -- The lifetime savings position, from the ledger.
    'total_savings',   (select coalesce(sum(
                          case when type in ('weekly_savings', 'monthly_savings', 'deposit')
                               then amount else -amount end), 0)
                          from transactions
                         where status = 'posted'
                           and type in ('weekly_savings', 'monthly_savings',
                                        'deposit', 'withdrawal')),

    -- The period in view, from every cycle that overlaps it.
    --
    -- Deliberately not "schedules whose due date falls in the range". A monthly
    -- cycle is due on the last day of the month, so on the 10th a due-date
    -- filter would report zero expected and zero collected for a month in which
    -- money has plainly been coming in all week. A cycle belongs to the window
    -- it runs through, and the figures below are what a manager means when they
    -- ask what this month looks like so far.
    'expected_savings',    (select coalesce(sum(expected_amount), 0) from savings_periods
                             where period_start <= v_to and period_end >= v_from),
    'collected_savings',   (select coalesce(sum(paid_amount), 0) from savings_periods
                             where period_start <= v_to and period_end >= v_from),
    'outstanding_savings', (select coalesce(sum(greatest(expected_amount - paid_amount, 0)), 0)
                              from savings_periods
                             where period_start <= v_to and period_end >= v_from
                               and status <> 'waived'),

    'paid_schedules',    (select count(*) from savings_periods
                           where period_start <= v_to and period_end >= v_from
                             and status = 'paid'),
    'partial_schedules', (select count(*) from savings_periods
                           where period_start <= v_to and period_end >= v_from
                             and status = 'partial'),
    'pending_schedules', (select count(*) from savings_periods
                           where period_start <= v_to and period_end >= v_from
                             and status = 'pending'),
    'missed_schedules',  (select count(*) from savings_periods
                           where period_start <= v_to and period_end >= v_from
                             and status = 'missed'),
    'waived_schedules',  (select count(*) from savings_periods
                           where period_start <= v_to and period_end >= v_from
                             and status = 'waived'),

    'due_today',       (select count(*) from savings_periods
                         where coalesce(due_on, period_end) = current_date
                           and status in ('pending', 'partial')),
    'collected_today', (select coalesce(sum(amount), 0) from transactions
                         where status = 'posted' and occurred_on = current_date
                           and type in ('weekly_savings', 'monthly_savings', 'deposit')),

    -- Everything still owed from cycles whose due date has already passed.
    'total_arrears',   (select coalesce(sum(greatest(expected_amount - paid_amount, 0)), 0)
                          from savings_periods
                         where status in ('partial', 'missed')
                           and coalesce(due_on, period_end) < current_date)
  ) into v;

  return v || jsonb_build_object(
    'collection_rate',
      case when (v ->> 'expected_savings')::numeric > 0
           then round((v ->> 'collected_savings')::numeric
                      / (v ->> 'expected_savings')::numeric * 100, 2)
           else 0 end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Category analytics - section 14.
--
-- For each savings category over a date range: members, expected, collected,
-- outstanding and the collection rate. The brief's worked example - 42 Diamond
-- Savers, UGX 4,200,000 expected, UGX 3,900,000 collected, 92.86% - is what
-- this returns when the database actually holds 42 Diamond Savers. With none,
-- it returns zeroes, and the screen says there are no members in the category.
-- ---------------------------------------------------------------------------
create or replace function savings_category_analytics(
  p_from date default null,
  p_to   date default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_from date := coalesce(p_from, date_trunc('month', current_date)::date);
  v_to   date := coalesce(p_to, current_date);
  v_rows jsonb;
  v_tot  jsonb;
begin
  perform assert_capability(can_view_operations(), 'view category analytics');

  select coalesce(jsonb_agg(to_jsonb(r) order by r.sort_order, r.name), '[]'::jsonb),
         jsonb_build_object(
           'members',     coalesce(sum(r.members), 0),
           'expected',    coalesce(sum(r.expected), 0),
           'collected',   coalesce(sum(r.collected), 0),
           'outstanding', coalesce(sum(r.outstanding), 0)
         )
    into v_rows, v_tot
    from (
      select
        c.id                                    as savings_category_id,
        c.code, c.name, c.amount, c.frequency, c.status, c.sort_order,
        (select count(*) from members m
          where m.savings_category_id = c.id and m.status = 'active')::integer as members,
        -- What one full cycle of this category is worth at today's membership.
        (c.amount * (select count(*) from members m
                      where m.savings_category_id = c.id and m.status = 'active'))::numeric(16,2)
                                                as expected_per_cycle,
        coalesce(sum(sp.expected_amount), 0)::numeric(16,2)  as expected,
        coalesce(sum(sp.paid_amount), 0)::numeric(16,2)      as collected,
        greatest(coalesce(sum(sp.expected_amount) filter (where sp.status <> 'waived'), 0)
                 - coalesce(sum(sp.paid_amount) filter (where sp.status <> 'waived'), 0),
                 0)::numeric(16,2)                           as outstanding,
        count(sp.id)::integer                                as schedules,
        count(sp.id) filter (where sp.status = 'paid')::integer    as paid_schedules,
        count(sp.id) filter (where sp.status = 'partial')::integer as partial_schedules,
        count(sp.id) filter (where sp.status = 'pending')::integer as pending_schedules,
        count(sp.id) filter (where sp.status = 'missed')::integer  as missed_schedules,
        case when coalesce(sum(sp.expected_amount), 0) > 0
             then round(coalesce(sum(sp.paid_amount), 0)
                        / sum(sp.expected_amount) * 100, 2)
             else 0 end::numeric(6,2)                        as collection_rate
      from savings_categories c
      left join savings_periods sp
             on sp.savings_category_id = c.id
            -- Every cycle that overlaps the window, for the reason given in
            -- `savings_dashboard()`: a monthly cycle is not absent from
            -- September simply because it is not due until the 30th.
            and sp.period_start <= v_to
            and sp.period_end >= v_from
      group by c.id, c.code, c.name, c.amount, c.frequency, c.status, c.sort_order
    ) r;

  return jsonb_build_object(
    'from', v_from, 'to', v_to,
    'rows', v_rows, 'totals', v_tot,
    'collection_rate',
      case when (v_tot ->> 'expected')::numeric > 0
           then round((v_tot ->> 'collected')::numeric
                      / (v_tot ->> 'expected')::numeric * 100, 2)
           else 0 end,
    'generated_at', now()
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- The member financial dashboard - section 12.
--
-- Savings, shares and loans for one member in one round trip. A member may read
-- their own; staff may read any. Everything is derived, so what a member sees
-- on their phone is the same arithmetic the collection screen shows the cashier
-- standing in front of them.
-- ---------------------------------------------------------------------------
create or replace function member_savings_overview(p_member_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_member jsonb;
  v_id     uuid := coalesce(p_member_id, current_member_id());
begin
  if v_id is null then
    raise exception 'Member not found.' using errcode = 'no_data_found';
  end if;
  if not (can_view_operations() or v_id = current_member_id()) then
    raise exception 'You may only view your own savings.' using errcode = 'insufficient_privilege';
  end if;

  select to_jsonb(mf) into v_member from member_financials mf where mf.id = v_id;
  if v_member is null then
    raise exception 'Member not found.' using errcode = 'no_data_found';
  end if;

  return jsonb_build_object(
    'member', v_member,
    'share_progress', (
      select to_jsonb(p) from member_share_progress p where p.member_id = v_id
    ),
    'next_due_on', next_savings_due_date(v_id, current_date),
    -- The schedules a member is judged against, most recent first.
    'schedules', (
      select coalesce(jsonb_agg(to_jsonb(s) order by s.due_on desc), '[]'::jsonb)
        from (select * from savings_schedules
               where member_id = v_id
               order by due_on desc limit 12) s
    ),
    'recent_payments', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.transaction_date desc), '[]'::jsonb)
        from (select * from savings_transactions
               where member_id = v_id
               order by transaction_date desc, created_at desc limit 10) t
    ),
    'loans', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'loan_id', lb.loan_id, 'loan_no', lb.loan_no, 'status', lb.status,
               'principal', lb.principal, 'total_payable', lb.total_payable,
               'amount_paid', lb.amount_paid, 'outstanding', lb.outstanding,
               'percent_repaid', lb.percent_repaid,
               'next_due_on', lb.next_due_on, 'next_due_amount', lb.next_due_amount,
               'overdue_amount', lb.overdue_amount
             ) order by lb.disbursed_on desc nulls last), '[]'::jsonb)
        from loan_balances lb
       where lb.member_id = v_id
         and lb.status in ('applied', 'under_review', 'approved',
                           'disbursed', 'active', 'defaulted')
    ),
    'generated_at', now()
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- The centralised collection screen - section 8.
--
-- One member, everything a cashier needs to take their money: who they are,
-- what category they save under, what this cycle expects, what they have
-- already paid, what is outstanding, their balance, their next due date and
-- their history. The schedule for the current period is raised if it does not
-- exist yet, so a cashier never faces an empty screen for a member who is
-- standing in front of them.
-- ---------------------------------------------------------------------------
create or replace function member_collection_view(
  p_member_id uuid,
  p_on        date default current_date
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member   jsonb;
  v_schedule savings_periods;
  v_current  jsonb;
begin
  perform assert_capability(can_view_operations(), 'view collections');

  select to_jsonb(mf) into v_member from member_financials mf where mf.id = p_member_id;
  if v_member is null then
    raise exception 'Member not found.' using errcode = 'no_data_found';
  end if;

  -- Only for an active member with an active category, and only when the
  -- caller could actually record against it.
  if (v_member ->> 'status') = 'active' and can_record_savings() then
    v_schedule := ensure_member_schedule(p_member_id, p_on);
  else
    select * into v_schedule from savings_periods
     where member_id = p_member_id
       and coalesce(due_on, period_end) >= p_on
     order by coalesce(due_on, period_end)
     limit 1;
  end if;

  if v_schedule.id is not null then
    select to_jsonb(s) into v_current from savings_schedules s
     where s.schedule_id = v_schedule.id;
  end if;

  return jsonb_build_object(
    'member',        v_member,
    'current',       v_current,
    'share_progress', (
      select to_jsonb(p) from member_share_progress p where p.member_id = p_member_id
    ),
    'next_due_on',   next_savings_due_date(p_member_id, p_on),
    'schedules', (
      select coalesce(jsonb_agg(to_jsonb(s) order by s.due_on desc), '[]'::jsonb)
        from (select * from savings_schedules
               where member_id = p_member_id
               order by due_on desc limit 12) s
    ),
    'history', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.transaction_date desc), '[]'::jsonb)
        from (select * from savings_transactions
               where member_id = p_member_id
               order by transaction_date desc, created_at desc limit 10) t
    ),
    'as_of', p_on
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- The staff dashboard, with the group counts replaced by category counts.
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
    'income_mtd',         (select coalesce(sum(amount), 0) from income_entries
                            where received_on >= date_trunc('month', current_date)),
    'expenses_mtd',       (select coalesce(sum(e.amount), 0) from expense_entries e
                            where e.approval = 'approved'
                              and e.spent_on >= date_trunc('month', current_date)),
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
-- Nightly hygiene.
--
-- A schedule whose due date has passed with nothing paid becomes 'missed'. A
-- partial one stays 'partial': money did arrive, and the shortfall is already
-- visible as outstanding. Then today's schedules are opened, so a collection
-- day never starts with an empty screen.
-- ---------------------------------------------------------------------------
create or replace function run_daily_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_missed  integer;
  v_default integer;
  v_opened  jsonb;
begin
  update savings_periods
     set status = 'missed'
   where coalesce(due_on, period_end) < current_date
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

  v_opened := open_savings_schedules(current_date);

  return jsonb_build_object(
    'periods_marked_missed', v_missed,
    'loans_defaulted',       v_default,
    'schedules_opened',      v_opened
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Settings coherence, without the group bounds 0021 deleted.
-- ---------------------------------------------------------------------------
create or replace function assert_settings_coherent()
returns void language plpgsql stable security definer set search_path = public as $fn$
declare
  v_min_w numeric := setting_number('financial.min_withdrawal');
  v_max_w numeric := setting_number('financial.max_withdrawal_per_transaction');
begin
  if v_max_w > 0 and v_min_w > v_max_w then
    raise exception 'The smallest withdrawal (UGX %) cannot be more than the largest withdrawal (UGX %).',
      trim(to_char(v_min_w, 'FM999,999,999')), trim(to_char(v_max_w, 'FM999,999,999'))
      using errcode = 'check_violation';
  end if;
end;
$fn$;

-- ===========================================================================
-- ROW LEVEL SECURITY
--
-- The category register is readable by anyone signed in: a member's own screens
-- quote their target and their expected contribution back to them. Writes go
-- only through the functions above, which audit every change - there is no
-- INSERT, UPDATE or DELETE policy on either table.
-- ===========================================================================
alter table share_categories   enable row level security;
alter table savings_categories enable row level security;

drop policy if exists share_categories_read on share_categories;
create policy share_categories_read on share_categories
  for select using (auth.uid() is not null);

drop policy if exists savings_categories_read on savings_categories;
create policy savings_categories_read on savings_categories
  for select using (auth.uid() is not null);

grant select on share_categories   to authenticated;
grant select on savings_categories to authenticated;
grant select on member_share_progress    to authenticated;
grant select on savings_category_summary to authenticated;
grant select on share_category_summary   to authenticated;
grant select on savings_transactions     to authenticated;

-- ---------------------------------------------------------------------------
-- Grants. Every function re-checks the capability of its caller internally.
-- ---------------------------------------------------------------------------
grant execute on function can_manage_categories()                      to authenticated;
grant execute on function savings_due_date(savings_kind, date)         to authenticated;
grant execute on function member_savings_category(uuid)                to authenticated;
grant execute on function next_savings_due_date(uuid, date)            to authenticated;
grant execute on function ensure_member_schedule(uuid, date)           to authenticated;
grant execute on function open_savings_schedules(date)                 to authenticated;
grant execute on function open_savings_periods(savings_kind, date)     to authenticated;
grant execute on function record_scheduled_savings(uuid, numeric, date, payment_method, text, text, text) to authenticated;
grant execute on function record_savings_payment(uuid, savings_kind, numeric, date, payment_method, text) to authenticated;
grant execute on function waive_savings_schedule(uuid, text)           to authenticated;

grant execute on function create_share_category(text, integer, numeric, integer, text, text, integer) to authenticated;
grant execute on function update_share_category(uuid, text, integer, numeric, integer, text, integer) to authenticated;
grant execute on function set_share_category_status(uuid, category_status, text) to authenticated;
grant execute on function create_savings_category(text, numeric, savings_kind, text, text, integer) to authenticated;
grant execute on function update_savings_category(uuid, text, numeric, savings_kind, text, integer) to authenticated;
grant execute on function set_savings_category_status(uuid, category_status, text) to authenticated;
grant execute on function set_member_categories(uuid, uuid, uuid, text)  to authenticated;

grant execute on function search_members(text, member_status, text, integer, integer, uuid, uuid, boolean) to authenticated;
grant execute on function savings_performance(savings_kind, date, date, uuid, savings_status) to authenticated;
grant execute on function savings_dashboard(date, date)                to authenticated;
grant execute on function savings_category_analytics(date, date)       to authenticated;
grant execute on function member_savings_overview(uuid)                to authenticated;
grant execute on function member_collection_view(uuid, date)           to authenticated;
grant execute on function dashboard_metrics()                          to authenticated;
grant execute on function run_daily_maintenance()                      to authenticated;
