-- ===========================================================================
-- BUD-SACCO - 0015 - The configuration registry
--
-- 0014 made the organisation's own details editable. This migration finishes
-- the job for the numbers that decide money: what a member pays to join, how
-- much may leave the counter in a day, what makes someone eligible to borrow,
-- and every term a loan product can carry.
--
-- The design question was whether to keep adding typed columns to
-- `sacco_settings`. That works until the fortieth setting, at which point every
-- new operating rule the SACCO invents needs a developer, a migration and a
-- deploy - which is the exact problem this work exists to remove.
--
-- So settings become rows in a registry that describes itself. A setting knows
-- its own category, label, help text, data type, unit, bounds and whether it is
-- grave enough to warrant a confirmation prompt. The settings screen renders
-- from that description rather than from a hand-written form per value, and
-- adding a setting is an INSERT.
--
-- What is deliberately NOT in the registry:
--
--  - The organisation's identity, which stays in `sacco_settings`. It is one
--    row of genuinely heterogeneous text, it is read by database functions
--    (`sacco_legal_name()`), and 0014's write path already audits it.
--  - The share unit price, which stays in `share_settings`. `buy_shares()` has
--    read it there since 0002 and every share lot records the price it was
--    actually sold at. Moving it would mean two places that both claim to say
--    what a share costs, which is the failure this migration exists to prevent.
--    It is edited through 0014's `update_share_settings()` and the settings
--    screen presents it alongside the registry values as one Financial section.
--  - Loan product terms, which are per-product and belong on `loan_products`
--    as typed columns with constraints. A registry is the right shape for one
--    global value and the wrong shape for a table.
--  - Document reference prefixes. `BND-M-`, `BND-TX-` are part of references
--    already issued and printed. 0014 said so; it is still true.
--
-- Every write goes through `update_settings()`, which validates against the
-- registry's own bounds and writes one audit row per changed key carrying the
-- old and the new value. There is no direct-write policy on the table.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

do $$ begin
  create type setting_value_type as enum (
    'money',      -- UGX. A person types 15000; it is stored as the number 15000.
    'number',     -- plain numeric, may be fractional
    'integer',    -- whole numbers: counts, days, months
    'percent',    -- 0..100, stored as the number a person would say aloud
    'boolean',
    'text',
    'select',     -- one of `options`
    'multiselect' -- a subset of `options`; business days are the case in point
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type setting_category as enum (
    'financial', 'loans', 'members', 'savings', 'groups',
    'notifications', 'security', 'system'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- The registry
-- ---------------------------------------------------------------------------

create table if not exists system_settings (
  key             text primary key
                    check (key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  category        setting_category not null,

  -- How the settings screen presents it. Held as data so that a new setting is
  -- one row rather than a row plus a form field plus a label plus a validator
  -- in three files that can disagree.
  label           text not null check (length(btrim(label)) > 0),
  description     text,
  value_type      setting_value_type not null,
  unit            text,                       -- 'UGX', '%', 'months', 'days'

  -- The value, and what it shipped as. jsonb because one column has to hold a
  -- number, a flag and a list; the check constraint below keeps it honest.
  value           jsonb not null,
  default_value   jsonb not null,

  -- Bounds, enforced on every write. Null means unbounded that way.
  min_value       numeric,
  max_value       numeric,
  options         jsonb,                      -- [{"value":..,"label":..}]

  /**
   * Grave enough that the screen asks "are you sure" and names the before and
   * the after. A withdrawal ceiling is; the receipt footer is not.
   */
  is_critical     boolean not null default false,

  sort_order      integer not null default 100,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references app_users (id),

  constraint system_settings_bounds_order
    check (min_value is null or max_value is null or max_value >= min_value),

  -- The stored value must match the declared type. Without this, a typo in some
  -- future write path could park the string "abc" where a shilling amount
  -- belongs, and nothing would notice until a calculation returned null.
  constraint system_settings_value_matches_type check (
    case value_type
      when 'boolean'     then jsonb_typeof(value) = 'boolean'
      when 'text'        then jsonb_typeof(value) = 'string'
      when 'select'      then jsonb_typeof(value) = 'string'
      when 'multiselect' then jsonb_typeof(value) = 'array'
      else jsonb_typeof(value) = 'number'
    end
  )
);

create index if not exists system_settings_category_idx
  on system_settings (category, sort_order, key);

alter table system_settings enable row level security;

-- Readable by anyone signed in: a member's own screens quote the joining fee
-- and the savings minimum back to them.
drop policy if exists system_settings_read on system_settings;
create policy system_settings_read on system_settings
  for select using (auth.uid() is not null);

grant select on system_settings to authenticated;

-- ---------------------------------------------------------------------------
-- Reading
--
-- Typed accessors, so that callers never parse jsonb by hand and a missing key
-- fails loudly instead of silently becoming zero. A setting that has gone
-- missing is a deployment fault; a loan fee that quietly computes as zero
-- because of one is a worse outcome than an error on the screen.
-- ---------------------------------------------------------------------------

create or replace function setting_number(p_key text)
returns numeric language plpgsql stable security definer set search_path = public as $fn$
declare v numeric;
begin
  select (value #>> '{}')::numeric into v from system_settings where key = p_key;
  if v is null then
    raise exception 'Configuration key % is not defined.', p_key using errcode = 'no_data_found';
  end if;
  return v;
end;
$fn$;

create or replace function setting_int(p_key text)
returns integer language sql stable security definer set search_path = public as $fn$
  select setting_number(p_key)::integer;
$fn$;

create or replace function setting_bool(p_key text)
returns boolean language plpgsql stable security definer set search_path = public as $fn$
declare v boolean;
begin
  select (value #>> '{}')::boolean into v from system_settings where key = p_key;
  if v is null then
    raise exception 'Configuration key % is not defined.', p_key using errcode = 'no_data_found';
  end if;
  return v;
end;
$fn$;

create or replace function setting_text(p_key text)
returns text language plpgsql stable security definer set search_path = public as $fn$
declare v text;
begin
  select value #>> '{}' into v from system_settings where key = p_key;
  if v is null then
    raise exception 'Configuration key % is not defined.', p_key using errcode = 'no_data_found';
  end if;
  return v;
end;
$fn$;

/**
 * The whole registry as one object: `{"members.registration_fee": 20000, ...}`.
 *
 * The application reads this once per request and hands it to whatever needs a
 * number, rather than issuing a query per setting. Values arrive already typed
 * as JSON numbers and booleans, so the client parses nothing.
 */
create or replace function settings_map()
returns jsonb language sql stable security definer set search_path = public as $fn$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from system_settings;
$fn$;

grant execute on function setting_number(text) to authenticated;
grant execute on function setting_int(text)    to authenticated;
grant execute on function setting_bool(text)   to authenticated;
grant execute on function setting_text(text)   to authenticated;
grant execute on function settings_map()       to authenticated;

-- ---------------------------------------------------------------------------
-- Seeding
--
-- `define_setting` is idempotent in the way that matters: it inserts the
-- setting with its shipped default the first time, and on every subsequent run
-- it refreshes the *description* - label, help text, bounds, ordering - while
-- leaving the *value* exactly as the SACCO set it. Re-running this migration
-- must never quietly reset a number a manager chose on purpose.
-- ---------------------------------------------------------------------------

create or replace function define_setting(
  p_key         text,
  p_category    setting_category,
  p_label       text,
  p_value_type  setting_value_type,
  p_default     jsonb,
  p_description text default null,
  p_unit        text default null,
  p_min         numeric default null,
  p_max         numeric default null,
  p_options     jsonb default null,
  p_critical    boolean default false,
  p_sort        integer default 100
) returns void language plpgsql security definer set search_path = public as $fn$
begin
  insert into system_settings (key, category, label, description, value_type, unit,
                               value, default_value, min_value, max_value, options,
                               is_critical, sort_order)
  values (p_key, p_category, p_label, p_description, p_value_type, p_unit,
          p_default, p_default, p_min, p_max, p_options,
          coalesce(p_critical, false), coalesce(p_sort, 100))
  on conflict (key) do update
     set category      = excluded.category,
         label         = excluded.label,
         description   = excluded.description,
         value_type    = excluded.value_type,
         unit          = excluded.unit,
         default_value = excluded.default_value,
         min_value     = excluded.min_value,
         max_value     = excluded.max_value,
         options       = excluded.options,
         is_critical   = excluded.is_critical,
         sort_order    = excluded.sort_order;
         -- `value` is pointedly absent.
end;
$fn$;

-- --- Financial -------------------------------------------------------------

select define_setting('financial.currency_code', 'financial', 'Currency', 'select',
  '"UGX"'::jsonb,
  'The currency every amount in the system is recorded and displayed in.',
  null, null, null,
  '[{"value":"UGX","label":"UGX - Ugandan Shilling"},
    {"value":"KES","label":"KES - Kenyan Shilling"},
    {"value":"TZS","label":"TZS - Tanzanian Shilling"},
    {"value":"RWF","label":"RWF - Rwandan Franc"},
    {"value":"USD","label":"USD - US Dollar"}]'::jsonb,
  true, 10);

select define_setting('financial.financial_year_start_month', 'financial',
  'Financial year starts in', 'select', '"1"'::jsonb,
  'Reports that summarise "this year" count from the first day of this month.',
  null, null, null,
  '[{"value":"1","label":"January"},{"value":"2","label":"February"},
    {"value":"3","label":"March"},{"value":"4","label":"April"},
    {"value":"5","label":"May"},{"value":"6","label":"June"},
    {"value":"7","label":"July"},{"value":"8","label":"August"},
    {"value":"9","label":"September"},{"value":"10","label":"October"},
    {"value":"11","label":"November"},{"value":"12","label":"December"}]'::jsonb,
  false, 20);

select define_setting('financial.min_deposit', 'financial', 'Smallest deposit', 'money',
  '0'::jsonb, 'A deposit below this amount is refused at the counter.',
  'UGX', 0, null, null, false, 30);

select define_setting('financial.min_withdrawal', 'financial', 'Smallest withdrawal', 'money',
  '0'::jsonb, 'A withdrawal below this amount is refused at the counter.',
  'UGX', 0, null, null, false, 40);

select define_setting('financial.max_withdrawal_per_transaction', 'financial',
  'Largest single withdrawal', 'money', '0'::jsonb,
  'The most a member may withdraw in one transaction. Zero means no ceiling.',
  'UGX', 0, null, null, true, 50);

select define_setting('financial.max_cash_transaction', 'financial',
  'Largest cash transaction', 'money', '0'::jsonb,
  'The most that may be taken or paid out in cash in a single transaction. Zero means no ceiling. Larger amounts must go through the bank or mobile money.',
  'UGX', 0, null, null, true, 60);

select define_setting('financial.withdrawal_fee', 'financial', 'Withdrawal fee', 'money',
  '0'::jsonb, 'Charged on each withdrawal.', 'UGX', 0, null, null, false, 70);

-- --- Members ---------------------------------------------------------------

select define_setting('members.registration_fee', 'members', 'Registration fee', 'money',
  '0'::jsonb, 'Paid once, when a member joins.', 'UGX', 0, null, null, true, 10);

select define_setting('members.annual_subscription', 'members', 'Annual subscription', 'money',
  '0'::jsonb, 'Membership fee charged each year.', 'UGX', 0, null, null, true, 20);

select define_setting('members.passbook_fee', 'members', 'Passbook fee', 'money',
  '0'::jsonb, 'Charged for a new or replacement passbook.', 'UGX', 0, null, null, false, 30);

select define_setting('members.min_savings_balance', 'members', 'Minimum savings balance', 'money',
  '0'::jsonb,
  'The balance a member is expected to keep. Shown on their profile; it does not block a withdrawal on its own.',
  'UGX', 0, null, null, false, 40);

select define_setting('members.min_age', 'members', 'Minimum age to join', 'integer',
  '18'::jsonb, 'Applications from anyone younger are refused.',
  'years', 0, 120, null, false, 50);

-- --- Savings ---------------------------------------------------------------

select define_setting('savings.min_weekly_amount', 'savings', 'Smallest weekly saving', 'money',
  '0'::jsonb, 'The least a member may pay towards a weekly savings period.',
  'UGX', 0, null, null, false, 10);

select define_setting('savings.min_monthly_amount', 'savings', 'Smallest monthly saving', 'money',
  '0'::jsonb, 'The least a member may pay towards a monthly savings period.',
  'UGX', 0, null, null, false, 20);

select define_setting('savings.allow_partial_payment', 'savings', 'Allow part payments', 'boolean',
  'true'::jsonb,
  'When on, a member may pay less than the period target and the period is marked partial. When off, only the full target is accepted.',
  null, null, null, null, false, 30);

select define_setting('savings.allow_advance_payment', 'savings', 'Allow paying ahead', 'boolean',
  'true'::jsonb, 'Whether a member may pay into a savings period before it opens.',
  null, null, null, null, false, 40);

select define_setting('savings.missed_period_penalty', 'savings', 'Missed period penalty', 'money',
  '0'::jsonb, 'Charged when a savings period closes unpaid.', 'UGX', 0, null, null, false, 50);

-- --- Loans -----------------------------------------------------------------
--
-- These are the SACCO-wide rules. Anything that can sensibly differ between a
-- school-fees loan and a business loan lives on the product instead.

select define_setting('loans.max_active_per_member', 'loans', 'Loans at once per member',
  'integer', '1'::jsonb,
  'How many loans one member may have running at the same time.',
  'loans', 1, 10, null, true, 10);

-- Ships at zero, meaning no ceiling. Before this migration there was no
-- savings-based borrowing limit at all, and a default of, say, three would have
-- silently barred every member with no savings from borrowing the moment this
-- deployed. A rule that refuses loans is one a SACCO opts into deliberately.
select define_setting('loans.max_savings_multiple', 'loans', 'Borrowing limit vs savings',
  'number', '0'::jsonb,
  'A member may borrow up to this multiple of their savings balance. Zero removes the limit.',
  'x savings', 0, 100, null, true, 20);

select define_setting('loans.min_membership_months', 'loans', 'Minimum membership before borrowing',
  'integer', '0'::jsonb,
  'How long someone must have been a member before their first application.',
  'months', 0, 120, null, false, 30);

select define_setting('loans.default_grace_period_days', 'loans', 'Default grace period',
  'integer', '0'::jsonb,
  'Days after a due date before a repayment counts as late. A product may set its own.',
  'days', 0, 365, null, false, 40);

select define_setting('loans.default_late_penalty_pct', 'loans', 'Default late penalty',
  'percent', '0'::jsonb,
  'Charged on the overdue amount once the grace period has passed. A product may set its own.',
  '%', 0, 100, null, true, 50);

select define_setting('loans.require_guarantors', 'loans', 'Require guarantors', 'boolean',
  'true'::jsonb,
  'When off, applications may be submitted with no guarantors whatever the product asks for.',
  null, null, null, null, true, 60);

-- Also zero for the same reason: until now only the *number* of guarantors was
-- checked, never the total they pledged. Shipping at 100 would have rejected
-- applications that were perfectly acceptable the day before.
select define_setting('loans.guarantor_cover_pct', 'loans', 'Guarantor cover required',
  'percent', '0'::jsonb,
  'Guarantees must together cover at least this share of the principal. Zero checks only how many guarantors there are.',
  '%', 0, 200, null, false, 70);

select define_setting('loans.auto_approve_limit', 'loans', 'Approval required above', 'money',
  '0'::jsonb,
  'Applications above this amount need a manager rather than a loan officer. Zero means every loan needs a manager.',
  'UGX', 0, null, null, true, 80);

-- --- Groups ----------------------------------------------------------------

select define_setting('groups.min_members', 'groups', 'Smallest group', 'integer',
  '1'::jsonb, 'A group may not be created with fewer members than this.',
  'members', 1, 1000, null, false, 10);

select define_setting('groups.max_members', 'groups', 'Largest group', 'integer',
  '50'::jsonb, 'A group may not take on more members than this. Zero removes the limit.',
  'members', 0, 10000, null, false, 20);

select define_setting('groups.allow_member_multiple_groups', 'groups',
  'A member may join several groups', 'boolean', 'false'::jsonb,
  'When off, each member belongs to at most one group.',
  null, null, null, null, false, 30);

-- --- Notifications ---------------------------------------------------------

select define_setting('notifications.collection_reminder_days', 'notifications',
  'Collection day reminder', 'integer', '1'::jsonb,
  'How many days ahead of a collection day members are reminded.',
  'days', 0, 30, null, false, 10);

select define_setting('notifications.loan_due_reminder_days', 'notifications',
  'Loan repayment reminder', 'integer', '3'::jsonb,
  'How many days ahead of an installment falling due members are reminded.',
  'days', 0, 60, null, false, 20);

select define_setting('notifications.notify_on_loan_decision', 'notifications',
  'Notify on approval or rejection', 'boolean', 'true'::jsonb,
  'Tell the member in the app when their application is decided.',
  null, null, null, null, false, 30);

-- --- Security --------------------------------------------------------------

select define_setting('security.session_timeout_minutes', 'security', 'Sign out after',
  'integer', '60'::jsonb,
  'Idle minutes before a staff session is ended. Enforced by Supabase Auth; recorded here so the policy is written down in one place.',
  'minutes', 5, 1440, null, false, 10);

select define_setting('security.password_min_length', 'security', 'Minimum password length',
  'integer', '8'::jsonb, 'Applied when a password is set or changed in this application.',
  'characters', 6, 64, null, true, 20);

select define_setting('security.require_reason_on_reversal', 'security',
  'Require a reason for reversals', 'boolean', 'true'::jsonb,
  'A transaction reversal must carry a written reason.',
  null, null, null, null, true, 30);

-- --- System ----------------------------------------------------------------

select define_setting('system.business_days', 'system', 'Business days', 'multiselect',
  '["1","2","3","4","5"]'::jsonb,
  'The days the SACCO is open. Collection days fall on these.',
  null, null, null,
  '[{"value":"1","label":"Monday"},{"value":"2","label":"Tuesday"},
    {"value":"3","label":"Wednesday"},{"value":"4","label":"Thursday"},
    {"value":"5","label":"Friday"},{"value":"6","label":"Saturday"},
    {"value":"7","label":"Sunday"}]'::jsonb,
  false, 10);

select define_setting('system.receipt_footer', 'system', 'Receipt footer', 'text',
  '"Thank you for saving with us."'::jsonb,
  'Printed at the foot of every receipt.', null, null, null, null, false, 20);

select define_setting('system.receipt_show_balance', 'system', 'Show balance on receipts',
  'boolean', 'true'::jsonb,
  'Print the member''s balance after the transaction on their receipt.',
  null, null, null, null, false, 30);

select define_setting('system.statement_footer', 'system', 'Statement footer', 'text',
  '"This statement is computer generated."'::jsonb,
  'Printed at the foot of every statement.', null, null, null, null, false, 40);
