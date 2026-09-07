-- ===========================================================================
-- BUD-SACCO - 0007 - Groups, savings cycles and the payment seam
--
-- The SACCO does not collect savings from 500 individuals one at a time. It
-- collects from groups, and each group has its own day of the week. This
-- migration adds that layer *on top of* the existing member ledger rather than
-- beside it:
--
--   SACCO -> GROUPS -> MEMBERS -> SAVINGS PLANS -> CYCLES -> SCHEDULES -> LEDGER
--
-- The critical design decision is that `savings_periods` keeps being the one
-- per-member expectation row. A group cycle stamps `cycle_id`, `group_id` and
-- `due_on` onto those rows; it never holds money of its own. Expected and
-- collected figures for a group are therefore always SUM()s over member rows,
-- and a group balance can never disagree with the balances of its members
-- because it is not stored anywhere.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Enumerations
--
-- 'waived' completes savings_status: a schedule a manager has forgiven is not
-- 'paid' (no money arrived) and not 'missed' (nobody is in arrears for it).
-- ---------------------------------------------------------------------------
alter type savings_status add value if not exists 'waived';

do $$ begin
  create type saving_frequency as enum ('weekly', 'biweekly', 'monthly');
exception when duplicate_object then null; end $$;

do $$ begin
  create type group_status as enum ('active', 'inactive', 'dissolved');
exception when duplicate_object then null; end $$;

do $$ begin
  create type cycle_status as enum ('open', 'closed');
exception when duplicate_object then null; end $$;

-- Phase Two lands here. Phase One writes 'manual' only, and never pretends a
-- provider confirmed anything.
do $$ begin
  create type payment_provider as enum (
    'manual', 'mtn_momo', 'airtel_money', 'flutterwave', 'pesapal', 'bank'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_state as enum (
    'pending', 'processing', 'successful', 'failed', 'cancelled'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- sacco_groups
--
-- `saving_day` is an ISO weekday (1 = Monday .. 7 = Sunday) so it compares
-- directly against `extract(isodow from ...)`. It is a column, never a
-- constant: Group A saving on Monday and Group D saving on Thursday are the
-- same code path with different data.
-- ---------------------------------------------------------------------------
create table if not exists sacco_groups (
  id                  uuid primary key default gen_random_uuid(),
  group_code          text unique not null,                  -- BND-G-004
  name                text unique not null,
  location            text,

  saving_day          smallint not null default 1 check (saving_day between 1 and 7),
  saving_frequency    saving_frequency not null default 'weekly',
  weekly_target       numeric(16,2) not null default 0 check (weekly_target >= 0),
  monthly_target      numeric(16,2) not null default 0 check (monthly_target >= 0),

  leader_member_id    uuid references members (id) on delete set null,
  secretary_member_id uuid references members (id) on delete set null,
  loan_officer_id     uuid references app_users (id) on delete set null,

  status              group_status not null default 'active',
  notes               text,

  created_by          uuid references app_users (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists sacco_groups_day_idx     on sacco_groups (saving_day) where status = 'active';
create index if not exists sacco_groups_status_idx  on sacco_groups (status, name);
create index if not exists sacco_groups_officer_idx on sacco_groups (loan_officer_id);
create index if not exists sacco_groups_name_trgm   on sacco_groups using gin (name gin_trgm_ops);
create index if not exists sacco_groups_code_trgm   on sacco_groups using gin (group_code gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Members belong to a group.
--
-- Nullable on purpose: a member registered at the office before being placed in
-- a group is a real state, and forcing a placeholder group would corrupt the
-- collection sheets.
-- ---------------------------------------------------------------------------
alter table members
  add column if not exists group_id uuid references sacco_groups (id) on delete set null;

create index if not exists members_group_idx on members (group_id, status);

-- ---------------------------------------------------------------------------
-- savings_cycles - one row per group per savings period.
--
-- "Week 37, 2026" for Bakenye Central, due Wednesday 9 September. Every date is
-- computed from the group configuration; none are hard-coded.
-- ---------------------------------------------------------------------------
create table if not exists savings_cycles (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references sacco_groups (id) on delete cascade,
  kind         savings_kind not null,

  cycle_start  date not null,
  cycle_end    date not null,
  due_on       date not null,
  label        text not null,                        -- 'Week 37, 2026'

  status       cycle_status not null default 'open',

  opened_by    uuid references app_users (id),
  opened_at    timestamptz not null default now(),
  closed_by    uuid references app_users (id),
  closed_at    timestamptz,
  note         text,

  unique (group_id, kind, cycle_start),
  constraint savings_cycles_order check (cycle_end >= cycle_start),
  constraint savings_cycles_due_within check (due_on between cycle_start and cycle_end)
);

create index if not exists savings_cycles_group_idx on savings_cycles (group_id, cycle_start desc);
create index if not exists savings_cycles_due_idx   on savings_cycles (due_on desc);
create index if not exists savings_cycles_open_idx  on savings_cycles (status, due_on desc);

-- ---------------------------------------------------------------------------
-- savings_periods becomes the savings *schedule*.
--
-- One row per member per cycle: expected, paid, outstanding, status. Kept as
-- the existing table so the savings screen a member sees, the statements and
-- `savings_performance()` all keep working against the same rows the group
-- collection sheet writes to. Two tables would mean two truths.
-- ---------------------------------------------------------------------------
alter table savings_periods
  add column if not exists cycle_id uuid references savings_cycles (id) on delete set null,
  add column if not exists group_id uuid references sacco_groups (id) on delete set null,
  add column if not exists due_on   date;

create index if not exists savings_periods_cycle_idx on savings_periods (cycle_id);
create index if not exists savings_periods_group_idx on savings_periods (group_id, due_on desc);
create index if not exists savings_periods_due_idx   on savings_periods (due_on desc)
  where status in ('pending', 'partial');

-- A member appears at most once on the collection sheet of a cycle.
create unique index if not exists savings_periods_cycle_member_idx
  on savings_periods (cycle_id, member_id) where cycle_id is not null;

-- ---------------------------------------------------------------------------
-- Manual payment detail.
--
-- Phase One records payments that happened elsewhere - cash counted at the
-- meeting, a mobile-money transfer the treasurer can see on their handset. The
-- reference typed by the staff member is the audit trail back to that event, so
-- it is unique: the same MTN transaction ID cannot be banked twice.
-- ---------------------------------------------------------------------------
alter table transactions
  add column if not exists external_ref text;

create unique index if not exists transactions_external_ref_idx
  on transactions (upper(external_ref))
  where external_ref is not null and status <> 'reversed';

alter table savings_payments
  add column if not exists schedule_id  uuid references savings_periods (id),
  add column if not exists external_ref text,
  add column if not exists note         text;

-- ---------------------------------------------------------------------------
-- payment_intents - the seam Phase Two plugs into.
--
-- Every collected payment opens an intent and settles it. In Phase One both
-- happen in the same statement with provider = 'manual', because a cashier
-- holding the cash *is* the confirmation. In Phase Two an MTN or Airtel
-- callback moves the same row pending -> processing -> successful and calls the
-- same settlement function, so the savings, ledger and audit code does not
-- change at all.
--
-- Nothing in this application writes a non-'manual' provider or invents a
-- provider_ref. There are no gateway calls in Phase One.
-- ---------------------------------------------------------------------------
create table if not exists payment_intents (
  id              uuid primary key default gen_random_uuid(),
  reference       text unique not null,                    -- BND-PAY-2026-000123
  member_id       uuid references members (id) on delete restrict,
  group_id        uuid references sacco_groups (id) on delete set null,

  purpose         txn_type not null,
  amount          numeric(16,2) not null check (amount > 0),

  provider        payment_provider not null default 'manual',
  method          payment_method not null default 'cash',
  state           payment_state not null default 'pending',

  provider_ref     text,
  provider_payload jsonb,
  failure_reason   text,

  schedule_id     uuid references savings_periods (id),
  loan_id         uuid references loans (id),
  transaction_id  uuid references transactions (id),

  idempotency_key text,
  initiated_by    uuid references app_users (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  settled_at      timestamptz
);

create unique index if not exists payment_intents_idempotency_idx
  on payment_intents (idempotency_key) where idempotency_key is not null;

create unique index if not exists payment_intents_provider_ref_idx
  on payment_intents (provider, upper(provider_ref))
  where provider_ref is not null;

create index if not exists payment_intents_member_idx   on payment_intents (member_id, created_at desc);
create index if not exists payment_intents_state_idx    on payment_intents (state, created_at desc);
create index if not exists payment_intents_schedule_idx on payment_intents (schedule_id);

-- ---------------------------------------------------------------------------
-- updated_at maintenance for the new tables
-- ---------------------------------------------------------------------------
drop trigger if exists sacco_groups_updated on sacco_groups;
create trigger sacco_groups_updated
  before update on sacco_groups
  for each row execute function set_updated_at();

drop trigger if exists payment_intents_updated on payment_intents;
create trigger payment_intents_updated
  before update on payment_intents
  for each row execute function set_updated_at();
