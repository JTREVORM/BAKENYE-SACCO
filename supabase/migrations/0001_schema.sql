-- ===========================================================================
-- Bakenye Unity and Development SACCO (BUD-SACCO)
-- 0001 - Core relational schema
--
-- Money is stored as NUMERIC(16,2) in UGX. Never float. Never double precision.
-- Every balance that matters is derived from an immutable ledger row, not from
-- a number a user typed into a form.
-- ===========================================================================

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";
create extension if not exists "citext";

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------
create type user_role as enum (
  'super_admin',
  'manager',
  'loan_officer',
  'cashier',
  'member'
);

create type member_status as enum ('active', 'inactive', 'suspended', 'exited');

create type savings_kind as enum ('weekly', 'monthly');

create type savings_status as enum ('paid', 'partial', 'pending', 'missed');

create type loan_status as enum (
  'applied',
  'under_review',
  'approved',
  'rejected',
  'disbursed',
  'active',
  'completed',
  'defaulted',
  'written_off'
);

create type guarantor_status as enum ('pending', 'accepted', 'declined', 'released');

create type txn_type as enum (
  'share_purchase',
  'weekly_savings',
  'monthly_savings',
  'loan_disbursement',
  'loan_repayment',
  'deposit',
  'withdrawal',
  'income',
  'expense',
  'fee',
  'penalty'
);

create type txn_status as enum ('posted', 'reversed', 'reversal');

create type payment_method as enum (
  'cash',
  'mobile_money',
  'bank_transfer',
  'cheque',
  'internal'
);

create type approval_status as enum ('pending', 'approved', 'rejected');

-- ---------------------------------------------------------------------------
-- app_users - profile + role, 1:1 with auth.users
-- ---------------------------------------------------------------------------
create table app_users (
  id            uuid primary key references auth.users (id) on delete cascade,
  full_name     text        not null,
  email         citext,
  phone         text,
  role          user_role   not null default 'member',
  photo_url     text,
  is_active     boolean     not null default true,
  last_login_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index app_users_role_idx on app_users (role) where is_active;

-- ---------------------------------------------------------------------------
-- members
-- ---------------------------------------------------------------------------
create table members (
  id                 uuid primary key default gen_random_uuid(),
  member_no          text unique not null,          -- BND-M-0001245
  user_id            uuid unique references app_users (id) on delete set null,
  full_name          text not null,
  phone              text not null,
  email              citext,
  national_id        text unique,
  date_of_birth      date,
  gender             text check (gender in ('male', 'female', 'other')),
  address            text,
  occupation         text,
  next_of_kin_name   text,
  next_of_kin_phone  text,
  next_of_kin_relation text,
  photo_url          text,
  status             member_status not null default 'active',
  joined_on          date not null default current_date,
  created_by         uuid references app_users (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint members_phone_format check (phone ~ '^\+?[0-9]{9,15}$')
);

-- Search + list performance for 500+ members.
create index members_status_idx      on members (status);
create index members_joined_idx      on members (joined_on desc);
create index members_name_trgm_idx   on members using gin (full_name gin_trgm_ops);
create index members_member_no_trgm  on members using gin (member_no gin_trgm_ops);
create index members_phone_trgm_idx  on members using gin (phone gin_trgm_ops);
create index members_user_id_idx     on members (user_id);

-- ---------------------------------------------------------------------------
-- transactions - the immutable financial ledger
--
-- Everything with money in it writes exactly one row here. Balances are always
-- SUM()s over this table, never a mutable "balance" column that can drift.
-- ---------------------------------------------------------------------------
create table transactions (
  id             uuid primary key default gen_random_uuid(),
  reference      text unique not null,               -- BND-TX-2026-004582
  member_id      uuid references members (id) on delete restrict,
  type           txn_type    not null,
  status         txn_status  not null default 'posted',

  -- Signed from the SACCO's point of view for cash movement, but each module
  -- interprets `amount` against its own sign convention (see 0002_functions).
  amount         numeric(16,2) not null check (amount > 0),
  method         payment_method not null default 'cash',

  occurred_on    date not null default current_date,
  description    text,

  -- Soft links to the originating record so a receipt can be re-derived.
  loan_id        uuid,
  savings_id     uuid,
  share_lot_id   uuid,
  income_id      uuid,
  expense_id     uuid,

  -- Reversal bookkeeping. A posted transaction is NEVER updated or deleted;
  -- a compensating 'reversal' row is written and both are linked.
  reverses_id    uuid references transactions (id),
  reversed_by_id uuid references transactions (id),
  reversal_reason text,

  -- Idempotency: the client sends a key, a unique index rejects the double tap.
  idempotency_key text,

  recorded_by    uuid references app_users (id),
  created_at     timestamptz not null default now()
);

create unique index transactions_idempotency_idx
  on transactions (idempotency_key)
  where idempotency_key is not null;

create index transactions_member_date_idx on transactions (member_id, occurred_on desc, created_at desc);
create index transactions_type_date_idx   on transactions (type, occurred_on desc);
create index transactions_date_idx        on transactions (occurred_on desc);
create index transactions_loan_idx        on transactions (loan_id) where loan_id is not null;
create index transactions_reference_trgm  on transactions using gin (reference gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Shares - deliberately separate from savings.
-- 10 shares x UGX 50,000 = UGX 500,000. Quantity and unit price both stored so
-- historic lots keep the price they were actually bought at.
-- ---------------------------------------------------------------------------
create table share_settings (
  id                 boolean primary key default true check (id),
  unit_price         numeric(16,2) not null default 50000 check (unit_price > 0),
  min_shares_on_join integer not null default 1 check (min_shares_on_join >= 0),
  updated_at         timestamptz not null default now()
);

insert into share_settings (id) values (true) on conflict do nothing;

create table share_lots (
  id             uuid primary key default gen_random_uuid(),
  member_id      uuid not null references members (id) on delete restrict,
  quantity       integer not null check (quantity <> 0),
  unit_price     numeric(16,2) not null check (unit_price > 0),
  total_value    numeric(16,2) generated always as (quantity * unit_price) stored,
  purchased_on   date not null default current_date,
  transaction_id uuid references transactions (id),
  note           text,
  recorded_by    uuid references app_users (id),
  created_at     timestamptz not null default now()
);

create index share_lots_member_idx on share_lots (member_id, purchased_on desc);

-- ---------------------------------------------------------------------------
-- Savings - weekly and monthly, each period is a row with an expected target.
-- ---------------------------------------------------------------------------
create table savings_plans (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references members (id) on delete cascade,
  kind          savings_kind not null,
  target_amount numeric(16,2) not null check (target_amount >= 0),
  active_from   date not null default current_date,
  active_to     date,
  created_at    timestamptz not null default now(),

  unique (member_id, kind, active_from)
);

create index savings_plans_member_idx on savings_plans (member_id, kind);

create table savings_periods (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references members (id) on delete cascade,
  kind          savings_kind not null,

  -- Canonical period boundaries. For weekly: Monday..Sunday. For monthly: 1st..last.
  period_start  date not null,
  period_end    date not null,
  period_label  text not null,                       -- 'Week 36, 2026' / 'Sep 2026'

  expected_amount numeric(16,2) not null default 0 check (expected_amount >= 0),
  paid_amount     numeric(16,2) not null default 0 check (paid_amount >= 0),
  status          savings_status not null default 'pending',

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (member_id, kind, period_start),
  constraint savings_period_order check (period_end >= period_start)
);

create index savings_periods_member_idx on savings_periods (member_id, kind, period_start desc);
create index savings_periods_status_idx on savings_periods (kind, status, period_start desc);

create table savings_payments (
  id             uuid primary key default gen_random_uuid(),
  period_id      uuid not null references savings_periods (id) on delete restrict,
  member_id      uuid not null references members (id) on delete restrict,
  amount         numeric(16,2) not null check (amount > 0),
  paid_on        date not null default current_date,
  method         payment_method not null default 'cash',
  transaction_id uuid references transactions (id),
  recorded_by    uuid references app_users (id),
  created_at     timestamptz not null default now()
);

create index savings_payments_period_idx on savings_payments (period_id);
create index savings_payments_member_idx on savings_payments (member_id, paid_on desc);

-- ---------------------------------------------------------------------------
-- Loans
-- ---------------------------------------------------------------------------
create table loan_products (
  id                 uuid primary key default gen_random_uuid(),
  name               text unique not null,
  code               text unique not null,
  interest_rate      numeric(6,3) not null check (interest_rate >= 0),   -- % per annum
  interest_method    text not null default 'flat' check (interest_method in ('flat', 'reducing')),
  min_amount         numeric(16,2) not null default 0,
  max_amount         numeric(16,2) not null,
  min_period_months  integer not null default 1 check (min_period_months >= 1),
  max_period_months  integer not null check (max_period_months >= 1),
  processing_fee_pct numeric(6,3) not null default 0 check (processing_fee_pct >= 0),
  min_guarantors     integer not null default 2 check (min_guarantors >= 0),
  is_active          boolean not null default true,
  description        text,
  created_at         timestamptz not null default now(),

  constraint loan_products_amount_order check (max_amount >= min_amount),
  constraint loan_products_period_order check (max_period_months >= min_period_months)
);

create table loans (
  id                uuid primary key default gen_random_uuid(),
  loan_no           text unique not null,             -- BND-LN-2026-00042
  member_id         uuid not null references members (id) on delete restrict,
  product_id        uuid not null references loan_products (id),

  principal         numeric(16,2) not null check (principal > 0),
  interest_rate     numeric(6,3)  not null check (interest_rate >= 0),
  interest_method   text not null default 'flat',
  interest_amount   numeric(16,2) not null default 0 check (interest_amount >= 0),
  processing_fee    numeric(16,2) not null default 0 check (processing_fee >= 0),
  total_payable     numeric(16,2) not null default 0 check (total_payable >= 0),
  period_months     integer not null check (period_months >= 1),
  installment_amount numeric(16,2) not null default 0,

  purpose           text not null,
  purpose_category  text,

  status            loan_status not null default 'applied',

  applied_on        date not null default current_date,
  reviewed_on       date,
  approved_on       date,
  rejected_on       date,
  disbursed_on      date,
  first_due_on      date,
  completed_on      date,

  rejection_reason  text,
  review_notes      text,

  approved_by       uuid references app_users (id),
  rejected_by       uuid references app_users (id),
  disbursed_by      uuid references app_users (id),
  created_by        uuid references app_users (id),

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index loans_member_idx  on loans (member_id, applied_on desc);
create index loans_status_idx  on loans (status, applied_on desc);
create index loans_no_trgm_idx on loans using gin (loan_no gin_trgm_ops);

-- A member may not hold two loans that are simultaneously outstanding unless a
-- manager explicitly closes the first. Enforced as a partial unique index on
-- the "live" states.
create unique index loans_one_active_per_member_idx
  on loans (member_id)
  where status in ('disbursed', 'active');

create table loan_schedule (
  id             uuid primary key default gen_random_uuid(),
  loan_id        uuid not null references loans (id) on delete cascade,
  installment_no integer not null check (installment_no >= 1),
  due_on         date not null,
  principal_due  numeric(16,2) not null default 0,
  interest_due   numeric(16,2) not null default 0,
  total_due      numeric(16,2) not null default 0,
  created_at     timestamptz not null default now(),

  unique (loan_id, installment_no)
);

create index loan_schedule_due_idx on loan_schedule (loan_id, due_on);

create table loan_repayments (
  id                uuid primary key default gen_random_uuid(),
  loan_id           uuid not null references loans (id) on delete restrict,
  member_id         uuid not null references members (id) on delete restrict,
  amount            numeric(16,2) not null check (amount > 0),
  principal_portion numeric(16,2) not null default 0 check (principal_portion >= 0),
  interest_portion  numeric(16,2) not null default 0 check (interest_portion >= 0),
  paid_on           date not null default current_date,
  method            payment_method not null default 'cash',
  transaction_id    uuid references transactions (id),
  recorded_by       uuid references app_users (id),
  created_at        timestamptz not null default now()
);

create index loan_repayments_loan_idx   on loan_repayments (loan_id, paid_on desc);
create index loan_repayments_member_idx on loan_repayments (member_id, paid_on desc);
create index loan_repayments_date_idx   on loan_repayments (paid_on desc);

create table loan_guarantors (
  id               uuid primary key default gen_random_uuid(),
  loan_id          uuid not null references loans (id) on delete cascade,
  member_id        uuid not null references members (id) on delete restrict,
  guaranteed_amount numeric(16,2) not null check (guaranteed_amount > 0),
  status           guarantor_status not null default 'pending',
  responded_on     date,
  note             text,
  created_at       timestamptz not null default now(),

  unique (loan_id, member_id)
);

create index loan_guarantors_member_idx on loan_guarantors (member_id, status);

create table loan_documents (
  id          uuid primary key default gen_random_uuid(),
  loan_id     uuid not null references loans (id) on delete cascade,
  label       text not null,
  file_path   text not null,
  mime_type   text,
  size_bytes  integer,
  uploaded_by uuid references app_users (id),
  created_at  timestamptz not null default now()
);

create index loan_documents_loan_idx on loan_documents (loan_id);

-- ---------------------------------------------------------------------------
-- Income & expenses (SACCO-level, not member-level)
-- ---------------------------------------------------------------------------
create table income_categories (
  id        uuid primary key default gen_random_uuid(),
  name      text unique not null,
  is_system boolean not null default false
);

create table expense_categories (
  id        uuid primary key default gen_random_uuid(),
  name      text unique not null,
  is_system boolean not null default false
);

create table income_entries (
  id             uuid primary key default gen_random_uuid(),
  category_id    uuid not null references income_categories (id),
  amount         numeric(16,2) not null check (amount > 0),
  description    text,
  received_on    date not null default current_date,
  method         payment_method not null default 'cash',
  member_id      uuid references members (id) on delete set null,
  loan_id        uuid references loans (id) on delete set null,
  transaction_id uuid references transactions (id),
  recorded_by    uuid references app_users (id),
  created_at     timestamptz not null default now()
);

create index income_entries_date_idx on income_entries (received_on desc);
create index income_entries_cat_idx  on income_entries (category_id, received_on desc);

create table expense_entries (
  id              uuid primary key default gen_random_uuid(),
  category_id     uuid not null references expense_categories (id),
  amount          numeric(16,2) not null check (amount > 0),
  description     text,
  spent_on        date not null default current_date,
  method          payment_method not null default 'cash',
  attachment_path text,
  approval        approval_status not null default 'pending',
  approved_by     uuid references app_users (id),
  approved_at     timestamptz,
  transaction_id  uuid references transactions (id),
  recorded_by     uuid references app_users (id),
  created_at      timestamptz not null default now()
);

create index expense_entries_date_idx on expense_entries (spent_on desc);
create index expense_entries_cat_idx  on expense_entries (category_id, spent_on desc);
create index expense_entries_appr_idx on expense_entries (approval) where approval = 'pending';

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
create table notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references app_users (id) on delete cascade,
  title       text not null,
  body        text not null,
  kind        text not null default 'info' check (kind in ('info', 'success', 'warning', 'error')),
  link        text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index notifications_user_idx on notifications (user_id, created_at desc);
create index notifications_unread_idx on notifications (user_id) where read_at is null;

-- ---------------------------------------------------------------------------
-- Audit log - append only
-- ---------------------------------------------------------------------------
create table audit_logs (
  id          bigserial primary key,
  actor_id    uuid references app_users (id),
  actor_name  text,
  actor_role  user_role,
  action      text not null,          -- 'loan.approved', 'member.deactivated'
  module      text not null,          -- 'Loans', 'Members', 'Financials'
  record_id   text,
  summary     text,
  old_value   jsonb,
  new_value   jsonb,
  reason      text,
  ip_address  inet,
  created_at  timestamptz not null default now()
);

create index audit_logs_created_idx on audit_logs (created_at desc);
create index audit_logs_actor_idx   on audit_logs (actor_id, created_at desc);
create index audit_logs_module_idx  on audit_logs (module, created_at desc);
create index audit_logs_record_idx  on audit_logs (record_id);

-- ---------------------------------------------------------------------------
-- Sequence counters for human-readable references (BND-TX-2026-004582)
-- ---------------------------------------------------------------------------
create table doc_counters (
  scope     text primary key,     -- 'TX-2026', 'LN-2026', 'M', 'RCP-2026'
  last_value bigint not null default 0
);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger app_users_updated       before update on app_users       for each row execute function set_updated_at();
create trigger members_updated         before update on members         for each row execute function set_updated_at();
create trigger loans_updated           before update on loans           for each row execute function set_updated_at();
create trigger savings_periods_updated before update on savings_periods for each row execute function set_updated_at();
