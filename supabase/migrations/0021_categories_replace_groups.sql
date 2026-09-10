-- ===========================================================================
-- BUD-SACCO - 0021 - Share categories, savings categories, and the end of
--                    group-based saving
--
-- The SACCO no longer collects through groups. 0007-0009 built
--
--     SACCO -> GROUPS -> MEMBERS -> CYCLES -> SCHEDULES -> LEDGER
--
-- and this migration replaces the middle of that chain with
--
--     SACCO -> MEMBERS -> SHARE CATEGORY
--                      -> SAVINGS CATEGORY -> SCHEDULE -> LEDGER
--
-- Two decisions shape everything below.
--
-- First, a member's share category and their savings category are separate
-- columns. Buying Gold shares does not make you a Gold Saver; the brief's
-- worked example is a Gold shareholder saving at the Diamond rate, and the
-- schema has to be able to say that. A SACCO that later decides the two must
-- agree turns on `categories.share_matches_savings` rather than getting a
-- migration.
--
-- Second, `savings_periods` stays the one per-member expectation row. It loses
-- its group and cycle columns and gains the savings category that produced it.
-- Keeping the table means every statement, receipt and member screen written
-- against it keeps working, and there is still exactly one place where "what
-- this member owes for this period" is recorded.
--
-- Nothing here hard-codes a due date, an amount or a frequency into logic. The
-- three share categories and three savings categories are seeded as *rows*,
-- with the figures the SACCO gave, and every function reads them back.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------
do $$ begin
  create type category_status as enum ('active', 'inactive');
exception when duplicate_object then null; end $$;

-- The settings registry had a 'groups' category. Renaming the enum value keeps
-- every existing row valid while the vocabulary moves on; deleting a value from
-- an enum in place is not possible, and leaving a dead 'groups' section on the
-- settings screen would be exactly the kind of stale reference this work exists
-- to remove.
do $$ begin
  if exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = 'setting_category' and e.enumlabel = 'groups'
  ) then
    alter type setting_category rename value 'groups' to 'categories';
  end if;
end $$;

-- `group_officer` was the field role that worked one group's collection day.
-- The role still exists - somebody still walks out and collects - but it is no
-- longer defined by a group, so it is renamed rather than dropped, which keeps
-- every account currently holding it signed in and working.
do $$ begin
  if exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = 'user_role' and e.enumlabel = 'group_officer'
  ) then
    alter type user_role rename value 'group_officer' to 'field_officer';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- share_categories
--
-- Diamond, Gold and Silver as the SACCO defined them. `required_amount` is a
-- generated column: 50 shares at UGX 20,000 is UGX 1,000,000 because Postgres
-- multiplied it, not because somebody typed it into a second field that can
-- later disagree with the first.
--
-- `qualification_months` is the window from the member's own joining date in
-- which the shares must be bought - three months for Diamond and Gold, null for
-- Silver, which has no deadline. Storing the *length* rather than a date is
-- what lets section 15 compute a per-member deadline from `members.joined_on`.
-- ---------------------------------------------------------------------------
create table if not exists share_categories (
  id                   uuid primary key default gen_random_uuid(),
  code                 text unique not null check (code ~ '^[A-Z][A-Z0-9_]*$'),
  name                 text unique not null check (length(btrim(name)) > 0),
  required_shares      integer not null check (required_shares >= 1),
  share_price          numeric(16,2) not null check (share_price > 0),
  required_amount      numeric(16,2)
                         generated always as (required_shares * share_price) stored,
  qualification_months integer check (qualification_months is null or qualification_months >= 1),
  description          text,
  status               category_status not null default 'active',
  sort_order           integer not null default 100,
  created_by           uuid references app_users (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists share_categories_status_idx
  on share_categories (status, sort_order, name);

-- ---------------------------------------------------------------------------
-- savings_categories
--
-- Diamond Saver UGX 100,000 monthly, Gold Saver UGX 50,000 monthly, Silver
-- Saver UGX 5,000 weekly. `frequency` is the existing `savings_kind`, so a
-- category slots straight into the period arithmetic that was already there
-- rather than introducing a second calendar.
-- ---------------------------------------------------------------------------
create table if not exists savings_categories (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null check (code ~ '^[A-Z][A-Z0-9_]*$'),
  name        text unique not null check (length(btrim(name)) > 0),
  amount      numeric(16,2) not null check (amount > 0),
  frequency   savings_kind not null,
  description text,
  status      category_status not null default 'active',
  sort_order  integer not null default 100,
  created_by  uuid references app_users (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists savings_categories_status_idx
  on savings_categories (status, sort_order, name);

drop trigger if exists share_categories_updated on share_categories;
create trigger share_categories_updated
  before update on share_categories
  for each row execute function set_updated_at();

drop trigger if exists savings_categories_updated on savings_categories;
create trigger savings_categories_updated
  before update on savings_categories
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- The categories the SACCO actually operates.
--
-- Seeded as configuration, not as sample data: these are the six categories
-- named in the business brief with the figures it gave. `on conflict do
-- nothing` keys on the code, so a SACCO that later edits a price through the
-- administration screen does not have it reset by a re-run.
-- ---------------------------------------------------------------------------
insert into share_categories
  (code, name, required_shares, share_price, qualification_months, description, sort_order)
values
  ('DIAMOND', 'Diamond', 50, 20000, 3,
   'Fifty shares, bought within the first three months of membership.', 10),
  ('GOLD', 'Gold', 25, 20000, 3,
   'Twenty-five shares, bought within the first three months of membership.', 20),
  ('SILVER', 'Silver', 1, 20000, null,
   'The basic share category. One share, with no qualification deadline.', 30)
on conflict (code) do nothing;

insert into savings_categories
  (code, name, amount, frequency, description, sort_order)
values
  ('DIAMOND_SAVER', 'Diamond Saver', 100000, 'monthly',
   'UGX 100,000 saved every month.', 10),
  ('GOLD_SAVER', 'Gold Saver', 50000, 'monthly',
   'UGX 50,000 saved every month.', 20),
  ('SILVER_SAVER', 'Silver Saver', 5000, 'weekly',
   'UGX 5,000 saved every week.', 30)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- members gain their two categories.
--
-- Both nullable, and deliberately so: a member registered at the counter before
-- choosing a savings category is a real state, and inventing a default would
-- put an expectation on their statement that nobody agreed to. `on delete
-- restrict` means a category that members are in cannot be deleted out from
-- under them - it is deactivated instead.
-- ---------------------------------------------------------------------------
alter table members
  add column if not exists share_category_id   uuid references share_categories (id) on delete restrict,
  add column if not exists savings_category_id uuid references savings_categories (id) on delete restrict;

create index if not exists members_share_category_idx   on members (share_category_id, status);
create index if not exists members_savings_category_idx on members (savings_category_id, status);

-- ---------------------------------------------------------------------------
-- savings_periods becomes a category-driven schedule.
--
-- It keeps `kind`, because the weekly/monthly period arithmetic in 0002 is
-- correct and unchanged. It gains the category that produced the expectation,
-- so a report can say "this row was raised under Gold Saver at UGX 50,000"
-- even after the category's amount is later edited.
-- ---------------------------------------------------------------------------
alter table savings_periods
  add column if not exists savings_category_id uuid references savings_categories (id);

create index if not exists savings_periods_category_idx
  on savings_periods (savings_category_id, period_start desc);

-- The same on the payment, so a savings transaction can be attributed to a
-- category without walking back through its schedule.
alter table savings_payments
  add column if not exists savings_category_id uuid references savings_categories (id);

create index if not exists savings_payments_category_idx
  on savings_payments (savings_category_id, paid_on desc);

-- ===========================================================================
-- REMOVING GROUPS
--
-- Order matters: views first, then the functions that reference the tables,
-- then the columns pointing at them, then the tables themselves. Anything left
-- holding a reference would make the drop fail rather than silently succeed,
-- which is the behaviour we want.
-- ===========================================================================

drop view if exists group_overview      cascade;
drop view if exists group_cycle_summary cascade;
drop view if exists savings_schedules   cascade;
drop view if exists member_financials   cascade;

drop function if exists group_collection_sheet(uuid, uuid)                cascade;
drop function if exists groups_saving_on(date)                            cascade;
drop function if exists group_report(uuid, date, date)                    cascade;
drop function if exists search_groups(text, group_status, smallint, integer, integer) cascade;
drop function if exists create_group(text, smallint, saving_frequency, text, numeric, numeric, uuid, uuid, uuid, text) cascade;
drop function if exists update_group(uuid, text, smallint, saving_frequency, text, numeric, numeric, uuid, uuid, uuid, text) cascade;
drop function if exists set_group_status(uuid, group_status, text)        cascade;
drop function if exists assign_member_group(uuid, uuid, text)             cascade;
drop function if exists open_group_cycle(uuid, date)                      cascade;
drop function if exists open_cycles_for_day(date)                         cascade;
drop function if exists close_savings_cycle(uuid, text)                   cascade;
drop function if exists group_collects_on(uuid, date)                     cascade;
drop function if exists group_due_date(smallint, savings_kind, date)      cascade;
drop function if exists group_savings_kind(saving_frequency)              cascade;
drop function if exists saving_day_label(smallint)                        cascade;
drop function if exists my_group_id()                                     cascade;
drop function if exists settle_manual_payment(uuid, uuid, txn_type, numeric, payment_method, uuid, uuid, uuid, text, text) cascade;

alter table savings_periods drop column if exists group_id;
alter table savings_periods drop column if exists cycle_id;
alter table payment_intents drop column if exists group_id;
alter table members         drop column if exists group_id;

drop table if exists savings_cycles cascade;
drop table if exists sacco_groups   cascade;

-- The group defaults on `sacco_settings` described a group that no longer
-- exists. A member's expected amount now comes from their savings category.
-- Dropped before the type they use, so the type drop has nothing left to
-- cascade through and would fail loudly if something else still held it.
drop function if exists update_savings_defaults(saving_frequency, numeric, numeric) cascade;

alter table sacco_settings drop column if exists default_saving_frequency;
alter table sacco_settings drop column if exists default_weekly_target;
alter table sacco_settings drop column if exists default_monthly_target;

drop type if exists cycle_status  cascade;
drop type if exists group_status  cascade;

-- `saving_frequency` (weekly/biweekly/monthly) existed only to describe how
-- often a group met. Savings categories use `savings_kind`.
drop type if exists saving_frequency cascade;

delete from system_settings where key like 'groups.%';

-- The one business rule the brief asked to be *configurable* rather than
-- assumed: whether a member's savings category must match their share
-- category. It ships off, because the brief's own worked example - Gold shares,
-- Diamond Saver - has to be recordable on day one.
select define_setting('categories.share_matches_savings', 'categories',
  'Savings category must match share category', 'boolean', 'false'::jsonb,
  'When on, a member may only be given the savings category that matches their share category - a Gold shareholder must be a Gold Saver. When off, the two are chosen independently.',
  null, null, null, null, true, 10);

select define_setting('categories.require_savings_category', 'categories',
  'Every member must have a savings category', 'boolean', 'false'::jsonb,
  'When on, a member cannot be registered without choosing a savings category. When off, a category may be added later and the member simply has no savings schedule until then.',
  null, null, null, null, false, 20);
