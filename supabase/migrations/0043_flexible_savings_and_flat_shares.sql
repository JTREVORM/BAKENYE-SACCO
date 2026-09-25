-- ===========================================================================
-- BUD-SACCO - 0043 - The new business rules: a flat registration fee, open
--                    monthly savings, and one share price with no tiers
--
-- The SACCO has replaced the category model the system was built around.
-- Approved rules, in the client's own terms:
--
--   1. Registration fee is UGX 20,000.
--   2. Monthly savings are open. There are no Silver / Gold / Diamond savers,
--      no monthly target, and a month without a deposit is not a debt.
--   3. One share costs UGX 10,000. A member may buy any whole number of them.
--      There are no share tiers and no category-based limits.
--
-- WHAT THIS MIGRATION DOES NOT DO
--
-- It deletes no member, no transaction, no savings payment, no share lot and
-- no ledger row. It restates no historical amount. `savings_periods` rows
-- raised under the old categories keep the `expected_amount` they were raised
-- with, `savings_payments` keep the category they were collected under, and
-- `share_lots` keep the price they were bought at. Every one of those is
-- evidence of what the SACCO asked for and what a member paid, and the rules
-- changing today does not change what happened last year.
--
-- HOW THE CATEGORIES ARE RETIRED
--
-- The two category tables are kept and every row in them is marked `inactive`.
-- `members.share_category_id` and `members.savings_category_id` keep the
-- values they hold, so the register can still say which tier a member joined
-- under. What is removed is the *dependence*: from this migration on, nothing
-- reads a category to decide an amount, raise an expectation, price a share or
-- classify a member. The columns are history; they are no longer inputs.
--
-- CONFIGURATION, NOT CONSTANTS
--
-- Both money values stay where the system already kept them and both stay
-- editable by a manager through the audited settings functions:
--
--   share price       share_settings.unit_price, read by share_unit_price()
--   registration fee  a row in `fees`, charged_when = 'registration'
--
-- This migration sets their current values. It does not hard-code them into
-- logic.
-- ===========================================================================

-- ===========================================================================
-- 1. THE TWO CONFIGURED AMOUNTS
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1a. One share is UGX 10,000.
--
-- Written through the same audited shape 0025 used, so the log says who
-- changed the price of a share and why. Shares already sold keep the price on
-- their own lot: a price change can never restate a sale.
-- ---------------------------------------------------------------------------
do $$
declare
  v_old share_settings;
begin
  select * into v_old from share_settings where id;

  if found and v_old.unit_price is distinct from 10000 then
    update share_settings
       set unit_price = 10000,
           updated_at = now()
     where id;

    insert into audit_logs (actor_name, action, module, record_id, summary,
                            old_value, new_value, reason)
    values ('system (migration 0043)', 'settings.shares', 'Settings', 'share_settings',
            format('Share price set to UGX 10,000 (was UGX %s)',
                   to_char(v_old.unit_price, 'FM999,999,999')),
            jsonb_build_object('unit_price', v_old.unit_price),
            jsonb_build_object('unit_price', 10000),
            'Approved business rule change: one share costs UGX 10,000, with no share categories.');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1b. The registration fee is UGX 20,000.
--
-- The fee is a row, not a setting, and has been since 0030. If the SACCO has
-- one, its amount is corrected and the change is audited. If it has none - a
-- database that never carried the old `members.registration_fee` setting
-- across - one is created, mandatory, booked to a "Registration Fees" income
-- category.
--
-- Charges already raised against members keep the amount they were charged.
-- `member_fees.amount` is a copy taken at the moment of charging precisely so
-- that a later price change cannot rewrite what somebody was asked to pay.
-- ---------------------------------------------------------------------------
do $$
declare
  v_fee     fees;
  v_cat     uuid;
  v_ccy     text := coalesce((select value #>> '{}' from system_settings
                               where key = 'financial.currency_code'), 'UGX');
  v_updated integer := 0;
begin
  for v_fee in
    select * from fees
     where charged_when = 'registration'
       and status = 'active'
       and is_mandatory
     order by sort_order, name
  loop
    if v_fee.amount is distinct from 20000 then
      update fees set amount = 20000, updated_at = now() where id = v_fee.id;

      insert into audit_logs (actor_name, action, module, record_id, summary,
                              old_value, new_value, reason)
      values ('system (migration 0043)', 'fee.updated', 'Settings', v_fee.id::text,
              format('%s set to UGX 20,000 (was UGX %s)', v_fee.name,
                     to_char(v_fee.amount, 'FM999,999,999')),
              jsonb_build_object('amount', v_fee.amount),
              jsonb_build_object('amount', 20000),
              'Approved business rule change: the registration fee is UGX 20,000.');
    end if;
    v_updated := v_updated + 1;
  end loop;

  if v_updated = 0 then
    select id into v_cat from income_categories
     where lower(name) in ('registration fees', 'registration fee') limit 1;
    if v_cat is null then
      insert into income_categories (name) values ('Registration Fees') returning id into v_cat;
    end if;

    insert into fees (code, name, description, amount, currency, fee_type, charged_when,
                      is_mandatory, applies_to_new_members, applies_to_existing_members,
                      status, income_category_id, sort_order)
    values ('REGISTRATION', 'Registration Fee',
            'Paid once, when a member joins the SACCO.',
            20000, v_ccy, 'registration', 'registration',
            true, true, false, 'active', v_cat, 10)
    on conflict (code) do update
       set amount = 20000, status = 'active', is_mandatory = true, updated_at = now()
    returning * into v_fee;

    insert into audit_logs (actor_name, action, module, record_id, summary,
                            old_value, new_value, reason)
    values ('system (migration 0043)', 'fee.created', 'Settings', v_fee.id::text,
            'Registration Fee created at UGX 20,000',
            null, jsonb_build_object('amount', 20000, 'is_mandatory', true),
            'Approved business rule change: the registration fee is UGX 20,000.');
  end if;
end $$;

-- ===========================================================================
-- 2. RETIRING THE CATEGORIES
--
-- Marked inactive, never deleted. `set_..._status` is not used because those
-- functions check a signed-in caller's capability and there is nobody signed
-- in during a migration; the audit entry is written directly instead, with the
-- migration named as the actor.
-- ===========================================================================
do $$
declare
  v_savings integer;
  v_shares  integer;
begin
  update savings_categories set status = 'inactive', updated_at = now()
   where status <> 'inactive';
  get diagnostics v_savings = row_count;

  update share_categories set status = 'inactive', updated_at = now()
   where status <> 'inactive';
  get diagnostics v_shares = row_count;

  if v_savings + v_shares > 0 then
    insert into audit_logs (actor_name, action, module, record_id, summary,
                            old_value, new_value, reason)
    values ('system (migration 0043)', 'categories.retired', 'Categories', null,
            format('%s savings categor(y/ies) and %s share categor(y/ies) retired',
                   v_savings, v_shares),
            null,
            jsonb_build_object('savings_categories_retired', v_savings,
                               'share_categories_retired', v_shares),
            'Approved business rule change: savings and shares no longer have categories. '
            || 'The rows are kept, inactive, so historical records can still name the '
            || 'category a member joined under.');
  end if;
end $$;

-- The two settings that only existed to police the categories.
delete from system_settings
 where key in ('categories.share_matches_savings',
               'members.registration_requires_categories');

-- ===========================================================================
-- 3. SAVINGS BECOME FLEXIBLE
--
-- A savings period stays: it is the bucket a deposit is filed in, and it is
-- what gives a member a month-by-month history. What it stops being is a
-- demand. New periods are raised with `expected_amount = 0`, which
-- `recompute_savings_period()` (0039) already understands: nothing expected
-- and nothing paid is `pending`, not `missed`, and nothing is outstanding.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 3a. ensure_savings_period - a bucket, not an obligation.
--
-- No savings category, no savings plan, no target. A period raised today
-- expects nothing of the member, whatever tier they once belonged to.
-- Periods already raised are left exactly as they are.
-- ---------------------------------------------------------------------------
create or replace function ensure_savings_period(
  p_member_id uuid,
  p_kind      savings_kind,
  p_on        date
) returns savings_periods
language plpgsql
security definer
set search_path = public
as $$
declare
  v_b      record;
  v_period savings_periods;
begin
  select * into v_b from savings_period_bounds(p_kind, p_on);

  select * into v_period from savings_periods
   where member_id = p_member_id and kind = p_kind and period_start = v_b.period_start
   for update;

  if found then
    return v_period;
  end if;

  insert into savings_periods (member_id, kind, period_start, period_end,
                               period_label, expected_amount, status, due_on)
  values (p_member_id, p_kind, v_b.period_start, v_b.period_end,
          v_b.period_label, 0, 'pending', v_b.period_end)
  on conflict (member_id, kind, period_start) do update
    set period_label = excluded.period_label
  returning * into v_period;

  return v_period;
end;
$$;

revoke all on function ensure_savings_period(uuid, savings_kind, date) from public, anon;

comment on function ensure_savings_period(uuid, savings_kind, date) is
  'Finds or opens the savings period a deposit belongs to. Since 0043 a new period expects nothing: savings are open, and a period is a record of what was saved, not a demand for what should have been.';

-- ---------------------------------------------------------------------------
-- 3b. ensure_member_schedule - the member's current month.
--
-- It used to depend on the member having an active savings category, and
-- returned null for anyone without one. Every member now saves on the same
-- open monthly footing, so it always returns the current month's bucket.
-- ---------------------------------------------------------------------------
create or replace function ensure_member_schedule(
  p_member_id uuid,
  p_on        date default current_date
) returns savings_periods
language plpgsql
security definer
set search_path = public
as $$
begin
  return ensure_savings_period(p_member_id, 'monthly'::savings_kind, coalesce(p_on, current_date));
end;
$$;

-- ---------------------------------------------------------------------------
-- 3c. Nothing falls due.
--
-- `next_savings_due_date()` is kept, because callers ask it, and it now
-- answers honestly: a member who saves what they choose, when they choose, has
-- no next due date. Returning a date here would put a deadline on a screen
-- that the SACCO has not set.
-- ---------------------------------------------------------------------------
create or replace function next_savings_due_date(
  p_member_id uuid,
  p_on        date default current_date
) returns date
language sql immutable as $$
  select null::date;
$$;

comment on function next_savings_due_date(uuid, date) is
  'Always null since 0043: monthly savings are open, so no contribution falls due on a date.';

-- ---------------------------------------------------------------------------
-- 3d. The schedule openers stop raising obligations.
--
-- Both are kept so the "open this period" control and any caller still
-- referring to them keep working, and both are now no-ops that say so. A month
-- with no deposit must not become a row somebody is chased for.
-- ---------------------------------------------------------------------------
create or replace function open_savings_schedules(p_on date default current_date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform assert_capability(can_record_savings(), 'open savings schedules');

  return jsonb_build_object(
    'date',      coalesce(p_on, current_date),
    'schedules', 0,
    'opened',    false,
    'message',   'Monthly savings are open. A member saves what they choose, '
                 || 'so there is no schedule to raise and nothing falls into arrears.'
  );
end;
$$;

create or replace function open_savings_periods(p_kind savings_kind, p_on date default current_date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  perform assert_capability(can_record_savings(), 'open savings periods');
  return 0;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3e. Personal savings targets are gone too.
--
-- `savings_plans` rows are kept as the record of targets that were once in
-- force, and nothing reads them any more. The one door into the table now
-- refuses, by name, rather than storing a target the rest of the system would
-- silently ignore.
-- ---------------------------------------------------------------------------
create or replace function set_savings_plan(p_member_id uuid, p_kind savings_kind,
                                            p_target_amount numeric, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'Monthly savings are open: a member saves any amount they choose, so there is no savings target to set.'
    using errcode = 'check_violation';
end;
$$;

-- ---------------------------------------------------------------------------
-- 3f. The collection path, without the category.
--
-- Body is 0039's, with two changes: the ledger description no longer names a
-- savings category, and the payment is no longer stamped with one. Everything
-- else - the permission check, the idempotency, the duplicate-reference
-- refusal, the single recompute that owns the arithmetic - is unchanged.
-- ---------------------------------------------------------------------------
create or replace function record_scheduled_savings(
  p_schedule_id     uuid,
  p_amount          numeric,
  p_paid_on         date default current_date,
  p_method          payment_method default 'cash',
  p_external_ref    text default null,
  p_note            text default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sched   savings_periods;
  v_member  members;
  v_txn     transactions;
  v_payment savings_payments;
  v_ref     text := nullif(trim(coalesce(p_external_ref, '')), '');
  v_paid    numeric(16,2);
  v_status  savings_status;
begin
  perform assert_capability(can_record_savings(), 'record savings');

  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount greater than zero.' using errcode = 'check_violation';
  end if;
  -- A fat-fingered extra zero on a UGX 100,000 contribution should not become a
  -- ten-billion-shilling ledger entry that has to be reversed.
  if p_amount > 500000000 then
    raise exception 'That amount looks incorrect. Record amounts above UGX 500,000,000 as separate entries.'
      using errcode = 'check_violation';
  end if;

  select * into v_sched from savings_periods where id = p_schedule_id for update;
  if not found then
    raise exception 'That savings period no longer exists.' using errcode = 'no_data_found';
  end if;

  if v_sched.status = 'waived' then
    raise exception 'This period has been waived. Remove the waiver before recording a payment.'
      using errcode = 'check_violation';
  end if;

  select * into v_member from members where id = v_sched.member_id;
  if v_member.status <> 'active' then
    raise exception 'Savings cannot be recorded for a % member.', v_member.status
      using errcode = 'check_violation';
  end if;

  if p_paid_on > current_date then
    raise exception 'A payment cannot be dated in the future.' using errcode = 'check_violation';
  end if;

  if v_ref is not null and exists (
    select 1 from transactions
     where upper(external_ref) = upper(v_ref) and status <> 'reversed'
  ) then
    raise exception 'Reference % has already been recorded against another transaction.', v_ref
      using errcode = 'unique_violation';
  end if;

  v_txn := post_transaction(
    v_sched.member_id,
    case when v_sched.kind = 'weekly' then 'weekly_savings'::txn_type
         else 'monthly_savings'::txn_type end,
    p_amount, p_method, p_paid_on,
    'Savings - ' || v_sched.period_label,
    p_idempotency_key
  );

  select * into v_payment from savings_payments where transaction_id = v_txn.id;

  if not found then
    if v_ref is not null then
      update transactions set external_ref = v_ref where id = v_txn.id;
    end if;

    insert into savings_payments (period_id, schedule_id, member_id,
                                  amount, paid_on, method, transaction_id,
                                  external_ref, note, recorded_by)
    values (v_sched.id, v_sched.id, v_sched.member_id,
            p_amount, p_paid_on, p_method, v_txn.id, v_ref,
            nullif(trim(coalesce(p_note, '')), ''), auth.uid())
    returning * into v_payment;

    update transactions set savings_id = v_payment.id where id = v_txn.id;

    -- Recomputed from the payment rows, through the one shared function that
    -- owns this arithmetic (0039). Never an incremented column.
    select paid_amount, status into v_paid, v_status
      from recompute_savings_period(v_sched.id);

    perform settle_manual_payment(
      v_sched.member_id,
      case when v_sched.kind = 'weekly' then 'weekly_savings'::txn_type
           else 'monthly_savings'::txn_type end,
      p_amount, p_method, v_sched.id, null, v_txn.id, v_ref, p_idempotency_key
    );

    perform write_audit('savings.recorded', 'Savings', v_payment.id::text,
      format('%s recorded UGX %s savings for %s (%s), %s',
             coalesce((select full_name from app_users where id = auth.uid()), 'system'),
             to_char(p_amount, 'FM999,999,999'), v_member.full_name, v_member.member_no,
             v_sched.period_label),
      null, to_jsonb(v_payment), p_note);
  else
    select paid_amount, status into v_paid, v_status from savings_periods where id = v_sched.id;
  end if;

  return jsonb_build_object(
    'transaction_id', v_txn.id,
    'reference',      v_txn.reference,
    'payment_id',     v_payment.id,
    'schedule_id',    v_sched.id,
    'period_id',      v_sched.id,
    'member_id',      v_sched.member_id,
    'member_name',    v_member.full_name,
    'period_label',   v_sched.period_label,
    'paid',           v_paid,
    'period_total',   v_paid,
    'status',         v_status
  );
end;
$$;

revoke all on function record_scheduled_savings(uuid, numeric, date, payment_method, text, text, text) from public, anon;
grant execute on function record_scheduled_savings(uuid, numeric, date, payment_method, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3g. Nightly hygiene no longer manufactures arrears.
--
-- The 'missed' sweep and the nightly schedule opening are both gone: a month
-- without a deposit is simply a month without a deposit. The loan default
-- sweep is untouched - that is a different, still-approved rule.
-- ---------------------------------------------------------------------------
create or replace function run_daily_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_default integer;
begin
  update loans l
     set status = 'defaulted'
    from loan_balances lb
   where lb.loan_id = l.id
     and l.status = 'active'
     and lb.days_overdue > 90
     and lb.overdue_amount > 0;
  get diagnostics v_default = row_count;

  return jsonb_build_object(
    'loans_defaulted',       v_default,
    'periods_marked_missed', 0,
    'schedules_opened',      0
  );
end;
$$;

-- ===========================================================================
-- 4. SHARES: ONE PRICE, ANY WHOLE NUMBER
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- buy_shares - the server prices the sale.
--
-- The quantity is the only thing the form decides. The price comes from
-- `share_unit_price()` and the total is multiplied here, in the database,
-- inside the same transaction that posts the ledger row. A total typed by a
-- client is never trusted: `p_expected_total` is the figure the form showed
-- the member, and if it does not match what the SACCO currently charges the
-- sale stops and says so rather than taking the wrong money.
--
-- The old six-argument form is dropped rather than left beside this one, so a
-- caller cannot reach a version that skips the check.
-- ---------------------------------------------------------------------------
drop function if exists buy_shares(uuid, integer, payment_method, date, text, text);

create or replace function buy_shares(
  p_member_id       uuid,
  p_quantity        integer,
  p_method          payment_method default 'cash',
  p_purchased_on    date default current_date,
  p_note            text default null,
  p_idempotency_key text default null,
  p_expected_total  numeric default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_price  numeric(16,2);
  v_total  numeric(16,2);
  v_txn    transactions;
  v_lot    share_lots;
  v_member members;
begin
  perform assert_permission('shares.sell');
  perform assert_not_future(p_purchased_on, 'A share purchase');

  if p_quantity is null then
    raise exception 'Enter the number of shares.' using errcode = 'check_violation', hint = 'quantity';
  end if;
  if p_quantity < 1 then
    raise exception 'Number of shares must be a whole number of at least 1.'
      using errcode = 'check_violation', hint = 'quantity';
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

  v_total := (v_price * p_quantity)::numeric(16,2);

  -- The form's arithmetic, checked against the SACCO's. A mismatch means the
  -- price moved while the form was open, or the total did not come from the
  -- quantity at all. Either way the sale does not go through on a figure
  -- nobody agreed.
  if p_expected_total is not null and p_expected_total <> v_total then
    raise exception 'The share price changed while this form was open. % share(s) now cost %. Review it and confirm again.',
      p_quantity, ugx(v_total) using errcode = 'check_violation', hint = 'quantity';
  end if;

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
$$;

revoke all on function buy_shares(uuid, integer, payment_method, date, text, text, numeric) from public, anon;
grant execute on function buy_shares(uuid, integer, payment_method, date, text, text, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- record_savings_payment - the ad-hoc entry.
--
-- Restated from 0041 only to stop reporting an `outstanding` balance that no
-- longer exists. A member's savings balance is the ledger's answer, not a
-- shortfall against a target nobody set.
-- ---------------------------------------------------------------------------
create or replace function record_savings_payment(
  p_member_id uuid,
  p_kind      savings_kind,
  p_amount    numeric,
  p_paid_on   date default current_date,
  p_method    payment_method default 'cash',
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period savings_periods;
  v_member members;
  v_res    jsonb;
begin
  perform assert_capability(can_record_savings(), 'record savings');
  perform assert_not_future(p_paid_on, 'A payment');

  if p_amount is null or p_amount <= 0 then
    raise exception 'Savings amount must be greater than zero.' using errcode = 'check_violation';
  end if;

  select * into v_member from members where id = p_member_id;
  if not found then
    raise exception 'Member not found.' using errcode = 'no_data_found';
  end if;
  if v_member.status <> 'active' then
    raise exception 'Savings cannot be recorded for a % member.', v_member.status
      using errcode = 'check_violation';
  end if;

  v_period := ensure_savings_period(p_member_id, coalesce(p_kind, 'monthly'::savings_kind),
                                    coalesce(p_paid_on, current_date));

  if v_period.status = 'waived' then
    raise exception 'This period has been waived. Remove the waiver before recording a payment.'
      using errcode = 'check_violation';
  end if;

  -- One collection path, so the two entry points cannot drift apart.
  v_res := record_scheduled_savings(v_period.id, p_amount, coalesce(p_paid_on, current_date),
                                    p_method, null, null, p_idempotency_key);

  return v_res || jsonb_build_object('period_id', v_period.id);
end;
$$;

revoke all on function record_savings_payment(uuid, savings_kind, numeric, date, payment_method, text) from public, anon;
grant execute on function record_savings_payment(uuid, savings_kind, numeric, date, payment_method, text) to authenticated;

-- ---------------------------------------------------------------------------
-- record_member_collection - the one counter for every kind of money.
--
-- Restated from 0027 for two lines in the `savings` branch: the cadence no
-- longer comes from a savings category, and a member without one is no longer
-- refused. Savings are monthly and open, so a cashier can always take them.
-- The `shares` branch already priced itself from `share_unit_price()`; it now
-- passes the quantity's total back for the database to confirm.
-- Everything else - the account checks, the reference rules, the idempotency,
-- the audit line - is 0027's, unchanged.
-- ---------------------------------------------------------------------------
create or replace function record_member_collection(
  p_member_id          uuid,
  p_collection_type    text,
  p_amount             numeric,
  p_account_id         uuid,
  p_paid_on            date default null,
  p_method             payment_method default null,
  p_external_ref       text default null,
  p_description        text default null,
  p_notes              text default null,
  p_savings_kind       savings_kind default null,
  p_loan_id            uuid default null,
  p_income_category_id uuid default null,
  p_idempotency_key    text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_acct     financial_accounts;
  v_member   members;
  v_method   payment_method;
  v_ref      text := nullif(btrim(coalesce(p_external_ref, '')), '');
  v_on       date := coalesce(p_paid_on, current_date);
  v_replay   boolean := false;
  v_res      jsonb;
  v_txn_id   uuid;
  v_txn      transactions;
  v_kind     savings_kind;
  v_period   savings_periods;
  v_price    numeric;
  v_qty      integer;
  v_loan_id  uuid;
  v_cat      income_categories;
  v_receipt  text;
  v_label    text;
begin
  perform assert_capability(can_record_finance() or can_record_savings(), 'record collections');

  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount greater than zero.' using errcode = 'check_violation';
  end if;
  perform assert_not_future(v_on, 'A payment');

  select * into v_acct from financial_accounts where id = p_account_id;
  if not found then
    raise exception 'Choose the account the money was received into.' using errcode = 'no_data_found';
  end if;

  v_method := coalesce(p_method, method_for_account_type(v_acct.account_type));
  v_acct   := assert_account_usable(p_account_id, v_method);

  select * into v_member from members where id = p_member_id;
  if not found then
    raise exception 'Member not found.' using errcode = 'no_data_found';
  end if;

  if p_idempotency_key is not null
     and exists (select 1 from transactions where idempotency_key = p_idempotency_key) then
    v_replay := true;
  end if;

  if not v_replay then
    if v_acct.account_type in ('merchant', 'bank') and v_ref is null then
      raise exception '%',
        case when v_acct.account_type = 'merchant'
             then 'Enter the mobile money transaction reference from the confirmation message.'
             else 'Enter the bank transfer or deposit slip reference.' end
        using errcode = 'check_violation';
    end if;
    if v_ref is not null and exists (
      select 1 from transactions where upper(external_ref) = upper(v_ref) and status <> 'reversed'
    ) then
      raise exception 'Reference % has already been recorded against another transaction.', v_ref
        using errcode = 'unique_violation';
    end if;
  end if;

  -- Hand the chosen account to the posting trigger for this database
  -- transaction only.
  perform set_config('bnd.account_id', p_account_id::text, true);

  case p_collection_type
    when 'savings' then
      -- Savings are monthly and open. A caller may still name a cadence, which
      -- is how a historical weekly period is paid into; with nothing named,
      -- the money goes to this month.
      v_kind := coalesce(p_savings_kind, 'monthly'::savings_kind);
      if v_member.status <> 'active' then
        raise exception 'Savings cannot be recorded for a % member.', v_member.status
          using errcode = 'check_violation';
      end if;
      v_period := ensure_savings_period(p_member_id, v_kind, v_on);
      if v_period.status = 'waived' then
        raise exception 'This period has been waived. Remove the waiver before recording a payment.'
          using errcode = 'check_violation';
      end if;
      -- On a replay the original row already carries the reference, and the
      -- duplicate-reference check inside would mistake the retry for a second
      -- payment; the idempotency key alone finds the original.
      v_res := record_scheduled_savings(v_period.id, p_amount, v_on, v_method,
                                        case when v_replay then null else v_ref end,
                                        coalesce(p_notes, p_description), p_idempotency_key);
      v_label := 'savings';

    when 'shares' then
      v_price := share_unit_price();
      if v_price is null or v_price <= 0 then
        raise exception 'The share price has not been set.' using errcode = 'check_violation';
      end if;
      if mod(p_amount, v_price) <> 0 then
        raise exception '% is not a whole number of shares at % each.', ugx(p_amount), ugx(v_price)
          using errcode = 'check_violation';
      end if;
      v_qty := (p_amount / v_price)::integer;
      v_res := buy_shares(p_member_id, v_qty, v_method, v_on,
                          coalesce(p_notes, p_description), p_idempotency_key, p_amount);
      v_label := 'share purchase';

    when 'loan_repayment' then
      v_loan_id := p_loan_id;
      if v_loan_id is null then
        select id into v_loan_id from loans
         where member_id = p_member_id and status in ('active', 'disbursed', 'defaulted')
         order by disbursed_on desc nulls last
         limit 1;
      end if;
      if v_loan_id is null then
        raise exception 'This member has no loan being repaid.' using errcode = 'check_violation';
      end if;
      if not exists (select 1 from loans where id = v_loan_id and member_id = p_member_id) then
        raise exception 'That loan does not belong to this member.' using errcode = 'check_violation';
      end if;
      v_res := record_loan_repayment(v_loan_id, p_amount, v_on, v_method, p_idempotency_key);
      v_label := 'loan repayment';

    when 'deposit' then
      v_res := record_cash_movement(p_member_id, 'deposit', p_amount, v_method, v_on,
                                    coalesce(p_description, 'Deposit'), p_idempotency_key);
      v_label := 'deposit';

    when 'fee' then
      select * into v_cat from income_categories where id = p_income_category_id;
      if not found or not v_cat.is_active then
        raise exception 'Choose what the member is paying for.' using errcode = 'check_violation';
      end if;
      v_res := record_income(v_cat.id, p_amount,
                             coalesce(nullif(btrim(coalesce(p_description, '')), ''),
                                      v_cat.name || ' - ' || v_member.full_name),
                             v_on, v_method, p_member_id, p_idempotency_key);
      v_label := lower(v_cat.name);

    else
      raise exception 'Unknown collection type %.', p_collection_type using errcode = 'check_violation';
  end case;

  perform set_config('bnd.account_id', '', true);

  v_txn_id := (v_res ->> 'transaction_id')::uuid;
  select * into v_txn from transactions where id = v_txn_id;

  if v_txn.destination_account_id is distinct from p_account_id then
    raise exception 'This payment was already recorded into %, not the account chosen now.',
      (select name from financial_accounts where id = v_txn.destination_account_id)
      using errcode = 'check_violation';
  end if;

  if v_ref is not null and v_txn.external_ref is null then
    update transactions set external_ref = v_ref where id = v_txn_id;
  end if;

  select receipt_no into v_receipt from receipts where transaction_id = v_txn_id;

  -- Only a posting made now is audited; an idempotent replay returns the
  -- original without writing a second line to the log.
  if v_txn.created_at = now() then
    perform write_audit('treasury.collection', 'Finance', v_txn_id::text,
      format('%s received for %s (%s) into %s%s', initcap(v_label) || ' of ' || ugx(p_amount),
             v_member.full_name, v_member.member_no, v_acct.name,
             case when v_ref is not null then ', ref ' || v_ref else '' end),
      null,
      jsonb_build_object('transaction_id', v_txn_id, 'reference', v_txn.reference,
                         'receipt_no', v_receipt, 'account_id', p_account_id,
                         'account', v_acct.name, 'amount', p_amount, 'method', v_method,
                         'external_ref', v_ref, 'collection_type', p_collection_type),
      p_notes);
  end if;

  return jsonb_build_object(
    'transaction_id',  v_txn_id,
    'reference',       v_txn.reference,
    'receipt_no',      v_receipt,
    'account_id',      p_account_id,
    'account_name',    v_acct.name,
    'account_balance', account_balance_at(p_account_id),
    'member_name',     v_member.full_name,
    'member_no',       v_member.member_no,
    'collection_type', p_collection_type,
    'amount',          p_amount,
    'duplicate',       v_txn.created_at <> now()
  );
end;
$$;

revoke all on function record_member_collection(uuid, text, numeric, uuid, date, payment_method, text, text, text, savings_kind, uuid, uuid, text) from public, anon;
grant execute on function record_member_collection(uuid, text, numeric, uuid, date, payment_method, text, text, text, savings_kind, uuid, uuid, text) to authenticated;

-- ===========================================================================
-- 5. REGISTRATION
--
-- Restated from 0038 with the category step removed. Nothing else about
-- registration changes: the same permission, the same duplicate checks, the
-- same idempotent registration key, the same fee schedule read from `fees`,
-- and the same rule that a member is Pending until the mandatory fees are
-- settled if the SACCO says so.
--
-- What a new member is charged is the registration fee set in section 1:
-- UGX 20,000, read from the `fees` row rather than written into this function.
-- ===========================================================================
create or replace function register_member(
  p_member             jsonb,
  p_optional_fee_ids   uuid[] default '{}',
  p_payment            jsonb default null,
  p_expected_total     numeric default null,
  p_registration_key   text default null,
  p_allow_shared_phone boolean default false,
  p_override_reason    text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_existing  members;
  v_member    members;
  v_other     members;
  v_name      text := regexp_replace(btrim(coalesce(p_member ->> 'full_name', '')), '\s+', ' ', 'g');
  v_phone     text := normalize_ug_phone(p_member ->> 'phone');
  v_email     text := nullif(lower(btrim(coalesce(p_member ->> 'email', ''))), '');
  v_nin       text := nullif(upper(regexp_replace(coalesce(p_member ->> 'national_id', ''), '\s', '', 'g')), '');
  v_gender    text := nullif(lower(btrim(coalesce(p_member ->> 'gender', ''))), '');
  v_nok_name  text := nullif(btrim(coalesce(p_member ->> 'next_of_kin_name', '')), '');
  v_nok_rel   text := nullif(btrim(coalesce(p_member ->> 'next_of_kin_relation', '')), '');
  v_nok_phone text := nullif(btrim(coalesce(p_member ->> 'next_of_kin_phone', '')), '');
  v_dob       date := form_date(p_member ->> 'date_of_birth', 'date_of_birth', 'date of birth');
  v_joined    date := coalesce(form_date(p_member ->> 'joined_on', 'joined_on', 'membership date'), current_date);
  v_fee       record;
  v_optional  uuid[] := coalesce(p_optional_fee_ids, '{}');
  v_charge    member_fees;
  v_charge_ids uuid[] := '{}';
  v_total     numeric(16,2) := 0;
  v_mandatory numeric(16,2) := 0;
  v_pay_now   boolean := coalesce((p_payment ->> 'pay_now')::boolean, false);
  v_paid      jsonb;
  v_min_age   integer;
  v_status    member_status;
  v_shared    boolean := false;
begin
  perform assert_permission('members.create');

  -- A retried submission returns the member it already registered.
  if p_registration_key is not null then
    select * into v_existing from members where registration_key = p_registration_key;
    if found then
      return registration_summary(v_existing.id, true);
    end if;
  end if;

  -- --- Who they are ------------------------------------------------------
  if length(v_name) < 3 or v_name !~ '\S+\s+\S+' then
    raise exception 'Enter the member''s full name - at least a first and a last name.'
      using errcode = 'check_violation', hint = 'full_name';
  end if;
  if length(v_name) > 120 then
    raise exception 'That name is too long.' using errcode = 'check_violation', hint = 'full_name';
  end if;

  if nullif(btrim(coalesce(p_member ->> 'phone', '')), '') is null then
    raise exception 'Enter the member''s phone number. It is how they sign in.'
      using errcode = 'check_violation', hint = 'phone';
  end if;
  if v_phone is null then
    raise exception 'Enter a valid Ugandan mobile number, e.g. 0772 123 456 or +256 772 123 456.'
      using errcode = 'check_violation', hint = 'phone';
  end if;

  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address, or leave it blank.' using errcode = 'check_violation', hint = 'email';
  end if;

  if v_nin is null and setting_bool('members.require_national_id') then
    raise exception 'Enter the member''s National ID number.' using errcode = 'check_violation', hint = 'national_id';
  end if;
  if v_nin is not null then
    select * into v_other from members where upper(national_id) = v_nin limit 1;
    if found then
      raise exception 'National ID % is already registered to % (%).', v_nin, v_other.full_name, v_other.member_no
        using errcode = 'unique_violation', hint = 'national_id';
    end if;
  end if;

  if v_dob is null and setting_bool('members.require_date_of_birth') then
    raise exception 'Enter the member''s date of birth.' using errcode = 'check_violation', hint = 'date_of_birth';
  end if;
  if v_dob is not null then
    if v_dob > current_date then
      raise exception 'A date of birth cannot be in the future.' using errcode = 'check_violation', hint = 'date_of_birth';
    end if;
    v_min_age := setting_int('members.min_age');
    if v_min_age > 0 and v_dob > (current_date - make_interval(years => v_min_age))::date then
      raise exception 'Members must be at least % years old to join.', v_min_age
        using errcode = 'check_violation', hint = 'date_of_birth';
    end if;
  end if;

  if v_gender is null and setting_bool('members.require_gender') then
    raise exception 'Choose the member''s gender.' using errcode = 'check_violation', hint = 'gender';
  end if;
  if v_gender is not null and v_gender not in ('male', 'female', 'other') then
    raise exception 'Choose a gender from the list.' using errcode = 'check_violation', hint = 'gender';
  end if;

  if setting_bool('members.require_next_of_kin')
     and (v_nok_name is null or v_nok_rel is null or v_nok_phone is null) then
    raise exception 'Enter the next of kin''s name, relationship and phone number.'
      using errcode = 'check_violation', hint = case when v_nok_name is null then 'next_of_kin_name'
                                                      when v_nok_rel is null then 'next_of_kin_relation'
                                                      else 'next_of_kin_phone' end;
  end if;

  if v_joined > current_date then
    raise exception 'The membership date cannot be in the future.' using errcode = 'check_violation', hint = 'joined_on';
  end if;

  -- --- Duplicates ----------------------------------------------------------
  select * into v_other from members
   where phone = v_phone and status not in ('archived', 'exited')
   order by joined_on limit 1;
  if found then
    if not coalesce(p_allow_shared_phone, false) then
      raise exception '% is already the phone number of % (%). Each member signs in with their own number.',
        format_ug_phone(v_phone), v_other.full_name, v_other.member_no
        using errcode = 'unique_violation', hint = 'phone';
    end if;
    perform assert_permission('members.phone_override');
    if length(btrim(coalesce(p_override_reason, ''))) < 5 then
      raise exception 'Give a reason for letting two members share this phone number.'
        using errcode = 'check_violation', hint = 'override_reason';
    end if;
    v_shared := true;
  end if;

  if v_dob is not null then
    select * into v_other from members
     where lower(full_name) = lower(v_name) and date_of_birth = v_dob
       and (v_nin is null or national_id is null)
       and status not in ('archived', 'exited')
     limit 1;
    if found then
      raise exception '% (%), born on the same day, is already a member. If this is a different person, record their National ID to tell them apart.',
        v_other.full_name, v_other.member_no using errcode = 'unique_violation', hint = 'full_name';
    end if;
  end if;

  -- --- Categories ------------------------------------------------------
  --
  -- There are none. Savings are open and every share costs the same, so
  -- nothing about a new member's tier has to be decided at the counter. The
  -- two columns stay on `members`, null for everyone registered from here on,
  -- because they still carry what the members registered before this change
  -- joined under.

  -- --- Fees ----------------------------------------------------------------
  if exists (
    select 1 from unnest(v_optional) x
     where not exists (select 1 from fees f
                        where f.id = x and f.status = 'active' and f.charged_when = 'registration'
                          and f.applies_to_new_members and not f.is_mandatory
                          and f.effective_from <= v_joined)
  ) then
    raise exception 'One of the optional fees chosen is not available. Reload the form.'
      using errcode = 'check_violation', hint = 'fees';
  end if;

  select coalesce(sum(amount), 0), coalesce(sum(amount) filter (where is_mandatory), 0)
    into v_total, v_mandatory
    from fees
   where status = 'active' and charged_when = 'registration' and applies_to_new_members
     and effective_from <= v_joined
     and (is_mandatory or id = any (v_optional));

  if p_expected_total is not null and p_expected_total <> v_total then
    raise exception 'The registration fees changed while this form was open. The total is now %. Review it and confirm again.',
      ugx(v_total) using errcode = 'check_violation', hint = 'fees';
  end if;

  if v_pay_now and v_total = 0 then
    v_pay_now := false;
  end if;

  v_status := case when v_mandatory > 0 and setting_bool('members.activation_requires_fees')
                   then 'pending' else 'active' end;

  -- --- The member ----------------------------------------------------------
  insert into members (member_no, full_name, phone, email, national_id, date_of_birth, gender,
                       address, occupation, next_of_kin_name, next_of_kin_phone,
                       next_of_kin_relation, joined_on, status, created_by, registration_key,
                       allow_shared_phone, shared_phone_reason, activated_at)
  values (next_member_no(), v_name, v_phone, v_email, v_nin, v_dob, v_gender,
          nullif(btrim(coalesce(p_member ->> 'address', '')), ''),
          nullif(btrim(coalesce(p_member ->> 'occupation', '')), ''),
          v_nok_name, v_nok_phone, v_nok_rel, v_joined, v_status,
          auth.uid(), p_registration_key,
          v_shared, case when v_shared then btrim(p_override_reason) end,
          case when v_status = 'active' then now() end)
  returning * into v_member;

  for v_fee in
    select * from fees
     where status = 'active' and charged_when = 'registration' and applies_to_new_members
       and effective_from <= v_joined
       and (is_mandatory or id = any (v_optional))
     order by is_mandatory desc, sort_order, name
  loop
    insert into member_fees (member_id, fee_id, fee_name, amount, currency, is_mandatory,
                             charged_at_registration, charged_on, created_by)
    values (v_member.id, v_fee.id, v_fee.name, v_fee.amount, v_fee.currency, v_fee.is_mandatory,
            true, v_joined, auth.uid())
    returning * into v_charge;
    v_charge_ids := v_charge_ids || v_charge.id;
  end loop;

  perform write_audit('member.created', 'Members', v_member.id::text,
    format('Member %s (%s) registered%s', v_member.full_name, v_member.member_no,
           case when v_status = 'pending' then ' - pending until mandatory fees are paid' else '' end),
    null,
    to_jsonb(v_member) - 'registration_key'
      || jsonb_build_object('fees_charged', v_total),
    case when v_shared then 'Shared phone number allowed: ' || btrim(p_override_reason) end);

  if v_shared then
    perform write_audit('member.phone_shared', 'Members', v_member.id::text,
      format('%s registered on %s, a number another member also uses', v_member.member_no,
             format_ug_phone(v_phone)),
      null, jsonb_build_object('phone', v_phone), p_override_reason);
  end if;

  -- --- Payment -------------------------------------------------------------
  if v_pay_now then
    v_paid := post_fee_payment(
      v_member.id, v_charge_ids,
      nullif(p_payment ->> 'account_id', '')::uuid,
      nullif(p_payment ->> 'method', '')::payment_method,
      form_date(p_payment ->> 'paid_on', 'paid_on', 'payment date'),
      p_payment ->> 'reference',
      coalesce(nullif(p_payment ->> 'idempotency_key', ''), 'register:' || coalesce(p_registration_key, v_member.id::text)),
      'Registration fees',
      nullif(p_payment ->> 'amount_received', '')::numeric);
  elsif v_status = 'active' then
    perform ensure_member_schedule(v_member.id, current_date);
  end if;

  return registration_summary(v_member.id, false);
end;
$$;
revoke all on function register_member(jsonb, uuid[], jsonb, numeric, text, boolean, text) from public, anon;
grant execute on function register_member(jsonb, uuid[], jsonb, numeric, text, boolean, text) to authenticated;

-- ===========================================================================
-- 6. THE READ MODELS, WITHOUT CATEGORIES
--
-- Dropped in dependency order and rebuilt. Nothing is dropped with CASCADE: if
-- something still depends on one of these, this migration should fail loudly
-- rather than quietly take it down.
-- ===========================================================================
drop view if exists savings_category_summary;
drop view if exists share_category_summary;
drop view if exists savings_transactions;
drop view if exists savings_schedules;
drop view if exists member_financials;
drop view if exists member_share_progress;
drop view if exists share_categories_priced;

-- ---------------------------------------------------------------------------
-- member_share_progress - shares owned, at the one price.
--
-- The name is kept because every caller asks for it, but there is no longer
-- any progress towards a tier to report. What a member wants to know is how
-- many shares they hold, what one costs today, and what the holding is worth.
--
-- `share_value` is what the lots actually cost - the sum of quantity times the
-- price paid at the time. `value_at_current_price` is what the same holding
-- is worth at today's price. They agree unless the price has moved, and
-- keeping both means neither has to lie.
-- ---------------------------------------------------------------------------
create view member_share_progress
with (security_invoker = true) as
select
  m.id                                       as member_id,
  coalesce(sh.share_count, 0)::integer       as shares_owned,
  coalesce(sh.share_value, 0)::numeric(16,2) as share_value,
  p.unit_price                               as share_price,
  (coalesce(sh.share_count, 0) * p.unit_price)::numeric(16,2) as value_at_current_price,
  sh.last_purchase_on
from members m
left join member_shares sh on sh.member_id = m.id
cross join (select share_unit_price() as unit_price) p;

-- ---------------------------------------------------------------------------
-- member_financials - one member's whole position.
--
-- Gone: share category, savings category, the share target and what remains of
-- it, the qualification window, the next due date, the next expected amount
-- and `savings_outstanding`. None of them is a fact about a member any more.
--
-- Added: `savings_this_month`, which is what the member and the cashier both
-- actually ask - how much has been saved since the first of the month - and
-- `shares_owned` / `share_price`, so a screen can show the holding and what a
-- share costs without a second query.
-- ---------------------------------------------------------------------------
create view member_financials
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

  -- --- shares, at the one price -------------------------------------------
  sp.shares_owned,
  sp.share_price,
  sp.value_at_current_price          as share_value_at_current_price,
  sp.last_purchase_on                as last_share_purchase_on,

  -- --- savings, open ------------------------------------------------------
  coalesce(tm.saved_this_month, 0)::numeric(16,2)  as savings_this_month,
  tm.last_saved_on                                  as last_saved_on,
  coalesce(ct.contributed, 0)::numeric(16,2)        as savings_contributed
from members m
left join member_savings       ms on ms.member_id = m.id
left join member_shares        sh on sh.member_id = m.id
left join member_loans_summary ml on ml.member_id = m.id
left join member_share_progress sp on sp.member_id = m.id
left join lateral (
  -- Saved this calendar month, and when they last saved. From the ledger, so
  -- it agrees with the balance above and with the member's statement.
  select sum(t.amount) filter (
           where t.occurred_on >= date_trunc('month', current_date)::date) as saved_this_month,
         max(t.occurred_on)                                                as last_saved_on
    from transactions t
   where t.member_id = m.id
     and t.status = 'posted'
     and t.type in ('weekly_savings', 'monthly_savings')
) tm on true
left join lateral (
  select sum(s.paid_amount) as contributed
    from savings_periods s
   where s.member_id = m.id
) ct on true;

-- ---------------------------------------------------------------------------
-- savings_schedules - a member's month-by-month savings history.
--
-- The name stays; what it holds has changed. `expected_amount` and
-- `outstanding` are gone, because nothing is expected and so nothing can be
-- outstanding. A row now says: this member, this month, this much saved, the
-- last deposit and how it arrived.
--
-- Rows raised under the old categories are still here, with everything they
-- recorded. What they no longer do is present an old target as a live debt.
-- ---------------------------------------------------------------------------
create view savings_schedules
with (security_invoker = true) as
select
  sp.id                                   as schedule_id,
  sp.id                                   as period_id,
  sp.member_id,
  m.member_no,
  m.full_name                             as member_name,
  m.phone                                 as member_phone,
  m.photo_url                             as member_photo,
  m.status                                as member_status,

  sp.kind,
  sp.period_start,
  sp.period_end,
  sp.period_label,
  sp.period_label                         as cycle,
  sp.paid_amount                          as saved_amount,
  sp.paid_amount,
  sp.status,
  sp.created_at,
  sp.updated_at,
  -- The last payment recorded in this month, so a collection screen can show
  -- the method and reference without a second query per row.
  lp.method                               as last_method,
  lp.external_ref                         as last_reference,
  lp.paid_on                              as last_paid_on,
  lp.transaction_id                       as last_transaction_id,
  coalesce(lc.deposits, 0)::integer       as deposits
from savings_periods sp
join members m on m.id = sp.member_id
left join lateral (
  select pay.method, pay.external_ref, pay.paid_on, pay.transaction_id
    from savings_payments pay
    join transactions t on t.id = pay.transaction_id
   where pay.period_id = sp.id and t.status = 'posted'
   order by pay.paid_on desc, pay.created_at desc
   limit 1
) lp on true
left join lateral (
  select count(*) as deposits
    from savings_payments pay
    join transactions t on t.id = pay.transaction_id
   where pay.period_id = sp.id and t.status = 'posted'
) lc on true;

-- ---------------------------------------------------------------------------
-- savings_transactions - the money, one row per posted deposit.
--
-- Unchanged but for the category columns. A reversed transaction still drops
-- out, because a reversed payment is not a savings transaction any more.
-- ---------------------------------------------------------------------------
create view savings_transactions
with (security_invoker = true) as
select
  pay.id,
  pay.member_id,
  m.member_no,
  m.full_name                as member_name,
  pay.period_id              as schedule_id,
  pay.period_id,
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
join transactions t          on t.id = pay.transaction_id and t.status = 'posted'
join members m               on m.id = pay.member_id
left join savings_periods sp on sp.id = pay.period_id
left join app_users au       on au.id = pay.recorded_by;

grant select on member_share_progress to authenticated;
grant select on member_financials     to authenticated;
grant select on savings_schedules     to authenticated;
grant select on savings_transactions  to authenticated;

-- ===========================================================================
-- 7. DASHBOARDS, SEARCH AND REPORTS
--
-- Every figure below is still an aggregate over the one ledger, member
-- schedules and share lots. What is gone is the category dimension: a report
-- can no longer group members by a tier, because members no longer have one.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- search_members - without the category filters.
--
-- Dropped rather than overloaded: two candidates with defaulted arguments is
-- an ambiguity waiting to pick the wrong one.
-- ---------------------------------------------------------------------------
drop function if exists search_members(text, member_status, text, integer, integer, uuid, uuid, boolean);
drop function if exists search_members(text, member_status, text, integer, integer, uuid, boolean);

create or replace function search_members(
  p_query   text default null,
  p_status  member_status default null,
  p_sort    text default 'name',   -- name | recent | savings | shares | loan
  p_limit   integer default 20,
  p_offset  integer default 0
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rows  jsonb;
  v_total bigint;
  v_q     text := nullif(trim(coalesce(p_query, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
begin
  perform assert_capability(can_view_operations(), 'view members');

  select count(*) into v_total
    from members m
   where (p_status is null or m.status = p_status)
     and (v_q is null
          or m.full_name ilike '%' || v_q || '%'
          or m.member_no ilike '%' || v_q || '%'
          or m.phone     ilike '%' || v_q || '%'
          or coalesce(m.national_id, '') ilike '%' || v_q || '%');

  select coalesce(jsonb_agg(to_jsonb(r) order by r.sort_rank), '[]'::jsonb)
    into v_rows
    from (
      select mf.*,
             case p_sort
               when 'recent'  then row_number() over (order by mf.joined_on desc, mf.full_name)
               when 'savings' then row_number() over (order by mf.savings_balance desc, mf.full_name)
               when 'shares'  then row_number() over (order by mf.share_value desc, mf.full_name)
               when 'loan'    then row_number() over (order by mf.loan_balance desc, mf.full_name)
               else                row_number() over (order by mf.full_name)
             end as sort_rank
        from member_financials mf
       where (p_status is null or mf.status = p_status)
         and (v_q is null
              or mf.full_name ilike '%' || v_q || '%'
              or mf.member_no ilike '%' || v_q || '%'
              or mf.phone     ilike '%' || v_q || '%'
              or coalesce(mf.national_id, '') ilike '%' || v_q || '%')
       order by sort_rank
       offset greatest(coalesce(p_offset, 0), 0)
       limit v_limit
    ) r;

  return jsonb_build_object(
    'rows',   v_rows,
    'total',  v_total,
    'limit',  v_limit,
    'offset', greatest(coalesce(p_offset, 0), 0)
  );
end;
$$;

-- A new signature is created with EXECUTE granted to PUBLIC by default, which
-- would put a member search behind no sign-in at all. Revoked before it is
-- granted, exactly as every other money or member function in this schema.
revoke all on function search_members(text, member_status, text, integer, integer) from public, anon;
grant execute on function search_members(text, member_status, text, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- savings_performance - who saved, and how much, over a period.
--
-- The old report measured members against their category's target and scored
-- them on compliance. With no target there is nothing to comply with, so the
-- report answers the question that is left: in this window, how many deposits
-- did each member make, and what did they save in total?
--
-- Taken from the ledger rather than from the period rows, so it agrees with
-- the member's statement to the shilling.
-- ---------------------------------------------------------------------------
drop function if exists savings_performance(savings_kind, date, date, uuid, savings_status);
drop function if exists savings_performance(savings_kind, date, date);

create or replace function savings_performance(
  p_from date,
  p_to   date
) returns table (
  member_id uuid, member_no text, full_name text, member_status member_status,
  deposits integer, total_saved numeric, first_saved_on date, last_saved_on date,
  savings_balance numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform assert_capability(can_view_operations(), 'view savings performance');

  return query
  select
    m.id, m.member_no, m.full_name, m.status,
    count(t.id)::integer,
    coalesce(sum(t.amount), 0)::numeric(16,2),
    min(t.occurred_on),
    max(t.occurred_on),
    coalesce(ms.savings_balance, 0)::numeric(16,2)
  from members m
  left join member_savings ms on ms.member_id = m.id
  left join transactions t
         on t.member_id = m.id
        and t.status = 'posted'
        and t.type in ('weekly_savings', 'monthly_savings')
        and t.occurred_on between p_from and p_to
  where m.status = 'active'
  group by m.id, m.member_no, m.full_name, m.status, ms.savings_balance
  order by m.full_name;
end;
$$;

revoke all on function savings_performance(date, date) from public, anon;
grant execute on function savings_performance(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- savings_dashboard - what came in, not what was owed.
--
-- Gone: expected, outstanding, arrears, the collection rate, the schedule
-- status counts, the per-category rows and the "uncategorised members" count.
-- Every one of them measured a target that no longer exists.
--
-- What a manager is told instead: how much was saved in the window, by how
-- many members, across how many deposits, the largest and the average, and
-- what the SACCO holds in savings altogether.
-- ---------------------------------------------------------------------------
create or replace function savings_dashboard(
  p_from date default null,
  p_to   date default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v      jsonb;
  v_from date := coalesce(p_from, date_trunc('month', current_date)::date);
  v_to   date := coalesce(p_to, current_date);
begin
  perform assert_capability(can_view_operations(), 'view the savings dashboard');

  select jsonb_build_object(
    'from', v_from,
    'to',   v_to,

    'total_members', (select count(*) from members where status = 'active'),

    -- The lifetime savings position, from the ledger.
    'total_savings', (select coalesce(sum(
                        case when type in ('weekly_savings', 'monthly_savings', 'deposit')
                             then amount else -amount end), 0)
                        from transactions
                       where status = 'posted'
                         and type in ('weekly_savings', 'monthly_savings',
                                      'deposit', 'withdrawal')),

    -- The window in view, from the ledger.
    'collected_savings', (select coalesce(sum(amount), 0) from transactions
                           where status = 'posted'
                             and type in ('weekly_savings', 'monthly_savings')
                             and occurred_on between v_from and v_to),
    'deposit_count',     (select count(*) from transactions
                           where status = 'posted'
                             and type in ('weekly_savings', 'monthly_savings')
                             and occurred_on between v_from and v_to),
    'saving_members',    (select count(distinct member_id) from transactions
                           where status = 'posted'
                             and type in ('weekly_savings', 'monthly_savings')
                             and occurred_on between v_from and v_to),
    'largest_deposit',   (select coalesce(max(amount), 0) from transactions
                           where status = 'posted'
                             and type in ('weekly_savings', 'monthly_savings')
                             and occurred_on between v_from and v_to),

    'collected_today',   (select coalesce(sum(amount), 0) from transactions
                           where status = 'posted' and occurred_on = current_date
                             and type in ('weekly_savings', 'monthly_savings', 'deposit')),
    'savers_today',      (select count(distinct member_id) from transactions
                           where status = 'posted' and occurred_on = current_date
                             and type in ('weekly_savings', 'monthly_savings'))
  ) into v;

  return v || jsonb_build_object(
    'average_deposit',
      case when (v ->> 'deposit_count')::numeric > 0
           then round((v ->> 'collected_savings')::numeric
                      / (v ->> 'deposit_count')::numeric, 2)
           else 0 end
  );
end;
$$;

grant execute on function savings_dashboard(date, date) to authenticated;

-- The category report has no subject left. Dropped rather than left returning
-- zeroes, so a screen still calling it fails loudly in testing instead of
-- quietly showing an empty table in production.
drop function if exists savings_category_analytics(date, date);

-- ---------------------------------------------------------------------------
-- member_savings_overview - the member's own dashboard.
-- ---------------------------------------------------------------------------
create or replace function member_savings_overview(p_member_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_member jsonb;
  v_id     uuid := coalesce(p_member_id, current_member_id());
begin
  if v_id is null then
    raise exception 'Member not found.' using errcode = 'no_data_found';
  end if;
  if not (can_view_operations() or v_id = current_member_id()) then
    raise exception 'You may only view your own savings.' using errcode = 'insufficient_privilege';
  end if;

  select to_jsonb(mf) into v_member from member_financials mf where mf.id = v_id;
  if v_member is null then
    raise exception 'Member not found.' using errcode = 'no_data_found';
  end if;

  return jsonb_build_object(
    'member', v_member,
    'share_progress', (
      select to_jsonb(p) from member_share_progress p where p.member_id = v_id
    ),
    'share_price', share_unit_price(),
    -- Month by month, most recent first: what this member saved each month.
    'schedules', (
      select coalesce(jsonb_agg(to_jsonb(s) order by s.period_start desc), '[]'::jsonb)
        from (select * from savings_schedules
               where member_id = v_id
               order by period_start desc limit 12) s
    ),
    'recent_payments', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.transaction_date desc), '[]'::jsonb)
        from (select * from savings_transactions
               where member_id = v_id
               order by transaction_date desc, created_at desc limit 10) t
    ),
    'loans', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'loan_id', lb.loan_id, 'loan_no', lb.loan_no, 'status', lb.status,
               'principal', lb.principal, 'total_payable', lb.total_payable,
               'amount_paid', lb.amount_paid, 'outstanding', lb.outstanding,
               'percent_repaid', lb.percent_repaid,
               'next_due_on', lb.next_due_on, 'next_due_amount', lb.next_due_amount,
               'overdue_amount', lb.overdue_amount
             ) order by lb.disbursed_on desc nulls last), '[]'::jsonb)
        from loan_balances lb
       where lb.member_id = v_id
         and lb.status in ('applied', 'under_review', 'approved',
                           'disbursed', 'active', 'defaulted')
    ),
    'generated_at', now()
  );
end;
$$;

grant execute on function member_savings_overview(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- member_collection_view - one member, everything a cashier needs.
--
-- The cashier no longer needs to be told what this member is expected to pay,
-- because nobody is expected to pay anything. They need to know who the member
-- is, what has been saved this month, what the balance is, and what the last
-- few deposits were. The current month's bucket is still opened if it does not
-- exist, so the screen is never empty for a member standing at the counter.
-- ---------------------------------------------------------------------------
create or replace function member_collection_view(
  p_member_id uuid,
  p_on        date default current_date
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member   jsonb;
  v_period   savings_periods;
  v_current  jsonb;
begin
  perform assert_capability(can_view_operations(), 'view collections');

  select to_jsonb(mf) into v_member from member_financials mf where mf.id = p_member_id;
  if v_member is null then
    raise exception 'Member not found.' using errcode = 'no_data_found';
  end if;

  if (v_member ->> 'status') = 'active' and can_record_savings() then
    v_period := ensure_member_schedule(p_member_id, p_on);
  else
    select * into v_period from savings_periods
     where member_id = p_member_id and kind = 'monthly'
       and period_start <= p_on and period_end >= p_on
     limit 1;
  end if;

  if v_period.id is not null then
    select to_jsonb(s) into v_current from savings_schedules s
     where s.schedule_id = v_period.id;
  end if;

  return jsonb_build_object(
    'member',        v_member,
    'current',       v_current,
    'share_progress', (
      select to_jsonb(p) from member_share_progress p where p.member_id = p_member_id
    ),
    'share_price',   share_unit_price(),
    'schedules', (
      select coalesce(jsonb_agg(to_jsonb(s) order by s.period_start desc), '[]'::jsonb)
        from (select * from savings_schedules
               where member_id = p_member_id
               order by period_start desc limit 12) s
    ),
    'history', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.transaction_date desc), '[]'::jsonb)
        from (select * from savings_transactions
               where member_id = p_member_id
               order by transaction_date desc, created_at desc limit 10) t
    ),
    'as_of', p_on
  );
end;
$$;

grant execute on function member_collection_view(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- dashboard_metrics - the staff dashboard.
--
-- Gone: the category counts, the uncategorised-member count, the schedules due
-- today and `savings_arrears`. Added: savings taken this month and the share
-- price, which is what the counter is actually asked about.
--
-- Everything else is 0036's, including its rule that a reversed entry is not
-- income or expense - the reason this dashboard agrees with the cashbook.
-- ---------------------------------------------------------------------------
create or replace function dashboard_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  perform assert_capability(can_view_operations(), 'view the dashboard');

  select jsonb_build_object(
    'total_members',      (select count(*) from members where status = 'active'),
    'members_this_month', (select count(*) from members
                            where joined_on >= date_trunc('month', current_date)),
    'share_capital',      (select coalesce(sum(sl.total_value), 0)
                             from share_lots sl
                             join transactions t on t.id = sl.transaction_id
                            where t.status = 'posted'),
    'shares_issued',      (select coalesce(sum(sl.quantity), 0)
                             from share_lots sl
                             join transactions t on t.id = sl.transaction_id
                            where t.status = 'posted'),
    'share_price',        share_unit_price(),
    'total_savings',      (select coalesce(sum(
                              case when type in ('weekly_savings', 'monthly_savings', 'deposit')
                                   then amount else -amount end), 0)
                             from transactions
                            where status = 'posted'
                              and type in ('weekly_savings', 'monthly_savings', 'deposit', 'withdrawal')),
    'savings_this_month', (select coalesce(sum(amount), 0) from transactions
                            where status = 'posted'
                              and type in ('weekly_savings', 'monthly_savings')
                              and occurred_on >= date_trunc('month', current_date)),
    'savers_this_month',  (select count(distinct member_id) from transactions
                            where status = 'posted'
                              and type in ('weekly_savings', 'monthly_savings')
                              and occurred_on >= date_trunc('month', current_date)),
    'active_loan_count',  (select count(*) from loans where status in ('active', 'disbursed')),
    'active_loan_value',  (select coalesce(sum(principal), 0) from loans
                            where status in ('active', 'disbursed')),
    'outstanding_loans',  (select coalesce(sum(outstanding), 0) from loan_balances
                            where status in ('active', 'disbursed', 'defaulted')),
    'overdue_loans',      (select coalesce(sum(overdue_amount), 0) from loan_balances
                            where status in ('active', 'disbursed', 'defaulted')),
    'overdue_count',      (select count(*) from loan_balances
                            where status in ('active', 'disbursed', 'defaulted')
                              and overdue_amount > 0),
    'pending_loans',      (select count(*) from loans where status in ('applied', 'under_review')),
    'todays_collections', (select coalesce(sum(amount), 0) from transactions
                            where status = 'posted' and occurred_on = current_date
                              and type in ('weekly_savings', 'monthly_savings', 'deposit',
                                           'share_purchase', 'loan_repayment')),
    -- Same rule as cashbook(), kept from 0036: an entry whose transaction was
    -- reversed is not income or expense any more.
    'income_mtd',         (select coalesce(sum(i.amount), 0)
                             from income_entries i
                             left join transactions t on t.id = i.transaction_id
                            where i.received_on >= date_trunc('month', current_date)
                              and coalesce(t.status, 'posted') = 'posted'),
    'expenses_mtd',       (select coalesce(sum(e.amount), 0)
                             from expense_entries e
                             left join transactions t on t.id = e.transaction_id
                            where e.approval = 'approved'
                              and e.spent_on >= date_trunc('month', current_date)
                              and coalesce(t.status, 'posted') = 'posted'),
    'pending_expenses',   (select count(*) from expense_entries where approval = 'pending')
  ) into v;

  return v;
end;
$$;

grant execute on function dashboard_metrics() to authenticated;

-- ===========================================================================
-- 8. THE CATEGORY MACHINERY ITSELF
--
-- The tables and their rows stay. The ways in do not: a function that creates
-- a category, edits one, or puts a member into one would let the old model
-- back in through a door the screens no longer show.
-- ===========================================================================
drop function if exists create_share_category(text, integer, integer, text, text, integer);
drop function if exists create_share_category(text, integer, numeric, integer, text, text, integer);
drop function if exists update_share_category(uuid, text, integer, integer, text, integer);
drop function if exists update_share_category(uuid, text, integer, numeric, integer, text, integer);
drop function if exists set_share_category_status(uuid, category_status, text);
drop function if exists create_savings_category(text, numeric, savings_kind, text, text, integer);
drop function if exists update_savings_category(uuid, text, numeric, savings_kind, text, integer);
drop function if exists set_savings_category_status(uuid, category_status, text);
drop function if exists set_member_categories(uuid, uuid, uuid, text);
drop function if exists member_savings_category(uuid);

-- The two tables keep their read policies: a historical record that names a
-- category still has to be able to resolve the name. Neither ever had an
-- INSERT, UPDATE or DELETE policy, and neither gains one.

comment on table savings_categories is
  'Retired by 0043. Savings are open and no member is classified by what they save. The rows are kept, inactive, so records raised under the old tiers can still be read.';
comment on table share_categories is
  'Retired by 0043. One share costs the configured price and a member may buy any whole number of them. The rows are kept, inactive, so records raised under the old tiers can still be read.';
comment on column members.savings_category_id is
  'Historical. The savings tier this member joined under, before 0043 made savings open. Read by nothing; kept so the register can still say what they were.';
comment on column members.share_category_id is
  'Historical. The share tier this member joined under, before 0043 made every share the same price. Read by nothing; kept so the register can still say what they were.';
comment on column savings_periods.expected_amount is
  'Zero on every period raised since 0043: savings are open and nothing is expected. Rows raised before it keep the target they were actually raised with, as the record of what was asked at the time.';

-- ===========================================================================
-- 9. ONE SETTING THAT CAN NO LONGER MEAN ANYTHING
--
-- "Allow part payments" asked whether a member may pay less than the amount
-- expected of them for a period. Nothing is expected of them any more, so the
-- setting has nothing left to decide. 0037 established the rule this follows:
-- a setting is enforced or it is removed, never left on the screen doing
-- nothing.
--
-- The smallest-saving settings stay. They are a SACCO-wide floor on what the
-- counter will take, not a target, and both ship at zero - which is what "a
-- member can save any positive amount" means in practice.
-- ===========================================================================
create or replace function savings_payment_minimum_gate()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_kind savings_kind;
  v_min  numeric;
begin
  select kind into v_kind from savings_periods where id = new.period_id;
  if v_kind is null then
    return new;
  end if;

  v_min := case v_kind
             when 'weekly'  then setting_number('savings.min_weekly_amount')
             else                setting_number('savings.min_monthly_amount')
           end;

  if v_min > 0 and new.amount < v_min then
    raise exception 'The smallest saving this SACCO accepts is UGX %.',
      to_char(v_min, 'FM999,999,999') using errcode = 'check_violation';
  end if;

  return new;
end;
$fn$;

delete from system_settings where key = 'savings.allow_partial_payment';

update system_settings
   set label = 'Smallest monthly saving',
       description = 'The least the counter will take as one monthly saving. Zero means any amount above zero is accepted, which is what open monthly savings means.'
 where key = 'savings.min_monthly_amount';

update system_settings
   set label = 'Smallest weekly saving',
       description = 'The least the counter will take as one weekly saving. Weekly saving is historical; monthly is what the SACCO collects.'
 where key = 'savings.min_weekly_amount';
