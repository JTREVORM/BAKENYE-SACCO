-- ===========================================================================
-- BUD-SACCO - 0022 - Category read models
--
-- Every figure below is an aggregate over member rows and the immutable ledger.
-- There is no `savings_categories.collected` column to read, so there is
-- nothing that can drift away from what members actually paid, and a category
-- total is by construction the sum of exactly what its members can see on their
-- own phones.
--
-- All views are `security_invoker` so row-level security still applies.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- member_share_progress - section 15 of the brief, as a view.
--
-- Everything here is derived from the member's own joining date and the
-- category's own configured target. The three-month Diamond deadline is
-- `joined_on + qualification_months`, computed per member; no deadline is
-- stored, and none is hard-coded.
--
-- A member with no share category still gets a row, with nulls where a target
-- would be. The screens read that as "no category chosen yet" and say so,
-- rather than showing a progress bar against a target nobody set.
-- ---------------------------------------------------------------------------
create or replace view member_share_progress
with (security_invoker = true) as
select
  m.id                                   as member_id,
  m.share_category_id,
  sc.code                                as share_category_code,
  sc.name                                as share_category_name,
  sc.required_shares                     as target_shares,
  sc.share_price,
  sc.required_amount                     as target_amount,
  sc.qualification_months,
  coalesce(sh.share_count, 0)::integer   as shares_owned,
  coalesce(sh.share_value, 0)::numeric(16,2) as share_value,
  greatest(sc.required_shares - coalesce(sh.share_count, 0), 0)::integer
                                         as shares_remaining,
  greatest(sc.required_amount - coalesce(sh.share_value, 0), 0)::numeric(16,2)
                                         as amount_remaining,
  case when sc.required_shares > 0
       then least(round(coalesce(sh.share_count, 0)::numeric
                        / sc.required_shares * 100, 2), 100)
       else null end::numeric(6,2)       as progress_percent,
  -- The deadline exists only for a category that has a qualification window.
  case when sc.qualification_months is not null
       then (m.joined_on + (sc.qualification_months || ' months')::interval)::date
       else null end                     as qualifies_by,
  case when sc.qualification_months is not null
       then (m.joined_on + (sc.qualification_months || ' months')::interval)::date
            - current_date
       else null end                     as days_to_qualify,
  -- Qualified the moment the shares are held, whatever the calendar says.
  (sc.id is not null and coalesce(sh.share_count, 0) >= sc.required_shares)
                                         as qualified,
  -- Behind, and out of time. This is the flag a manager acts on.
  (sc.id is not null
   and sc.qualification_months is not null
   and coalesce(sh.share_count, 0) < sc.required_shares
   and (m.joined_on + (sc.qualification_months || ' months')::interval)::date < current_date)
                                         as qualification_lapsed
from members m
left join share_categories sc on sc.id = m.share_category_id
left join member_shares    sh on sh.member_id = m.id;

-- ---------------------------------------------------------------------------
-- member_financials - the one view the member dashboard, the member register
-- and the statements all read.
--
-- Rebuilt from 0008's group-aware version: the group columns are gone and the
-- two categories, the savings plan and the share progress take their place.
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

  coalesce(ms.savings_balance, 0)   as savings_balance,
  coalesce(ms.weekly_total, 0)      as weekly_total,
  coalesce(ms.monthly_total, 0)     as monthly_total,
  coalesce(ms.deposits_total, 0)    as deposits_total,
  coalesce(ms.withdrawals_total, 0) as withdrawals_total,
  coalesce(sh.share_count, 0)       as share_count,
  coalesce(sh.share_value, 0)       as share_value,
  coalesce(ml.loan_balance, 0)      as loan_balance,
  coalesce(ml.overdue_amount, 0)    as overdue_amount,
  coalesce(ml.active_loans, 0)      as active_loans,
  coalesce(ml.pending_loans, 0)     as pending_loans,
  ml.next_due_on,
  ml.next_due_amount,
  (coalesce(ms.savings_balance, 0) + coalesce(sh.share_value, 0))::numeric(16,2) as total_equity,

  -- --- share category ------------------------------------------------------
  m.share_category_id,
  shc.code                          as share_category_code,
  shc.name                          as share_category_name,
  shc.required_shares               as share_target_shares,
  shc.required_amount               as share_target_amount,
  sp.shares_remaining               as share_shares_remaining,
  sp.amount_remaining               as share_amount_remaining,
  sp.progress_percent               as share_progress_percent,
  sp.qualifies_by                   as share_qualifies_by,
  sp.qualified                      as share_qualified,
  sp.qualification_lapsed           as share_qualification_lapsed,

  -- --- savings category ----------------------------------------------------
  m.savings_category_id,
  svc.code                          as savings_category_code,
  svc.name                          as savings_category_name,
  svc.amount                        as savings_expected_amount,
  svc.frequency                     as savings_frequency,

  -- The next expectation that is not yet settled. `due_on` is what the brief
  -- calls the next due date; it is the end of the member's current period, so
  -- it moves on its own as the calendar does.
  nx.due_on                         as savings_next_due_on,
  nx.expected_amount                as savings_next_expected,
  nx.paid_amount                    as savings_next_paid,
  nx.status                         as savings_next_status,
  nx.period_label                   as savings_current_cycle,

  -- Savings still owed across every schedule that is not settled. This is the
  -- arrears figure the collection screen and the member statement both show.
  coalesce(ar.outstanding, 0)::numeric(16,2) as savings_outstanding,
  coalesce(ct.contributed, 0)::numeric(16,2) as savings_contributed
from members m
left join member_savings       ms  on ms.member_id = m.id
left join member_shares        sh  on sh.member_id = m.id
left join member_loans_summary ml  on ml.member_id = m.id
left join share_categories     shc on shc.id = m.share_category_id
left join savings_categories   svc on svc.id = m.savings_category_id
left join member_share_progress sp on sp.member_id = m.id
left join lateral (
  select s.due_on, s.expected_amount, s.paid_amount, s.status, s.period_label
    from savings_periods s
   where s.member_id = m.id
     and s.status in ('pending', 'partial')
   order by coalesce(s.due_on, s.period_end)
   limit 1
) nx on true
left join lateral (
  select sum(greatest(s.expected_amount - s.paid_amount, 0)) as outstanding
    from savings_periods s
   where s.member_id = m.id
     and s.status in ('pending', 'partial', 'missed')
) ar on true
left join lateral (
  select sum(s.paid_amount) as contributed
    from savings_periods s
   where s.member_id = m.id
) ct on true;

-- ---------------------------------------------------------------------------
-- savings_schedules - the per-member expectation, with the names resolved.
--
-- This is the collection row and the "my savings" row at the same time.
-- `outstanding` is derived, never stored. `cycle` is the period label the
-- schedule was raised for - "Week 37, 2026" or "Sep 2026" - so a report can
-- name the cycle without recomputing it.
-- ---------------------------------------------------------------------------
create or replace view savings_schedules
with (security_invoker = true) as
select
  sp.id                                   as schedule_id,
  sp.member_id,
  m.member_no,
  m.full_name                             as member_name,
  m.phone                                 as member_phone,
  m.photo_url                             as member_photo,
  m.status                                as member_status,

  sp.savings_category_id,
  sc.code                                 as savings_category_code,
  sc.name                                 as savings_category_name,
  sc.frequency                            as savings_category_frequency,

  m.share_category_id,
  shc.name                                as share_category_name,

  sp.kind,
  sp.period_start,
  sp.period_end,
  sp.period_label,
  sp.period_label                         as cycle,
  coalesce(sp.due_on, sp.period_end)      as due_on,
  sp.expected_amount,
  sp.paid_amount,
  greatest(sp.expected_amount - sp.paid_amount, 0)::numeric(16,2) as outstanding,
  sp.status,
  sp.created_at,
  sp.updated_at,
  -- The last payment recorded against this schedule, so a collection screen can
  -- show the method and reference without a second query per row.
  lp.method                               as last_method,
  lp.external_ref                         as last_reference,
  lp.paid_on                              as last_paid_on,
  lp.transaction_id                       as last_transaction_id
from savings_periods sp
join members m                on m.id = sp.member_id
left join savings_categories sc  on sc.id = sp.savings_category_id
left join share_categories   shc on shc.id = m.share_category_id
left join lateral (
  select pay.method, pay.external_ref, pay.paid_on, pay.transaction_id
    from savings_payments pay
    join transactions t on t.id = pay.transaction_id
   where pay.period_id = sp.id and t.status = 'posted'
   order by pay.paid_on desc, pay.created_at desc
   limit 1
) lp on true;

-- ---------------------------------------------------------------------------
-- savings_transactions - the money, as section 17 names it.
--
-- A view rather than a table, because the SACCO already has exactly one
-- immutable financial ledger and a second one would be a second truth. Each row
-- here is one posted savings payment with its ledger reference resolved; a
-- reversed transaction drops out, because a reversed payment is not a savings
-- transaction any more.
-- ---------------------------------------------------------------------------
create or replace view savings_transactions
with (security_invoker = true) as
select
  pay.id,
  pay.member_id,
  m.member_no,
  m.full_name                as member_name,
  coalesce(pay.savings_category_id, sp.savings_category_id) as savings_category_id,
  sc.name                    as savings_category_name,
  pay.period_id              as schedule_id,
  sp.period_label            as cycle,
  pay.amount,
  pay.method                 as payment_method,
  t.reference,
  pay.external_ref,
  pay.paid_on                as transaction_date,
  pay.note,
  pay.transaction_id,
  pay.recorded_by,
  au.full_name               as recorded_by_name,
  pay.created_at
from savings_payments pay
join transactions t        on t.id = pay.transaction_id and t.status = 'posted'
join members m             on m.id = pay.member_id
left join savings_periods sp on sp.id = pay.period_id
left join savings_categories sc
       on sc.id = coalesce(pay.savings_category_id, sp.savings_category_id)
left join app_users au     on au.id = pay.recorded_by;

-- ---------------------------------------------------------------------------
-- savings_category_summary - section 14, as SQL.
--
-- Members, expected, collected, outstanding and the collection rate for each
-- category, over every schedule ever raised under it. The date-bounded version
-- a report needs is `savings_category_analytics()` in 0023; this view is the
-- lifetime position, and it is what the category administration screen shows
-- next to each category so a manager can see the consequence of an edit.
--
-- Categories with no members appear with zeroes, not absent: "Diamond Savers:
-- 0 members" is a fact worth showing, and a missing row would read as a bug.
-- ---------------------------------------------------------------------------
create or replace view savings_category_summary
with (security_invoker = true) as
select
  c.id                                    as savings_category_id,
  c.code,
  c.name,
  c.amount,
  c.frequency,
  c.status,
  c.sort_order,
  coalesce(mc.member_count, 0)::integer   as member_count,
  coalesce(mc.active_count, 0)::integer   as active_member_count,
  -- What the category would expect from its active members in one cycle.
  (c.amount * coalesce(mc.active_count, 0))::numeric(16,2) as expected_per_cycle,
  coalesce(ag.expected, 0)::numeric(16,2)     as expected_total,
  coalesce(ag.collected, 0)::numeric(16,2)    as collected_total,
  coalesce(ag.outstanding, 0)::numeric(16,2)  as outstanding_total,
  coalesce(ag.schedules, 0)::integer          as schedules,
  coalesce(ag.paid_count, 0)::integer         as paid_schedules,
  coalesce(ag.partial_count, 0)::integer      as partial_schedules,
  coalesce(ag.pending_count, 0)::integer      as pending_schedules,
  coalesce(ag.missed_count, 0)::integer       as missed_schedules,
  coalesce(ag.waived_count, 0)::integer       as waived_schedules,
  case when coalesce(ag.expected, 0) > 0
       then round(coalesce(ag.collected, 0) / ag.expected * 100, 2)
       else 0 end::numeric(6,2)               as collection_rate
from savings_categories c
left join lateral (
  select count(*) as member_count,
         count(*) filter (where m.status = 'active') as active_count
    from members m where m.savings_category_id = c.id
) mc on true
left join lateral (
  select
    count(*)                                              as schedules,
    sum(s.expected_amount)                                as expected,
    sum(s.paid_amount)                                    as collected,
    sum(greatest(s.expected_amount - s.paid_amount, 0))
      filter (where s.status <> 'waived')                 as outstanding,
    count(*) filter (where s.status = 'paid')             as paid_count,
    count(*) filter (where s.status = 'partial')          as partial_count,
    count(*) filter (where s.status = 'pending')          as pending_count,
    count(*) filter (where s.status = 'missed')           as missed_count,
    count(*) filter (where s.status = 'waived')           as waived_count
  from savings_periods s
  where s.savings_category_id = c.id
) ag on true;

-- ---------------------------------------------------------------------------
-- share_category_summary - the same treatment for shares.
--
-- `qualified_members` counts members who actually hold the required shares;
-- `lapsed_members` counts those whose qualification window has closed without
-- them. Both are computed from share lots and joining dates, so neither can
-- disagree with a member's own share screen.
-- ---------------------------------------------------------------------------
create or replace view share_category_summary
with (security_invoker = true) as
select
  c.id                                    as share_category_id,
  c.code,
  c.name,
  c.required_shares,
  c.share_price,
  c.required_amount,
  c.qualification_months,
  c.status,
  c.sort_order,
  coalesce(ag.member_count, 0)::integer     as member_count,
  coalesce(ag.active_count, 0)::integer     as active_member_count,
  coalesce(ag.qualified, 0)::integer        as qualified_members,
  coalesce(ag.lapsed, 0)::integer           as lapsed_members,
  coalesce(ag.shares_held, 0)::integer      as shares_held,
  coalesce(ag.value_held, 0)::numeric(16,2) as value_held,
  (c.required_amount * coalesce(ag.active_count, 0))::numeric(16,2) as value_targeted,
  case when coalesce(ag.member_count, 0) > 0
       then round(coalesce(ag.qualified, 0)::numeric / ag.member_count * 100, 2)
       else 0 end::numeric(6,2)             as qualification_rate
from share_categories c
left join lateral (
  select
    count(*)                                                  as member_count,
    count(*) filter (where p.member_status = 'active')         as active_count,
    count(*) filter (where p.qualified)                        as qualified,
    count(*) filter (where p.qualification_lapsed)             as lapsed,
    sum(p.shares_owned)                                        as shares_held,
    sum(p.share_value)                                         as value_held
  from (
    select msp.*, m.status as member_status
      from member_share_progress msp
      join members m on m.id = msp.member_id
     where msp.share_category_id = c.id
  ) p
) ag on true;
