-- ===========================================================================
-- BUD-SACCO - 0012 - Break the loans <-> loan_guarantors policy cycle
--
-- Two policies in 0004 read each other's tables:
--
--   loans_guarantor_read        (on loans)           reads loan_guarantors
--   loan_guarantors_self_read   (on loan_guarantors) reads loans
--
-- Each subquery is itself subject to row-level security, so evaluating either
-- one re-enters the other and Postgres aborts with "infinite recursion detected
-- in policy for relation loans". That takes down every read of `loans`, and
-- with it `loan_balances`, `member_loans_summary`, `member_financials` and the
-- group views built on top of them.
--
-- 0004 already documents the cure and applies it elsewhere ("A policy on a
-- table must never query that same table directly ... These are SECURITY
-- DEFINER, so they read past RLS and terminate"). It was not applied to this
-- pair. It is now.
--
-- The visibility rules are unchanged: a member sees their own loans plus the
-- loans they have agreed to guarantee, and sees the guarantee rows that name
-- them plus the guarantors backing their own loan.
-- ===========================================================================

/** The loans this member has agreed to guarantee. Reads past RLS, so it ends. */
create or replace function my_guaranteed_loan_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(g.loan_id), '{}'::uuid[])
    from loan_guarantors g
   where g.member_id = current_member_id();
$$;

/** The loans belonging to this member. Reads past RLS, so it ends. */
create or replace function my_loan_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(l.id), '{}'::uuid[])
    from loans l
   where l.member_id = current_member_id();
$$;

grant execute on function my_guaranteed_loan_ids() to authenticated;
grant execute on function my_loan_ids()            to authenticated;

drop policy if exists loans_guarantor_read on loans;
create policy loans_guarantor_read on loans
  for select using (id = any (my_guaranteed_loan_ids()));

drop policy if exists loan_guarantors_self_read on loan_guarantors;
create policy loan_guarantors_self_read on loan_guarantors
  for select using (
    member_id = current_member_id()
    or loan_id = any (my_loan_ids())
  );

-- The schedule and document policies read `loans` from a *different* table, so
-- they were never part of the cycle; restating them against the helper keeps
-- one loan-visibility rule instead of three copies of it.
drop policy if exists loan_schedule_self_read on loan_schedule;
create policy loan_schedule_self_read on loan_schedule
  for select using (loan_id = any (my_loan_ids()));

drop policy if exists loan_documents_self on loan_documents;
create policy loan_documents_self on loan_documents
  for select using (loan_id = any (my_loan_ids()));
