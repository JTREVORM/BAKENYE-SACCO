-- ===========================================================================
-- BUD-SACCO - 0008 - Group and schedule views
--
-- Rule 26 of the brief, expressed as SQL: every group figure below is an
-- aggregate over member rows. There is no `groups.balance` column to read, so
-- there is nothing that can drift away from what the members actually paid.
--
-- All views are `security_invoker` so row-level security still applies.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- savings_schedules - the per-member expectation, with the names resolved.
--
-- This is the collection sheet row and the "my savings" row at the same time.
-- `outstanding` is derived, never stored.
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
  sp.group_id,
  g.name                                  as group_name,
  g.group_code,
  g.saving_day,
  sp.cycle_id,
  c.label                                 as cycle_label,
  c.status                                as cycle_status,
  sp.kind,
  sp.period_start,
  sp.period_end,
  sp.period_label,
  coalesce(sp.due_on, sp.period_end)      as due_on,
  sp.expected_amount,
  sp.paid_amount,
  greatest(sp.expected_amount - sp.paid_amount, 0)::numeric(16,2) as outstanding,
  sp.status,
  sp.created_at,
  sp.updated_at,
  -- The last payment recorded against this schedule, so the sheet can show the
  -- method and reference without a second query per row.
  lp.method                               as last_method,
  lp.external_ref                         as last_reference,
  lp.paid_on                              as last_paid_on,
  lp.transaction_id                       as last_transaction_id
from savings_periods sp
join members m               on m.id = sp.member_id
left join sacco_groups g     on g.id = sp.group_id
left join savings_cycles c   on c.id = sp.cycle_id
left join lateral (
  select pay.method, pay.external_ref, pay.paid_on, pay.transaction_id
    from savings_payments pay
    join transactions t on t.id = pay.transaction_id
   where pay.period_id = sp.id and t.status = 'posted'
   order by pay.paid_on desc, pay.created_at desc
   limit 1
) lp on true;

-- ---------------------------------------------------------------------------
-- group_cycle_summary - what one collection day looks like.
--
-- 25 members x UGX 20,000 expected, 23 paid, UGX 40,000 outstanding: the
-- worked example from the brief, computed rather than typed.
-- ---------------------------------------------------------------------------
create or replace view group_cycle_summary
with (security_invoker = true) as
select
  c.id                                    as cycle_id,
  c.group_id,
  g.name                                  as group_name,
  g.group_code,
  g.location,
  g.saving_day,
  g.saving_frequency,
  c.kind,
  c.cycle_start,
  c.cycle_end,
  c.due_on,
  c.label,
  c.status,
  c.opened_at,
  c.closed_at,
  count(sp.id)::integer                                                  as members_expected,
  coalesce(sum(sp.expected_amount), 0)::numeric(16,2)                    as expected_amount,
  coalesce(sum(sp.paid_amount), 0)::numeric(16,2)                        as collected_amount,
  greatest(coalesce(sum(sp.expected_amount), 0)
           - coalesce(sum(sp.paid_amount), 0), 0)::numeric(16,2)         as outstanding_amount,
  count(sp.id) filter (where sp.status = 'paid')::integer                as paid_members,
  count(sp.id) filter (where sp.status = 'partial')::integer             as partial_members,
  count(sp.id) filter (where sp.status = 'pending')::integer             as pending_members,
  count(sp.id) filter (where sp.status = 'missed')::integer              as missed_members,
  count(sp.id) filter (where sp.status = 'waived')::integer              as waived_members,
  case when coalesce(sum(sp.expected_amount), 0) > 0
       then round(coalesce(sum(sp.paid_amount), 0)
                  / sum(sp.expected_amount) * 100, 2)
       else 0 end::numeric(6,2)                                          as collection_rate
from savings_cycles c
join sacco_groups g          on g.id = c.group_id
left join savings_periods sp on sp.cycle_id = c.id
group by c.id, g.name, g.group_code, g.location, g.saving_day, g.saving_frequency;

-- ---------------------------------------------------------------------------
-- group_overview - the group register row and the group dashboard header.
--
-- Savings, shares and loan balances come from the same member-level views the
-- member screens use, so a group total is by construction the sum of exactly
-- what its members can see on their own phones.
-- ---------------------------------------------------------------------------
create or replace view group_overview
with (security_invoker = true) as
select
  g.id,
  g.group_code,
  g.name,
  g.location,
  g.saving_day,
  g.saving_frequency,
  g.weekly_target,
  g.monthly_target,
  g.status,
  g.notes,
  g.created_at,
  g.updated_at,
  g.leader_member_id,
  lead.full_name                          as leader_name,
  lead.phone                              as leader_phone,
  g.secretary_member_id,
  sec.full_name                           as secretary_name,
  sec.phone                               as secretary_phone,
  g.loan_officer_id,
  off.full_name                           as loan_officer_name,
  coalesce(mc.member_count, 0)::integer   as member_count,
  coalesce(mc.active_count, 0)::integer   as active_member_count,
  coalesce(agg.total_savings, 0)::numeric(16,2)  as total_savings,
  coalesce(agg.total_shares, 0)::numeric(16,2)   as total_shares,
  coalesce(agg.total_loans, 0)::numeric(16,2)    as total_loan_balance,
  cur.cycle_id                            as current_cycle_id,
  cur.label                               as current_cycle_label,
  cur.due_on                              as current_cycle_due_on,
  cur.expected_amount                     as current_expected,
  cur.collected_amount                    as current_collected,
  cur.outstanding_amount                  as current_outstanding,
  cur.collection_rate                     as current_collection_rate
from sacco_groups g
left join members   lead on lead.id = g.leader_member_id
left join members   sec  on sec.id  = g.secretary_member_id
left join app_users off  on off.id  = g.loan_officer_id
left join lateral (
  select count(*) as member_count,
         count(*) filter (where m.status = 'active') as active_count
    from members m where m.group_id = g.id
) mc on true
left join lateral (
  select
    coalesce(sum(ms.savings_balance), 0) as total_savings,
    coalesce(sum(sh.share_value), 0)     as total_shares,
    coalesce(sum(ml.loan_balance), 0)    as total_loans
  from members m
  left join member_savings       ms on ms.member_id = m.id
  left join member_shares        sh on sh.member_id = m.id
  left join member_loans_summary ml on ml.member_id = m.id
  where m.group_id = g.id
) agg on true
left join lateral (
  select s.cycle_id, s.label, s.due_on, s.expected_amount,
         s.collected_amount, s.outstanding_amount, s.collection_rate
    from group_cycle_summary s
   where s.group_id = g.id
   order by s.cycle_start desc
   limit 1
) cur on true;

-- ---------------------------------------------------------------------------
-- member_financials gains its group.
--
-- Appended at the end so `create or replace` is legal and every existing
-- consumer keeps the column order it was written against.
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
  (coalesce(ms.savings_balance, 0) + coalesce(sh.share_value, 0))::numeric(16,2) as total_equity,
  m.group_id,
  g.name       as group_name,
  g.group_code as group_code,
  g.saving_day as group_saving_day,
  -- Savings still owed across every schedule that is not settled. This is the
  -- arrears figure the collection screen and the member statement both show.
  coalesce(ar.outstanding, 0)::numeric(16,2) as savings_outstanding
from members m
left join member_savings        ms on ms.member_id = m.id
left join member_shares         sh on sh.member_id = m.id
left join member_loans_summary  ml on ml.member_id = m.id
left join sacco_groups          g  on g.id = m.group_id
left join lateral (
  select sum(greatest(sp.expected_amount - sp.paid_amount, 0)) as outstanding
    from savings_periods sp
   where sp.member_id = m.id
     and sp.status in ('pending', 'partial', 'missed')
) ar on true;
