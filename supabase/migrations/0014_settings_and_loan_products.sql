-- ===========================================================================
-- BUD-SACCO - 0014 - Editable settings, and loan products as data
--
-- Two changes, both of the same kind: things the SACCO decides for itself stop
-- being facts about the source code and become rows a manager can edit.
--
--  1. `sacco_settings` - one row, the organisation's own details plus the
--     handful of operating defaults that were previously literals in the UI.
--     The registered name in particular was hard-coded in three places,
--     including the receipt letterhead, which is why 0013 had to exist at all.
--     After this it is a row, and correcting it is an edit rather than a
--     migration.
--
--  2. Write functions for the settings that already had tables but no way in:
--     `share_settings`, and `loan_products`. Loan products have always been a
--     table - what was missing was any means of creating one, so the four
--     seeded in 0005 were, in practice, the only four that could ever exist.
--
-- Everything here follows the rules the rest of the schema already keeps: no
-- direct writes to a configuration table from the application, one capability
-- predicate rather than a list of roles, and every change written to the audit
-- log with the before and after values.
--
-- Document reference prefixes are deliberately NOT configurable. `BND-M-`,
-- `BND-TX-` and the rest are part of references that have already been issued
-- and printed; making them editable would let one edit silently break the
-- meaning of every document in the archive.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Capability
-- ---------------------------------------------------------------------------

/** Who may change how the SACCO itself is configured. */
create or replace function can_manage_settings()
returns boolean language sql stable security definer set search_path = public as $$
  select has_role('super_admin', 'manager');
$$;

grant execute on function can_manage_settings() to authenticated;

-- ---------------------------------------------------------------------------
-- Organisation and operating defaults
-- ---------------------------------------------------------------------------

create table if not exists sacco_settings (
  id                          boolean primary key default true check (id),

  -- Identity. `legal_name` is what goes on a document that leaves the building.
  legal_name                  text not null default 'Bakenye Unity and Development SACCO',
  short_name                  text not null default 'BUD-SACCO',
  motto                       text not null default 'Together We Grow, Prosper and Build',
  registration_no             text,
  contact_email               text,
  contact_phone               text,
  address                     text,

  -- Defaults offered when a new group is created. A group still sets its own
  -- day and targets; these only decide what the form starts with, which is the
  -- difference between typing the same three numbers forty times and once.
  default_saving_frequency    saving_frequency not null default 'weekly',
  default_weekly_target       numeric(16,2) not null default 0 check (default_weekly_target >= 0),
  default_monthly_target      numeric(16,2) not null default 0 check (default_monthly_target >= 0),

  -- In-app notifications. This gates the notifications the loan functions
  -- raise; it is a real switch, not a label.
  notify_in_app               boolean not null default true,

  updated_at                  timestamptz not null default now(),
  updated_by                  uuid references app_users (id),

  constraint sacco_settings_legal_name_present check (length(btrim(legal_name)) > 0),
  constraint sacco_settings_short_name_present check (length(btrim(short_name)) > 0)
);

insert into sacco_settings (id) values (true) on conflict do nothing;

alter table sacco_settings enable row level security;

-- Readable by anyone signed in: the member app puts the SACCO's name and
-- contact details on statements and the help screen.
drop policy if exists sacco_settings_read on sacco_settings;
create policy sacco_settings_read on sacco_settings
  for select using (auth.uid() is not null);

-- No write policy at all. Every change goes through the functions below, so a
-- change to the organisation's registered name cannot happen without an audit
-- row naming who made it.

grant select on sacco_settings to authenticated;

/**
 * The registered name, for use inside other functions.
 *
 * A separate function rather than an inline sub-select so that the receipt
 * payload and anything added later cannot drift apart.
 */
create or replace function sacco_legal_name()
returns text language sql stable security definer set search_path = public as $$
  select upper(legal_name) from sacco_settings where id;
$$;

grant execute on function sacco_legal_name() to authenticated;

-- ---------------------------------------------------------------------------
-- Settings writes
-- ---------------------------------------------------------------------------

create or replace function update_organisation_settings(
  p_legal_name      text,
  p_short_name      text,
  p_motto           text,
  p_registration_no text default null,
  p_contact_email   text default null,
  p_contact_phone   text default null,
  p_address         text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old sacco_settings;
  v_new sacco_settings;
begin
  perform assert_capability(can_manage_settings(), 'change organisation settings');

  if coalesce(btrim(p_legal_name), '') = '' then
    raise exception 'Enter the registered name of the SACCO.' using errcode = 'check_violation';
  end if;
  if coalesce(btrim(p_short_name), '') = '' then
    raise exception 'Enter a short name.' using errcode = 'check_violation';
  end if;
  if p_contact_email is not null and btrim(p_contact_email) <> ''
     and p_contact_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter a valid contact email address.' using errcode = 'check_violation';
  end if;

  select * into v_old from sacco_settings where id;

  update sacco_settings
     set legal_name      = btrim(p_legal_name),
         short_name      = btrim(p_short_name),
         motto           = btrim(coalesce(p_motto, '')),
         registration_no = nullif(btrim(coalesce(p_registration_no, '')), ''),
         contact_email   = nullif(btrim(coalesce(p_contact_email, '')), ''),
         contact_phone   = nullif(btrim(coalesce(p_contact_phone, '')), ''),
         address         = nullif(btrim(coalesce(p_address, '')), ''),
         updated_at      = now(),
         updated_by      = auth.uid()
   where id
  returning * into v_new;

  perform write_audit('settings.organisation', 'Settings', 'sacco_settings',
    format('Organisation details updated (%s)', v_new.legal_name),
    to_jsonb(v_old), to_jsonb(v_new), null);

  return to_jsonb(v_new);
end;
$$;

create or replace function update_savings_defaults(
  p_default_saving_frequency saving_frequency,
  p_default_weekly_target    numeric,
  p_default_monthly_target   numeric
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old sacco_settings;
  v_new sacco_settings;
begin
  perform assert_capability(can_manage_settings(), 'change savings defaults');

  if coalesce(p_default_weekly_target, 0) < 0 or coalesce(p_default_monthly_target, 0) < 0 then
    raise exception 'A target cannot be negative.' using errcode = 'check_violation';
  end if;

  select * into v_old from sacco_settings where id;

  update sacco_settings
     set default_saving_frequency = p_default_saving_frequency,
         default_weekly_target    = coalesce(p_default_weekly_target, 0),
         default_monthly_target   = coalesce(p_default_monthly_target, 0),
         updated_at               = now(),
         updated_by               = auth.uid()
   where id
  returning * into v_new;

  perform write_audit('settings.savings_defaults', 'Settings', 'sacco_settings',
    format('Savings defaults set to %s, weekly %s / monthly %s',
           v_new.default_saving_frequency,
           to_char(v_new.default_weekly_target, 'FM999,999,999'),
           to_char(v_new.default_monthly_target, 'FM999,999,999')),
    to_jsonb(v_old), to_jsonb(v_new), null);

  return to_jsonb(v_new);
end;
$$;

create or replace function update_notification_settings(
  p_notify_in_app boolean
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old sacco_settings;
  v_new sacco_settings;
begin
  perform assert_capability(can_manage_settings(), 'change notification settings');

  select * into v_old from sacco_settings where id;

  update sacco_settings
     set notify_in_app = coalesce(p_notify_in_app, true),
         updated_at    = now(),
         updated_by    = auth.uid()
   where id
  returning * into v_new;

  perform write_audit('settings.notifications', 'Settings', 'sacco_settings',
    format('In-app notifications turned %s',
           case when v_new.notify_in_app then 'on' else 'off' end),
    to_jsonb(v_old), to_jsonb(v_new), null);

  return to_jsonb(v_new);
end;
$$;

create or replace function update_share_settings(
  p_unit_price         numeric,
  p_min_shares_on_join integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old share_settings;
  v_new share_settings;
begin
  perform assert_capability(can_manage_settings(), 'change share settings');

  if coalesce(p_unit_price, 0) <= 0 then
    raise exception 'The share unit price must be greater than zero.' using errcode = 'check_violation';
  end if;
  if coalesce(p_min_shares_on_join, 0) < 0 then
    raise exception 'The minimum number of shares cannot be negative.' using errcode = 'check_violation';
  end if;

  select * into v_old from share_settings where id;

  update share_settings
     set unit_price         = p_unit_price,
         min_shares_on_join = p_min_shares_on_join,
         updated_at         = now()
   where id
  returning * into v_new;

  -- The unit price is a financial parameter: it decides what every future
  -- share purchase costs. Shares already bought keep the price recorded on
  -- their own lot, so this changes nothing that has happened.
  perform write_audit('settings.shares', 'Settings', 'share_settings',
    format('Share unit price set to UGX %s, minimum %s share(s) on joining',
           to_char(v_new.unit_price, 'FM999,999,999'), v_new.min_shares_on_join),
    to_jsonb(v_old), to_jsonb(v_new), null);

  return to_jsonb(v_new);
end;
$$;

grant execute on function update_organisation_settings(text, text, text, text, text, text, text) to authenticated;
grant execute on function update_savings_defaults(saving_frequency, numeric, numeric)            to authenticated;
grant execute on function update_notification_settings(boolean)                                  to authenticated;
grant execute on function update_share_settings(numeric, integer)                                to authenticated;

-- ---------------------------------------------------------------------------
-- Loan products
--
-- The table has been here since 0001. What follows is the way in.
-- ---------------------------------------------------------------------------

/** Shared validation, so create and update cannot disagree about what is legal. */
create or replace function assert_loan_product_valid(
  p_name              text,
  p_code              text,
  p_interest_rate     numeric,
  p_min_amount        numeric,
  p_max_amount        numeric,
  p_min_period_months integer,
  p_max_period_months integer,
  p_processing_fee_pct numeric,
  p_min_guarantors    integer
) returns void
language plpgsql
immutable
as $$
begin
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'Enter a name for the product.' using errcode = 'check_violation';
  end if;
  if coalesce(btrim(p_code), '') = '' then
    raise exception 'Enter a short code, for example BIZ.' using errcode = 'check_violation';
  end if;
  if p_code !~ '^[A-Z0-9]{2,10}$' then
    raise exception 'The code must be 2-10 capital letters or digits.' using errcode = 'check_violation';
  end if;
  if coalesce(p_interest_rate, -1) < 0 then
    raise exception 'Enter an interest rate of zero or more.' using errcode = 'check_violation';
  end if;
  if coalesce(p_interest_rate, 0) > 100 then
    raise exception 'An interest rate above 100%% per year is almost certainly a typing error.'
      using errcode = 'check_violation';
  end if;
  if coalesce(p_min_amount, -1) < 0 then
    raise exception 'The smallest amount cannot be negative.' using errcode = 'check_violation';
  end if;
  if coalesce(p_max_amount, 0) <= 0 then
    raise exception 'Enter the largest amount a member may borrow.' using errcode = 'check_violation';
  end if;
  if p_max_amount < p_min_amount then
    raise exception 'The largest amount must be at least the smallest amount.'
      using errcode = 'check_violation';
  end if;
  if coalesce(p_min_period_months, 0) < 1 then
    raise exception 'The shortest term must be at least one month.' using errcode = 'check_violation';
  end if;
  if coalesce(p_max_period_months, 0) < 1 or p_max_period_months < p_min_period_months then
    raise exception 'The longest term must be at least the shortest term.'
      using errcode = 'check_violation';
  end if;
  if coalesce(p_processing_fee_pct, -1) < 0 then
    raise exception 'The processing fee cannot be negative.' using errcode = 'check_violation';
  end if;
  if coalesce(p_min_guarantors, -1) < 0 then
    raise exception 'The number of guarantors cannot be negative.' using errcode = 'check_violation';
  end if;
end;
$$;

create or replace function create_loan_product(
  p_name               text,
  p_code               text,
  p_interest_rate      numeric,
  p_interest_method    text,
  p_min_amount         numeric,
  p_max_amount         numeric,
  p_min_period_months  integer,
  p_max_period_months  integer,
  p_processing_fee_pct numeric default 0,
  p_min_guarantors     integer default 2,
  p_description        text default null,
  p_is_active          boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product loan_products;
  v_code    text := upper(btrim(coalesce(p_code, '')));
begin
  perform assert_capability(can_manage_settings(), 'create loan products');

  perform assert_loan_product_valid(p_name, v_code, p_interest_rate, p_min_amount, p_max_amount,
                                    p_min_period_months, p_max_period_months,
                                    p_processing_fee_pct, p_min_guarantors);

  if exists (select 1 from loan_products where upper(code) = v_code) then
    raise exception 'A product with the code % already exists.', v_code
      using errcode = 'unique_violation';
  end if;
  if exists (select 1 from loan_products where lower(name) = lower(btrim(p_name))) then
    raise exception 'A product called % already exists.', btrim(p_name)
      using errcode = 'unique_violation';
  end if;

  insert into loan_products (name, code, interest_rate, interest_method, min_amount, max_amount,
                             min_period_months, max_period_months, processing_fee_pct,
                             min_guarantors, description, is_active)
  values (btrim(p_name), v_code, p_interest_rate, coalesce(p_interest_method, 'flat'),
          p_min_amount, p_max_amount, p_min_period_months, p_max_period_months,
          coalesce(p_processing_fee_pct, 0), coalesce(p_min_guarantors, 2),
          nullif(btrim(coalesce(p_description, '')), ''), coalesce(p_is_active, true))
  returning * into v_product;

  perform write_audit('loan_product.created', 'Settings', v_product.id::text,
    format('Loan product %s (%s) created at %s%% %s',
           v_product.name, v_product.code, v_product.interest_rate, v_product.interest_method),
    null, to_jsonb(v_product), null);

  return to_jsonb(v_product);
end;
$$;

create or replace function update_loan_product(
  p_product_id         uuid,
  p_name               text,
  p_code               text,
  p_interest_rate      numeric,
  p_interest_method    text,
  p_min_amount         numeric,
  p_max_amount         numeric,
  p_min_period_months  integer,
  p_max_period_months  integer,
  p_processing_fee_pct numeric default 0,
  p_min_guarantors     integer default 2,
  p_description        text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old  loan_products;
  v_new  loan_products;
  v_code text := upper(btrim(coalesce(p_code, '')));
begin
  perform assert_capability(can_manage_settings(), 'change loan products');

  select * into v_old from loan_products where id = p_product_id;
  if not found then
    raise exception 'That loan product could not be found.' using errcode = 'no_data_found';
  end if;

  perform assert_loan_product_valid(p_name, v_code, p_interest_rate, p_min_amount, p_max_amount,
                                    p_min_period_months, p_max_period_months,
                                    p_processing_fee_pct, p_min_guarantors);

  if exists (select 1 from loan_products where upper(code) = v_code and id <> p_product_id) then
    raise exception 'A product with the code % already exists.', v_code
      using errcode = 'unique_violation';
  end if;
  if exists (select 1 from loan_products
              where lower(name) = lower(btrim(p_name)) and id <> p_product_id) then
    raise exception 'A product called % already exists.', btrim(p_name)
      using errcode = 'unique_violation';
  end if;

  update loan_products
     set name               = btrim(p_name),
         code               = v_code,
         interest_rate      = p_interest_rate,
         interest_method    = coalesce(p_interest_method, 'flat'),
         min_amount         = p_min_amount,
         max_amount         = p_max_amount,
         min_period_months  = p_min_period_months,
         max_period_months  = p_max_period_months,
         processing_fee_pct = coalesce(p_processing_fee_pct, 0),
         min_guarantors     = coalesce(p_min_guarantors, 2),
         description        = nullif(btrim(coalesce(p_description, '')), '')
   where id = p_product_id
  returning * into v_new;

  -- Loans already written carry their own rate, method and fee, copied at
  -- application time. Editing the product changes what the next application is
  -- quoted, and nothing about a loan already on the books.
  perform write_audit('loan_product.updated', 'Settings', v_new.id::text,
    format('Loan product %s (%s) updated', v_new.name, v_new.code),
    to_jsonb(v_old), to_jsonb(v_new), null);

  return to_jsonb(v_new);
end;
$$;

/**
 * Retire a product, or bring it back.
 *
 * There is no delete. A product is referenced by every loan ever written under
 * it, and a financial record that cannot name the terms it was written on is
 * not a record. Retiring takes it out of the application form and leaves the
 * history intact.
 */
create or replace function set_loan_product_active(
  p_product_id uuid,
  p_is_active  boolean,
  p_reason     text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old loan_products;
  v_new loan_products;
  v_live integer;
begin
  perform assert_capability(can_manage_settings(), 'retire or restore loan products');

  select * into v_old from loan_products where id = p_product_id;
  if not found then
    raise exception 'That loan product could not be found.' using errcode = 'no_data_found';
  end if;

  if v_old.is_active and not p_is_active then
    select count(*) into v_live
      from loans
     where product_id = p_product_id
       and status in ('pending', 'under_review', 'approved', 'disbursed', 'active', 'in_arrears');
    if v_live > 0 then
      -- Retiring is still allowed: those loans keep running under the terms
      -- already recorded on them. The count is put in the audit summary so the
      -- decision is legible later.
      null;
    end if;
  end if;

  update loan_products
     set is_active = coalesce(p_is_active, true)
   where id = p_product_id
  returning * into v_new;

  perform write_audit(
    case when v_new.is_active then 'loan_product.restored' else 'loan_product.retired' end,
    'Settings', v_new.id::text,
    format('Loan product %s (%s) %s%s', v_new.name, v_new.code,
           case when v_new.is_active then 'restored' else 'retired' end,
           case when coalesce(v_live, 0) > 0
                then format(' with %s loan(s) still running under it', v_live)
                else '' end),
    to_jsonb(v_old), to_jsonb(v_new), nullif(btrim(coalesce(p_reason, '')), ''));

  return to_jsonb(v_new);
end;
$$;

grant execute on function create_loan_product(text, text, numeric, text, numeric, numeric, integer, integer, numeric, integer, text, boolean) to authenticated;
grant execute on function update_loan_product(uuid, text, text, numeric, text, numeric, numeric, integer, integer, numeric, integer, text)    to authenticated;
grant execute on function set_loan_product_active(uuid, boolean, text)                                                                        to authenticated;

-- The direct-write policy from 0004 is replaced by the functions above, so
-- that a product cannot be changed without an audit row.
drop policy if exists loan_products_admin on loan_products;

-- ---------------------------------------------------------------------------
-- In-app notifications honour the setting
--
-- The two places that raise a notification are both buried inside large loan
-- functions in 0002. Copying those functions here to add one condition would
-- mean carrying two hundred lines of unrelated financial logic in this
-- migration, where any future edit to them silently diverges.
--
-- A gate on the table itself is smaller and cannot drift: a BEFORE INSERT
-- trigger that returns NULL skips the row. With the setting off the loan still
-- moves, the audit row is still written, and the member simply is not pinged.
-- Everything that raises a notification is covered, including anything added
-- later, without that code having to know the setting exists.
-- ---------------------------------------------------------------------------

create or replace function notifications_enabled()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select notify_in_app from sacco_settings where id), true);
$$;

grant execute on function notifications_enabled() to authenticated;

create or replace function notifications_gate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not notifications_enabled() then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists notifications_respect_setting on notifications;
create trigger notifications_respect_setting
  before insert on notifications
  for each row execute function notifications_gate();

-- ---------------------------------------------------------------------------
-- The receipt letterhead reads the name from the row
--
-- This is 0013's function with one expression changed: the literal becomes
-- `sacco_legal_name()`. Correcting the registered name is now an edit on the
-- settings screen rather than a fourteenth migration.
-- ---------------------------------------------------------------------------

create or replace function receipt_for_transaction(p_transaction_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_txn transaction_feed;
begin
  select * into v_txn from transaction_feed where id = p_transaction_id;
  if not found then
    raise exception 'Transaction not found.' using errcode = 'no_data_found';
  end if;

  if not (can_view_operations() or v_txn.member_id = current_member_id()) then
    raise exception 'You may only view your own receipts.' using errcode = 'insufficient_privilege';
  end if;

  return jsonb_build_object(
    'transaction',   to_jsonb(v_txn),
    'sacco_name',    sacco_legal_name(),
    'receipt_no',    replace(v_txn.reference, 'BND-TX-', 'BND-RCP-'),
    'loan', (
      select jsonb_build_object('loan_no', l.loan_no, 'outstanding', lb.outstanding,
                                'total_payable', l.total_payable, 'next_due_on', lb.next_due_on)
        from loans l join loan_balances lb on lb.loan_id = l.id
       where l.id = v_txn.loan_id
    ),
    'shares', (
      select jsonb_build_object('quantity', sl.quantity, 'unit_price', sl.unit_price,
                                'total_value', sl.total_value)
        from share_lots sl where sl.transaction_id = v_txn.id
    ),
    'balance_after', (
      select coalesce(sum(case when t2.type in ('weekly_savings', 'monthly_savings', 'deposit')
                               then t2.amount else -t2.amount end), 0)
        from transactions t2
       where t2.member_id = v_txn.member_id
         and t2.status = 'posted'
         and t2.type in ('weekly_savings', 'monthly_savings', 'deposit', 'withdrawal')
         and (t2.occurred_on, t2.created_at) <= (v_txn.occurred_on, v_txn.created_at)
    )
  );
end;
$$;
