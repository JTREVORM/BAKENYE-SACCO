-- ===========================================================================
-- BUD-SACCO - 0029 - Roles and permissions as data
--
-- Until now a role was a value of the `user_role` enum and what it could do
-- was written into function bodies as role lists:
--
--     perform assert_role('super_admin', 'manager', 'cashier');
--
-- That made the "Roles & Permissions" screen a picture of rules nobody could
-- change, and it made a new role a migration. From here:
--
--   roles             one row per role. Seven system roles ship; a Super Admin
--                     may add more (a "Branch Supervisor", a "Credit
--                     Committee" member) without a deployment.
--   permissions       the catalogue of things the system can check. This stays
--                     code-defined on purpose: a permission is only real if a
--                     function enforces it, so inventing one from the UI would
--                     be a toggle that silently does nothing.
--   role_permissions  which role holds which permission, editable and audited.
--
-- Every check in the database now asks `has_permission('loans.approve')`,
-- never "is this caller one of these roles". A permission switched off on the
-- Roles screen is switched off here, for the REST API as much as the app.
--
-- Two roles are fixed: `super_admin` always holds everything (so the SACCO
-- cannot lock itself out of its own system), and `member` can only ever hold
-- member-portal permissions (so no toggle can hand a member a staff power).
--
-- This migration also closes four holes found while reviewing access:
--
--   1. `handle_new_auth_user()` took the new account's role from
--      `raw_user_meta_data`, which the person signing up controls. With public
--      sign-up enabled, anyone holding the public anon key could register
--      themselves as `super_admin`. The role is now read only from
--      `raw_app_meta_data`, which only the service role can write, and an
--      account nobody provisioned is created switched off.
--   2. `members_self_update` let a member rewrite their own name and phone
--      number through the REST API. Official member records are now written
--      only by audited functions (0030), and members have no write path at all.
--   3. `app_users_self_update` let a deactivated user set `is_active = true`
--      on their own row. Direct writes to `app_users` are gone.
--   4. `search_guarantor_candidates()` returned every active member's phone,
--      savings balance and share value to any signed-in member. A member now
--      gets a name and a member number, and only for a real search.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The tables
-- ---------------------------------------------------------------------------
create table if not exists roles (
  key          text primary key check (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  name         text not null unique check (length(btrim(name)) between 2 and 60),
  description  text,
  -- A staff role opens the back office; a member role opens the member portal.
  -- The two never mix: see `role_permissions_scope_guard`.
  kind         text not null check (kind in ('staff', 'member')),
  is_system    boolean not null default false,
  status       text not null default 'active' check (status in ('active', 'inactive')),
  sort_order   integer not null default 100,
  created_by   uuid references app_users (id),
  updated_by   uuid references app_users (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

drop trigger if exists roles_updated on roles;
create trigger roles_updated before update on roles
  for each row execute function set_updated_at();

create table if not exists permissions (
  key          text primary key check (key ~ '^[a-z]+\.[a-z_]+$'),
  module       text not null,
  label        text not null,
  description  text,
  scope        text not null check (scope in ('staff', 'member')),
  -- Held by every role of its scope and not switchable: every member of staff
  -- can see the member register; every member can see their own dashboard.
  is_core      boolean not null default false,
  -- Only a Super Admin may grant or withdraw it. These are the permissions
  -- that decide who else gets permissions.
  is_sensitive boolean not null default false,
  sort_order   integer not null default 100
);

create table if not exists role_permissions (
  role_key       text not null references roles (key) on delete cascade on update cascade,
  permission_key text not null references permissions (key) on delete cascade,
  granted_by     uuid references app_users (id),
  granted_at     timestamptz not null default now(),
  primary key (role_key, permission_key)
);

create index if not exists role_permissions_permission_idx on role_permissions (permission_key);

/** A member role may only hold member permissions, and a staff role staff ones. */
create or replace function role_permissions_scope_guard()
returns trigger language plpgsql as $$
declare
  v_kind  text;
  v_scope text;
begin
  select kind into v_kind from roles where key = new.role_key;
  select scope into v_scope from permissions where key = new.permission_key;
  if v_kind is distinct from v_scope then
    raise exception 'The % role cannot hold the "%" permission: it belongs to the % side of the system.',
      new.role_key, new.permission_key, v_scope using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists role_permissions_scope on role_permissions;
create trigger role_permissions_scope before insert or update on role_permissions
  for each row execute function role_permissions_scope_guard();

-- ---------------------------------------------------------------------------
-- 2. The permission catalogue
--
-- Keys match `Permission` in src/lib/rbac.ts. Each one is enforced by at least
-- one function or policy below or in 0030.
-- ---------------------------------------------------------------------------
insert into permissions (key, module, label, description, scope, is_core, is_sensitive, sort_order) values
  ('dashboard.staff',       'Dashboard',    'Staff dashboard',                 'Open the back-office dashboard.',                                              'staff', true,  false, 10),

  ('members.view',          'Members',      'View members',                    'Search the member register and open a member''s record.',                     'staff', true,  false, 100),
  ('members.create',        'Members',      'Register members',                'Register a new member, set their categories and take the registration fees.', 'staff', false, false, 110),
  ('members.manage',        'Members',      'Edit member records',             'Change a member''s official details: name, phone, ID, next of kin. Every change is recorded with a reason.', 'staff', false, false, 120),
  ('members.status',        'Members',      'Change member status',            'Activate, suspend, deactivate or archive a member.',                           'staff', false, false, 130),
  ('members.phone_override','Members',      'Allow a shared phone number',     'Register or keep a member on a phone number another member already uses.',    'staff', false, false, 140),

  ('categories.view',       'Categories',   'View categories',                 'See the share and savings categories and who is in them.',                     'staff', true,  false, 200),
  ('categories.manage',     'Categories',   'Manage categories',               'Create and edit categories, and move a member between them.',                  'staff', false, false, 210),

  ('fees.collect',          'Fees',         'Collect fees',                    'Record a fee payment, or charge a fee to an existing member.',                 'staff', false, false, 300),
  ('fees.manage',           'Fees',         'Manage fees',                     'Create, edit and deactivate fees, and waive a fee a member owes.',             'staff', false, false, 310),

  ('savings.view',          'Savings',      'View savings',                    'See savings schedules, balances and collections.',                             'staff', true,  false, 400),
  ('savings.record',        'Savings',      'Record savings',                  'Record a savings collection against a member''s schedule.',                   'staff', false, false, 410),
  ('savings.waive',         'Savings',      'Waive a savings schedule',        'Waive a savings period that has not been paid, with a reason.',                'staff', false, false, 420),

  ('shares.view',           'Shares',       'View shares',                     'See share holdings and purchases.',                                            'staff', false, false, 500),
  ('shares.sell',           'Shares',       'Sell shares',                     'Record a share purchase for a member.',                                        'staff', false, false, 510),

  ('loans.view',            'Loans',        'View loans',                      'See loans, schedules and repayments.',                                         'staff', false, false, 600),
  ('loans.assess',          'Loans',        'Assess loan applications',        'Create applications for members, review them and reject them.',               'staff', false, false, 610),
  ('loans.approve',         'Loans',        'Approve loans',                   'Approve a loan application.',                                                  'staff', false, false, 620),
  ('loans.disburse',        'Loans',        'Disburse loans',                  'Pay out an approved loan.',                                                    'staff', false, false, 630),
  ('loans.repay',           'Loans',        'Record repayments',               'Record a loan repayment.',                                                     'staff', false, false, 640),
  ('guarantors.manage',     'Loans',        'Manage guarantors',               'Change or remove the guarantors on a loan.',                                   'staff', false, false, 650),

  ('transactions.view',     'Transactions', 'View transactions',               'See the transaction ledger and receipts.',                                     'staff', true,  false, 700),
  ('transactions.reverse',  'Transactions', 'Reverse transactions',            'Post a reversal against a transaction, with a reason.',                        'staff', false, false, 710),
  ('cash.movement',         'Transactions', 'Deposits & withdrawals',          'Record a member deposit or withdrawal.',                                       'staff', false, false, 720),

  ('finance.view',          'Finance',      'View finance',                    'See Cash at Merchant, Cash at Bank, Cash at Hand and the SACCO''s books.',     'staff', false, false, 800),
  ('finance.record',        'Finance',      'Record income & expenses',        'Record receipts, expenses, payments and transfers.',                           'staff', false, false, 810),
  ('finance.approve',       'Finance',      'Approve finance entries',         'Approve transfers, payments and expenses waiting for approval.',               'staff', false, false, 820),
  ('finance.reconcile',     'Finance',      'Reconcile accounts',              'Record a reconciliation against a count or a bank statement.',                 'staff', false, false, 830),
  ('finance.accounts',      'Finance',      'Set up accounts',                 'Create and edit the merchant, bank and cash accounts and finance categories.', 'staff', false, false, 840),

  ('reports.view',          'Reports',      'View reports',                    'Open the reports centre.',                                                     'staff', true,  false, 900),
  ('reports.member',        'Reports',      'Member statements & reports',     'Produce statements and reports about individual members.',                     'staff', false, false, 910),

  ('users.manage',          'Administration','Manage staff accounts',          'Create staff accounts, assign roles, deactivate accounts.',                    'staff', false, true,  1000),
  ('roles.manage',          'Administration','Manage roles & permissions',     'Create roles and decide which permissions each one holds.',                    'staff', false, true,  1010),
  ('audit.view',            'Administration','View audit log',                 'Read the audit log.',                                                          'staff', false, false, 1020),
  ('settings.view',         'Administration','View settings',                  'See how the SACCO is configured.',                                             'staff', false, false, 1030),
  ('settings.manage',       'Administration','Change settings',                'Change SACCO settings, the share price and loan products.',                    'staff', false, false, 1040),

  ('portal.view',           'Member portal','Member portal',                   'Sign in and see their own dashboard, profile, savings, shares, loans, transactions, statements and notifications. Read-only.', 'member', true, false, 2000),
  ('portal.loan_apply',     'Member portal','Apply for a loan',                'Submit a loan application from the member portal for staff to assess.',        'member', false, false, 2010),
  ('portal.guarantee_respond','Member portal','Answer guarantee requests',     'Accept or decline a request to guarantee another member''s loan.',             'member', false, false, 2020)
on conflict (key) do update
   set module = excluded.module, label = excluded.label, description = excluded.description,
       scope = excluded.scope, is_core = excluded.is_core, is_sensitive = excluded.is_sensitive,
       sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- 3. The system roles and their starting permissions
--
-- These reproduce what each role could already do (the old `ROLE_PERMISSIONS`
-- table and the old role lists), plus the new Admin role and the new
-- registration and fee permissions. Seeded once: re-running this migration
-- never undoes a change a Super Admin made on the Roles screen.
-- ---------------------------------------------------------------------------
insert into roles (key, name, description, kind, is_system, sort_order) values
  ('super_admin',   'Super Admin',     'Full control of the system, including staff accounts, roles and permissions. Always holds every permission.', 'staff', true, 10),
  ('admin',         'Admin',           'Member management, settings and financial management, and any other administration a Super Admin assigns.',  'staff', true, 20),
  ('manager',       'SACCO Manager',   'Runs operations: approvals, member records, categories, fees and the books.',                                'staff', true, 30),
  ('loan_officer',  'Loan Officer',    'Loan applications, assessment and repayments.',                                                              'staff', true, 40),
  ('cashier',       'Cashier / Teller','Front-desk collections, fees, shares, deposits and repayments.',                                             'staff', true, 50),
  ('accountant',    'Accountant',      'Transactions, income, expenses, reconciliation and the financial reports.',                                  'staff', true, 60),
  ('field_officer', 'Field Officer',   'Collects savings from members in the field.',                                                                'staff', true, 70),
  ('viewer',        'Viewer',          'Read-only. Cannot record or change anything.',                                                               'staff', true, 80),
  ('member',        'Member',          'A SACCO member. Sees only their own records, read-only, in the member portal.',                              'member', true, 100)
on conflict (key) do nothing;

do $seed$
declare
  v_seed jsonb := jsonb_build_object(
    'admin', to_jsonb(array[
      'members.create','members.manage','members.status','members.phone_override',
      'categories.manage','fees.collect','fees.manage',
      'savings.record','savings.waive','shares.view','shares.sell',
      'loans.view','loans.assess','loans.approve','loans.disburse','loans.repay','guarantors.manage',
      'transactions.reverse','cash.movement',
      'finance.view','finance.record','finance.approve','finance.reconcile','finance.accounts',
      'reports.member','users.manage','audit.view','settings.view','settings.manage']),
    'manager', to_jsonb(array[
      'members.create','members.manage','members.status',
      'categories.manage','fees.collect','fees.manage',
      'savings.record','savings.waive','shares.view','shares.sell',
      'loans.view','loans.assess','loans.approve','loans.disburse','loans.repay','guarantors.manage',
      'transactions.reverse','cash.movement',
      'finance.view','finance.record','finance.approve','finance.reconcile','finance.accounts',
      'reports.member','audit.view','settings.view','settings.manage']),
    'loan_officer', to_jsonb(array[
      'loans.view','loans.assess','loans.repay','guarantors.manage','reports.member']),
    'cashier', to_jsonb(array[
      'fees.collect','savings.record','shares.view','shares.sell',
      'loans.view','loans.repay','cash.movement','finance.view','finance.record']),
    'accountant', to_jsonb(array[
      'shares.view','loans.view','finance.view','finance.record','finance.reconcile',
      'reports.member','audit.view']),
    'field_officer', to_jsonb(array['savings.record','reports.member']),
    'viewer', to_jsonb(array['shares.view','loans.view']),
    'member', to_jsonb(array['portal.loan_apply','portal.guarantee_respond'])
  );
  v_role text;
begin
  for v_role in select jsonb_object_keys(v_seed) loop
    -- Only a role that has never been given permissions is seeded.
    if not exists (select 1 from role_permissions where role_key = v_role) then
      insert into role_permissions (role_key, permission_key)
      select v_role, p from jsonb_array_elements_text(v_seed -> v_role) p
      on conflict do nothing;
    end if;
  end loop;
end
$seed$;

-- ---------------------------------------------------------------------------
-- 4. app_users.role becomes a reference to `roles`
--
-- The policies and helpers that depend on the old column type are dropped
-- first; each is restated below against the new model.
-- ---------------------------------------------------------------------------
drop policy if exists app_users_self_update on app_users;
drop policy if exists app_users_admin_write on app_users;

drop function if exists my_role_raw();
drop function if exists current_role_of();

alter table app_users alter column role drop default;
alter table app_users alter column role type text using role::text;
alter table app_users alter column role set default 'member';

do $$ begin
  alter table app_users add constraint app_users_role_fk
    foreign key (role) references roles (key) on update cascade;
exception when duplicate_object then null; end $$;

alter table audit_logs alter column actor_role type text using actor_role::text;

-- ---------------------------------------------------------------------------
-- 5. The predicates everything else is built on
-- ---------------------------------------------------------------------------

/** The caller's role key, or null for a signed-out or deactivated caller. */
create or replace function current_role_of()
returns text language sql stable security definer set search_path = public as $$
  select u.role from app_users u
    join roles r on r.key = u.role and r.status = 'active'
   where u.id = auth.uid() and u.is_active;
$$;

/** Whether the caller is an active member of staff. */
create or replace function is_staff_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from app_users u join roles r on r.key = u.role
     where u.id = auth.uid() and u.is_active and r.status = 'active' and r.kind = 'staff'
  );
$$;

/**
 * Whether the caller holds a permission.
 *
 * A Super Admin holds every staff permission. A core permission is held by
 * every role of its scope. Anything else must be granted to the caller's role.
 */
create or replace function has_permission(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from app_users u
      join roles r       on r.key = u.role and r.status = 'active'
      join permissions p on p.key = p_key and p.scope = r.kind
     where u.id = auth.uid()
       and u.is_active
       and (u.role = 'super_admin'
            or p.is_core
            or exists (select 1 from role_permissions rp
                        where rp.role_key = u.role and rp.permission_key = p_key))
  );
$$;

create or replace function assert_permission(p_key text)
returns void language plpgsql stable security definer set search_path = public as $$
declare
  v_label text;
begin
  if not has_permission(p_key) then
    select label into v_label from permissions where key = p_key;
    raise exception 'You do not have permission to do this (%). Ask a Super Admin if your role should allow it.',
      coalesce(lower(v_label), p_key) using errcode = 'insufficient_privilege';
  end if;
end;
$$;

/**
 * Kept for the handful of old call sites that may still name roles. It now
 * compares role keys as text; nothing in this migration relies on it.
 */
create or replace function has_role(variadic p_roles user_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from app_users
     where id = auth.uid() and is_active and role = any (p_roles::text[])
  );
$$;

create or replace function write_audit(
  p_action    text,
  p_module    text,
  p_record_id text,
  p_summary   text,
  p_old       jsonb default null,
  p_new       jsonb default null,
  p_reason    text  default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_name text;
  v_role text;
begin
  select full_name, role into v_name, v_role from app_users where id = auth.uid();

  insert into audit_logs (actor_id, actor_name, actor_role, action, module,
                          record_id, summary, old_value, new_value, reason)
  values (auth.uid(), coalesce(v_name, 'system'), v_role, p_action, p_module,
          p_record_id, p_summary, p_old, p_new, p_reason);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. The capability predicates, restated as permissions
--
-- Their names stay, because policies and forty-odd functions call them. What
-- they mean is now whatever the Roles screen says.
-- ---------------------------------------------------------------------------
create or replace function can_view_operations()
returns boolean language sql stable security definer set search_path = public as $$
  select is_staff_user();
$$;

create or replace function can_record_savings()
returns boolean language sql stable security definer set search_path = public as $$
  select has_permission('savings.record');
$$;

create or replace function can_manage_categories()
returns boolean language sql stable security definer set search_path = public as $$
  select has_permission('categories.manage');
$$;

create or replace function can_view_finance()
returns boolean language sql stable security definer set search_path = public as $$
  select has_permission('finance.view');
$$;

create or replace function can_record_finance()
returns boolean language sql stable security definer set search_path = public as $$
  select has_permission('finance.record');
$$;

create or replace function can_view_audit()
returns boolean language sql stable security definer set search_path = public as $$
  select has_permission('audit.view');
$$;

create or replace function can_manage_settings()
returns boolean language sql stable security definer set search_path = public as $$
  select has_permission('settings.manage');
$$;

create or replace function can_approve_finance()
returns boolean language sql stable security definer set search_path = public as $$
  select has_permission('finance.approve');
$$;

create or replace function can_reconcile_finance()
returns boolean language sql stable security definer set search_path = public as $$
  select has_permission('finance.reconcile');
$$;

create or replace function can_manage_finance_accounts()
returns boolean language sql stable security definer set search_path = public as $$
  select has_permission('finance.accounts');
$$;

-- ---------------------------------------------------------------------------
-- 7. Functions that named roles, now naming permissions
--
-- Generated from the definitions live in the database at the time of writing,
-- with only the authorisation line changed, so no other behaviour moves.
-- `create_member()` is dropped: registration goes through `register_member()`
-- in 0030, which takes the fees and creates the receipt in the same
-- transaction, and a second door that skipped the fees would undo that.
-- ---------------------------------------------------------------------------
drop function if exists create_member(text, text, text, text, text, date, text, text, text, text, text, text, uuid);

-- waive_savings_schedule
CREATE OR REPLACE FUNCTION public.waive_savings_schedule(p_schedule_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sched savings_periods;
  v_old   jsonb;
  v_name  text;
begin
  perform assert_permission('savings.waive');

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Give a reason for the waiver.' using errcode = 'check_violation';
  end if;

  select * into v_sched from savings_periods where id = p_schedule_id for update;
  if not found then
    raise exception 'That savings schedule no longer exists.' using errcode = 'no_data_found';
  end if;
  if v_sched.paid_amount > 0 then
    raise exception 'This schedule has payments against it and cannot be waived. Reverse the payments first.'
      using errcode = 'check_violation';
  end if;
  if v_sched.status = 'waived' then
    raise exception 'This schedule is already waived.' using errcode = 'check_violation';
  end if;

  v_old := to_jsonb(v_sched);
  select full_name into v_name from members where id = v_sched.member_id;

  update savings_periods set status = 'waived' where id = p_schedule_id
  returning * into v_sched;

  perform write_audit('savings.waived', 'Savings', p_schedule_id::text,
    format('%s waived for %s (UGX %s)', v_sched.period_label, v_name,
           to_char(v_sched.expected_amount, 'FM999,999,999')),
    v_old, to_jsonb(v_sched), p_reason);

  return jsonb_build_object('schedule_id', p_schedule_id, 'status', 'waived');
end;
$function$
;

-- apply_for_loan
CREATE OR REPLACE FUNCTION public.apply_for_loan(p_member_id uuid, p_product_id uuid, p_principal numeric, p_period_months integer, p_purpose text, p_purpose_category text DEFAULT NULL::text, p_guarantors jsonb DEFAULT '[]'::jsonb, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_q        jsonb;
  v_elig     jsonb;
  v_loan     loans;
  v_member   members;
  v_product  loan_products;
  v_g        jsonb;
  v_gmember  members;
  v_count    integer;
  v_cover    numeric := 0;
  v_min_g    integer;
  v_need     numeric;
begin
  if not (has_permission('loans.assess')
          or (current_member_id() = p_member_id and has_permission('portal.loan_apply'))) then
    raise exception 'You do not have permission to apply on behalf of this member.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_member from members where id = p_member_id for update;
  if not found then
    raise exception 'Member not found.' using errcode = 'no_data_found';
  end if;

  -- Guard against a resubmitted wizard creating twin applications.
  if p_idempotency_key is not null then
    select * into v_loan from loans
     where member_id = p_member_id
       and created_at > now() - interval '1 day'
       and review_notes = 'idem:' || p_idempotency_key;
    if found then
      return jsonb_build_object('loan_id', v_loan.id, 'loan_no', v_loan.loan_no,
                                'status', v_loan.status, 'duplicate', true);
    end if;
  end if;

  select * into v_product from loan_products where id = p_product_id;
  if not found then
    raise exception 'Loan product is not available.' using errcode = 'no_data_found';
  end if;

  -- Every rule at once, so the applicant is told everything standing in the
  -- way rather than the first thing.
  v_elig := loan_eligibility(p_member_id, p_product_id, p_principal);
  if not (v_elig ->> 'eligible')::boolean then
    raise exception '%', (
      select string_agg(value #>> '{}', ' ') from jsonb_array_elements(v_elig -> 'reasons')
    ) using errcode = 'check_violation';
  end if;

  v_q     := quote_loan(p_product_id, p_principal, p_period_months);
  v_min_g := (v_elig ->> 'min_guarantors')::integer;

  insert into loans (
    loan_no, member_id, product_id, product_name, product_code,
    principal, interest_rate, interest_method, interest_amount,
    processing_fee, insurance_fee, application_fee,
    total_payable, period_months, installment_amount, installment_count,
    repayment_frequency, late_penalty_pct, penalty_basis, grace_period_days,
    purpose, purpose_category, status, created_by, review_notes, terms)
  values (
    next_document_no('LN', 5), p_member_id, p_product_id, v_product.name, v_product.code,
    p_principal,
    (v_q ->> 'interest_rate')::numeric, v_q ->> 'interest_method',
    (v_q ->> 'interest_amount')::numeric,
    (v_q ->> 'processing_fee')::numeric,
    (v_q ->> 'insurance_fee')::numeric,
    (v_q ->> 'application_fee')::numeric,
    (v_q ->> 'total_payable')::numeric, p_period_months,
    (v_q ->> 'installment_amount')::numeric,
    (v_q ->> 'installment_count')::integer,
    v_product.repayment_frequency, v_product.late_penalty_pct,
    v_product.penalty_basis, v_product.grace_period_days,
    p_purpose, p_purpose_category, 'applied', auth.uid(),
    case when p_idempotency_key is null then null else 'idem:' || p_idempotency_key end,
    -- The contract, as it read today.
    jsonb_build_object(
      'snapshotted_at', now(),
      'quote', v_q,
      'product', to_jsonb(v_product),
      'sacco_rules', jsonb_build_object(
        'max_active_per_member', setting_int('loans.max_active_per_member'),
        'max_savings_multiple',  setting_number('loans.max_savings_multiple'),
        'min_membership_months', setting_int('loans.min_membership_months'),
        'require_guarantors',    setting_bool('loans.require_guarantors'),
        'guarantor_cover_pct',   setting_number('loans.guarantor_cover_pct'))))
  returning * into v_loan;

  -- Guarantors must be active members, and never the borrower.
  v_count := 0;
  for v_g in select * from jsonb_array_elements(coalesce(p_guarantors, '[]'::jsonb))
  loop
    select * into v_gmember from members where id = (v_g ->> 'member_id')::uuid;
    if not found then
      raise exception 'Guarantor is not a registered member.' using errcode = 'no_data_found';
    end if;
    if v_gmember.status <> 'active' then
      raise exception 'Guarantor % is not an active member.', v_gmember.full_name
        using errcode = 'check_violation';
    end if;
    if v_gmember.id = p_member_id then
      raise exception 'A member cannot guarantee their own loan.' using errcode = 'check_violation';
    end if;

    insert into loan_guarantors (loan_id, member_id, guaranteed_amount, status)
    values (v_loan.id, v_gmember.id, (v_g ->> 'amount')::numeric, 'pending');

    v_count := v_count + 1;
    v_cover := v_cover + coalesce((v_g ->> 'amount')::numeric, 0);
  end loop;

  if v_count < v_min_g then
    raise exception 'This loan requires at least % guarantor(s).', v_min_g
      using errcode = 'check_violation';
  end if;

  -- Cover, not just headcount: three guarantors pledging a tenth of the
  -- principal between them are not security for it.
  if v_min_g > 0 then
    v_need := round(p_principal * (v_elig ->> 'guarantor_cover_pct')::numeric / 100.0, 2);
    if v_cover < v_need then
      raise exception 'Guarantors must cover at least UGX % of this loan. They currently cover UGX %.',
        to_char(v_need, 'FM999,999,999'), to_char(v_cover, 'FM999,999,999')
        using errcode = 'check_violation';
    end if;
  end if;

  perform write_audit('loan.applied', 'Loans', v_loan.id::text,
    format('%s applied for %s of UGX %s', v_member.full_name, v_product.name,
           to_char(p_principal, 'FM999,999,999')),
    null, to_jsonb(v_loan), p_purpose);

  return jsonb_build_object('loan_id', v_loan.id, 'loan_no', v_loan.loan_no,
                            'status', v_loan.status, 'quote', v_q, 'duplicate', false);
end;
$function$
;

-- buy_shares
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
$function$
;

-- record_cash_movement
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
$function$
;

-- disburse_loan
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
$function$
;

-- record_loan_repayment
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
$function$
;

-- remove_guarantor
CREATE OR REPLACE FUNCTION public.remove_guarantor(p_guarantor_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_g    loan_guarantors;
  v_loan loans;
  v_left integer;
  v_min  integer;
begin
  perform assert_permission('guarantors.manage');

  select * into v_g from loan_guarantors where id = p_guarantor_id;
  if not found then
    raise exception 'Guarantor record not found.' using errcode = 'no_data_found';
  end if;

  select * into v_loan from loans where id = v_g.loan_id for update;

  -- Once money is out the door the guarantee is a live obligation.
  if v_loan.status in ('disbursed', 'active', 'defaulted') then
    raise exception 'Guarantors cannot be removed from a loan that has been disbursed.'
      using errcode = 'check_violation';
  end if;

  select p.min_guarantors into v_min from loan_products p where p.id = v_loan.product_id;
  select count(*) - 1 into v_left from loan_guarantors where loan_id = v_g.loan_id;

  if v_left < v_min then
    raise exception 'Loan %s must keep at least % guarantor(s).', v_loan.loan_no, v_min
      using errcode = 'check_violation';
  end if;

  delete from loan_guarantors where id = p_guarantor_id;

  perform write_audit('guarantor.removed', 'Loans', p_guarantor_id::text,
    format('Guarantor removed from loan %s', v_loan.loan_no), to_jsonb(v_g), null, p_reason);

  return jsonb_build_object('removed', true);
end;
$function$
;

-- reverse_transaction
CREATE OR REPLACE FUNCTION public.reverse_transaction(p_transaction_id uuid, p_reason text, p_reversal_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_orig      transactions;
  v_rev       transactions;
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
    update loans
       set status = case when status = 'completed' then 'active'::loan_status else status end,
           completed_on = case when status = 'completed' then null else completed_on end
     where id = v_orig.loan_id;
  end if;

  perform write_audit('transaction.reversed', 'Financials', v_orig.id::text,
    format('Transaction %s (%s) reversed by %s on %s', v_orig.reference, ugx(v_orig.amount),
           v_rev.reference, to_char(v_on, 'DD Mon YYYY')),
    to_jsonb(v_orig), to_jsonb(v_rev), p_reason);

  return jsonb_build_object('original_reference', v_orig.reference,
                            'reversal_reference', v_rev.reference,
                            'reversal_id', v_rev.id);
end;
$function$
;

-- set_guarantor_status
CREATE OR REPLACE FUNCTION public.set_guarantor_status(p_guarantor_id uuid, p_status guarantor_status, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_g    loan_guarantors;
  v_old  jsonb;
  v_loan loans;
begin
  select * into v_g from loan_guarantors where id = p_guarantor_id for update;
  if not found then
    raise exception 'Guarantor record not found.' using errcode = 'no_data_found';
  end if;
  v_old := to_jsonb(v_g);

  -- Staff may set any status; the guaranteeing member may only accept/decline
  -- their own pending request.
  if not has_permission('guarantors.manage') then
    if current_member_id() is distinct from v_g.member_id
       or not has_permission('portal.guarantee_respond') then
      raise exception 'You may only respond to your own guarantee requests.'
        using errcode = 'insufficient_privilege';
    end if;
    if p_status not in ('accepted', 'declined') then
      raise exception 'You may only accept or decline a guarantee request.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  select * into v_loan from loans where id = v_g.loan_id;
  if p_status = 'released' and v_loan.status not in ('completed', 'rejected', 'written_off') then
    raise exception 'A guarantor cannot be released while the loan is still %.', v_loan.status
      using errcode = 'check_violation';
  end if;

  update loan_guarantors
     set status = p_status, responded_on = current_date, note = coalesce(p_note, note)
   where id = p_guarantor_id
   returning * into v_g;

  perform write_audit('guarantor.' || p_status::text, 'Loans', v_g.id::text,
    format('Guarantor on loan %s marked %s', v_loan.loan_no, p_status), v_old, to_jsonb(v_g), p_note);

  return jsonb_build_object('guarantor_id', v_g.id, 'status', v_g.status);
end;
$function$
;

-- set_loan_status
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
   where m.id = v_loan.member_id and m.user_id is not null;

  return jsonb_build_object('loan_id', v_loan.id, 'loan_no', v_loan.loan_no, 'status', v_loan.status);
end;
$function$
;

-- set_member_categories
CREATE OR REPLACE FUNCTION public.set_member_categories(p_member_id uuid, p_share_category_id uuid, p_savings_category_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_member  members;
  v_share   share_categories;
  v_savings savings_categories;
  v_old_share text;
  v_old_savings text;
  v_repriced integer := 0;
begin
  perform assert_permission('categories.manage');

  select * into v_member from members where id = p_member_id for update;
  if not found then
    raise exception 'Member not found.' using errcode = 'no_data_found';
  end if;

  if p_share_category_id is not null then
    select * into v_share from share_categories
     where id = p_share_category_id and status = 'active';
    if not found then
      raise exception 'That share category is not available.' using errcode = 'no_data_found';
    end if;
  end if;

  if p_savings_category_id is not null then
    select * into v_savings from savings_categories
     where id = p_savings_category_id and status = 'active';
    if not found then
      raise exception 'That savings category is not available.' using errcode = 'no_data_found';
    end if;
  end if;

  -- The configurable rule from section 3. Off by default; when a SACCO turns it
  -- on, the two categories must name the same tier.
  if coalesce(setting_bool('categories.share_matches_savings'), false)
     and v_share.id is not null and v_savings.id is not null
     and split_part(v_savings.code, '_', 1) <> v_share.code then
    raise exception 'This SACCO requires the savings category to match the share category. % shares go with the % saver category.',
      v_share.name, v_share.name using errcode = 'check_violation';
  end if;

  select name into v_old_share   from share_categories   where id = v_member.share_category_id;
  select name into v_old_savings from savings_categories where id = v_member.savings_category_id;

  update members
     set share_category_id   = p_share_category_id,
         savings_category_id = p_savings_category_id
   where id = p_member_id;

  -- Re-price what has not happened yet, and only that.
  if p_savings_category_id is distinct from v_member.savings_category_id
     and v_savings.id is not null then
    update savings_periods sp
       set savings_category_id = v_savings.id,
           expected_amount     = v_savings.amount,
           kind                = v_savings.frequency
     where sp.member_id = p_member_id
       and sp.status = 'pending'
       and sp.paid_amount = 0
       and coalesce(sp.due_on, sp.period_end) >= current_date
       and sp.kind = v_savings.frequency;
    get diagnostics v_repriced = row_count;
  end if;

  perform write_audit('member.categories_changed', 'Categories', p_member_id::text,
    format('%s: share category %s -> %s, savings category %s -> %s',
           v_member.full_name,
           coalesce(v_old_share, 'none'),   coalesce(v_share.name, 'none'),
           coalesce(v_old_savings, 'none'), coalesce(v_savings.name, 'none')),
    jsonb_build_object('share_category_id', v_member.share_category_id,
                       'savings_category_id', v_member.savings_category_id),
    jsonb_build_object('share_category_id', p_share_category_id,
                       'savings_category_id', p_savings_category_id),
    p_reason);

  return jsonb_build_object(
    'member_id',            p_member_id,
    'share_category_id',    p_share_category_id,
    'share_category_name',  v_share.name,
    'savings_category_id',  p_savings_category_id,
    'savings_category_name', v_savings.name,
    'schedules_repriced',   v_repriced
  );
end;
$function$
;

-- ---------------------------------------------------------------------------
-- 8. Accounts: sign-up, roles on accounts, activation
-- ---------------------------------------------------------------------------

/**
 * Every new auth account gets its `app_users` row here.
 *
 * Only `raw_app_meta_data` is trusted. It can be written by the service role
 * alone - the server actions that create staff and member logins - whereas
 * `raw_user_meta_data` is whatever the person signing up chose to send. An
 * account that arrives with no role in its app metadata was not provisioned by
 * the SACCO; it is created switched off, and can do nothing until a Super
 * Admin looks at it.
 *
 * A member login carries `member_id`. The account is linked to that member in
 * the same transaction that creates it, so there is never a login that points
 * at nobody or two logins for one member.
 */
create or replace function handle_new_auth_user()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_role   text := nullif(new.raw_app_meta_data ->> 'role', '');
  v_member members;
  v_mid    uuid;
begin
  begin
    v_mid := nullif(new.raw_app_meta_data ->> 'member_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'Invalid member reference on a new login.';
  end;

  if v_mid is not null then
    select * into v_member from members where id = v_mid for update;
    if not found then
      raise exception 'A login was requested for a member that does not exist.';
    end if;
    if v_member.user_id is not null then
      raise exception 'Member % already has a login.', v_member.member_no;
    end if;
    v_role := 'member';
  elsif v_role is not null then
    if not exists (select 1 from roles where key = v_role and status = 'active') then
      raise exception 'Unknown role % on a new login.', v_role;
    end if;
    if v_role = 'member' then
      raise exception 'A member login must name the member it belongs to.';
    end if;
  end if;

  insert into app_users (id, full_name, email, phone, role, is_active)
  values (
    new.id,
    coalesce(v_member.full_name,
             nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
             split_part(new.email, '@', 1)),
    -- A member's sign-in address is an internal identifier, not a mailbox;
    -- their contact email, if any, lives on their member record.
    case when v_mid is null then new.email end,
    coalesce(v_member.phone, nullif(btrim(new.raw_user_meta_data ->> 'phone'), '')),
    coalesce(v_role, 'member'),
    v_role is not null
  )
  on conflict (id) do nothing;

  if v_mid is not null then
    update members set user_id = new.id where id = v_mid;
  end if;

  return new;
end;
$$;

/** Record a sign-in. Replaces the direct `app_users` update the app used to make. */
create or replace function touch_last_login()
returns void language sql security definer set search_path = public as $$
  update app_users set last_login_at = now() where id = auth.uid() and is_active;
$$;

/**
 * Everything the app needs to know about the signed-in person, in one round
 * trip: who they are, their role, every permission they hold, and the member
 * record they are linked to. On a 3G connection this is one request instead of
 * four.
 */
create or replace function my_session()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id',          u.id,
    'full_name',   coalesce(m.full_name, u.full_name),
    'email',       u.email,
    'phone',       coalesce(m.phone, u.phone),
    'photo_url',   coalesce(m.photo_url, u.photo_url),
    'is_active',   u.is_active,
    'role',        u.role,
    'role_name',   r.name,
    'role_kind',   r.kind,
    'role_active', r.status = 'active',
    'member',      case when m.id is null then null else jsonb_build_object(
                     'id', m.id, 'member_no', m.member_no, 'status', m.status) end,
    'permissions', coalesce((
      select jsonb_agg(p.key order by p.sort_order)
        from permissions p
       where p.scope = r.kind
         and (u.role = 'super_admin' or p.is_core
              or exists (select 1 from role_permissions rp
                          where rp.role_key = u.role and rp.permission_key = p.key))
    ), '[]'::jsonb)
  )
  from app_users u
  join roles r on r.key = u.role
  left join members m on m.user_id = u.id
  where u.id = auth.uid();
$$;

/**
 * Whether the caller may give a staff account this role. Called by the server
 * action before it asks Supabase Auth to create the account, so a refusal
 * costs nothing and leaves nothing behind.
 */
create or replace function assert_can_assign_role(p_role text)
returns void language plpgsql stable security definer set search_path = public as $$
declare
  v_role roles;
begin
  perform assert_permission('users.manage');

  select * into v_role from roles where key = p_role;
  if not found or v_role.status <> 'active' then
    raise exception 'Choose an active role.' using errcode = 'check_violation';
  end if;
  if v_role.kind <> 'staff' then
    raise exception 'Member logins are created from the member''s record, not here.'
      using errcode = 'check_violation';
  end if;
  if p_role = 'super_admin' and current_role_of() is distinct from 'super_admin' then
    raise exception 'Only a Super Admin can create another Super Admin.'
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

/** Audit a staff account the server action has just created. */
create or replace function log_staff_account_created(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user app_users;
begin
  perform assert_permission('users.manage');
  select * into v_user from app_users where id = p_user_id;
  if not found then
    raise exception 'User not found.' using errcode = 'no_data_found';
  end if;
  perform write_audit('user.created', 'User Management', p_user_id::text,
    format('Staff account created for %s (%s) as %s', v_user.full_name,
           coalesce(v_user.email::text, 'no email'),
           (select name from roles where key = v_user.role)),
    null, jsonb_build_object('email', v_user.email, 'role', v_user.role), null);
end;
$$;

drop function if exists set_user_role(uuid, user_role, text);

create or replace function set_user_role(p_user_id uuid, p_role text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user     app_users;
  v_old_kind text;
  v_old      text;
begin
  perform assert_can_assign_role(p_role);

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Give a reason for this change.' using errcode = 'check_violation';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot change your own role.' using errcode = 'check_violation';
  end if;

  select * into v_user from app_users where id = p_user_id for update;
  if not found then
    raise exception 'User not found.' using errcode = 'no_data_found';
  end if;

  select kind into v_old_kind from roles where key = v_user.role;
  if v_old_kind = 'member' or exists (select 1 from members where user_id = p_user_id) then
    raise exception 'This is a member''s login. Staff access needs a separate staff account with its own email address.'
      using errcode = 'check_violation';
  end if;
  if v_user.role = 'super_admin' and current_role_of() is distinct from 'super_admin' then
    raise exception 'Only a Super Admin can change a Super Admin''s role.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_user.role = 'super_admin' and p_role <> 'super_admin'
     and (select count(*) from app_users where role = 'super_admin' and is_active) <= 1 then
    raise exception 'This is the last active Super Admin. Make someone else a Super Admin first.'
      using errcode = 'check_violation';
  end if;
  if v_user.role = p_role then
    raise exception '% already has this role.', v_user.full_name using errcode = 'check_violation';
  end if;

  v_old := v_user.role;
  update app_users set role = p_role where id = p_user_id returning * into v_user;

  perform write_audit('user.role_changed', 'User Management', p_user_id::text,
    format('%s: role changed from %s to %s', v_user.full_name,
           (select name from roles where key = v_old), (select name from roles where key = p_role)),
    jsonb_build_object('role', v_old), jsonb_build_object('role', p_role), p_reason);

  return jsonb_build_object('user_id', v_user.id, 'role', v_user.role);
end;
$$;

create or replace function set_user_active(p_user_id uuid, p_active boolean, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user app_users;
begin
  perform assert_permission('users.manage');

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Give a reason for this change.' using errcode = 'check_violation';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot deactivate your own account.' using errcode = 'check_violation';
  end if;

  select * into v_user from app_users where id = p_user_id for update;
  if not found then
    raise exception 'User not found.' using errcode = 'no_data_found';
  end if;
  if v_user.role = 'super_admin' and current_role_of() is distinct from 'super_admin' then
    raise exception 'Only a Super Admin can deactivate a Super Admin.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_user.role = 'super_admin' and not p_active
     and (select count(*) from app_users where role = 'super_admin' and is_active) <= 1 then
    raise exception 'This is the last active Super Admin and cannot be deactivated.'
      using errcode = 'check_violation';
  end if;
  if v_user.is_active = p_active then
    raise exception 'This account is already %.', case when p_active then 'active' else 'deactivated' end
      using errcode = 'check_violation';
  end if;

  update app_users set is_active = p_active where id = p_user_id returning * into v_user;

  perform write_audit(case when p_active then 'user.activated' else 'user.deactivated' end,
    'User Management', p_user_id::text,
    format('%s %s', v_user.full_name, case when p_active then 'activated' else 'deactivated' end),
    jsonb_build_object('is_active', not p_active), jsonb_build_object('is_active', p_active), p_reason);

  return jsonb_build_object('user_id', v_user.id, 'is_active', v_user.is_active);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Roles administration
-- ---------------------------------------------------------------------------

/** Validate and normalise a permission list for a role. */
create or replace function normalise_role_permissions(p_role roles, p_permissions text[])
returns text[] language plpgsql stable security definer set search_path = public as $$
declare
  v_bad  text;
  v_list text[];
begin
  select array_agg(distinct x) into v_list
    from unnest(coalesce(p_permissions, '{}')) x
   where x is not null and btrim(x) <> '';
  v_list := coalesce(v_list, '{}');

  select x into v_bad from unnest(v_list) x
   where not exists (select 1 from permissions p where p.key = x)
   limit 1;
  if v_bad is not null then
    raise exception 'There is no "%" permission.', v_bad using errcode = 'check_violation';
  end if;

  select x into v_bad from unnest(v_list) x
    join permissions p on p.key = x
   where p.scope <> p_role.kind
   limit 1;
  if v_bad is not null then
    raise exception 'The % role cannot hold "%": it belongs to the other side of the system.',
      p_role.name, (select label from permissions where key = v_bad) using errcode = 'check_violation';
  end if;

  -- Core permissions are implicit and never stored.
  select coalesce(array_agg(x order by x), '{}') into v_list
    from unnest(v_list) x join permissions p on p.key = x
   where not p.is_core;

  return v_list;
end;
$$;

/** Replace a role's permissions. Audited with exactly what was granted and withdrawn. */
create or replace function set_role_permissions(p_role_key text, p_permissions text[], p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role    roles;
  v_old     text[];
  v_new     text[];
  v_added   text[];
  v_removed text[];
  v_bad     text;
begin
  perform assert_permission('roles.manage');

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Give a reason for changing this role''s permissions.' using errcode = 'check_violation';
  end if;

  select * into v_role from roles where key = p_role_key for update;
  if not found then
    raise exception 'Role not found.' using errcode = 'no_data_found';
  end if;
  if v_role.key = 'super_admin' then
    raise exception 'The Super Admin role always holds every permission and cannot be edited.'
      using errcode = 'check_violation';
  end if;

  v_new := normalise_role_permissions(v_role, p_permissions);
  select coalesce(array_agg(permission_key order by permission_key), '{}') into v_old
    from role_permissions where role_key = p_role_key;

  select coalesce(array_agg(x order by x), '{}') into v_added   from unnest(v_new) x where not x = any (v_old);
  select coalesce(array_agg(x order by x), '{}') into v_removed from unnest(v_old) x where not x = any (v_new);

  if cardinality(v_added) = 0 and cardinality(v_removed) = 0 then
    raise exception 'Nothing changed.' using errcode = 'check_violation';
  end if;

  -- The permissions that decide who else gets permissions move only with a
  -- Super Admin's hand on them.
  select x into v_bad
    from unnest(v_added || v_removed) x join permissions p on p.key = x
   where p.is_sensitive limit 1;
  if v_bad is not null and current_role_of() is distinct from 'super_admin' then
    raise exception 'Only a Super Admin can grant or withdraw "%".',
      (select label from permissions where key = v_bad) using errcode = 'insufficient_privilege';
  end if;

  -- Nobody edits the role they themselves hold: that is how an Admin with
  -- roles.manage would quietly give themselves everything else.
  if current_role_of() = p_role_key then
    raise exception 'You cannot change the permissions of your own role.'
      using errcode = 'insufficient_privilege';
  end if;

  delete from role_permissions where role_key = p_role_key and not permission_key = any (v_new);
  insert into role_permissions (role_key, permission_key, granted_by)
  select p_role_key, x, auth.uid() from unnest(v_added) x
  on conflict do nothing;

  update roles set updated_by = auth.uid(), updated_at = now() where key = p_role_key;

  perform write_audit('role.permissions_changed', 'User Management', p_role_key,
    format('%s: %s granted, %s withdrawn', v_role.name,
           coalesce(nullif(array_to_string(v_added, ', '), ''), 'nothing'),
           coalesce(nullif(array_to_string(v_removed, ', '), ''), 'nothing')),
    jsonb_build_object('permissions', v_old),
    jsonb_build_object('permissions', v_new, 'granted', v_added, 'withdrawn', v_removed),
    p_reason);

  return jsonb_build_object('role', p_role_key, 'permissions', v_new,
                            'granted', v_added, 'withdrawn', v_removed);
end;
$$;

/** Create a staff role. */
create or replace function create_role(
  p_name        text,
  p_description text,
  p_permissions text[],
  p_reason      text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_key  text;
  v_role roles;
  v_list text[];
  v_bad  text;
begin
  perform assert_permission('roles.manage');

  if length(v_name) < 2 or length(v_name) > 60 then
    raise exception 'Give the role a name of 2 to 60 characters.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from roles where lower(name) = lower(v_name)) then
    raise exception 'A role called % already exists.', v_name using errcode = 'unique_violation';
  end if;

  v_key := left(regexp_replace(regexp_replace(lower(v_name), '[^a-z0-9]+', '_', 'g'), '^_+|_+$', '', 'g'), 32);
  if v_key !~ '^[a-z]' then
    v_key := 'role_' || v_key;
  end if;
  while exists (select 1 from roles where key = v_key) loop
    v_key := left(v_key, 28) || '_' || substr(md5(random()::text), 1, 3);
  end loop;

  insert into roles (key, name, description, kind, is_system, sort_order, created_by, updated_by)
  values (v_key, v_name, nullif(btrim(coalesce(p_description, '')), ''), 'staff', false, 90,
          auth.uid(), auth.uid())
  returning * into v_role;

  v_list := normalise_role_permissions(v_role, p_permissions);

  select x into v_bad from unnest(v_list) x join permissions p on p.key = x
   where p.is_sensitive limit 1;
  if v_bad is not null and current_role_of() is distinct from 'super_admin' then
    raise exception 'Only a Super Admin can grant "%".',
      (select label from permissions where key = v_bad) using errcode = 'insufficient_privilege';
  end if;

  insert into role_permissions (role_key, permission_key, granted_by)
  select v_key, x, auth.uid() from unnest(v_list) x;

  perform write_audit('role.created', 'User Management', v_key,
    format('Role %s created with %s permission(s)', v_name, cardinality(v_list)),
    null, jsonb_build_object('name', v_name, 'description', v_role.description, 'permissions', v_list),
    p_reason);

  return jsonb_build_object('role', v_key, 'name', v_name, 'permissions', v_list);
end;
$$;

/** Rename or re-describe a role. The two fixed roles keep their names. */
create or replace function update_role(p_role_key text, p_name text, p_description text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role roles;
  v_old  jsonb;
  v_name text := btrim(coalesce(p_name, ''));
begin
  perform assert_permission('roles.manage');

  select * into v_role from roles where key = p_role_key for update;
  if not found then
    raise exception 'Role not found.' using errcode = 'no_data_found';
  end if;
  if length(v_name) < 2 or length(v_name) > 60 then
    raise exception 'Give the role a name of 2 to 60 characters.' using errcode = 'check_violation';
  end if;
  if v_role.key in ('super_admin', 'member') and v_name <> v_role.name then
    raise exception 'The % role cannot be renamed.', v_role.name using errcode = 'check_violation';
  end if;
  if exists (select 1 from roles where lower(name) = lower(v_name) and key <> p_role_key) then
    raise exception 'A role called % already exists.', v_name using errcode = 'unique_violation';
  end if;

  v_old := jsonb_build_object('name', v_role.name, 'description', v_role.description);
  update roles
     set name = v_name,
         description = nullif(btrim(coalesce(p_description, '')), ''),
         updated_by = auth.uid()
   where key = p_role_key
   returning * into v_role;

  perform write_audit('role.updated', 'User Management', p_role_key,
    format('Role %s updated', v_role.name), v_old,
    jsonb_build_object('name', v_role.name, 'description', v_role.description), p_reason);

  return jsonb_build_object('role', v_role.key, 'name', v_role.name);
end;
$$;

/** Retire or restore a role. A role still held by an active account stays. */
create or replace function set_role_status(p_role_key text, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role  roles;
  v_count integer;
begin
  perform assert_permission('roles.manage');

  if p_status not in ('active', 'inactive') then
    raise exception 'Unknown status %.', p_status using errcode = 'check_violation';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Give a reason for this change.' using errcode = 'check_violation';
  end if;

  select * into v_role from roles where key = p_role_key for update;
  if not found then
    raise exception 'Role not found.' using errcode = 'no_data_found';
  end if;
  if v_role.key in ('super_admin', 'member') then
    raise exception 'The % role cannot be retired.', v_role.name using errcode = 'check_violation';
  end if;
  if v_role.status = p_status then
    raise exception 'This role is already %.', p_status using errcode = 'check_violation';
  end if;

  if p_status = 'inactive' then
    select count(*) into v_count from app_users where role = p_role_key and is_active;
    if v_count > 0 then
      raise exception '% active account(s) still hold the % role. Give them another role first.',
        v_count, v_role.name using errcode = 'check_violation';
    end if;
  end if;

  update roles set status = p_status, updated_by = auth.uid() where key = p_role_key;

  perform write_audit('role.' || case when p_status = 'active' then 'restored' else 'retired' end,
    'User Management', p_role_key,
    format('Role %s %s', v_role.name, case when p_status = 'active' then 'restored' else 'retired' end),
    jsonb_build_object('status', v_role.status), jsonb_build_object('status', p_status), p_reason);

  return jsonb_build_object('role', p_role_key, 'status', p_status);
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Policies
--
-- Official records are written by functions only. Every direct-write policy
-- on a table that holds member data, money, roles or accounts is removed, and
-- the table privileges are narrowed to match, so a hand-crafted REST call is
-- refused twice.
-- ---------------------------------------------------------------------------
alter table roles            enable row level security;
alter table permissions      enable row level security;
alter table role_permissions enable row level security;

drop policy if exists roles_read on roles;
create policy roles_read on roles for select using (auth.uid() is not null);

drop policy if exists permissions_read on permissions;
create policy permissions_read on permissions for select using (auth.uid() is not null);

drop policy if exists role_permissions_read on role_permissions;
create policy role_permissions_read on role_permissions for select using (is_staff_user());

-- Members: read own row, staff read all. No write policy at all.
drop policy if exists members_self_update    on members;
drop policy if exists members_staff_write    on members;
drop policy if exists members_officer_insert on members;

-- Loans and guarantors change through their functions, which audit.
drop policy if exists loans_staff_update on loans;
drop policy if exists loan_guarantors_staff on loan_guarantors;
drop policy if exists loan_guarantors_staff_read on loan_guarantors;
create policy loan_guarantors_staff_read on loan_guarantors for select using (can_view_operations());

drop policy if exists loan_documents_staff on loan_documents;
drop policy if exists loan_documents_staff_read on loan_documents;
create policy loan_documents_staff_read on loan_documents for select using (can_view_operations());
drop policy if exists loan_documents_staff_write on loan_documents;
create policy loan_documents_staff_write on loan_documents for insert
  with check (has_permission('loans.assess'));

-- The share price changes through update_share_settings(), which audits.
drop policy if exists share_settings_admin on share_settings;

-- Notifications are created by the functions that have something to say. A
-- member of staff inserting one directly could put words in the SACCO's mouth
-- on a member's phone.
drop policy if exists notifications_staff_insert on notifications;

-- ---------------------------------------------------------------------------
-- 11. The guarantor search tells a member only what they need
-- ---------------------------------------------------------------------------
create or replace function search_guarantor_candidates(
  p_query          text,
  p_exclude_member uuid,
  p_loan_id        uuid default null
) returns table (
  id uuid, member_no text, full_name text, phone text,
  photo_url text, savings_balance numeric, share_value numeric
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_staff boolean := can_view_operations();
  v_q     text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if not v_staff and current_member_id() is null then
    raise exception 'You do not have permission to search members.' using errcode = 'insufficient_privilege';
  end if;

  -- A member finds a guarantor by typing a name or number they already know;
  -- they are not handed a browsable list of the register.
  if not v_staff and (v_q is null or length(v_q) < 3) then
    return;
  end if;

  return query
  select mf.id, mf.member_no, mf.full_name,
         case when v_staff then mf.phone end,
         mf.photo_url,
         case when v_staff then mf.savings_balance end,
         case when v_staff then mf.share_value end
    from member_financials mf
   where mf.status = 'active'
     and mf.id <> p_exclude_member
     and (p_loan_id is null
          or not exists (select 1 from loan_guarantors g
                          where g.loan_id = p_loan_id and g.member_id = mf.id))
     and (v_q is null
          or mf.full_name ilike '%' || v_q || '%'
          or mf.member_no ilike '%' || v_q || '%'
          or (v_staff and mf.phone ilike '%' || v_q || '%'))
   order by mf.full_name
   limit 10;
end;
$$;
