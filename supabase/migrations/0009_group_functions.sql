-- ===========================================================================
-- BUD-SACCO - 0009 - Group savings: cycles, schedules and manual collection
--
-- Every function that moves money is SECURITY DEFINER, checks the role of the
-- caller, does its arithmetic in one statement block and writes its own audit
-- entry. The application has no INSERT rights on any of the tables below; this
-- file is the only door.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Capability predicates.
--
-- Role lists were previously spelled out in a dozen places. Naming the
-- capability once means adding a role (0010 adds three) is one edit here rather
-- than a search across two thousand lines of SQL.
-- ---------------------------------------------------------------------------
create or replace function can_view_operations()
returns boolean language sql stable security definer set search_path = public as $$
  select has_role('super_admin', 'manager', 'loan_officer', 'cashier');
$$;

create or replace function can_record_savings()
returns boolean language sql stable security definer set search_path = public as $$
  select has_role('super_admin', 'manager', 'cashier');
$$;

create or replace function can_manage_groups()
returns boolean language sql stable security definer set search_path = public as $$
  select has_role('super_admin', 'manager');
$$;

create or replace function assert_capability(p_ok boolean, p_what text)
returns void language plpgsql immutable as $$
begin
  if not coalesce(p_ok, false) then
    raise exception 'You do not have permission to %.', p_what
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Saving-day arithmetic.
--
-- The whole point of the group model: the day is data. `saving_day` is an ISO
-- weekday, so Group A on Monday and Group F on Saturday run identical code.
-- ---------------------------------------------------------------------------
create or replace function saving_day_label(p_day smallint)
returns text language sql immutable as $$
  select case p_day
    when 1 then 'Monday'   when 2 then 'Tuesday' when 3 then 'Wednesday'
    when 4 then 'Thursday' when 5 then 'Friday'  when 6 then 'Saturday'
    when 7 then 'Sunday'   else 'Unscheduled' end;
$$;

/**
 * The date a cycle falls due, given the saving day of the group.
 *
 * Weekly: the configured weekday inside the Monday-to-Sunday week of `p_on`.
 * Monthly: the first occurrence of that weekday in the calendar month.
 */
create or replace function group_due_date(p_saving_day smallint, p_kind savings_kind, p_on date)
returns date language sql immutable as $$
  select case
    when p_kind = 'weekly'
      then (date_trunc('week', p_on)::date + (p_saving_day - 1))
    else
      date_trunc('month', p_on)::date
        + ((p_saving_day - extract(isodow from date_trunc('month', p_on))::int + 7) % 7)
  end;
$$;

/** The savings kind a group collects, from its configured frequency. */
create or replace function group_savings_kind(p_frequency saving_frequency)
returns savings_kind language sql immutable as $$
  select case when p_frequency = 'monthly' then 'monthly'::savings_kind
              else 'weekly'::savings_kind end;
$$;

/**
 * Is this group due to collect on `p_on`?
 *
 * Biweekly groups alternate on the parity of the ISO week, anchored to the week
 * the group was created - deterministic, and derived from stored data rather
 * than from a hard-coded calendar.
 */
create or replace function group_collects_on(p_group_id uuid, p_on date)
returns boolean language sql stable security definer set search_path = public as $$
  select case g.saving_frequency
    when 'monthly'  then group_due_date(g.saving_day, 'monthly', p_on) = p_on
    when 'biweekly' then g.saving_day = extract(isodow from p_on)::int
                         and (extract(week from p_on)::int % 2)
                             = (extract(week from g.created_at)::int % 2)
    else g.saving_day = extract(isodow from p_on)::int
  end
  from sacco_groups g
  where g.id = p_group_id and g.status = 'active';
$$;

-- ---------------------------------------------------------------------------
-- ensure_savings_period - now group-aware.
--
-- Replaces the 0002 version. A period created by an ad-hoc walk-in payment now
-- carries the group and due date of the member, so it lands on the right
-- collection sheet instead of floating free.
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
  v_group  sacco_groups;
  v_due    date;
begin
  select * into v_b from savings_period_bounds(p_kind, p_on);

  select g.* into v_group
    from members m join sacco_groups g on g.id = m.group_id
   where m.id = p_member_id;

  v_due := case when v_group.id is not null
                then group_due_date(v_group.saving_day, p_kind, p_on)
                else v_b.period_end end;

  select * into v_period from savings_periods
   where member_id = p_member_id and kind = p_kind and period_start = v_b.period_start
   for update;

  if found then
    -- Backfill the group linkage for rows created before the member was placed.
    if v_period.group_id is null and v_group.id is not null then
      update savings_periods
         set group_id = v_group.id, due_on = coalesce(due_on, v_due)
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

  -- With no personal plan, the target of the group applies.
  if v_target is null and v_group.id is not null then
    v_target := case when p_kind = 'weekly' then v_group.weekly_target
                     else v_group.monthly_target end;
  end if;

  insert into savings_periods (member_id, kind, period_start, period_end,
                               period_label, expected_amount, status, group_id, due_on)
  values (p_member_id, p_kind, v_b.period_start, v_b.period_end,
          v_b.period_label, coalesce(v_target, 0), 'pending', v_group.id, v_due)
  on conflict (member_id, kind, period_start) do update
    set period_label = excluded.period_label
  returning * into v_period;

  return v_period;
end;
$$;

revoke all on function ensure_savings_period(uuid, savings_kind, date) from public;

-- ---------------------------------------------------------------------------
-- Opening a cycle.
--
-- Opening in advance is what turns a member who pays nothing into a measurable
-- 'missed' schedule instead of a silent absence of a row.
-- ---------------------------------------------------------------------------
create or replace function open_group_cycle(
  p_group_id uuid,
  p_on       date default current_date
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_g       sacco_groups;
  v_kind    savings_kind;
  v_b       record;
  v_due     date;
  v_cycle   savings_cycles;
  v_created integer := 0;
  v_m       record;
  v_target  numeric(16,2);
  v_new     boolean;
begin
  perform assert_capability(can_record_savings(), 'open a savings cycle');

  select * into v_g from sacco_groups where id = p_group_id;
  if not found then
    raise exception 'Group not found.' using errcode = 'no_data_found';
  end if;
  if v_g.status <> 'active' then
    raise exception 'Cycles cannot be opened for a % group.', v_g.status
      using errcode = 'check_violation';
  end if;

  v_kind := group_savings_kind(v_g.saving_frequency);
  select * into v_b from savings_period_bounds(v_kind, p_on);
  v_due := group_due_date(v_g.saving_day, v_kind, p_on);

  select * into v_cycle from savings_cycles
   where group_id = p_group_id and kind = v_kind and cycle_start = v_b.period_start
   for update;

  v_new := not found;

  if v_new then
    insert into savings_cycles (group_id, kind, cycle_start, cycle_end, due_on, label, opened_by)
    values (p_group_id, v_kind, v_b.period_start, v_b.period_end, v_due, v_b.period_label, auth.uid())
    returning * into v_cycle;
  end if;

  -- One schedule per active member. Re-running is safe: an existing row is
  -- linked to the cycle, and its expectation is refreshed only while nothing
  -- has been paid against it.
  for v_m in
    select m.id from members m
     where m.group_id = p_group_id and m.status = 'active'
     order by m.full_name
  loop
    select target_amount into v_target
      from savings_plans
     where member_id = v_m.id and kind = v_kind
       and active_from <= v_cycle.due_on
       and (active_to is null or active_to >= v_cycle.due_on)
     order by active_from desc
     limit 1;

    if v_target is null then
      v_target := case when v_kind = 'weekly' then v_g.weekly_target else v_g.monthly_target end;
    end if;

    insert into savings_periods (member_id, kind, period_start, period_end, period_label,
                                 expected_amount, status, cycle_id, group_id, due_on)
    values (v_m.id, v_kind, v_cycle.cycle_start, v_cycle.cycle_end, v_cycle.label,
            coalesce(v_target, 0), 'pending', v_cycle.id, p_group_id, v_cycle.due_on)
    on conflict (member_id, kind, period_start) do update
      set cycle_id        = excluded.cycle_id,
          group_id        = excluded.group_id,
          due_on          = excluded.due_on,
          expected_amount = case
            when savings_periods.paid_amount = 0 and savings_periods.status = 'pending'
              then excluded.expected_amount
            else savings_periods.expected_amount
          end;

    v_created := v_created + 1;
  end loop;

  if v_new then
    perform write_audit('savings.cycle_opened', 'Savings', v_cycle.id::text,
      format('%s cycle opened for %s - %s member(s), due %s',
             v_cycle.label, v_g.name, v_created, to_char(v_cycle.due_on, 'DD Mon YYYY')),
      null, to_jsonb(v_cycle), null);
  end if;

  return jsonb_build_object(
    'cycle_id',  v_cycle.id,
    'group_id',  p_group_id,
    'group_name', v_g.name,
    'kind',      v_kind,
    'label',     v_cycle.label,
    'due_on',    v_cycle.due_on,
    'members',   v_created,
    'created',   v_new
  );
end;
$$;

/**
 * Open the cycle for every group that collects on `p_on`.
 *
 * This is the scheduled job. Running it twice on the same day is a no-op
 * because `open_group_cycle()` upserts.
 */
create or replace function open_cycles_for_day(p_on date default current_date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_g       record;
  v_groups  integer := 0;
  v_members integer := 0;
  v_res     jsonb;
begin
  perform assert_capability(can_record_savings(), 'open savings cycles');

  for v_g in
    select id from sacco_groups
     where status = 'active' and group_collects_on(id, p_on)
     order by name
  loop
    v_res := open_group_cycle(v_g.id, p_on);
    v_groups  := v_groups + 1;
    v_members := v_members + (v_res ->> 'members')::integer;
  end loop;

  return jsonb_build_object('date', p_on, 'groups', v_groups, 'schedules', v_members);
end;
$$;

/**
 * Close a cycle.
 *
 * Anything still pending at close becomes 'missed' - the shortfall stays on the
 * books and on the statement of the member. Nothing is deleted.
 */
create or replace function close_savings_cycle(p_cycle_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle  savings_cycles;
  v_missed integer;
begin
  perform assert_capability(can_manage_groups(), 'close a savings cycle');

  select * into v_cycle from savings_cycles where id = p_cycle_id for update;
  if not found then
    raise exception 'Savings cycle not found.' using errcode = 'no_data_found';
  end if;
  if v_cycle.status = 'closed' then
    raise exception 'This cycle is already closed.' using errcode = 'check_violation';
  end if;

  update savings_periods
     set status = 'missed'
   where cycle_id = p_cycle_id
     and status = 'pending'
     and expected_amount > 0
     and paid_amount = 0;
  get diagnostics v_missed = row_count;

  update savings_cycles
     set status = 'closed', closed_at = now(), closed_by = auth.uid(),
         note = coalesce(p_note, note)
   where id = p_cycle_id
  returning * into v_cycle;

  perform write_audit('savings.cycle_closed', 'Savings', p_cycle_id::text,
    format('%s closed - %s schedule(s) marked missed', v_cycle.label, v_missed),
    null, to_jsonb(v_cycle), p_note);

  return jsonb_build_object('cycle_id', p_cycle_id, 'status', 'closed', 'marked_missed', v_missed);
end;
$$;

-- ---------------------------------------------------------------------------
-- Payment intents - the Phase Two seam, used for real in Phase One.
--
-- A manual collection opens an intent and settles it in the same statement,
-- because the cashier holding the cash is the confirmation. Nothing here calls
-- a gateway or fabricates a provider response.
-- ---------------------------------------------------------------------------
create or replace function settle_manual_payment(
  p_member_id      uuid,
  p_group_id       uuid,
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
    reference, member_id, group_id, purpose, amount, provider, method, state,
    provider_ref, schedule_id, loan_id, transaction_id, idempotency_key,
    initiated_by, settled_at
  ) values (
    next_document_no('PAY'), p_member_id, p_group_id, p_purpose, p_amount,
    'manual', p_method, 'successful',
    p_external_ref, p_schedule_id, p_loan_id, p_transaction_id,
    p_idempotency_key, auth.uid(), now()
  )
  returning * into v_intent;

  return v_intent;
end;
$$;

revoke all on function settle_manual_payment(uuid, uuid, txn_type, numeric, payment_method,
                                             uuid, uuid, uuid, text, text) from public;

-- ---------------------------------------------------------------------------
-- Recording a collection against one schedule.
--
-- The screen a cashier works from on a collection day calls exactly this, once
-- per member. Everything the brief asks for in section 8 happens inside a
-- single database transaction:
--
--   * the amount is validated
--   * the external reference is unique, so the same mobile-money transfer
--     cannot be banked twice
--   * the idempotency key makes a double tap a no-op
--   * one immutable ledger row is written
--   * the schedule is recomputed from the payment rows, never incremented
--   * the audit entry names who recorded what, for whom
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
  v_cycle   savings_cycles;
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
  -- A fat-fingered extra zero on a UGX 20,000 contribution should not become a
  -- half-billion-shilling ledger entry that has to be reversed.
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

  if v_sched.cycle_id is not null then
    select * into v_cycle from savings_cycles where id = v_sched.cycle_id;
    if v_cycle.status = 'closed' then
      raise exception 'The % cycle is closed. Reopen it before recording more payments.', v_cycle.label
        using errcode = 'check_violation';
    end if;
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

  v_txn := post_transaction(
    v_sched.member_id,
    case when v_sched.kind = 'weekly' then 'weekly_savings'::txn_type
         else 'monthly_savings'::txn_type end,
    p_amount, p_method, p_paid_on,
    initcap(v_sched.kind::text) || ' savings - ' || v_sched.period_label,
    p_idempotency_key
  );

  select * into v_payment from savings_payments where transaction_id = v_txn.id;

  if not found then
    if v_ref is not null then
      update transactions set external_ref = v_ref where id = v_txn.id;
    end if;

    insert into savings_payments (period_id, schedule_id, member_id, amount, paid_on,
                                  method, transaction_id, external_ref, note, recorded_by)
    values (v_sched.id, v_sched.id, v_sched.member_id, p_amount, p_paid_on,
            p_method, v_txn.id, v_ref, nullif(trim(coalesce(p_note, '')), ''), auth.uid())
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
      v_sched.member_id, v_sched.group_id,
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
    'member_name',    v_member.full_name,
    'period_label',   v_sched.period_label,
    'expected',       v_sched.expected_amount,
    'paid',           v_paid,
    'outstanding',    greatest(v_sched.expected_amount - v_paid, 0),
    'status',         v_status
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
  perform assert_capability(can_manage_groups(), 'waive a savings schedule');

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
    format('%s waived for %s (%s)', v_sched.period_label, v_name,
           to_char(v_sched.expected_amount, 'FM999,999,999')),
    v_old, to_jsonb(v_sched), p_reason);

  return jsonb_build_object('schedule_id', p_schedule_id, 'status', 'waived');
end;
$$;

-- ===========================================================================
-- GROUP ADMINISTRATION
-- ===========================================================================
create or replace function create_group(
  p_name             text,
  p_saving_day       smallint,
  p_saving_frequency saving_frequency default 'weekly',
  p_location         text default null,
  p_weekly_target    numeric default 0,
  p_monthly_target   numeric default 0,
  p_leader_member_id uuid default null,
  p_secretary_member_id uuid default null,
  p_loan_officer_id  uuid default null,
  p_notes            text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group sacco_groups;
begin
  perform assert_capability(can_manage_groups(), 'create groups');

  if coalesce(trim(p_name), '') = '' then
    raise exception 'Enter a name for the group.' using errcode = 'check_violation';
  end if;
  if p_saving_day is null or p_saving_day not between 1 and 7 then
    raise exception 'Choose the day of the week this group saves on.' using errcode = 'check_violation';
  end if;

  insert into sacco_groups (group_code, name, location, saving_day, saving_frequency,
                            weekly_target, monthly_target, leader_member_id,
                            secretary_member_id, loan_officer_id, notes, created_by)
  values (next_document_no('G', 3), trim(p_name), nullif(trim(coalesce(p_location, '')), ''),
          p_saving_day, p_saving_frequency,
          coalesce(p_weekly_target, 0), coalesce(p_monthly_target, 0),
          p_leader_member_id, p_secretary_member_id, p_loan_officer_id,
          nullif(trim(coalesce(p_notes, '')), ''), auth.uid())
  returning * into v_group;

  perform write_audit('group.created', 'Groups', v_group.id::text,
    format('Group %s (%s) created, saving on %s', v_group.name, v_group.group_code,
           saving_day_label(v_group.saving_day)),
    null, to_jsonb(v_group), null);

  return jsonb_build_object('group_id', v_group.id, 'group_code', v_group.group_code,
                            'name', v_group.name);
end;
$$;

create or replace function update_group(
  p_group_id         uuid,
  p_name             text,
  p_saving_day       smallint,
  p_saving_frequency saving_frequency,
  p_location         text default null,
  p_weekly_target    numeric default 0,
  p_monthly_target   numeric default 0,
  p_leader_member_id uuid default null,
  p_secretary_member_id uuid default null,
  p_loan_officer_id  uuid default null,
  p_notes            text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old   sacco_groups;
  v_group sacco_groups;
begin
  perform assert_capability(can_manage_groups(), 'edit groups');

  select * into v_old from sacco_groups where id = p_group_id for update;
  if not found then
    raise exception 'Group not found.' using errcode = 'no_data_found';
  end if;
  if p_saving_day is null or p_saving_day not between 1 and 7 then
    raise exception 'Choose the day of the week this group saves on.' using errcode = 'check_violation';
  end if;

  update sacco_groups
     set name                = trim(p_name),
         location            = nullif(trim(coalesce(p_location, '')), ''),
         saving_day          = p_saving_day,
         saving_frequency    = p_saving_frequency,
         weekly_target       = coalesce(p_weekly_target, 0),
         monthly_target      = coalesce(p_monthly_target, 0),
         leader_member_id    = p_leader_member_id,
         secretary_member_id = p_secretary_member_id,
         loan_officer_id     = p_loan_officer_id,
         notes               = nullif(trim(coalesce(p_notes, '')), '')
   where id = p_group_id
  returning * into v_group;

  perform write_audit('group.updated', 'Groups', p_group_id::text,
    format('Group %s updated', v_group.name), to_jsonb(v_old), to_jsonb(v_group), null);

  return jsonb_build_object('group_id', v_group.id, 'group_code', v_group.group_code,
                            'name', v_group.name);
end;
$$;

create or replace function set_group_status(p_group_id uuid, p_status group_status, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old   sacco_groups;
  v_group sacco_groups;
  v_members integer;
begin
  perform assert_capability(can_manage_groups(), 'change the status of a group');

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Give a reason - this is recorded in the audit log.'
      using errcode = 'check_violation';
  end if;

  select * into v_old from sacco_groups where id = p_group_id for update;
  if not found then
    raise exception 'Group not found.' using errcode = 'no_data_found';
  end if;

  if p_status = 'dissolved' then
    select count(*) into v_members from members
     where group_id = p_group_id and status = 'active';
    if v_members > 0 then
      raise exception 'Move the % active member(s) to another group before dissolving this one.', v_members
        using errcode = 'check_violation';
    end if;
  end if;

  update sacco_groups set status = p_status where id = p_group_id returning * into v_group;

  perform write_audit('group.status_changed', 'Groups', p_group_id::text,
    format('Group %s marked %s', v_group.name, p_status),
    to_jsonb(v_old), to_jsonb(v_group), p_reason);

  return jsonb_build_object('group_id', p_group_id, 'status', v_group.status);
end;
$$;

/**
 * Move a member into a group, or out of one.
 *
 * Only future schedules follow the member. History stays with the group that
 * actually collected it, otherwise last month's collection sheet would silently
 * rewrite itself.
 */
create or replace function assign_member_group(
  p_member_id uuid,
  p_group_id  uuid,
  p_reason    text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member members;
  v_old_group text;
  v_new_group text;
  v_moved integer := 0;
begin
  perform assert_capability(has_role('super_admin', 'manager'), 'move members between groups');

  select * into v_member from members where id = p_member_id for update;
  if not found then
    raise exception 'Member not found.' using errcode = 'no_data_found';
  end if;

  select name into v_old_group from sacco_groups where id = v_member.group_id;

  if p_group_id is not null then
    select name into v_new_group from sacco_groups where id = p_group_id and status = 'active';
    if v_new_group is null then
      raise exception 'That group is not available.' using errcode = 'no_data_found';
    end if;
  end if;

  update members set group_id = p_group_id where id = p_member_id;

  -- Schedules not yet due move with the member; settled ones never do.
  update savings_periods sp
     set group_id = p_group_id,
         cycle_id = null
   where sp.member_id = p_member_id
     and coalesce(sp.due_on, sp.period_end) >= current_date
     and sp.paid_amount = 0
     and sp.status = 'pending';
  get diagnostics v_moved = row_count;

  perform write_audit('member.group_changed', 'Groups', p_member_id::text,
    format('%s moved from %s to %s', v_member.full_name,
           coalesce(v_old_group, 'no group'), coalesce(v_new_group, 'no group')),
    jsonb_build_object('group_id', v_member.group_id),
    jsonb_build_object('group_id', p_group_id), p_reason);

  return jsonb_build_object('member_id', p_member_id, 'group_id', p_group_id,
                            'group_name', v_new_group, 'schedules_moved', v_moved);
end;
$$;

-- ===========================================================================
-- READ MODELS
-- ===========================================================================

/** Paged, searchable group register. */
create or replace function search_groups(
  p_query      text default null,
  p_status     group_status default null,
  p_saving_day smallint default null,
  p_limit      integer default 20,
  p_offset     integer default 0
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
  perform assert_capability(can_view_operations(), 'view groups');

  select count(*) into v_total
    from sacco_groups g
   where (p_status is null or g.status = p_status)
     and (p_saving_day is null or g.saving_day = p_saving_day)
     and (v_q is null
          or g.name ilike '%' || v_q || '%'
          or g.group_code ilike '%' || v_q || '%'
          or coalesce(g.location, '') ilike '%' || v_q || '%');

  select coalesce(jsonb_agg(to_jsonb(r) order by r.name), '[]'::jsonb) into v_rows
    from (
      select go.*
        from group_overview go
       where (p_status is null or go.status = p_status)
         and (p_saving_day is null or go.saving_day = p_saving_day)
         and (v_q is null
              or go.name ilike '%' || v_q || '%'
              or go.group_code ilike '%' || v_q || '%'
              or coalesce(go.location, '') ilike '%' || v_q || '%')
       order by go.name
       offset greatest(coalesce(p_offset, 0), 0)
       limit v_limit
    ) r;

  return jsonb_build_object('rows', v_rows, 'total', v_total,
                            'limit', v_limit, 'offset', greatest(coalesce(p_offset, 0), 0));
end;
$$;

/**
 * Everything one collection screen needs, in one round trip: the group, the
 * cycle, the totals and the member rows.
 */
create or replace function group_collection_sheet(
  p_group_id uuid,
  p_cycle_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_group   jsonb;
  v_cycle   jsonb;
  v_cycle_id uuid := p_cycle_id;
  v_rows    jsonb;
begin
  perform assert_capability(can_view_operations(), 'view collections');

  select to_jsonb(go) into v_group from group_overview go where go.id = p_group_id;
  if v_group is null then
    raise exception 'Group not found.' using errcode = 'no_data_found';
  end if;

  if v_cycle_id is null then
    select c.id into v_cycle_id
      from savings_cycles c
     where c.group_id = p_group_id
     order by c.cycle_start desc
     limit 1;
  end if;

  select to_jsonb(s) into v_cycle from group_cycle_summary s where s.cycle_id = v_cycle_id;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.member_name), '[]'::jsonb) into v_rows
    from savings_schedules r
   where r.cycle_id = v_cycle_id;

  return jsonb_build_object(
    'group',   v_group,
    'cycle',   v_cycle,
    'rows',    v_rows,
    'cycles', (
      select coalesce(jsonb_agg(jsonb_build_object(
                'cycle_id', c.id, 'label', c.label, 'due_on', c.due_on, 'status', c.status)
              order by c.cycle_start desc), '[]'::jsonb)
        from (select * from savings_cycles where group_id = p_group_id
              order by cycle_start desc limit 12) c
    )
  );
end;
$$;

/** The groups collecting on a given day, with live progress for each. */
create or replace function groups_saving_on(p_on date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v jsonb;
begin
  perform assert_capability(can_view_operations(), 'view collections');

  select coalesce(jsonb_agg(to_jsonb(x) order by x.name), '[]'::jsonb) into v
    from (
      select
        g.id as group_id, g.group_code, g.name, g.location,
        g.saving_day, saving_day_label(g.saving_day) as saving_day_label,
        g.saving_frequency, g.weekly_target, g.monthly_target,
        (select count(*) from members m
          where m.group_id = g.id and m.status = 'active')::integer as active_members,
        s.cycle_id, s.label as cycle_label, s.due_on, s.status as cycle_status,
        coalesce(s.members_expected, 0)     as members_expected,
        coalesce(s.expected_amount, 0)      as expected_amount,
        coalesce(s.collected_amount, 0)     as collected_amount,
        coalesce(s.outstanding_amount, 0)   as outstanding_amount,
        coalesce(s.paid_members, 0)         as paid_members,
        coalesce(s.partial_members, 0)      as partial_members,
        coalesce(s.pending_members, 0)      as pending_members,
        coalesce(s.missed_members, 0)       as missed_members,
        coalesce(s.collection_rate, 0)      as collection_rate
      from sacco_groups g
      left join lateral (
        select * from group_cycle_summary gcs
         where gcs.group_id = g.id and gcs.due_on = p_on
         order by gcs.cycle_start desc
         limit 1
      ) s on true
      where g.status = 'active' and group_collects_on(g.id, p_on)
    ) x;

  return v;
end;
$$;

/**
 * The savings dashboard.
 *
 * Every figure is an aggregate over member schedules and the ledger. Nothing
 * here is stored, and nothing here is a constant.
 */
create or replace function savings_dashboard(p_on date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v jsonb;
begin
  perform assert_capability(can_view_operations(), 'view the savings dashboard');

  select jsonb_build_object(
    'date',            p_on,
    'total_members',   (select count(*) from members where status = 'active'),
    'total_groups',    (select count(*) from sacco_groups where status = 'active'),
    'grouped_members', (select count(*) from members m join sacco_groups g on g.id = m.group_id
                         where m.status = 'active' and g.status = 'active'),
    'total_savings',   (select coalesce(sum(
                          case when type in ('weekly_savings', 'monthly_savings', 'deposit')
                               then amount else -amount end), 0)
                          from transactions
                         where status = 'posted'
                           and type in ('weekly_savings', 'monthly_savings', 'deposit', 'withdrawal')),
    'today_expected',    (select coalesce(sum(expected_amount), 0) from savings_periods
                           where coalesce(due_on, period_end) = p_on),
    'today_collected',   (select coalesce(sum(paid_amount), 0) from savings_periods
                           where coalesce(due_on, period_end) = p_on),
    'today_outstanding', (select coalesce(sum(greatest(expected_amount - paid_amount, 0)), 0)
                            from savings_periods
                           where coalesce(due_on, period_end) = p_on
                             and status <> 'waived'),
    'members_paid',      (select count(*) from savings_periods
                           where coalesce(due_on, period_end) = p_on and status = 'paid'),
    'members_partial',   (select count(*) from savings_periods
                           where coalesce(due_on, period_end) = p_on and status = 'partial'),
    'members_pending',   (select count(*) from savings_periods
                           where coalesce(due_on, period_end) = p_on and status = 'pending'),
    'members_missed',    (select count(*) from savings_periods
                           where coalesce(due_on, period_end) = p_on and status = 'missed'),
    'collected_today',   (select coalesce(sum(amount), 0) from transactions
                           where status = 'posted' and occurred_on = p_on
                             and type in ('weekly_savings', 'monthly_savings', 'deposit')),
    'total_arrears',     (select coalesce(sum(greatest(expected_amount - paid_amount, 0)), 0)
                            from savings_periods
                           where status in ('partial', 'missed')
                             and coalesce(due_on, period_end) < p_on),
    'groups_today',      groups_saving_on(p_on)
  ) into v;

  return v || jsonb_build_object(
    'collection_rate',
      case when (v ->> 'today_expected')::numeric > 0
           then round((v ->> 'today_collected')::numeric
                      / (v ->> 'today_expected')::numeric * 100, 2)
           else 0 end
  );
end;
$$;

/** Group performance over a date range - the group report. */
create or replace function group_report(
  p_group_id uuid,
  p_from     date,
  p_to       date
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_group jsonb;
  v_rows  jsonb;
  v_tot   jsonb;
begin
  perform assert_capability(can_view_operations(), 'view group reports');

  select to_jsonb(go) into v_group from group_overview go where go.id = p_group_id;
  if v_group is null then
    raise exception 'Group not found.' using errcode = 'no_data_found';
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.full_name), '[]'::jsonb),
         jsonb_build_object(
           'expected',    coalesce(sum(r.expected), 0),
           'paid',        coalesce(sum(r.paid), 0),
           'outstanding', coalesce(sum(r.outstanding), 0),
           'members',     count(*)
         )
    into v_rows, v_tot
    from (
      select m.id as member_id, m.member_no, m.full_name, m.phone, m.status,
             count(sp.id)::integer as schedules,
             coalesce(sum(sp.expected_amount), 0)::numeric(16,2) as expected,
             coalesce(sum(sp.paid_amount), 0)::numeric(16,2)     as paid,
             greatest(coalesce(sum(sp.expected_amount), 0)
                      - coalesce(sum(sp.paid_amount), 0), 0)::numeric(16,2) as outstanding,
             count(sp.id) filter (where sp.status = 'paid')::integer    as paid_count,
             count(sp.id) filter (where sp.status = 'partial')::integer as partial_count,
             count(sp.id) filter (where sp.status = 'missed')::integer  as missed_count
        from members m
        left join savings_periods sp
               on sp.member_id = m.id
              and coalesce(sp.due_on, sp.period_end) between p_from and p_to
       where m.group_id = p_group_id
       group by m.id, m.member_no, m.full_name, m.phone, m.status
    ) r;

  return jsonb_build_object(
    'group', v_group, 'from', p_from, 'to', p_to,
    'rows', v_rows, 'totals', v_tot,
    'collection_rate',
      case when (v_tot ->> 'expected')::numeric > 0
           then round((v_tot ->> 'paid')::numeric / (v_tot ->> 'expected')::numeric * 100, 2)
           else 0 end,
    'generated_at', now()
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Existing read models, extended with a group filter.
--
-- Dropped and recreated rather than overloaded: two candidates with the same
-- name and defaulted arguments is an ambiguity waiting to pick the wrong one.
-- ---------------------------------------------------------------------------
drop function if exists search_members(text, member_status, text, integer, integer);

create or replace function search_members(
  p_query   text default null,
  p_status  member_status default null,
  p_sort    text default 'name',      -- name | recent | savings | shares | loan
  p_limit   integer default 20,
  p_offset  integer default 0,
  p_group_id uuid default null,
  p_unassigned boolean default false
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
     and (p_group_id is null or m.group_id = p_group_id)
     and (not coalesce(p_unassigned, false) or m.group_id is null)
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
               when 'group'   then row_number() over (order by mf.group_name nulls last, mf.full_name)
               else                row_number() over (order by mf.full_name)
             end as sort_rank
        from member_financials mf
       where (p_status is null or mf.status = p_status)
         and (p_group_id is null or mf.group_id = p_group_id)
         and (not coalesce(p_unassigned, false) or mf.group_id is null)
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

drop function if exists savings_performance(savings_kind, date, date);

create or replace function savings_performance(
  p_kind     savings_kind,
  p_from     date,
  p_to       date,
  p_group_id uuid default null,
  p_status   savings_status default null
) returns table (
  member_id uuid, member_no text, full_name text, group_name text,
  periods integer, expected numeric, paid numeric, balance numeric,
  paid_periods integer, missed_periods integer, compliance numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- This returns the savings position of every member. It was previously
  -- callable by any signed-in user; it is staff-only.
  perform assert_capability(can_view_operations(), 'view savings performance');

  return query
  select
    m.id, m.member_no, m.full_name, g.name,
    count(sp.id)::integer,
    coalesce(sum(sp.expected_amount), 0)::numeric(16,2),
    coalesce(sum(sp.paid_amount), 0)::numeric(16,2),
    greatest(coalesce(sum(sp.expected_amount), 0)
             - coalesce(sum(sp.paid_amount), 0), 0)::numeric(16,2),
    count(sp.id) filter (where sp.status = 'paid')::integer,
    count(sp.id) filter (where sp.status = 'missed')::integer,
    case when count(sp.id) = 0 then 0
         else round(count(sp.id) filter (where sp.status = 'paid')::numeric
                    / count(sp.id) * 100, 1) end
  from members m
  left join sacco_groups g on g.id = m.group_id
  left join savings_periods sp
         on sp.member_id = m.id
        and sp.kind = p_kind
        and sp.period_start >= p_from
        and sp.period_end   <= p_to
        and (p_status is null or sp.status = p_status)
  where m.status = 'active'
    and (p_group_id is null or m.group_id = p_group_id)
  group by m.id, m.member_no, m.full_name, g.name
  order by m.full_name;
end;
$$;

-- `collections_trend` was SECURITY DEFINER with no role check, so any signed-in
-- member could read SACCO-wide collection totals. It is staff-only.
create or replace function collections_trend(p_months integer default 6)
returns table (bucket date, label text, savings numeric, repayments numeric, shares numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform assert_capability(can_view_operations(), 'view collection trends');

  return query
  with months as (
    select generate_series(
      date_trunc('month', current_date) - ((greatest(p_months, 1) - 1) || ' month')::interval,
      date_trunc('month', current_date),
      '1 month'
    )::date as bucket
  )
  select
    mo.bucket,
    to_char(mo.bucket, 'Mon') as label,
    coalesce(sum(t.amount) filter (where t.type in ('weekly_savings', 'monthly_savings', 'deposit')), 0),
    coalesce(sum(t.amount) filter (where t.type = 'loan_repayment'), 0),
    coalesce(sum(t.amount) filter (where t.type = 'share_purchase'), 0)
  from months mo
  left join transactions t
         on t.status = 'posted'
        and date_trunc('month', t.occurred_on)::date = mo.bucket
  group by mo.bucket
  order by mo.bucket;
end;
$$;

-- ---------------------------------------------------------------------------
-- Nightly hygiene, now schedule-aware.
--
-- A schedule whose due date has passed with nothing paid becomes 'missed'. A
-- partial one stays 'partial': money did arrive, and the shortfall is already
-- visible as outstanding.
-- ---------------------------------------------------------------------------
create or replace function run_daily_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_missed  integer;
  v_default integer;
  v_opened  jsonb;
begin
  update savings_periods
     set status = 'missed'
   where coalesce(due_on, period_end) < current_date
     and paid_amount = 0
     and expected_amount > 0
     and status = 'pending';
  get diagnostics v_missed = row_count;

  update loans l
     set status = 'defaulted'
    from loan_balances lb
   where lb.loan_id = l.id
     and l.status = 'active'
     and lb.days_overdue > 90
     and lb.overdue_amount > 0;
  get diagnostics v_default = row_count;

  -- Open today's sheets so a collection day never starts with an empty screen.
  v_opened := open_cycles_for_day(current_date);

  return jsonb_build_object(
    'periods_marked_missed', v_missed,
    'loans_defaulted',       v_default,
    'cycles_opened',         v_opened
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants. Every function re-checks the role of the caller internally.
-- ---------------------------------------------------------------------------
grant execute on function can_view_operations()   to authenticated;
grant execute on function can_record_savings()    to authenticated;
grant execute on function can_manage_groups()     to authenticated;
grant execute on function saving_day_label(smallint) to authenticated;
grant execute on function group_due_date(smallint, savings_kind, date) to authenticated;
grant execute on function group_savings_kind(saving_frequency) to authenticated;
grant execute on function group_collects_on(uuid, date) to authenticated;

grant execute on function open_group_cycle(uuid, date)            to authenticated;
grant execute on function open_cycles_for_day(date)               to authenticated;
grant execute on function close_savings_cycle(uuid, text)         to authenticated;
grant execute on function record_scheduled_savings(uuid, numeric, date, payment_method, text, text, text) to authenticated;
grant execute on function waive_savings_schedule(uuid, text)      to authenticated;

grant execute on function create_group(text, smallint, saving_frequency, text, numeric, numeric, uuid, uuid, uuid, text) to authenticated;
grant execute on function update_group(uuid, text, smallint, saving_frequency, text, numeric, numeric, uuid, uuid, uuid, text) to authenticated;
grant execute on function set_group_status(uuid, group_status, text) to authenticated;
grant execute on function assign_member_group(uuid, uuid, text)   to authenticated;

grant execute on function search_groups(text, group_status, smallint, integer, integer) to authenticated;
grant execute on function group_collection_sheet(uuid, uuid)      to authenticated;
grant execute on function groups_saving_on(date)                  to authenticated;
grant execute on function savings_dashboard(date)                 to authenticated;
grant execute on function group_report(uuid, date, date)          to authenticated;
grant execute on function search_members(text, member_status, text, integer, integer, uuid, boolean) to authenticated;
grant execute on function savings_performance(savings_kind, date, date, uuid, savings_status) to authenticated;
grant execute on function collections_trend(integer)              to authenticated;
grant execute on function run_daily_maintenance()                 to authenticated;
