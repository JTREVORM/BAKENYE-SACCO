-- ===========================================================================
-- BUD-SACCO - 0023 - Category savings: schedules, collection and analytics
--
-- Every function that moves money is SECURITY DEFINER, checks the capability of
-- the caller, does its arithmetic in one statement block and writes its own
-- audit entry. The application has no INSERT rights on any of the tables below;
-- this file is the only door.
--
-- The group functions this replaces asked "which group is due today?". These
-- ask "what does this member's savings category expect of them, and by when?" -
-- which is the same question about one person instead of twenty-five.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Capabilities.
--
-- `can_manage_groups()` was dropped with the group tables. Its successor guards
-- the category register and the waiver: both are management decisions about
-- what the SACCO expects of its members.
--
-- `can_record_savings()` and `can_view_operations()` are re-stated here only
-- because 0021 renamed the `group_officer` enum value; the bodies had that
-- label written into them, and a renamed value in an old body is a runtime
-- error rather than a silent no-op.
-- ---------------------------------------------------------------------------
create or replace function can_manage_categories()
returns boolean language sql stable security definer set search_path = public as $$
  select has_role('super_admin', 'manager');
$$;

create or replace function can_record_savings()
returns boolean language sql stable security definer set search_path = public as $$
  select has_role('super_admin', 'manager', 'cashier', 'field_officer');
$$;

create or replace function can_view_operations()
returns boolean language sql stable security definer set search_path = public as $$
  select has_role('super_admin', 'manager', 'loan_officer', 'cashier',
                  'accountant', 'field_officer', 'viewer');
$$;

-- ---------------------------------------------------------------------------
-- Schedule arithmetic.
--
-- The whole point of the category model: the frequency is data. A Silver Saver
-- on UGX 5,000 weekly and a Diamond Saver on UGX 100,000 monthly run identical
-- code with different rows.
--
-- A savings period is due at its own end - the Sunday that closes the week, the
-- last day of the month. Nothing is hard-coded to a date, and moving a member
-- between categories changes when they are next due with no code change.
-- ---------------------------------------------------------------------------
create or replace function savings_due_date(p_kind savings_kind, p_on date)
returns date language sql immutable as $$
  select period_end from savings_period_bounds(p_kind, p_on);
$$;

/**
 * The savings category a member saves under, or null if they have not been
 * given one. Only active categories drive new expectations: deactivating a
 * category stops it raising further schedules without touching the history.
 */
create or replace function member_savings_category(p_member_id uuid)
returns savings_categories
language sql stable security definer set search_path = public as $$
  select c.* from members m
    join savings_categories c on c.id = m.savings_category_id
   where m.id = p_member_id and c.status = 'active';
$$;

/**
 * The date a member's next contribution falls due, given where they are now.
 *
 * The next unsettled schedule if one exists, otherwise the end of the period
 * containing `p_on`. Computed, never stored, so it is right the morning after
 * a cycle closes without anything having to run overnight.
 */
create or replace function next_savings_due_date(
  p_member_id uuid,
  p_on        date default current_date
) returns date
language plpgsql stable security definer set search_path = public as $$
declare
  v_cat  savings_categories;
  v_next date;
begin
  select coalesce(s.due_on, s.period_end) into v_next
    from savings_periods s
   where s.member_id = p_member_id
     and s.status in ('pending', 'partial')
   order by coalesce(s.due_on, s.period_end)
   limit 1;

  if v_next is not null then
    return v_next;
  end if;

  v_cat := member_savings_category(p_member_id);
  if v_cat.id is null then
    return null;
  end if;

  return savings_due_date(v_cat.frequency, p_on);
end;
$$;

-- ---------------------------------------------------------------------------
-- ensure_savings_period - now category-aware.
--
-- Replaces the 0009 group-aware version. The expectation on a new period comes
-- from the member's own savings plan if one has been set for them, and from
-- their savings category otherwise. A member with neither gets a period with an
-- expectation of zero rather than an invented target: the SACCO has not agreed
-- an amount with them, and printing one on their statement would be a claim
-- nobody made.
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
  v_target numeric(16,2);
  v_cat    savings_categories;
  v_due    date;
begin
  select * into v_b from savings_period_bounds(p_kind, p_on);
  v_cat := member_savings_category(p_member_id);
  v_due := v_b.period_end;

  select * into v_period from savings_periods
   where member_id = p_member_id and kind = p_kind and period_start = v_b.period_start
   for update;

  if found then
    -- Backfill the category linkage for rows raised before the member was
    -- given one, so the analytics can see them.
    if v_period.savings_category_id is null and v_cat.id is not null
       and v_cat.frequency = p_kind then
      update savings_periods
         set savings_category_id = v_cat.id,
             due_on = coalesce(due_on, v_due)
       where id = v_period.id
      returning * into v_period;
    end if;
    return v_period;
  end if;

  select target_amount into v_target
    from savings_plans
   where member_id = p_member_id and kind = p_kind
     and active_from <= p_on and (active_to is null or active_to >= p_on)
   order by active_from desc
   limit 1;

  -- With no personal plan, the category the member chose applies - but only
  -- when it collects on this cadence. A monthly Gold Saver has no weekly
  -- expectation, and giving them one would put them in arrears for a week the
  -- SACCO never asked them to save.
  if v_target is null and v_cat.id is not null and v_cat.frequency = p_kind then
    v_target := v_cat.amount;
  end if;

  insert into savings_periods (member_id, kind, period_start, period_end,
                               period_label, expected_amount, status,
                               savings_category_id, due_on)
  values (p_member_id, p_kind, v_b.period_start, v_b.period_end,
          v_b.period_label, coalesce(v_target, 0), 'pending',
          case when v_cat.frequency = p_kind then v_cat.id else null end, v_due)
  on conflict (member_id, kind, period_start) do update
    set period_label = excluded.period_label
  returning * into v_period;

  return v_period;
end;
$$;

revoke all on function ensure_savings_period(uuid, savings_kind, date) from public;

/**
 * Raise the schedule a single member owes for the period containing `p_on`,
 * on the cadence of their own savings category.
 */
create or replace function ensure_member_schedule(
  p_member_id uuid,
  p_on        date default current_date
) returns savings_periods
language plpgsql
security definer
set search_path = public
as $$
declare v_cat savings_categories;
begin
  v_cat := member_savings_category(p_member_id);
  if v_cat.id is null then
    return null;
  end if;
  return ensure_savings_period(p_member_id, v_cat.frequency, p_on);
end;
$$;

-- ---------------------------------------------------------------------------
-- Opening the schedules for a date.
--
-- This is what turns a member who pays nothing into a measurable 'missed'
-- schedule instead of a silent absence of a row. Running it twice on the same
-- day is a no-op, because `ensure_savings_period()` upserts.
--
-- It walks active members who have a savings category. A member without one is
-- skipped, not defaulted: they appear on the "no savings category" list on the
-- dashboard, which is a problem for a person to fix rather than for the
-- database to paper over.
-- ---------------------------------------------------------------------------
create or replace function open_savings_schedules(p_on date default current_date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_m         record;
  v_count     integer := 0;
  v_weekly    integer := 0;
  v_monthly   integer := 0;
  v_uncategorised integer;
begin
  perform assert_capability(can_record_savings(), 'open savings schedules');

  for v_m in
    select m.id, c.frequency
      from members m
      join savings_categories c on c.id = m.savings_category_id
     where m.status = 'active' and c.status = 'active'
     order by m.full_name
  loop
    perform ensure_savings_period(v_m.id, v_m.frequency, p_on);
    v_count := v_count + 1;
    if v_m.frequency = 'weekly' then v_weekly := v_weekly + 1;
    else v_monthly := v_monthly + 1;
    end if;
  end loop;

  select count(*) into v_uncategorised
    from members m
   where m.status = 'active' and m.savings_category_id is null;

  if v_count > 0 then
    perform write_audit('savings.schedules_opened', 'Savings', null,
      format('%s savings schedule(s) opened for %s', v_count,
             to_char(p_on, 'DD Mon YYYY')),
      null, null, null);
  end if;

  return jsonb_build_object(
    'date',          p_on,
    'schedules',     v_count,
    'weekly',        v_weekly,
    'monthly',       v_monthly,
    'uncategorised', v_uncategorised
  );
end;
$$;

/**
 * The 0006 entry point, kept so the "open this period" control keeps working.
 * It now opens one cadence at a time, for the members who actually save on it.
 */
create or replace function open_savings_periods(p_kind savings_kind, p_on date default current_date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_m     record;
begin
  perform assert_capability(can_record_savings(), 'open savings periods');

  for v_m in
    select m.id from members m
      join savings_categories c on c.id = m.savings_category_id
     where m.status = 'active' and c.status = 'active' and c.frequency = p_kind
  loop
    perform ensure_savings_period(v_m.id, p_kind, p_on);
    v_count := v_count + 1;
  end loop;

  perform write_audit('savings.periods_opened', 'Savings', null,
    format('Opened %s %s savings period(s) for %s', v_count, p_kind,
           to_char(p_on, 'DD Mon YYYY')),
    null, null, null);

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Payment intents - the Phase Two seam, used for real in Phase One.
--
-- A manual collection opens an intent and settles it in the same statement,
-- because the cashier holding the cash is the confirmation. Nothing here calls
-- a gateway or fabricates a provider response. When MTN or Airtel is added in
-- Phase Two, a callback moves the same row pending -> successful and calls the
-- same settlement, and the savings, ledger and audit code does not change.
-- ---------------------------------------------------------------------------
create or replace function settle_manual_payment(
  p_member_id      uuid,
  p_purpose        txn_type,
  p_amount         numeric,
  p_method         payment_method,
  p_schedule_id    uuid,
  p_loan_id        uuid,
  p_transaction_id uuid,
  p_external_ref   text,
  p_idempotency_key text
) returns payment_intents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intent payment_intents;
begin
  select * into v_intent from payment_intents where transaction_id = p_transaction_id;
  if found then
    return v_intent;
  end if;

  insert into payment_intents (
    reference, member_id, purpose, amount, provider, method, state,
    provider_ref, schedule_id, loan_id, transaction_id, idempotency_key,
    initiated_by, settled_at
  ) values (
    next_document_no('PAY'), p_member_id, p_purpose, p_amount,
    'manual', p_method, 'successful',
    p_external_ref, p_schedule_id, p_loan_id, p_transaction_id,
    p_idempotency_key, auth.uid(), now()
  )
  returning * into v_intent;

  return v_intent;
end;
$$;

revoke all on function settle_manual_payment(uuid, txn_type, numeric, payment_method,
                                             uuid, uuid, uuid, text, text) from public;

-- ---------------------------------------------------------------------------
-- Recording a collection against one schedule.
--
-- The centralised collection screen calls exactly this, once per member.
-- Everything section 8 of the brief asks for happens inside a single database
-- transaction:
--
--   * the amount is validated
--   * the external reference is unique, so the same mobile-money transfer
--     cannot be banked twice
--   * the idempotency key makes a double tap a no-op
--   * one immutable ledger row is written
--   * the schedule is recomputed from the payment rows, never incremented
--   * the audit entry names who recorded what, for whom
--
-- Sections 9, 10 and 11 - Mary paying 5,000 of 5,000, John paying 30,000 of
-- 50,000, Peter paying 100,000 of 100,000 - are the three branches of the
-- status expression below, not three special cases.
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
  v_cat     text;
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
    raise exception 'That savings schedule no longer exists.' using errcode = 'no_data_found';
  end if;

  if v_sched.status = 'waived' then
    raise exception 'This schedule has been waived. Remove the waiver before recording a payment.'
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

  -- Same external reference, different transaction: refuse before posting so
  -- the message names the problem rather than leaking a constraint.
  if v_ref is not null and exists (
    select 1 from transactions
     where upper(external_ref) = upper(v_ref) and status <> 'reversed'
  ) then
    raise exception 'Reference % has already been recorded against another transaction.', v_ref
      using errcode = 'unique_violation';
  end if;

  select name into v_cat from savings_categories where id = v_sched.savings_category_id;

  v_txn := post_transaction(
    v_sched.member_id,
    case when v_sched.kind = 'weekly' then 'weekly_savings'::txn_type
         else 'monthly_savings'::txn_type end,
    p_amount, p_method, p_paid_on,
    coalesce(v_cat, initcap(v_sched.kind::text) || ' savings')
      || ' - ' || v_sched.period_label,
    p_idempotency_key
  );

  select * into v_payment from savings_payments where transaction_id = v_txn.id;

  if not found then
    if v_ref is not null then
      update transactions set external_ref = v_ref where id = v_txn.id;
    end if;

    insert into savings_payments (period_id, schedule_id, member_id, savings_category_id,
                                  amount, paid_on, method, transaction_id,
                                  external_ref, note, recorded_by)
    values (v_sched.id, v_sched.id, v_sched.member_id, v_sched.savings_category_id,
            p_amount, p_paid_on, p_method, v_txn.id, v_ref,
            nullif(trim(coalesce(p_note, '')), ''), auth.uid())
    returning * into v_payment;

    update transactions set savings_id = v_payment.id where id = v_txn.id;

    -- Recomputed from the payment rows. Never an incremented column.
    select coalesce(sum(sp.amount), 0) into v_paid
      from savings_payments sp
      join transactions t on t.id = sp.transaction_id
     where sp.period_id = v_sched.id and t.status = 'posted';

    v_status := case
      when v_sched.expected_amount > 0 and v_paid >= v_sched.expected_amount then 'paid'
      when v_paid > 0 then 'partial'
      else 'pending'
    end;
    if v_sched.expected_amount = 0 and v_paid > 0 then
      v_status := 'paid';
    end if;

    update savings_periods set paid_amount = v_paid, status = v_status where id = v_sched.id;

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
    'member_id',      v_sched.member_id,
    'member_name',    v_member.full_name,
    'savings_category', v_cat,
    'period_label',   v_sched.period_label,
    'expected',       v_sched.expected_amount,
    'paid',           v_paid,
    'outstanding',    greatest(v_sched.expected_amount - v_paid, 0),
    'status',         v_status
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- The ad-hoc entry: record savings for a member without picking a schedule
-- first. It finds or raises the right period and then does exactly what the
-- collection screen does.
--
-- Re-stated from 0011 because that version stamped a group onto the payment
-- intent.
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
  v_period  savings_periods;
  v_member  members;
  v_res     jsonb;
begin
  perform assert_capability(can_record_savings(), 'record savings');

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

  v_period := ensure_savings_period(p_member_id, p_kind, coalesce(p_paid_on, current_date));

  if v_period.status = 'waived' then
    raise exception 'This period has been waived. Remove the waiver before recording a payment.'
      using errcode = 'check_violation';
  end if;

  -- One collection path, so the two entry points cannot drift apart.
  v_res := record_scheduled_savings(v_period.id, p_amount, coalesce(p_paid_on, current_date),
                                    p_method, null, null, p_idempotency_key);

  return v_res || jsonb_build_object(
    'period_id', v_period.id,
    'balance',   v_res -> 'outstanding'
  );
end;
$$;

/**
 * Forgive one schedule.
 *
 * Only while nothing has been paid against it, and only with a reason: a waiver
 * writes off an expectation, so it is a management decision that has to be
 * attributable. The row stays visible, marked 'waived', for ever.
 */
create or replace function waive_savings_schedule(p_schedule_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sched savings_periods;
  v_old   jsonb;
  v_name  text;
begin
  perform assert_capability(can_manage_categories(), 'waive a savings schedule');

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
$$;

-- ===========================================================================
-- CATEGORY ADMINISTRATION - section 16
--
-- Required shares, share price, qualification window, savings amount and
-- frequency are all editable, because the SACCO said they may change. Editing
-- them changes what is expected from here on; it never rewrites a schedule
-- already raised, and never touches a payment already banked.
-- ===========================================================================

create or replace function create_share_category(
  p_name            text,
  p_required_shares integer,
  p_share_price     numeric,
  p_qualification_months integer default null,
  p_description     text default null,
  p_code            text default null,
  p_sort_order      integer default 100
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cat  share_categories;
  v_code text;
begin
  perform assert_capability(can_manage_categories(), 'create share categories');

  if coalesce(trim(p_name), '') = '' then
    raise exception 'Enter a name for the share category.' using errcode = 'check_violation';
  end if;
  if p_required_shares is null or p_required_shares < 1 then
    raise exception 'A share category must require at least one share.'
      using errcode = 'check_violation';
  end if;
  if p_share_price is null or p_share_price <= 0 then
    raise exception 'Enter the price of one share.' using errcode = 'check_violation';
  end if;

  -- A code is how reports and imports refer to the category, so it is derived
  -- from the name when nobody supplies one rather than left blank.
  v_code := upper(regexp_replace(coalesce(nullif(trim(p_code), ''), trim(p_name)),
                                 '[^A-Za-z0-9]+', '_', 'g'));
  v_code := regexp_replace(v_code, '^_+|_+$', '', 'g');

  insert into share_categories (code, name, required_shares, share_price,
                                qualification_months, description, sort_order, created_by)
  values (v_code, trim(p_name), p_required_shares, p_share_price,
          p_qualification_months, nullif(trim(coalesce(p_description, '')), ''),
          coalesce(p_sort_order, 100), auth.uid())
  returning * into v_cat;

  perform write_audit('share_category.created', 'Categories', v_cat.id::text,
    format('Share category %s created - %s shares at UGX %s (UGX %s)',
           v_cat.name, v_cat.required_shares,
           to_char(v_cat.share_price, 'FM999,999,999'),
           to_char(v_cat.required_amount, 'FM999,999,999')),
    null, to_jsonb(v_cat), null);

  return jsonb_build_object('id', v_cat.id, 'code', v_cat.code, 'name', v_cat.name);
end;
$$;

create or replace function update_share_category(
  p_id              uuid,
  p_name            text,
  p_required_shares integer,
  p_share_price     numeric,
  p_qualification_months integer default null,
  p_description     text default null,
  p_sort_order      integer default 100
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old share_categories;
  v_cat share_categories;
begin
  perform assert_capability(can_manage_categories(), 'edit share categories');

  select * into v_old from share_categories where id = p_id for update;
  if not found then
    raise exception 'Share category not found.' using errcode = 'no_data_found';
  end if;
  if p_required_shares is null or p_required_shares < 1 then
    raise exception 'A share category must require at least one share.'
      using errcode = 'check_violation';
  end if;
  if p_share_price is null or p_share_price <= 0 then
    raise exception 'Enter the price of one share.' using errcode = 'check_violation';
  end if;

  update share_categories
     set name                 = trim(p_name),
         required_shares      = p_required_shares,
         share_price          = p_share_price,
         qualification_months = p_qualification_months,
         description          = nullif(trim(coalesce(p_description, '')), ''),
         sort_order           = coalesce(p_sort_order, 100)
   where id = p_id
  returning * into v_cat;

  perform write_audit('share_category.updated', 'Categories', p_id::text,
    format('Share category %s updated - %s shares at UGX %s (UGX %s)',
           v_cat.name, v_cat.required_shares,
           to_char(v_cat.share_price, 'FM999,999,999'),
           to_char(v_cat.required_amount, 'FM999,999,999')),
    to_jsonb(v_old), to_jsonb(v_cat), null);

  return jsonb_build_object('id', v_cat.id, 'code', v_cat.code, 'name', v_cat.name);
end;
$$;

create or replace function set_share_category_status(
  p_id     uuid,
  p_status category_status,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old     share_categories;
  v_cat     share_categories;
  v_members integer;
begin
  perform assert_capability(can_manage_categories(), 'change the status of a share category');

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Give a reason - this is recorded in the audit log.'
      using errcode = 'check_violation';
  end if;

  select * into v_old from share_categories where id = p_id for update;
  if not found then
    raise exception 'Share category not found.' using errcode = 'no_data_found';
  end if;

  select count(*) into v_members
    from members where share_category_id = p_id and status = 'active';

  update share_categories set status = p_status where id = p_id returning * into v_cat;

  perform write_audit('share_category.status_changed', 'Categories', p_id::text,
    format('Share category %s marked %s (%s active member(s) hold it)',
           v_cat.name, p_status, v_members),
    to_jsonb(v_old), to_jsonb(v_cat), p_reason);

  return jsonb_build_object('id', p_id, 'status', v_cat.status, 'members', v_members);
end;
$$;

create or replace function create_savings_category(
  p_name        text,
  p_amount      numeric,
  p_frequency   savings_kind,
  p_description text default null,
  p_code        text default null,
  p_sort_order  integer default 100
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cat  savings_categories;
  v_code text;
begin
  perform assert_capability(can_manage_categories(), 'create savings categories');

  if coalesce(trim(p_name), '') = '' then
    raise exception 'Enter a name for the savings category.' using errcode = 'check_violation';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter the amount members in this category save.'
      using errcode = 'check_violation';
  end if;

  v_code := upper(regexp_replace(coalesce(nullif(trim(p_code), ''), trim(p_name)),
                                 '[^A-Za-z0-9]+', '_', 'g'));
  v_code := regexp_replace(v_code, '^_+|_+$', '', 'g');

  insert into savings_categories (code, name, amount, frequency, description,
                                  sort_order, created_by)
  values (v_code, trim(p_name), p_amount, p_frequency,
          nullif(trim(coalesce(p_description, '')), ''),
          coalesce(p_sort_order, 100), auth.uid())
  returning * into v_cat;

  perform write_audit('savings_category.created', 'Categories', v_cat.id::text,
    format('Savings category %s created - UGX %s %s', v_cat.name,
           to_char(v_cat.amount, 'FM999,999,999'), v_cat.frequency),
    null, to_jsonb(v_cat), null);

  return jsonb_build_object('id', v_cat.id, 'code', v_cat.code, 'name', v_cat.name);
end;
$$;

create or replace function update_savings_category(
  p_id          uuid,
  p_name        text,
  p_amount      numeric,
  p_frequency   savings_kind,
  p_description text default null,
  p_sort_order  integer default 100
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old savings_categories;
  v_cat savings_categories;
begin
  perform assert_capability(can_manage_categories(), 'edit savings categories');

  select * into v_old from savings_categories where id = p_id for update;
  if not found then
    raise exception 'Savings category not found.' using errcode = 'no_data_found';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter the amount members in this category save.'
      using errcode = 'check_violation';
  end if;

  update savings_categories
     set name        = trim(p_name),
         amount      = p_amount,
         frequency   = p_frequency,
         description = nullif(trim(coalesce(p_description, '')), ''),
         sort_order  = coalesce(p_sort_order, 100)
   where id = p_id
  returning * into v_cat;

  perform write_audit('savings_category.updated', 'Categories', p_id::text,
    format('Savings category %s updated - UGX %s %s', v_cat.name,
           to_char(v_cat.amount, 'FM999,999,999'), v_cat.frequency),
    to_jsonb(v_old), to_jsonb(v_cat), null);

  return jsonb_build_object('id', v_cat.id, 'code', v_cat.code, 'name', v_cat.name);
end;
$$;

create or replace function set_savings_category_status(
  p_id     uuid,
  p_status category_status,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old     savings_categories;
  v_cat     savings_categories;
  v_members integer;
begin
  perform assert_capability(can_manage_categories(), 'change the status of a savings category');

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Give a reason - this is recorded in the audit log.'
      using errcode = 'check_violation';
  end if;

  select * into v_old from savings_categories where id = p_id for update;
  if not found then
    raise exception 'Savings category not found.' using errcode = 'no_data_found';
  end if;

  select count(*) into v_members
    from members where savings_category_id = p_id and status = 'active';

  -- Deactivating a category members are still saving under would stop their
  -- schedules being raised without anybody noticing until they fell into
  -- arrears. Say so, and make moving them the explicit step.
  if p_status = 'inactive' and v_members > 0 then
    raise exception 'Move the % active member(s) saving under % to another category before deactivating it.',
      v_members, v_old.name using errcode = 'check_violation';
  end if;

  update savings_categories set status = p_status where id = p_id returning * into v_cat;

  perform write_audit('savings_category.status_changed', 'Categories', p_id::text,
    format('Savings category %s marked %s', v_cat.name, p_status),
    to_jsonb(v_old), to_jsonb(v_cat), p_reason);

  return jsonb_build_object('id', p_id, 'status', v_cat.status, 'members', v_members);
end;
$$;

/**
 * Give a member their share and savings categories, or change them.
 *
 * The two are independent by default - the brief's own example is a Gold
 * shareholder saving at the Diamond rate - and become linked only if the SACCO
 * turns on `categories.share_matches_savings`.
 *
 * Changing the savings category re-prices only schedules that are still
 * pending, unpaid and not yet due. A week already collected keeps the amount it
 * was actually judged against; rewriting history to match a new category would
 * make last month's collection sheet disagree with last month's receipts.
 */
create or replace function set_member_categories(
  p_member_id           uuid,
  p_share_category_id   uuid,
  p_savings_category_id uuid,
  p_reason              text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member  members;
  v_share   share_categories;
  v_savings savings_categories;
  v_old_share text;
  v_old_savings text;
  v_repriced integer := 0;
begin
  perform assert_capability(has_role('super_admin', 'manager'), 'set member categories');

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
$$;

-- ---------------------------------------------------------------------------
-- The last group-shaped thing in the database.
--
-- Dropped here, at the end, because `waive_savings_schedule` above has just
-- been redefined to ask `can_manage_categories()` instead. Leaving it behind
-- would be a live predicate nothing consults - exactly the kind of dead
-- reference this work exists to remove.
-- ---------------------------------------------------------------------------
drop function if exists can_manage_groups();
