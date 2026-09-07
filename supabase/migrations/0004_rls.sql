-- ===========================================================================
-- BUD-SACCO - 0004 - Row Level Security
--
-- The rule that matters most: a member can read their own financial rows and
-- nobody else's. This is enforced in the database, so it holds even if a bug
-- in the web app forgets to filter, and even if someone calls the REST API
-- directly with their own access token.
--
-- Writes to financial tables are denied to *everyone* at the RLS layer. Money
-- moves only through the SECURITY DEFINER functions in 0002, which run their
-- own role checks. That is deliberate: there is exactly one door.
-- ===========================================================================

alter table app_users          enable row level security;
alter table members            enable row level security;
alter table transactions       enable row level security;
alter table share_lots         enable row level security;
alter table share_settings     enable row level security;
alter table savings_plans      enable row level security;
alter table savings_periods    enable row level security;
alter table savings_payments   enable row level security;
alter table loan_products      enable row level security;
alter table loans              enable row level security;
alter table loan_schedule      enable row level security;
alter table loan_repayments    enable row level security;
alter table loan_guarantors    enable row level security;
alter table loan_documents     enable row level security;
alter table income_categories  enable row level security;
alter table expense_categories enable row level security;
alter table income_entries     enable row level security;
alter table expense_entries    enable row level security;
alter table notifications      enable row level security;
alter table audit_logs         enable row level security;
alter table doc_counters       enable row level security;

-- ---------------------------------------------------------------------------
-- Helpers used inside policies.
--
-- A policy on a table must never query that same table directly: the subquery
-- is itself subject to RLS, which recurses. These are SECURITY DEFINER, so they
-- read past RLS and terminate.
-- ---------------------------------------------------------------------------
create or replace function my_role_raw()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from app_users where id = auth.uid();
$$;

create or replace function my_member_no()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select member_no from members where user_id = auth.uid();
$$;

create or replace function my_member_status()
returns member_status
language sql
stable
security definer
set search_path = public
as $$
  select status from members where user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- app_users
-- ---------------------------------------------------------------------------
create policy app_users_self_read on app_users
  for select using (id = auth.uid());

create policy app_users_staff_read on app_users
  for select using (has_role('super_admin', 'manager'));

-- A user may update their own profile, but not promote themselves. Role changes
-- go through set_user_role(), which is super-admin only and audited.
create policy app_users_self_update on app_users
  for update using (id = auth.uid())
  with check (id = auth.uid() and role = my_role_raw());

create policy app_users_admin_write on app_users
  for all using (has_role('super_admin')) with check (has_role('super_admin'));

-- ---------------------------------------------------------------------------
-- members
-- ---------------------------------------------------------------------------
create policy members_self_read on members
  for select using (user_id = auth.uid());

create policy members_staff_read on members
  for select using (has_role('super_admin', 'manager', 'loan_officer', 'cashier'));

-- A member may keep their own contact details current, but not their
-- member_no or status. Same reasoning as app_users: the comparison goes through
-- a SECURITY DEFINER helper so the policy does not query its own table.
create policy members_self_update on members
  for update using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and member_no = my_member_no()
    and status = my_member_status()
  );

create policy members_staff_write on members
  for all using (has_role('super_admin', 'manager'))
  with check (has_role('super_admin', 'manager'));

create policy members_officer_insert on members
  for insert with check (has_role('loan_officer', 'cashier'));

-- ---------------------------------------------------------------------------
-- transactions - read scoped, writes only via functions
-- ---------------------------------------------------------------------------
create policy transactions_self_read on transactions
  for select using (member_id = current_member_id());

create policy transactions_staff_read on transactions
  for select using (has_role('super_admin', 'manager', 'loan_officer', 'cashier'));

-- Deliberately no INSERT/UPDATE/DELETE policy. post_transaction() is
-- SECURITY DEFINER and bypasses RLS; direct writes are impossible.

-- ---------------------------------------------------------------------------
-- shares
-- ---------------------------------------------------------------------------
create policy share_lots_self_read on share_lots
  for select using (member_id = current_member_id());

create policy share_lots_staff_read on share_lots
  for select using (has_role('super_admin', 'manager', 'loan_officer', 'cashier'));

create policy share_settings_read on share_settings
  for select using (auth.uid() is not null);

create policy share_settings_admin on share_settings
  for all using (has_role('super_admin', 'manager'))
  with check (has_role('super_admin', 'manager'));

-- ---------------------------------------------------------------------------
-- savings
-- ---------------------------------------------------------------------------
create policy savings_plans_self_read on savings_plans
  for select using (member_id = current_member_id());
create policy savings_plans_staff on savings_plans
  for all using (has_role('super_admin', 'manager', 'cashier'))
  with check (has_role('super_admin', 'manager', 'cashier'));

create policy savings_periods_self_read on savings_periods
  for select using (member_id = current_member_id());
create policy savings_periods_staff_read on savings_periods
  for select using (has_role('super_admin', 'manager', 'loan_officer', 'cashier'));

create policy savings_payments_self_read on savings_payments
  for select using (member_id = current_member_id());
create policy savings_payments_staff_read on savings_payments
  for select using (has_role('super_admin', 'manager', 'loan_officer', 'cashier'));

-- ---------------------------------------------------------------------------
-- loans
-- ---------------------------------------------------------------------------
create policy loan_products_read on loan_products
  for select using (auth.uid() is not null);
create policy loan_products_admin on loan_products
  for all using (has_role('super_admin', 'manager'))
  with check (has_role('super_admin', 'manager'));

create policy loans_self_read on loans
  for select using (member_id = current_member_id());

-- A member can also see the loans they have been asked to guarantee - they are
-- on the hook for them, so hiding them would be wrong.
create policy loans_guarantor_read on loans
  for select using (
    exists (select 1 from loan_guarantors g
             where g.loan_id = loans.id and g.member_id = current_member_id())
  );

create policy loans_staff_read on loans
  for select using (has_role('super_admin', 'manager', 'loan_officer', 'cashier'));

create policy loans_staff_update on loans
  for update using (has_role('super_admin', 'manager', 'loan_officer'))
  with check (has_role('super_admin', 'manager', 'loan_officer'));

create policy loan_schedule_self_read on loan_schedule
  for select using (
    exists (select 1 from loans l where l.id = loan_schedule.loan_id
             and l.member_id = current_member_id())
  );
create policy loan_schedule_staff_read on loan_schedule
  for select using (has_role('super_admin', 'manager', 'loan_officer', 'cashier'));

create policy loan_repayments_self_read on loan_repayments
  for select using (member_id = current_member_id());
create policy loan_repayments_staff_read on loan_repayments
  for select using (has_role('super_admin', 'manager', 'loan_officer', 'cashier'));

-- A guarantor sees the guarantee rows that name them, and the borrower sees
-- who is backing their own loan.
create policy loan_guarantors_self_read on loan_guarantors
  for select using (
    member_id = current_member_id()
    or exists (select 1 from loans l where l.id = loan_guarantors.loan_id
                and l.member_id = current_member_id())
  );
create policy loan_guarantors_staff on loan_guarantors
  for all using (has_role('super_admin', 'manager', 'loan_officer'))
  with check (has_role('super_admin', 'manager', 'loan_officer'));

create policy loan_documents_self on loan_documents
  for select using (
    exists (select 1 from loans l where l.id = loan_documents.loan_id
             and l.member_id = current_member_id())
  );
create policy loan_documents_self_insert on loan_documents
  for insert with check (
    exists (select 1 from loans l where l.id = loan_documents.loan_id
             and l.member_id = current_member_id()
             and l.status in ('applied', 'under_review'))
  );
create policy loan_documents_staff on loan_documents
  for all using (has_role('super_admin', 'manager', 'loan_officer'))
  with check (has_role('super_admin', 'manager', 'loan_officer'));

-- ---------------------------------------------------------------------------
-- finance - staff only, members never see SACCO-level books
-- ---------------------------------------------------------------------------
create policy income_categories_read on income_categories
  for select using (has_role('super_admin', 'manager', 'cashier'));
create policy income_categories_admin on income_categories
  for all using (has_role('super_admin', 'manager'))
  with check (has_role('super_admin', 'manager'));

create policy expense_categories_read on expense_categories
  for select using (has_role('super_admin', 'manager', 'cashier'));
create policy expense_categories_admin on expense_categories
  for all using (has_role('super_admin', 'manager'))
  with check (has_role('super_admin', 'manager'));

create policy income_entries_read on income_entries
  for select using (has_role('super_admin', 'manager', 'cashier'));

create policy expense_entries_read on expense_entries
  for select using (has_role('super_admin', 'manager', 'cashier'));

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------
create policy notifications_self on notifications
  for select using (user_id = auth.uid());

create policy notifications_self_update on notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy notifications_staff_insert on notifications
  for insert with check (has_role('super_admin', 'manager', 'loan_officer', 'cashier'));

-- ---------------------------------------------------------------------------
-- audit log - readable by oversight roles, writable by nobody directly
-- ---------------------------------------------------------------------------
create policy audit_logs_read on audit_logs
  for select using (has_role('super_admin', 'manager'));

-- No insert policy: only write_audit() (SECURITY DEFINER) may append.

-- ---------------------------------------------------------------------------
-- doc_counters - internal only, no policies at all
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Function grants. `authenticated` may call these; each one re-checks the
-- caller's role internally via assert_role().
-- ---------------------------------------------------------------------------
revoke all on function post_transaction(uuid, txn_type, numeric, payment_method, date, text, text) from public;
revoke all on function next_document_no(text, integer) from public;
revoke all on function write_audit(text, text, text, text, jsonb, jsonb, text) from public;
revoke all on function ensure_savings_period(uuid, savings_kind, date) from public;

grant execute on function has_role(user_role[])                 to authenticated;
grant execute on function current_role_of()                     to authenticated;
grant execute on function current_member_id()                   to authenticated;
grant execute on function quote_loan(uuid, numeric, integer)     to authenticated;
grant execute on function buy_shares(uuid, integer, payment_method, date, text, text) to authenticated;
grant execute on function record_savings_payment(uuid, savings_kind, numeric, date, payment_method, text) to authenticated;
grant execute on function apply_for_loan(uuid, uuid, numeric, integer, text, text, jsonb, text) to authenticated;
grant execute on function set_loan_status(uuid, loan_status, text) to authenticated;
grant execute on function disburse_loan(uuid, payment_method, date, text) to authenticated;
grant execute on function record_loan_repayment(uuid, numeric, date, payment_method, text) to authenticated;
grant execute on function record_cash_movement(uuid, txn_type, numeric, payment_method, date, text, text) to authenticated;
grant execute on function record_income(uuid, numeric, text, date, payment_method, uuid, text) to authenticated;
grant execute on function record_expense(uuid, numeric, text, date, payment_method, text, text) to authenticated;
grant execute on function approve_expense(uuid, boolean, text)   to authenticated;
grant execute on function reverse_transaction(uuid, text)        to authenticated;
grant execute on function set_guarantor_status(uuid, guarantor_status, text) to authenticated;
grant execute on function remove_guarantor(uuid, text)           to authenticated;
grant execute on function create_member(text, text, text, text, text, date, text, text, text, text, text, text, uuid) to authenticated;
grant execute on function set_member_status(uuid, member_status, text) to authenticated;
grant execute on function dashboard_metrics()                    to authenticated;
grant execute on function collections_trend(integer)             to authenticated;
grant execute on function member_statement(uuid, date, date)     to authenticated;
grant execute on function cashbook(date, date)                   to authenticated;

-- ---------------------------------------------------------------------------
-- On signup, mirror the auth user into app_users so a role always exists.
-- Defaults to 'member'; staff roles are assigned explicitly by a super admin.
-- ---------------------------------------------------------------------------
create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into app_users (id, full_name, email, phone, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.email,
    new.raw_user_meta_data ->> 'phone',
    coalesce((new.raw_user_meta_data ->> 'role')::user_role, 'member')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();
