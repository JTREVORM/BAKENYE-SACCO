-- ===========================================================================
-- BUD-SACCO - 0030 - Member registration, fees, profile control and sign-in
--
-- What this migration makes true:
--
--   * A member is registered in ONE database transaction: the member record,
--     their share and savings categories, every fee they are charged, the fee
--     payment on the ledger, the receipt, the Cash at Merchant / Bank / Hand
--     entry and the audit trail. If any part fails, none of it happened.
--
--   * Fees are rows in `fees`, set up under Settings -> Fees. Nothing charges
--     a figure written into code. A fee's amount is copied onto each charge when
--     it is made, so raising the Membership Fee from UGX 10,000 to UGX 20,000
--     changes what the next member is charged and nothing a past member paid.
--     A fee that is no longer used is made inactive, never deleted.
--
--   * A member's official record - name, phone, member number, membership date,
--     categories, status - is changed only by staff holding the permission,
--     only through `update_member_profile()` / `set_member_categories()` /
--     `set_member_status()`, and every change is kept with who, when, the value
--     before and after, and the reason. There is no write path for a member.
--
--   * Phone numbers are held in one form, +2567XXXXXXXX, whatever was typed, so
--     0772 123 456 and +256 772 123456 are the same number and cannot register
--     two members. Two non-archived members may share a number only by an
--     explicit, permissioned and audited override.
--
--   * A member signs in with their member number and the phone number on their
--     official record. `member_login_verify()` checks the pair against the
--     register, counts failures and locks a member number out after too many.
--     It is callable only with the service-role key, from the server.
--
--   * Every function in the public schema stops being callable by `anon` and
--     `authenticated` unless it is on an explicit list (section 12). Supabase's
--     default privileges had granted EXECUTE on everything - including
--     `post_transaction()`, `post_account_entry()` and `write_audit()` - so any
--     signed-in member could have posted a ledger row or written an audit entry
--     directly through the REST API.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Settings this migration introduces
--
-- The three old fee settings (`members.registration_fee`,
-- `members.annual_subscription`, `members.passbook_fee`) were stored but read
-- by nothing: a manager could type a registration fee and no member was ever
-- charged it. Any non-zero value becomes a real fee below; the settings then go,
-- so a fee has exactly one home.
-- ---------------------------------------------------------------------------
select define_setting('members.activation_requires_fees', 'members',
  'Mandatory fees must be paid before a member is active', 'boolean', 'true'::jsonb,
  'When on, a new member stays Pending until every mandatory registration fee is paid or waived. When off, a member is active from registration and any unpaid fee is simply owed.',
  null, null, null, null, true, 60);

select define_setting('members.registration_requires_categories', 'members',
  'A new member must be given both categories', 'boolean', 'true'::jsonb,
  'When on, registration asks for a share category and a savings category before it completes.',
  null, null, null, null, false, 70);

select define_setting('members.require_national_id', 'members',
  'National ID is required at registration', 'boolean', 'false'::jsonb,
  'When on, a member cannot be registered without a National ID number.',
  null, null, null, null, false, 80);

select define_setting('members.require_date_of_birth', 'members',
  'Date of birth is required at registration', 'boolean', 'false'::jsonb,
  'When on, a member cannot be registered without a date of birth. The minimum age applies whenever one is given.',
  null, null, null, null, false, 90);

select define_setting('members.require_gender', 'members',
  'Gender is required at registration', 'boolean', 'false'::jsonb,
  'When on, registration asks for the member''s gender.',
  null, null, null, null, false, 100);

select define_setting('members.require_next_of_kin', 'members',
  'Next of kin is required at registration', 'boolean', 'false'::jsonb,
  'When on, registration needs the next of kin''s name, relationship and phone number.',
  null, null, null, null, false, 110);

select define_setting('security.member_login_max_attempts', 'security',
  'Member sign-in attempts before lock-out', 'integer', '5'::jsonb,
  'A member number is locked after this many wrong phone numbers in a row. The member waits out the lock-out, or visits the office.',
  'attempts', 3, 20, null, false, 40);

select define_setting('security.member_login_lockout_minutes', 'security',
  'Member sign-in lock-out', 'integer', '15'::jsonb,
  'How long a member number stays locked after too many failed sign-ins.',
  'minutes', 1, 1440, null, false, 50);

-- The share price lives in its row, set under Settings. A column default would
-- be a second, silent copy of it.
alter table share_settings alter column unit_price drop default;

-- ---------------------------------------------------------------------------
-- 2. Phone numbers
-- ---------------------------------------------------------------------------

/**
 * A Ugandan mobile number in its one stored form, +2567XXXXXXXX, or null if
 * what was typed is not one. Accepts 07XXXXXXXX, 7XXXXXXXX, 2567XXXXXXXX,
 * +2567XXXXXXXX and 002567XXXXXXXX, with any spaces, dashes or brackets.
 */
create or replace function normalize_ug_phone(p text)
returns text language plpgsql immutable as $$
declare
  d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if d = '' then
    return null;
  end if;
  if d ~ '^00256' then
    d := substr(d, 3);
  end if;
  if d ~ '^256' then
    d := substr(d, 4);
  elsif d ~ '^0' then
    d := substr(d, 2);
  end if;
  if d ~ '^7[0-9]{8}$' then
    return '+256' || d;
  end if;
  return null;
end;
$$;

/** "0772 123 456", for messages. */
create or replace function format_ug_phone(p text)
returns text language sql immutable as $$
  select case when p ~ '^\+2567[0-9]{8}$'
              then '0' || substr(p, 5, 3) || ' ' || substr(p, 8, 3) || ' ' || substr(p, 11, 3)
              else p end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The member record
-- ---------------------------------------------------------------------------
alter table members
  add column if not exists registration_key    text,
  add column if not exists activated_at        timestamptz,
  add column if not exists allow_shared_phone  boolean not null default false,
  add column if not exists shared_phone_reason text;

create unique index if not exists members_registration_key_idx
  on members (registration_key) where registration_key is not null;

create index if not exists members_phone_idx on members (phone);

-- Existing numbers into the one stored form. A number that is not a Ugandan
-- mobile is left exactly as it was: better a visible oddity for a person to
-- fix than a guess.
update members
   set phone = normalize_ug_phone(phone)
 where normalize_ug_phone(phone) is not null
   and phone is distinct from normalize_ug_phone(phone);

update members
   set next_of_kin_phone = normalize_ug_phone(next_of_kin_phone)
 where normalize_ug_phone(next_of_kin_phone) is not null
   and next_of_kin_phone is distinct from normalize_ug_phone(next_of_kin_phone);

/**
 * Before any member row is written: tidy what can be tidied, refuse what is
 * wrong, and never let the member number change.
 */
create or replace function members_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_other members;
  v_phone text;
begin
  if tg_op = 'UPDATE' and new.member_no is distinct from old.member_no then
    raise exception 'A member number is permanent and cannot be changed (%).', old.member_no
      using errcode = 'check_violation';
  end if;

  new.full_name := regexp_replace(btrim(new.full_name), '\s+', ' ', 'g');

  if tg_op = 'INSERT' or new.phone is distinct from old.phone then
    v_phone := normalize_ug_phone(new.phone);
    if v_phone is null then
      raise exception 'Enter a valid Ugandan mobile number, e.g. 0772 123 456.'
        using errcode = 'check_violation', hint = 'phone';
    end if;
    new.phone := v_phone;
  end if;

  if new.next_of_kin_phone is not null and btrim(new.next_of_kin_phone) <> ''
     and (tg_op = 'INSERT' or new.next_of_kin_phone is distinct from old.next_of_kin_phone) then
    v_phone := normalize_ug_phone(new.next_of_kin_phone);
    if v_phone is null then
      raise exception 'Enter a valid Ugandan mobile number for the next of kin.'
        using errcode = 'check_violation', hint = 'next_of_kin_phone';
    end if;
    new.next_of_kin_phone := v_phone;
  elsif new.next_of_kin_phone is not null and btrim(new.next_of_kin_phone) = '' then
    new.next_of_kin_phone := null;
  end if;

  -- One number, one live member - unless someone with the authority said
  -- otherwise, on the record. The advisory lock makes two simultaneous
  -- registrations of the same number queue instead of both passing.
  if new.status not in ('archived', 'exited')
     and (tg_op = 'INSERT' or new.phone is distinct from old.phone
          or new.status is distinct from old.status
          or new.allow_shared_phone is distinct from old.allow_shared_phone) then
    perform pg_advisory_xact_lock(hashtext('member-phone:' || new.phone));
    select * into v_other from members
     where phone = new.phone and id <> new.id and status not in ('archived', 'exited')
     order by joined_on limit 1;
    if found and not new.allow_shared_phone then
      raise exception '% is already the phone number of % (%).',
        format_ug_phone(new.phone), v_other.full_name, v_other.member_no
        using errcode = 'unique_violation', hint = 'phone';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists members_guard on members;
create trigger members_guard before insert or update on members
  for each row execute function members_guard();

do $$ begin
  alter table members add constraint members_phone_ug check (phone ~ '^\+2567[0-9]{8}$') not valid;
exception when duplicate_object then null; end $$;

-- Validated only if every existing number is already in the stored form; the
-- constraint still guards every new or changed row either way.
do $$ begin
  if not exists (select 1 from members where phone !~ '^\+2567[0-9]{8}$') then
    alter table members validate constraint members_phone_ug;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Profile change history
--
-- One row per field changed, so "who changed John's phone number, from what,
-- and why" is a lookup rather than a diff of two JSON documents.
-- ---------------------------------------------------------------------------
create table if not exists member_profile_changes (
  id              bigserial primary key,
  member_id       uuid not null references members (id) on delete restrict,
  field           text not null,
  field_label     text not null,
  old_value       text,
  new_value       text,
  reason          text not null,
  changed_by      uuid references app_users (id),
  changed_by_name text,
  changed_at      timestamptz not null default now()
);

create index if not exists member_profile_changes_member_idx
  on member_profile_changes (member_id, changed_at desc);

create or replace function guard_append_only()
returns trigger language plpgsql as $$
begin
  raise exception '% is a permanent record and cannot be changed or deleted.', tg_table_name
    using errcode = 'check_violation';
end;
$$;

drop trigger if exists member_profile_changes_append_only on member_profile_changes;
create trigger member_profile_changes_append_only
  before update or delete on member_profile_changes
  for each row execute function guard_append_only();

-- ---------------------------------------------------------------------------
-- 5. Fees
-- ---------------------------------------------------------------------------
create table if not exists fees (
  id                          uuid primary key default gen_random_uuid(),
  code                        text unique not null check (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  name                        text unique not null check (length(btrim(name)) between 2 and 80),
  description                 text,
  amount                      numeric(16,2) not null check (amount > 0),
  currency                    text not null,
  fee_type                    text not null check (fee_type in (
                                'membership', 'registration', 'application', 'passbook',
                                'welfare', 'subscription', 'other')),
  -- When the fee applies. Only `registration` is charged automatically, by
  -- `register_member()`. `annual` and `on_request` are charged by a person,
  -- from the member's record; nothing charges them on a timer.
  charged_when                text not null check (charged_when in ('registration', 'annual', 'on_request')),
  is_mandatory                boolean not null default false,
  applies_to_new_members      boolean not null default true,
  applies_to_existing_members boolean not null default false,
  status                      text not null default 'active' check (status in ('active', 'inactive')),
  effective_from              date not null default current_date,
  -- Where the money is booked in the SACCO's income, for the cashbook.
  income_category_id          uuid not null references income_categories (id),
  sort_order                  integer not null default 100,
  created_by                  uuid references app_users (id),
  updated_by                  uuid references app_users (id),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  constraint fees_applies_to_someone
    check (applies_to_new_members or applies_to_existing_members),
  constraint fees_registration_is_for_new_members
    check (charged_when <> 'registration' or applies_to_new_members)
);

drop trigger if exists fees_updated on fees;
create trigger fees_updated before update on fees
  for each row execute function set_updated_at();

create or replace function fees_never_deleted()
returns trigger language plpgsql as $$
begin
  raise exception 'A fee is never deleted, so the records of what members paid stay whole. Make it inactive instead.'
    using errcode = 'check_violation';
end;
$$;

drop trigger if exists fees_no_delete on fees;
create trigger fees_no_delete before delete on fees
  for each row execute function fees_never_deleted();

/**
 * A fee owed by a member. The name and amount are copied from the fee when it
 * is charged: that copy is what the member owes, whatever happens to the fee
 * afterwards.
 */
create table if not exists member_fees (
  id                      uuid primary key default gen_random_uuid(),
  member_id               uuid not null references members (id) on delete restrict,
  fee_id                  uuid not null references fees (id),
  fee_name                text not null,
  amount                  numeric(16,2) not null check (amount > 0),
  currency                text not null,
  is_mandatory            boolean not null,
  charged_at_registration boolean not null default false,
  charged_on              date not null default current_date,
  charge_reason           text,
  status                  text not null default 'unpaid' check (status in ('unpaid', 'paid', 'waived')),
  paid_transaction_id     uuid references transactions (id),
  paid_on                 date,
  waived_by               uuid references app_users (id),
  waived_at               timestamptz,
  waived_reason           text,
  created_by              uuid references app_users (id),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint member_fees_paid_has_txn check (status <> 'paid' or paid_transaction_id is not null),
  constraint member_fees_waived_has_reason check (status <> 'waived' or length(btrim(coalesce(waived_reason, ''))) >= 5)
);

create unique index if not exists member_fees_one_registration_charge
  on member_fees (member_id, fee_id) where charged_at_registration;
create index if not exists member_fees_member_idx on member_fees (member_id, created_at desc);
create index if not exists member_fees_unpaid_idx on member_fees (member_id) where status = 'unpaid';
create index if not exists member_fees_txn_idx on member_fees (paid_transaction_id) where paid_transaction_id is not null;

drop trigger if exists member_fees_updated on member_fees;
create trigger member_fees_updated before update on member_fees
  for each row execute function set_updated_at();

create or replace function member_fees_never_deleted()
returns trigger language plpgsql as $$
begin
  raise exception 'A fee charge is never deleted. Waive it, with a reason, instead.'
    using errcode = 'check_violation';
end;
$$;

drop trigger if exists member_fees_no_delete on member_fees;
create trigger member_fees_no_delete before delete on member_fees
  for each row execute function member_fees_never_deleted();

/**
 * The lines of a fee payment: what one ledger row paid for. Immutable, and
 * kept even if the payment is later reversed, so the original receipt always
 * prints the lines it was issued with.
 */
create table if not exists fee_payment_lines (
  id             bigserial primary key,
  transaction_id uuid not null references transactions (id) on delete restrict,
  member_fee_id  uuid not null references member_fees (id) on delete restrict,
  fee_id         uuid not null references fees (id),
  description    text not null,
  amount         numeric(16,2) not null check (amount > 0),
  created_at     timestamptz not null default now()
);

create index if not exists fee_payment_lines_txn_idx on fee_payment_lines (transaction_id);

drop trigger if exists fee_payment_lines_append_only on fee_payment_lines;
create trigger fee_payment_lines_append_only
  before update or delete on fee_payment_lines
  for each row execute function guard_append_only();

-- The old settings, carried over only where the SACCO had actually set them.
do $carry$
declare
  r record;
  v_cat uuid;
begin
  for r in
    select s.key, (s.value #>> '{}')::numeric as amount,
           case s.key
             when 'members.registration_fee'    then 'Registration Fee'
             when 'members.annual_subscription' then 'Annual Subscription'
             when 'members.passbook_fee'        then 'Passbook Fee' end as name,
           case s.key
             when 'members.registration_fee'    then 'registration'
             when 'members.annual_subscription' then 'subscription'
             when 'members.passbook_fee'        then 'passbook' end as fee_type,
           case s.key
             when 'members.registration_fee'    then 'registration'
             when 'members.annual_subscription' then 'annual'
             when 'members.passbook_fee'        then 'on_request' end as charged_when
      from system_settings s
     where s.key in ('members.registration_fee', 'members.annual_subscription', 'members.passbook_fee')
       and jsonb_typeof(s.value) = 'number' and (s.value #>> '{}')::numeric > 0
  loop
    select id into v_cat from income_categories where lower(name) = lower(r.name || 's')
                                                   or lower(name) = lower(r.name) limit 1;
    if v_cat is null then
      insert into income_categories (name) values (r.name) returning id into v_cat;
    end if;
    insert into fees (code, name, amount, currency, fee_type, charged_when, is_mandatory,
                      applies_to_new_members, applies_to_existing_members, income_category_id)
    values (upper(replace(r.name, ' ', '_')), r.name, r.amount,
            coalesce((select value #>> '{}' from system_settings where key = 'financial.currency_code'), 'UGX'),
            r.fee_type, r.charged_when, r.charged_when = 'registration',
            r.charged_when = 'registration', r.charged_when <> 'registration', v_cat)
    on conflict (name) do nothing;
  end loop;

  delete from system_settings
   where key in ('members.registration_fee', 'members.annual_subscription', 'members.passbook_fee');
end
$carry$;

-- ---------------------------------------------------------------------------
-- 6. Fee administration
-- ---------------------------------------------------------------------------

/** Validate a fee payload; returns the income category to book it under. */
create or replace function assert_fee_payload_valid(p jsonb, p_fee_id uuid default null)
returns void language plpgsql stable security definer set search_path = public as $$
declare
  v_name text := btrim(coalesce(p ->> 'name', ''));
  v_amt  numeric;
begin
  if length(v_name) < 2 or length(v_name) > 80 then
    raise exception 'Give the fee a name of 2 to 80 characters.' using errcode = 'check_violation', hint = 'name';
  end if;
  if exists (select 1 from fees where lower(name) = lower(v_name) and id is distinct from p_fee_id) then
    raise exception 'There is already a fee called %.', v_name using errcode = 'unique_violation', hint = 'name';
  end if;

  begin
    v_amt := (p ->> 'amount')::numeric;
  exception when others then
    v_amt := null;
  end;
  if v_amt is null or v_amt <= 0 then
    raise exception 'Enter an amount greater than zero.' using errcode = 'check_violation', hint = 'amount';
  end if;
  if v_amt <> round(v_amt, 2) then
    raise exception 'Enter the amount to at most two decimal places.' using errcode = 'check_violation', hint = 'amount';
  end if;

  if coalesce(p ->> 'fee_type', '') not in ('membership', 'registration', 'application', 'passbook', 'welfare', 'subscription', 'other') then
    raise exception 'Choose what kind of fee this is.' using errcode = 'check_violation', hint = 'fee_type';
  end if;
  if coalesce(p ->> 'charged_when', '') not in ('registration', 'annual', 'on_request') then
    raise exception 'Choose when the fee applies.' using errcode = 'check_violation', hint = 'charged_when';
  end if;
  if not coalesce((p ->> 'applies_to_new_members')::boolean, false)
     and not coalesce((p ->> 'applies_to_existing_members')::boolean, false) then
    raise exception 'A fee must apply to new members, existing members, or both.'
      using errcode = 'check_violation', hint = 'applies_to_new_members';
  end if;
  if p ->> 'charged_when' = 'registration' and not coalesce((p ->> 'applies_to_new_members')::boolean, false) then
    raise exception 'A fee charged at registration must apply to new members.'
      using errcode = 'check_violation', hint = 'applies_to_new_members';
  end if;
  if nullif(p ->> 'income_category_id', '') is not null
     and not exists (select 1 from income_categories where id = (p ->> 'income_category_id')::uuid and is_active) then
    raise exception 'Choose an active income category.' using errcode = 'check_violation', hint = 'income_category_id';
  end if;
  if nullif(p ->> 'effective_from', '') is not null then
    perform (p ->> 'effective_from')::date;
  end if;
end;
$$;

/** The income category a fee books to: the one chosen, or one named after it. */
create or replace function fee_income_category(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id   uuid := nullif(p ->> 'income_category_id', '')::uuid;
  v_name text := btrim(p ->> 'name');
begin
  if v_id is not null then
    return v_id;
  end if;
  select id into v_id from income_categories
   where lower(name) in (lower(v_name), lower(v_name || 's')) and is_active
   limit 1;
  if v_id is null then
    insert into income_categories (name, description)
    values (v_name, 'Created for the ' || v_name || ' fee.')
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function create_fee(p jsonb, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_fee  fees;
  v_code text;
begin
  perform assert_permission('fees.manage');
  perform assert_fee_payload_valid(p);

  v_code := left(regexp_replace(regexp_replace(upper(btrim(p ->> 'name')), '[^A-Z0-9]+', '_', 'g'), '^_+|_+$', '', 'g'), 32);
  if v_code !~ '^[A-Z]' then
    v_code := 'FEE_' || v_code;
  end if;
  while exists (select 1 from fees where code = v_code) loop
    v_code := left(v_code, 28) || '_' || upper(substr(md5(random()::text), 1, 3));
  end loop;

  insert into fees (code, name, description, amount, currency, fee_type, charged_when,
                    is_mandatory, applies_to_new_members, applies_to_existing_members,
                    effective_from, income_category_id, sort_order, created_by, updated_by)
  values (v_code, btrim(p ->> 'name'), nullif(btrim(coalesce(p ->> 'description', '')), ''),
          (p ->> 'amount')::numeric, setting_text('financial.currency_code'),
          p ->> 'fee_type', p ->> 'charged_when',
          coalesce((p ->> 'is_mandatory')::boolean, false),
          coalesce((p ->> 'applies_to_new_members')::boolean, false),
          coalesce((p ->> 'applies_to_existing_members')::boolean, false),
          coalesce(nullif(p ->> 'effective_from', '')::date, current_date),
          fee_income_category(p),
          coalesce(nullif(p ->> 'sort_order', '')::integer, 100),
          auth.uid(), auth.uid())
  returning * into v_fee;

  perform write_audit('fee.created', 'Fees', v_fee.id::text,
    format('Fee %s created at %s (%s)', v_fee.name, ugx(v_fee.amount),
           case when v_fee.is_mandatory then 'mandatory' else 'optional' end),
    null, to_jsonb(v_fee), p_reason);

  return to_jsonb(v_fee);
end;
$$;

create or replace function update_fee(p_fee_id uuid, p jsonb, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_old fees;
  v_new fees;
begin
  perform assert_permission('fees.manage');

  select * into v_old from fees where id = p_fee_id for update;
  if not found then
    raise exception 'Fee not found.' using errcode = 'no_data_found';
  end if;

  perform assert_fee_payload_valid(p, p_fee_id);

  if (p ->> 'amount')::numeric <> v_old.amount and coalesce(btrim(p_reason), '') = '' then
    raise exception 'Give a reason for changing the amount of a fee.' using errcode = 'check_violation', hint = 'reason';
  end if;

  update fees
     set name                        = btrim(p ->> 'name'),
         description                 = nullif(btrim(coalesce(p ->> 'description', '')), ''),
         amount                      = (p ->> 'amount')::numeric,
         fee_type                    = p ->> 'fee_type',
         charged_when                = p ->> 'charged_when',
         is_mandatory                = coalesce((p ->> 'is_mandatory')::boolean, false),
         applies_to_new_members      = coalesce((p ->> 'applies_to_new_members')::boolean, false),
         applies_to_existing_members = coalesce((p ->> 'applies_to_existing_members')::boolean, false),
         effective_from              = coalesce(nullif(p ->> 'effective_from', '')::date, v_old.effective_from),
         income_category_id          = case when nullif(p ->> 'income_category_id', '') is null
                                            then v_old.income_category_id
                                            else (p ->> 'income_category_id')::uuid end,
         sort_order                  = coalesce(nullif(p ->> 'sort_order', '')::integer, v_old.sort_order),
         updated_by                  = auth.uid()
   where id = p_fee_id
   returning * into v_new;

  if to_jsonb(v_new) - 'updated_at' - 'updated_by' = to_jsonb(v_old) - 'updated_at' - 'updated_by' then
    raise exception 'Nothing changed.' using errcode = 'check_violation';
  end if;

  perform write_audit(
    case when v_new.amount <> v_old.amount then 'fee.amount_changed' else 'fee.updated' end,
    'Fees', p_fee_id::text,
    case when v_new.amount <> v_old.amount
         then format('Fee %s changed from %s to %s. Charges already made keep their amount.',
                     v_new.name, ugx(v_old.amount), ugx(v_new.amount))
         else format('Fee %s updated', v_new.name) end,
    to_jsonb(v_old), to_jsonb(v_new), p_reason);

  return to_jsonb(v_new);
end;
$$;

create or replace function set_fee_status(p_fee_id uuid, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_fee fees;
begin
  perform assert_permission('fees.manage');

  if p_status not in ('active', 'inactive') then
    raise exception 'Unknown status %.', p_status using errcode = 'check_violation';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Give a reason for this change.' using errcode = 'check_violation', hint = 'reason';
  end if;

  select * into v_fee from fees where id = p_fee_id for update;
  if not found then
    raise exception 'Fee not found.' using errcode = 'no_data_found';
  end if;
  if v_fee.status = p_status then
    raise exception 'This fee is already %.', p_status using errcode = 'check_violation';
  end if;

  update fees set status = p_status, updated_by = auth.uid() where id = p_fee_id returning * into v_fee;

  perform write_audit(case when p_status = 'active' then 'fee.activated' else 'fee.deactivated' end,
    'Fees', p_fee_id::text,
    format('Fee %s %s', v_fee.name, case when p_status = 'active' then 'activated' else 'deactivated' end),
    jsonb_build_object('status', case when p_status = 'active' then 'inactive' else 'active' end),
    jsonb_build_object('status', p_status), p_reason);

  return to_jsonb(v_fee);
end;
$$;

/**
 * The fees a member registered on `p_on` would be charged: active,
 * registration-time, for new members, in effect by that date.
 */
create or replace function registration_fee_schedule(p_on date default current_date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_capability(has_permission('members.create') or has_permission('fees.manage'),
                            'see the registration fees');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', f.id, 'code', f.code, 'name', f.name, 'description', f.description,
             'amount', f.amount, 'currency', f.currency, 'fee_type', f.fee_type,
             'is_mandatory', f.is_mandatory)
           order by f.is_mandatory desc, f.sort_order, f.name)
      from fees f
     where f.status = 'active'
       and f.charged_when = 'registration'
       and f.applies_to_new_members
       and f.effective_from <= coalesce(p_on, current_date)
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Charging, paying and waiving fees
-- ---------------------------------------------------------------------------

/**
 * Make a pending member active once nothing mandatory is left unpaid - or
 * immediately, if the SACCO does not tie activation to fees.
 */
create or replace function maybe_activate_member(p_member_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_member members;
  v_owing  numeric(16,2);
begin
  select * into v_member from members where id = p_member_id for update;
  if not found or v_member.status <> 'pending' then
    return false;
  end if;

  select coalesce(sum(amount), 0) into v_owing
    from member_fees
   where member_id = p_member_id and status = 'unpaid' and is_mandatory and charged_at_registration;

  if v_owing > 0 and setting_bool('members.activation_requires_fees') then
    return false;
  end if;

  update members set status = 'active', activated_at = now() where id = p_member_id;

  perform write_audit('member.activated', 'Members', p_member_id::text,
    format('Member %s (%s) activated: mandatory registration fees settled',
           v_member.full_name, v_member.member_no),
    jsonb_build_object('status', 'pending'), jsonb_build_object('status', 'active'),
    'Mandatory registration fees settled');

  -- Raise the current savings schedule now, rather than at the next nightly
  -- run, so the member's first expectation is visible from day one.
  perform ensure_member_schedule(p_member_id, current_date);
  return true;
end;
$$;

/** The receipt-shaped summary of a fee payment. */
create or replace function fee_payment_result(p_transaction_id uuid, p_duplicate boolean)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'transaction_id', t.id,
    'reference',      t.reference,
    'receipt_no',     (select receipt_no from receipts where transaction_id = t.id),
    'amount',         t.amount,
    'method',         t.method,
    'external_ref',   t.external_ref,
    'paid_on',        t.occurred_on,
    'account_name',   (select name from financial_accounts where id = t.destination_account_id),
    'lines',          (select coalesce(jsonb_agg(jsonb_build_object('description', l.description,
                                                                    'amount', l.amount) order by l.id), '[]'::jsonb)
                         from fee_payment_lines l where l.transaction_id = t.id),
    'duplicate',      p_duplicate
  )
  from transactions t where t.id = p_transaction_id;
$$;

/**
 * Pay some of a member's unpaid fees in one payment: one ledger row, one
 * receipt, one entry in the receiving account, and one income line per fee.
 *
 * Internal. Reached through `pay_member_fees()` and `register_member()`, which
 * check the caller's permission.
 */
create or replace function post_fee_payment(
  p_member_id       uuid,
  p_charge_ids      uuid[],
  p_account_id      uuid,
  p_method          payment_method,
  p_paid_on         date,
  p_reference       text,
  p_idempotency_key text,
  p_note            text,
  p_amount_received numeric default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_member members;
  v_acct   financial_accounts;
  v_method payment_method;
  v_ref    text := nullif(btrim(coalesce(p_reference, '')), '');
  v_on     date := coalesce(p_paid_on, current_date);
  v_ids    uuid[];
  v_count  integer;
  v_total  numeric(16,2);
  v_txn    transactions;
  v_desc   text;
begin
  -- A retry of a payment already posted returns that payment.
  if p_idempotency_key is not null then
    select * into v_txn from transactions where idempotency_key = p_idempotency_key;
    if found then
      if exists (select 1 from fee_payment_lines where transaction_id = v_txn.id) then
        return fee_payment_result(v_txn.id, true);
      end if;
      raise exception 'This submission was already used for a different transaction. Reload the page and try again.'
        using errcode = 'unique_violation';
    end if;
  end if;

  select * into v_member from members where id = p_member_id;
  if not found then
    raise exception 'Member not found.' using errcode = 'no_data_found';
  end if;
  if v_member.status in ('archived', 'exited') then
    raise exception 'Fees cannot be taken from an archived member.' using errcode = 'check_violation';
  end if;

  select array_agg(distinct x) into v_ids from unnest(coalesce(p_charge_ids, '{}')) x where x is not null;
  if v_ids is null then
    raise exception 'Choose at least one fee to pay.' using errcode = 'check_violation', hint = 'fees';
  end if;

  perform 1 from member_fees where id = any (v_ids) for update;
  select count(*), coalesce(sum(amount), 0) into v_count, v_total
    from member_fees
   where id = any (v_ids) and member_id = p_member_id and status = 'unpaid';
  if v_count <> cardinality(v_ids) then
    raise exception 'One or more of these fees is already paid, waived, or not this member''s. Reload and try again.'
      using errcode = 'check_violation', hint = 'fees';
  end if;

  if p_amount_received is not null and p_amount_received <> v_total then
    raise exception 'The amount received (%) must equal the total due (%).', ugx(p_amount_received), ugx(v_total)
      using errcode = 'check_violation', hint = 'amount_received';
  end if;
  if v_on > current_date then
    raise exception 'A payment cannot be dated in the future.' using errcode = 'check_violation', hint = 'paid_on';
  end if;

  if p_account_id is null then
    raise exception 'Choose the account the money was received into.' using errcode = 'check_violation', hint = 'account_id';
  end if;
  select * into v_acct from financial_accounts where id = p_account_id;
  if not found then
    raise exception 'Choose the account the money was received into.' using errcode = 'no_data_found', hint = 'account_id';
  end if;
  v_method := method_for_account_type(v_acct.account_type, p_method);
  v_acct   := assert_account_usable(p_account_id, v_method);

  if v_acct.account_type in ('merchant', 'bank') and v_ref is null then
    raise exception '%',
      case when v_acct.account_type = 'merchant'
           then 'Enter the mobile money transaction reference from the confirmation message.'
           else 'Enter the bank transfer or deposit slip reference.' end
      using errcode = 'check_violation', hint = 'reference';
  end if;
  if v_ref is not null and exists (
    select 1 from transactions where upper(external_ref) = upper(v_ref) and status <> 'reversed'
  ) then
    raise exception 'Reference % has already been recorded against another transaction.', v_ref
      using errcode = 'unique_violation', hint = 'reference';
  end if;

  select string_agg(fee_name, ', ' order by is_mandatory desc, fee_name) into v_desc
    from member_fees where id = any (v_ids);
  v_desc := coalesce(nullif(btrim(coalesce(p_note, '')), '') || ': ', '') || v_desc
            || ' - ' || v_member.full_name;

  -- The receiving account is handed to the posting trigger for this database
  -- transaction only, exactly as the collection screen does it.
  perform set_config('bnd.account_id', p_account_id::text, true);
  v_txn := post_transaction(p_member_id, 'fee', v_total, v_method, v_on, v_desc, p_idempotency_key);
  perform set_config('bnd.account_id', '', true);

  if v_ref is not null then
    update transactions set external_ref = v_ref where id = v_txn.id;
  end if;

  insert into fee_payment_lines (transaction_id, member_fee_id, fee_id, description, amount)
  select v_txn.id, mf.id, mf.fee_id, mf.fee_name, mf.amount
    from member_fees mf where mf.id = any (v_ids)
   order by mf.is_mandatory desc, mf.fee_name;

  -- The SACCO's income, one line per fee, so the cashbook shows Membership
  -- Fee and Registration Fee as the separate income they are.
  insert into income_entries (category_id, amount, description, received_on, method,
                              member_id, transaction_id, recorded_by)
  select f.income_category_id, mf.amount, mf.fee_name || ' - ' || v_member.full_name,
         v_on, v_method, p_member_id, v_txn.id, auth.uid()
    from member_fees mf join fees f on f.id = mf.fee_id
   where mf.id = any (v_ids);

  update member_fees
     set status = 'paid', paid_transaction_id = v_txn.id, paid_on = v_on
   where id = any (v_ids);

  perform write_audit('fees.payment_recorded', 'Fees', v_txn.id::text,
    format('%s in fees received from %s (%s) into %s%s', ugx(v_total), v_member.full_name,
           v_member.member_no, v_acct.name, case when v_ref is not null then ', ref ' || v_ref else '' end),
    null,
    jsonb_build_object('transaction_id', v_txn.id, 'reference', v_txn.reference,
                       'receipt_no', (select receipt_no from receipts where transaction_id = v_txn.id),
                       'member_id', p_member_id, 'account', v_acct.name, 'method', v_method,
                       'external_ref', v_ref, 'amount', v_total,
                       'fees', (select jsonb_agg(jsonb_build_object('fee', fee_name, 'amount', amount))
                                  from member_fees where id = any (v_ids))),
    p_note);

  perform maybe_activate_member(p_member_id);

  return fee_payment_result(v_txn.id, false);
end;
$$;

/** Record a payment of fees a member already owes. */
create or replace function pay_member_fees(
  p_member_id       uuid,
  p_charge_ids      uuid[],
  p_account_id      uuid,
  p_method          payment_method default null,
  p_paid_on         date default null,
  p_reference       text default null,
  p_amount_received numeric default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform assert_permission('fees.collect');
  return post_fee_payment(p_member_id, p_charge_ids, p_account_id, p_method, p_paid_on,
                          p_reference, p_idempotency_key, null, p_amount_received);
end;
$$;

/** Charge a fee to an existing member - a replacement passbook, a subscription. */
create or replace function charge_member_fee(p_member_id uuid, p_fee_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_member members;
  v_fee    fees;
  v_charge member_fees;
begin
  perform assert_permission('fees.collect');

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Say what this charge is for.' using errcode = 'check_violation', hint = 'reason';
  end if;

  select * into v_member from members where id = p_member_id;
  if not found then
    raise exception 'Member not found.' using errcode = 'no_data_found';
  end if;
  if v_member.status in ('archived', 'exited') then
    raise exception 'Fees cannot be charged to an archived member.' using errcode = 'check_violation';
  end if;

  select * into v_fee from fees where id = p_fee_id;
  if not found or v_fee.status <> 'active' then
    raise exception 'That fee is not active.' using errcode = 'check_violation', hint = 'fee_id';
  end if;
  if not v_fee.applies_to_existing_members then
    raise exception '% applies only to new members, at registration.', v_fee.name
      using errcode = 'check_violation', hint = 'fee_id';
  end if;
  if v_fee.effective_from > current_date then
    raise exception '% takes effect on %.', v_fee.name, to_char(v_fee.effective_from, 'DD Mon YYYY')
      using errcode = 'check_violation', hint = 'fee_id';
  end if;

  insert into member_fees (member_id, fee_id, fee_name, amount, currency, is_mandatory,
                           charged_at_registration, charge_reason, created_by)
  values (p_member_id, v_fee.id, v_fee.name, v_fee.amount, v_fee.currency, v_fee.is_mandatory,
          false, btrim(p_reason), auth.uid())
  returning * into v_charge;

  perform write_audit('fees.charged', 'Fees', v_charge.id::text,
    format('%s of %s charged to %s (%s)', v_fee.name, ugx(v_fee.amount), v_member.full_name, v_member.member_no),
    null, to_jsonb(v_charge), p_reason);

  return to_jsonb(v_charge);
end;
$$;

/** Waive an unpaid fee. Money already paid is corrected by reversal, not waiver. */
create or replace function waive_member_fee(p_charge_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_charge member_fees;
  v_member members;
begin
  perform assert_permission('fees.manage');

  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Give a reason of at least five characters for waiving this fee.'
      using errcode = 'check_violation', hint = 'reason';
  end if;

  select * into v_charge from member_fees where id = p_charge_id for update;
  if not found then
    raise exception 'Fee charge not found.' using errcode = 'no_data_found';
  end if;
  if v_charge.status <> 'unpaid' then
    raise exception 'Only an unpaid fee can be waived. This one is %.', v_charge.status
      using errcode = 'check_violation';
  end if;

  update member_fees
     set status = 'waived', waived_by = auth.uid(), waived_at = now(), waived_reason = btrim(p_reason)
   where id = p_charge_id
   returning * into v_charge;

  select * into v_member from members where id = v_charge.member_id;

  perform write_audit('fees.waived', 'Fees', p_charge_id::text,
    format('%s of %s waived for %s (%s)', v_charge.fee_name, ugx(v_charge.amount),
           v_member.full_name, v_member.member_no),
    jsonb_build_object('status', 'unpaid'), jsonb_build_object('status', 'waived'), p_reason);

  perform maybe_activate_member(v_charge.member_id);

  return to_jsonb(v_charge);
end;
$$;

/**
 * When a fee payment is reversed, the fees it paid are owed again, and a
 * member it activated goes back to pending if the SACCO ties activation to
 * fees. The payment's lines stay, so the original receipt still prints.
 */
create or replace function transactions_fee_reversal()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_member_id uuid;
  v_member    members;
begin
  if new.status <> 'reversal' or new.type <> 'fee' or new.reverses_id is null then
    return null;
  end if;

  for v_member_id in
    update member_fees
       set status = 'unpaid', paid_transaction_id = null, paid_on = null
     where paid_transaction_id = new.reverses_id
    returning member_id
  loop
    select * into v_member from members where id = v_member_id for update;
    if v_member.status = 'active'
       and setting_bool('members.activation_requires_fees')
       and exists (select 1 from member_fees
                    where member_id = v_member_id and status = 'unpaid'
                      and is_mandatory and charged_at_registration) then
      update members set status = 'pending' where id = v_member_id;
      perform write_audit('member.returned_to_pending', 'Members', v_member_id::text,
        format('Member %s (%s) returned to pending: the registration fee payment was reversed',
               v_member.full_name, v_member.member_no),
        jsonb_build_object('status', 'active'), jsonb_build_object('status', 'pending'),
        new.reversal_reason);
    end if;
  end loop;

  return null;
end;
$$;

drop trigger if exists transactions_fee_reversal on transactions;
create trigger transactions_fee_reversal
  after insert on transactions
  for each row execute function transactions_fee_reversal();

-- ---------------------------------------------------------------------------
-- 8. Registration
-- ---------------------------------------------------------------------------

/** A date from a form field, or a sentence naming the field that is wrong. */
create or replace function form_date(p_value text, p_field text, p_label text)
returns date language plpgsql immutable as $$
begin
  if nullif(btrim(coalesce(p_value, '')), '') is null then
    return null;
  end if;
  return p_value::date;
exception when others then
  raise exception 'Enter a valid % (YYYY-MM-DD).', p_label using errcode = 'check_violation', hint = p_field;
end;
$$;

/** The state of a registration, for the confirmation screen and for retries. */
create or replace function registration_summary(p_member_id uuid, p_duplicate boolean)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'member_id',   m.id,
    'member_no',   m.member_no,
    'full_name',   m.full_name,
    'phone',       m.phone,
    'status',      m.status,
    'has_login',   m.user_id is not null,
    'total_due',   (select coalesce(sum(amount), 0) from member_fees
                     where member_id = m.id and charged_at_registration),
    'amount_paid', (select coalesce(sum(amount), 0) from member_fees
                     where member_id = m.id and charged_at_registration and status = 'paid'),
    'charges',     (select coalesce(jsonb_agg(jsonb_build_object(
                             'id', id, 'name', fee_name, 'amount', amount,
                             'is_mandatory', is_mandatory, 'status', status)
                           order by is_mandatory desc, fee_name), '[]'::jsonb)
                      from member_fees where member_id = m.id and charged_at_registration),
    'payment',     (select fee_payment_result(mf.paid_transaction_id, p_duplicate)
                      from member_fees mf
                     where mf.member_id = m.id and mf.charged_at_registration
                       and mf.paid_transaction_id is not null
                     order by mf.paid_on desc limit 1),
    'duplicate',   p_duplicate
  )
  from members m where m.id = p_member_id;
$$;

/**
 * Register a member. One call, one database transaction.
 *
 *   p_member            the form: full_name, phone, email, national_id,
 *                       date_of_birth, gender, address, occupation,
 *                       next_of_kin_name / _phone / _relation, joined_on,
 *                       share_category_id, savings_category_id
 *   p_optional_fee_ids  the optional registration fees the member is taking
 *   p_payment           { pay_now, account_id, method, reference, paid_on,
 *                         amount_received, idempotency_key } or null
 *   p_expected_total    the total the officer was shown. If the fees changed
 *                       while the form was open, registration stops and says so
 *                       rather than charge a figure nobody saw.
 *   p_registration_key  idempotency: a retry returns the member already made
 */
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
  v_share     share_categories;
  v_savings   savings_categories;
  v_share_id  uuid;
  v_sav_id    uuid;
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

  -- --- Categories ----------------------------------------------------------
  v_share_id := nullif(p_member ->> 'share_category_id', '')::uuid;
  v_sav_id   := nullif(p_member ->> 'savings_category_id', '')::uuid;

  if setting_bool('members.registration_requires_categories') then
    if v_share_id is null then
      raise exception 'Choose the member''s share category.' using errcode = 'check_violation', hint = 'share_category_id';
    end if;
    if v_sav_id is null then
      raise exception 'Choose the member''s savings category.' using errcode = 'check_violation', hint = 'savings_category_id';
    end if;
  end if;

  if v_share_id is not null then
    select * into v_share from share_categories where id = v_share_id and status = 'active';
    if not found then
      raise exception 'That share category is not available.' using errcode = 'check_violation', hint = 'share_category_id';
    end if;
  end if;
  if v_sav_id is not null then
    select * into v_savings from savings_categories where id = v_sav_id and status = 'active';
    if not found then
      raise exception 'That savings category is not available.' using errcode = 'check_violation', hint = 'savings_category_id';
    end if;
  end if;
  if setting_bool('categories.share_matches_savings')
     and v_share.id is not null and v_savings.id is not null
     and split_part(v_savings.code, '_', 1) <> v_share.code then
    raise exception 'This SACCO requires the savings category to match the share category. % shares go with the % saver category.',
      v_share.name, v_share.name using errcode = 'check_violation', hint = 'savings_category_id';
  end if;

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
                       next_of_kin_relation, joined_on, status, share_category_id,
                       savings_category_id, created_by, registration_key,
                       allow_shared_phone, shared_phone_reason, activated_at)
  values (next_document_no('M', 7), v_name, v_phone, v_email, v_nin, v_dob, v_gender,
          nullif(btrim(coalesce(p_member ->> 'address', '')), ''),
          nullif(btrim(coalesce(p_member ->> 'occupation', '')), ''),
          v_nok_name, v_nok_phone, v_nok_rel, v_joined, v_status, v_share_id, v_sav_id,
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
      || jsonb_build_object('share_category', v_share.name, 'savings_category', v_savings.name,
                            'fees_charged', v_total),
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

/** Audit the login a server action has just created for a member. */
create or replace function log_member_login_created(p_member_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_member members;
begin
  perform assert_capability(has_permission('members.create') or has_permission('members.manage'),
                            'create member logins');
  select * into v_member from members where id = p_member_id;
  if not found or v_member.user_id is null then
    raise exception 'That member has no login.' using errcode = 'no_data_found';
  end if;
  perform write_audit('user.created', 'User Management', v_member.user_id::text,
    format('Member login created for %s (%s): signs in with member number and registered phone',
           v_member.full_name, v_member.member_no),
    null, jsonb_build_object('member_id', v_member.id, 'role', 'member'), null);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Editing an official member record
-- ---------------------------------------------------------------------------

/**
 * Change a member's official details. Staff only; a reason is required and
 * every changed field is recorded with its old and new value.
 *
 * `p_changes` holds only the fields being edited, by column name. The member
 * number, status and categories are not editable here: the first never
 * changes, the other two have their own audited functions.
 */
create or replace function update_member_profile(
  p_member_id          uuid,
  p_changes            jsonb,
  p_reason             text,
  p_allow_shared_phone boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_old     members;
  v_new     members;
  v_key     text;
  v_val     text;
  v_labels  jsonb := jsonb_build_object(
    'full_name', 'Full name', 'phone', 'Phone number', 'email', 'Email',
    'national_id', 'National ID', 'date_of_birth', 'Date of birth', 'gender', 'Gender',
    'address', 'Address', 'occupation', 'Occupation',
    'next_of_kin_name', 'Next of kin', 'next_of_kin_phone', 'Next of kin phone',
    'next_of_kin_relation', 'Next of kin relationship', 'photo_url', 'Photo',
    'joined_on', 'Membership date');
  v_changed text[] := '{}';
  v_oldj    jsonb := '{}';
  v_newj    jsonb := '{}';
  v_other   members;
  v_min_age integer;
  v_actor   text;
begin
  perform assert_permission('members.manage');

  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Give a reason for this change - it is kept on the member''s record.'
      using errcode = 'check_violation', hint = 'reason';
  end if;

  select key into v_key from jsonb_object_keys(coalesce(p_changes, '{}')) key
   where not v_labels ? key limit 1;
  if v_key is not null then
    raise exception '"%" cannot be changed here.', v_key using errcode = 'check_violation';
  end if;

  select * into v_old from members where id = p_member_id for update;
  if not found then
    raise exception 'Member not found.' using errcode = 'no_data_found';
  end if;
  v_new := v_old;

  if p_changes ? 'full_name' then
    v_new.full_name := regexp_replace(btrim(coalesce(p_changes ->> 'full_name', '')), '\s+', ' ', 'g');
    if length(v_new.full_name) < 3 or v_new.full_name !~ '\S+\s+\S+' or length(v_new.full_name) > 120 then
      raise exception 'Enter the member''s full name - at least a first and a last name.'
        using errcode = 'check_violation', hint = 'full_name';
    end if;
  end if;

  if p_changes ? 'phone' then
    v_new.phone := normalize_ug_phone(p_changes ->> 'phone');
    if v_new.phone is null then
      raise exception 'Enter a valid Ugandan mobile number, e.g. 0772 123 456.'
        using errcode = 'check_violation', hint = 'phone';
    end if;
    if v_new.phone <> v_old.phone then
      select * into v_other from members
       where phone = v_new.phone and id <> p_member_id and status not in ('archived', 'exited')
       limit 1;
      if found then
        if not coalesce(p_allow_shared_phone, false) then
          raise exception '% is already the phone number of % (%).',
            format_ug_phone(v_new.phone), v_other.full_name, v_other.member_no
            using errcode = 'unique_violation', hint = 'phone';
        end if;
        perform assert_permission('members.phone_override');
        v_new.allow_shared_phone := true;
        v_new.shared_phone_reason := btrim(p_reason);
      else
        v_new.allow_shared_phone := false;
        v_new.shared_phone_reason := null;
      end if;
    end if;
  end if;

  if p_changes ? 'email' then
    v_new.email := nullif(lower(btrim(coalesce(p_changes ->> 'email', ''))), '');
    if v_new.email is not null and v_new.email::text !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception 'Enter a valid email address, or leave it blank.' using errcode = 'check_violation', hint = 'email';
    end if;
  end if;

  if p_changes ? 'national_id' then
    v_new.national_id := nullif(upper(regexp_replace(coalesce(p_changes ->> 'national_id', ''), '\s', '', 'g')), '');
    if v_new.national_id is null and setting_bool('members.require_national_id') then
      raise exception 'The National ID cannot be removed: the SACCO requires one.' using errcode = 'check_violation', hint = 'national_id';
    end if;
    if v_new.national_id is not null and exists (
      select 1 from members where upper(national_id) = v_new.national_id and id <> p_member_id
    ) then
      raise exception 'National ID % is already registered to another member.', v_new.national_id
        using errcode = 'unique_violation', hint = 'national_id';
    end if;
  end if;

  if p_changes ? 'date_of_birth' then
    v_new.date_of_birth := form_date(p_changes ->> 'date_of_birth', 'date_of_birth', 'date of birth');
    if v_new.date_of_birth > current_date then
      raise exception 'A date of birth cannot be in the future.' using errcode = 'check_violation', hint = 'date_of_birth';
    end if;
    v_min_age := setting_int('members.min_age');
    if v_new.date_of_birth is not null and v_min_age > 0
       and v_new.date_of_birth > (current_date - make_interval(years => v_min_age))::date then
      raise exception 'Members must be at least % years old.', v_min_age using errcode = 'check_violation', hint = 'date_of_birth';
    end if;
  end if;

  if p_changes ? 'gender' then
    v_new.gender := nullif(lower(btrim(coalesce(p_changes ->> 'gender', ''))), '');
    if v_new.gender is not null and v_new.gender not in ('male', 'female', 'other') then
      raise exception 'Choose a gender from the list.' using errcode = 'check_violation', hint = 'gender';
    end if;
  end if;

  if p_changes ? 'joined_on' then
    v_new.joined_on := form_date(p_changes ->> 'joined_on', 'joined_on', 'membership date');
    if v_new.joined_on is null or v_new.joined_on > current_date then
      raise exception 'Enter a membership date that is not in the future.' using errcode = 'check_violation', hint = 'joined_on';
    end if;
  end if;

  if p_changes ? 'address' then
    v_new.address := nullif(btrim(coalesce(p_changes ->> 'address', '')), '');
  end if;
  if p_changes ? 'occupation' then
    v_new.occupation := nullif(btrim(coalesce(p_changes ->> 'occupation', '')), '');
  end if;
  if p_changes ? 'next_of_kin_name' then
    v_new.next_of_kin_name := nullif(btrim(coalesce(p_changes ->> 'next_of_kin_name', '')), '');
  end if;
  if p_changes ? 'next_of_kin_relation' then
    v_new.next_of_kin_relation := nullif(btrim(coalesce(p_changes ->> 'next_of_kin_relation', '')), '');
  end if;
  if p_changes ? 'next_of_kin_phone' then
    v_val := nullif(btrim(coalesce(p_changes ->> 'next_of_kin_phone', '')), '');
    v_new.next_of_kin_phone := case when v_val is null then null else normalize_ug_phone(v_val) end;
    if v_val is not null and v_new.next_of_kin_phone is null then
      raise exception 'Enter a valid Ugandan mobile number for the next of kin.'
        using errcode = 'check_violation', hint = 'next_of_kin_phone';
    end if;
  end if;
  if p_changes ? 'photo_url' then
    v_new.photo_url := nullif(btrim(coalesce(p_changes ->> 'photo_url', '')), '');
  end if;

  for v_key in select jsonb_object_keys(v_labels) loop
    if (to_jsonb(v_old) -> v_key) is distinct from (to_jsonb(v_new) -> v_key) then
      v_changed := v_changed || v_key;
      v_oldj := v_oldj || jsonb_build_object(v_key, to_jsonb(v_old) -> v_key);
      v_newj := v_newj || jsonb_build_object(v_key, to_jsonb(v_new) -> v_key);
    end if;
  end loop;

  if cardinality(v_changed) = 0 then
    raise exception 'Nothing changed.' using errcode = 'check_violation';
  end if;

  update members
     set full_name = v_new.full_name, phone = v_new.phone, email = v_new.email,
         national_id = v_new.national_id, date_of_birth = v_new.date_of_birth,
         gender = v_new.gender, address = v_new.address, occupation = v_new.occupation,
         next_of_kin_name = v_new.next_of_kin_name, next_of_kin_phone = v_new.next_of_kin_phone,
         next_of_kin_relation = v_new.next_of_kin_relation, photo_url = v_new.photo_url,
         joined_on = v_new.joined_on, allow_shared_phone = v_new.allow_shared_phone,
         shared_phone_reason = v_new.shared_phone_reason
   where id = p_member_id
   returning * into v_new;

  select full_name into v_actor from app_users where id = auth.uid();

  insert into member_profile_changes (member_id, field, field_label, old_value, new_value,
                                      reason, changed_by, changed_by_name)
  select p_member_id, k, v_labels ->> k,
         case when k in ('phone', 'next_of_kin_phone') then format_ug_phone(v_oldj ->> k) else v_oldj ->> k end,
         case when k in ('phone', 'next_of_kin_phone') then format_ug_phone(v_newj ->> k) else v_newj ->> k end,
         btrim(p_reason), auth.uid(), v_actor
    from unnest(v_changed) k;

  -- A member's login shows their name; keep it in step with the register.
  if v_new.user_id is not null then
    update app_users set full_name = v_new.full_name, phone = v_new.phone where id = v_new.user_id;
  end if;

  perform write_audit('member.profile_updated', 'Members', p_member_id::text,
    format('Member %s: %s changed', v_new.member_no,
           (select string_agg(lower(v_labels ->> k), ', ') from unnest(v_changed) k)),
    v_oldj, v_newj, p_reason);

  if 'phone' = any (v_changed) then
    perform write_audit('member.phone_changed', 'Members', p_member_id::text,
      format('Member %s phone number changed from %s to %s', v_new.member_no,
             format_ug_phone(v_old.phone), format_ug_phone(v_new.phone)),
      jsonb_build_object('phone', v_old.phone), jsonb_build_object('phone', v_new.phone), p_reason);
  end if;
  if 'full_name' = any (v_changed) then
    perform write_audit('member.name_changed', 'Members', p_member_id::text,
      format('Member %s name changed from %s to %s', v_new.member_no, v_old.full_name, v_new.full_name),
      jsonb_build_object('full_name', v_old.full_name), jsonb_build_object('full_name', v_new.full_name),
      p_reason);
  end if;

  return jsonb_build_object('member_id', p_member_id, 'changed', to_jsonb(v_changed),
                            'user_id', v_new.user_id, 'phone', v_new.phone);
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Member status, with the lifecycle
--
--   pending   registered; mandatory fees not yet paid (set by registration)
--   active    a full member
--   suspended temporarily barred
--   inactive  dormant
--   archived  left the SACCO; the record is kept, never deleted
-- ---------------------------------------------------------------------------
create or replace function set_member_status(
  p_member_id uuid,
  p_status    member_status,
  p_reason    text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_member members;
  v_old    member_status;
  v_out    numeric(16,2);
  v_unpaid numeric(16,2);
begin
  perform assert_permission('members.status');

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required when changing a member''s status.'
      using errcode = 'check_violation', hint = 'reason';
  end if;
  if p_status = 'exited' then
    raise exception 'Use Archived for a member who has left the SACCO.' using errcode = 'check_violation';
  end if;
  if p_status = 'pending' then
    raise exception 'A member is pending only between registration and paying the mandatory fees.'
      using errcode = 'check_violation';
  end if;

  select * into v_member from members where id = p_member_id for update;
  if not found then
    raise exception 'Member not found.' using errcode = 'no_data_found';
  end if;
  if v_member.status = p_status then
    raise exception 'This member is already %.', p_status using errcode = 'check_violation';
  end if;
  v_old := v_member.status;

  if p_status = 'active' and setting_bool('members.activation_requires_fees') then
    select coalesce(sum(amount), 0) into v_unpaid
      from member_fees
     where member_id = p_member_id and status = 'unpaid' and is_mandatory and charged_at_registration;
    if v_unpaid > 0 then
      raise exception 'This member still owes % in mandatory registration fees. Record the payment, or waive the fee, before activating them.',
        ugx(v_unpaid) using errcode = 'check_violation';
    end if;
  end if;

  if p_status in ('inactive', 'archived') then
    select coalesce(sum(lb.outstanding), 0) into v_out
      from loan_balances lb
     where lb.member_id = p_member_id and lb.status in ('active', 'disbursed', 'defaulted');
    if v_out > 0 then
      raise exception 'This member still owes % on a loan. Settle it before making them %.',
        ugx(v_out), p_status using errcode = 'check_violation';
    end if;
  end if;

  update members
     set status = p_status,
         activated_at = case when p_status = 'active' then coalesce(activated_at, now()) else activated_at end
   where id = p_member_id
   returning * into v_member;

  perform write_audit('member.' || p_status::text, 'Members', v_member.id::text,
    format('Member %s (%s) %s (was %s)', v_member.full_name, v_member.member_no,
           case p_status when 'active' then 'activated' else 'marked ' || p_status::text end, v_old),
    jsonb_build_object('status', v_old), jsonb_build_object('status', v_member.status), p_reason);

  if p_status = 'active' then
    perform ensure_member_schedule(p_member_id, current_date);
  end if;

  return jsonb_build_object('member_id', v_member.id, 'status', v_member.status);
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. Member sign-in: member number + registered phone number
-- ---------------------------------------------------------------------------
create table if not exists member_login_attempts (
  id         bigserial primary key,
  member_no  text not null,
  client     text,
  succeeded  boolean not null,
  reason     text,
  -- clock_timestamp(), not now(): attempts inside one transaction still have
  -- an order, which the lock-out arithmetic depends on.
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists member_login_attempts_member_idx on member_login_attempts (member_no, created_at desc);
create index if not exists member_login_attempts_client_idx on member_login_attempts (client, created_at desc)
  where client is not null;

/** The sign-in identity of a member's login: an address that is never a mailbox. */
create or replace function member_auth_email(p_member_no text)
returns text language sql immutable as $$
  select lower(p_member_no) || '@members.bnd-sacco.invalid';
$$;

/**
 * Check a member number and phone number against the register.
 *
 * Called only by the server's sign-in action, with the service-role key. The
 * answer never says which half was wrong. Failures are counted per member
 * number and per client; past the limit in Settings -> Security the member
 * number is locked for the lock-out period, correct phone or not.
 *
 * Returns the auth user to sign in as, or - for a member who has never signed
 * in - the address to create their login under.
 */
create or replace function member_login_verify(p_member_no text, p_phone text, p_client text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_no      text := upper(regexp_replace(coalesce(p_member_no, ''), '\s', '', 'g'));
  v_phone   text := normalize_ug_phone(p_phone);
  v_client  text := nullif(left(btrim(coalesce(p_client, '')), 100), '');
  v_max     integer := setting_int('security.member_login_max_attempts');
  v_window  interval := make_interval(mins => setting_int('security.member_login_lockout_minutes'));
  v_since   timestamptz;
  v_fails   integer;
  v_last    timestamptz;
  v_member  members;
  v_user    app_users;
  v_kind    text;
  v_email   text;
  v_auth_id uuid;
begin
  -- "123" and "BND-M-123" both mean BND-M-0000123.
  if v_no ~ '^[0-9]{1,7}$' then
    v_no := 'BND-M-' || lpad(v_no, 7, '0');
  elsif v_no ~ '^BND-?M-?[0-9]{1,7}$' then
    v_no := 'BND-M-' || lpad(regexp_replace(v_no, '\D', '', 'g'), 7, '0');
  end if;

  select coalesce(max(created_at), '-infinity') into v_since
    from member_login_attempts where member_no = v_no and succeeded;
  select count(*), max(created_at) into v_fails, v_last
    from member_login_attempts
   where member_no = v_no and not succeeded and created_at > greatest(v_since, now() - v_window);

  if v_fails >= v_max then
    insert into member_login_attempts (member_no, client, succeeded, reason)
    values (v_no, v_client, false, 'locked');
    return jsonb_build_object('ok', false, 'reason', 'locked', 'retry_at', v_last + v_window);
  end if;

  if v_client is not null and (
    select count(*) from member_login_attempts
     where client = v_client and not succeeded and created_at > now() - v_window
  ) >= v_max * 4 then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'retry_at', now() + v_window);
  end if;

  select * into v_member from members where member_no = v_no;

  if not found or v_phone is null or v_member.phone <> v_phone then
    insert into member_login_attempts (member_no, client, succeeded, reason)
    values (v_no, v_client, false, 'mismatch');
    return jsonb_build_object('ok', false, 'reason', 'invalid',
                              'attempts_left', greatest(v_max - v_fails - 1, 0));
  end if;

  if v_member.status not in ('active', 'pending') then
    insert into member_login_attempts (member_no, client, succeeded, reason)
    values (v_no, v_client, false, 'status:' || v_member.status);
    return jsonb_build_object('ok', false, 'reason', 'inactive', 'status', v_member.status);
  end if;

  if v_member.user_id is not null then
    select * into v_user from app_users where id = v_member.user_id;
    select kind into v_kind from roles where key = v_user.role;
    if v_kind is distinct from 'member' then
      insert into member_login_attempts (member_no, client, succeeded, reason)
      values (v_no, v_client, false, 'staff_account');
      return jsonb_build_object('ok', false, 'reason', 'staff_account');
    end if;
    if not v_user.is_active then
      insert into member_login_attempts (member_no, client, succeeded, reason)
      values (v_no, v_client, false, 'disabled');
      return jsonb_build_object('ok', false, 'reason', 'disabled');
    end if;
    select email into v_email from auth.users where id = v_member.user_id;
    v_auth_id := v_member.user_id;
  else
    -- Never signed in. A login made earlier under the member address but not
    -- linked (a failure half way) is adopted rather than duplicated.
    v_email := member_auth_email(v_member.member_no);
    select id into v_auth_id from auth.users where email = v_email;
    if v_auth_id is not null then
      if exists (select 1 from members where user_id = v_auth_id) then
        v_auth_id := null;
        v_email := null;
      else
        insert into app_users (id, full_name, phone, role, is_active)
        values (v_auth_id, v_member.full_name, v_member.phone, 'member', true)
        on conflict (id) do update set role = 'member', is_active = true;
        update members set user_id = v_auth_id where id = v_member.id;
      end if;
    end if;
    if v_email is null then
      insert into member_login_attempts (member_no, client, succeeded, reason)
      values (v_no, v_client, false, 'login_conflict');
      return jsonb_build_object('ok', false, 'reason', 'conflict');
    end if;
  end if;

  insert into member_login_attempts (member_no, client, succeeded, reason)
  values (v_no, v_client, true, null);

  return jsonb_build_object(
    'ok', true,
    'member_id', v_member.id,
    'member_no', v_member.member_no,
    'full_name', v_member.full_name,
    'phone', v_member.phone,
    'status', v_member.status,
    'user_id', v_auth_id,
    'auth_email', v_email
  );
end;
$$;

-- The old member-number-to-email lookup served password sign-in by member
-- number, which no longer exists.
drop function if exists email_for_member_no(text);

-- ---------------------------------------------------------------------------
-- 12. Read paths
-- ---------------------------------------------------------------------------

/** Member search that understands phone numbers however they are typed. */
create or replace function search_members(
  p_query   text default null,
  p_status  member_status default null,
  p_sort    text default 'name',
  p_limit   integer default 20,
  p_offset  integer default 0,
  p_savings_category_id uuid default null,
  p_share_category_id   uuid default null,
  p_uncategorised       boolean default false
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_rows  jsonb;
  v_total bigint;
  v_q     text := nullif(trim(coalesce(p_query, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  -- "0772 123", "+256 772 123" and "772123" all find +256772123...
  v_tail  text := nullif(regexp_replace(regexp_replace(regexp_replace(coalesce(p_query, ''), '\D', '', 'g'),
                                                       '^(00)?256', ''), '^0', ''), '');
begin
  perform assert_capability(can_view_operations(), 'view members');

  if v_tail is not null and length(v_tail) < 4 then
    v_tail := null;
  end if;

  select count(*) into v_total
    from members m
   where (p_status is null or m.status = p_status)
     and (p_savings_category_id is null or m.savings_category_id = p_savings_category_id)
     and (p_share_category_id   is null or m.share_category_id   = p_share_category_id)
     and (not coalesce(p_uncategorised, false) or m.savings_category_id is null)
     and (v_q is null
          or m.full_name ilike '%' || v_q || '%'
          or m.member_no ilike '%' || v_q || '%'
          or m.phone     ilike '%' || v_q || '%'
          or (v_tail is not null and m.phone like '%' || v_tail || '%')
          or coalesce(m.national_id, '') ilike '%' || v_q || '%');

  select coalesce(jsonb_agg(to_jsonb(r) order by r.sort_rank), '[]'::jsonb)
    into v_rows
    from (
      select mf.*,
             case p_sort
               when 'recent'   then row_number() over (order by mf.joined_on desc, mf.full_name)
               when 'savings'  then row_number() over (order by mf.savings_balance desc, mf.full_name)
               when 'shares'   then row_number() over (order by mf.share_value desc, mf.full_name)
               when 'loan'     then row_number() over (order by mf.loan_balance desc, mf.full_name)
               when 'category' then row_number() over (order by mf.savings_category_name nulls last, mf.full_name)
               when 'number'   then row_number() over (order by mf.member_no)
               else                 row_number() over (order by mf.full_name)
             end as sort_rank
        from member_financials mf
       where (p_status is null or mf.status = p_status)
         and (p_savings_category_id is null or mf.savings_category_id = p_savings_category_id)
         and (p_share_category_id   is null or mf.share_category_id   = p_share_category_id)
         and (not coalesce(p_uncategorised, false) or mf.savings_category_id is null)
         and (v_q is null
              or mf.full_name ilike '%' || v_q || '%'
              or mf.member_no ilike '%' || v_q || '%'
              or mf.phone     ilike '%' || v_q || '%'
              or (v_tail is not null and mf.phone like '%' || v_tail || '%')
              or coalesce(mf.national_id, '') ilike '%' || v_q || '%')
       order by sort_rank
       offset greatest(coalesce(p_offset, 0), 0)
       limit v_limit
    ) r;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'limit', v_limit,
                            'offset', greatest(coalesce(p_offset, 0), 0));
end;
$$;

/** An account balance on a date, for people who may see the books. */
create or replace function finance_account_balance_at(p_account_id uuid, p_on date default null)
returns numeric language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_capability(can_view_finance(), 'view account balances');
  return account_balance_at(p_account_id, p_on);
end;
$$;

-- A fee payment is labelled by what it paid for; a loan's withheld fees stay
-- "Loan fees". Otherwise these are 0027's views, column for column.
create or replace view account_movements
with (security_invoker = true) as
select
  e.id                  as entry_id,
  e.transaction_id,
  e.account_id,
  a.code                as account_code,
  a.name                as account_name,
  a.account_type,
  e.entry_date,
  e.debit               as money_in,
  e.credit              as money_out,
  e.balance_after,
  e.created_at,
  t.reference,
  t.type                as txn_type,
  t.status              as txn_status,
  t.method,
  t.description,
  t.external_ref,
  t.member_id,
  m.member_no,
  m.full_name           as member_name,
  t.recorded_by,
  u.full_name           as recorded_by_name,
  t.reverses_id,
  t.reversed_by_id,
  case when e.debit > 0 then sa.account_type else da.account_type end as counter_account_type,
  case when e.debit > 0 then sa.name         else da.name         end as counter_account_name,
  case
    when t.status = 'reversal' then 'reversal'
    when t.type = 'transfer' and e.debit > 0 then 'transfer_in'
    when t.type = 'transfer' then 'transfer_out'
    when t.type in ('weekly_savings', 'monthly_savings', 'deposit', 'share_purchase', 'loan_repayment')
      then 'collection'
    when t.type in ('income', 'fee', 'penalty')
         and t.member_id is not null and t.method <> 'internal' then 'collection'
    when t.type in ('income', 'fee', 'penalty') then 'other_receipt'
    when t.type = 'expense' then 'expense'
    else 'payment'
  end                   as movement_class,
  case t.type
    when 'weekly_savings'    then 'Member savings'
    when 'monthly_savings'   then 'Member savings'
    when 'deposit'           then 'Member deposits'
    when 'share_purchase'    then 'Share purchases'
    when 'loan_repayment'    then 'Loan repayments'
    when 'income'            then coalesce(ic.name, 'Other income')
    when 'fee'               then coalesce(fl.label, 'Loan fees')
    when 'penalty'           then 'Penalties'
    when 'expense'           then coalesce(ec.name, 'Expenses')
    when 'payment'           then coalesce(pc.name, 'Payments')
    when 'withdrawal'        then 'Member withdrawals'
    when 'loan_disbursement' then 'Loan disbursements'
    else 'Internal transfer'
  end                   as category_label,
  (a.opening_balance
   + sum(e.debit - e.credit) over (partition by e.account_id order by e.entry_date, e.id))::numeric(16,2)
                        as running_balance
from account_ledger_entries e
join financial_accounts a        on a.id  = e.account_id
join transactions t              on t.id  = e.transaction_id
left join financial_accounts sa  on sa.id = t.source_account_id
left join financial_accounts da  on da.id = t.destination_account_id
left join members m              on m.id  = t.member_id
left join app_users u            on u.id  = t.recorded_by
left join lateral (
  select c.name from income_entries ie
    join income_categories c on c.id = ie.category_id
   where ie.transaction_id = coalesce(t.reverses_id, t.id)
   limit 1
) ic on t.type = 'income'
left join lateral (
  select c.name from expense_entries xe
    join expense_categories c on c.id = xe.category_id
   where xe.transaction_id = coalesce(t.reverses_id, t.id)
   limit 1
) ec on t.type = 'expense'
left join lateral (
  select c.name from payments p
    join payment_categories c on c.id = p.category_id
   where p.transaction_id = coalesce(t.reverses_id, t.id)
   limit 1
) pc on t.type = 'payment'
left join lateral (
  select case when count(*) = 1 then max(l.description) else 'Member fees' end as label
    from fee_payment_lines l
   where l.transaction_id = coalesce(t.reverses_id, t.id)
  having count(*) > 0
) fl on t.type = 'fee';

create or replace view receipt_register
with (security_invoker = true) as
select
  r.id,
  r.receipt_no,
  r.transaction_id,
  t.reference,
  t.occurred_on             as receipt_date,
  t.amount,
  t.method,
  t.status,
  t.type                    as txn_type,
  t.member_id,
  m.member_no,
  m.full_name               as member_name,
  coalesce(r.payer_name, m.full_name) as payer,
  case t.type
    when 'weekly_savings'  then 'Member Savings'
    when 'monthly_savings' then 'Member Savings'
    when 'deposit'         then 'Member Savings'
    when 'share_purchase'  then 'Share Purchase'
    when 'loan_repayment'  then 'Loan Repayment'
    when 'penalty'         then 'Penalties'
    when 'fee'             then coalesce(fl.label, 'Loan Fees')
    else coalesce(ic.name, 'Other Income')
  end                       as category,
  t.destination_account_id  as receiving_account_id,
  a.name                    as receiving_account_name,
  a.account_type            as receiving_account_type,
  t.external_ref            as reference_no,
  t.description,
  t.recorded_by,
  u.full_name               as recorded_by_name,
  r.created_at
from receipts r
join transactions t            on t.id = r.transaction_id
left join members m            on m.id = t.member_id
left join financial_accounts a on a.id = t.destination_account_id
left join app_users u          on u.id = t.recorded_by
left join lateral (
  select c.name from income_entries ie
    join income_categories c on c.id = ie.category_id
   where ie.transaction_id = t.id and t.type = 'income'
   limit 1
) ic on true
left join lateral (
  select case when count(*) = 1 then max(l.description) else 'Member Fees' end as label
    from fee_payment_lines l
   where l.transaction_id = t.id
  having count(*) > 0
) fl on t.type = 'fee';

/** 0027's receipt payload, plus the lines of a fee payment and its title. */
create or replace function receipt_for_transaction(p_transaction_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_txn transaction_feed;
  v_row transactions;
  v_lines_txn uuid;
begin
  select * into v_txn from transaction_feed where id = p_transaction_id;
  if not found then
    raise exception 'Transaction not found.' using errcode = 'no_data_found';
  end if;

  if not (can_view_operations() or v_txn.member_id = current_member_id()) then
    raise exception 'You may only view your own receipts.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_row from transactions where id = p_transaction_id;
  v_lines_txn := coalesce(v_row.reverses_id, v_row.id);

  return jsonb_build_object(
    'transaction',   to_jsonb(v_txn),
    'sacco_name',    sacco_legal_name(),
    'receipt_no',    coalesce((select receipt_no from receipts where transaction_id = p_transaction_id),
                              replace(v_txn.reference, 'BND-TX-', 'BND-RCP-')),
    'external_ref',  v_row.external_ref,
    'receipt_title', case
                       when exists (select 1 from fee_payment_lines l
                                      join member_fees mf on mf.id = l.member_fee_id
                                     where l.transaction_id = v_lines_txn and mf.charged_at_registration)
                         then 'Membership Payment Receipt'
                       when exists (select 1 from fee_payment_lines l where l.transaction_id = v_lines_txn)
                         then 'Fee Payment Receipt'
                     end,
    'fee_lines',     (select coalesce(jsonb_agg(jsonb_build_object('description', l.description,
                                                                   'amount', l.amount) order by l.id), '[]'::jsonb)
                        from fee_payment_lines l where l.transaction_id = v_lines_txn),
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
    ),
    'source_account', case when can_view_finance() then (
      select jsonb_build_object('id', a.id, 'name', a.name, 'account_type', a.account_type)
        from financial_accounts a where a.id = v_row.source_account_id) end,
    'destination_account', case when can_view_finance() then (
      select jsonb_build_object('id', a.id, 'name', a.name, 'account_type', a.account_type)
        from financial_accounts a where a.id = v_row.destination_account_id) end,
    'transfer', case when can_view_finance() then (
      select jsonb_build_object('id', x.id, 'transfer_no', x.transfer_no, 'kind', x.kind,
                                'source_reference', x.source_reference,
                                'destination_reference', x.destination_reference,
                                'handled_by', x.handled_by, 'status', x.status)
        from internal_transfers x where x.transaction_id = coalesce(v_row.reverses_id, v_row.id)) end,
    'payment', case when can_view_finance() then (
      select jsonb_build_object('id', p.id, 'payment_no', p.payment_no, 'payee', p.payee,
                                'reference', p.reference, 'status', p.status)
        from payments p where p.transaction_id = coalesce(v_row.reverses_id, v_row.id)) end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 13. Row-level security for the new tables
-- ---------------------------------------------------------------------------
alter table fees                   enable row level security;
alter table member_fees            enable row level security;
alter table fee_payment_lines      enable row level security;
alter table member_profile_changes enable row level security;
alter table member_login_attempts  enable row level security;

drop policy if exists fees_staff_read on fees;
create policy fees_staff_read on fees for select using (is_staff_user());

drop policy if exists member_fees_self_read on member_fees;
create policy member_fees_self_read on member_fees for select using (member_id = current_member_id());
drop policy if exists member_fees_staff_read on member_fees;
create policy member_fees_staff_read on member_fees for select using (is_staff_user());

drop policy if exists fee_payment_lines_read on fee_payment_lines;
create policy fee_payment_lines_read on fee_payment_lines for select using (
  is_staff_user()
  or exists (select 1 from member_fees mf
              where mf.id = fee_payment_lines.member_fee_id and mf.member_id = current_member_id())
);

drop policy if exists member_profile_changes_read on member_profile_changes;
create policy member_profile_changes_read on member_profile_changes for select
  using (has_permission('members.manage') or has_permission('audit.view'));

drop policy if exists member_login_attempts_read on member_login_attempts;
create policy member_login_attempts_read on member_login_attempts for select
  using (has_permission('audit.view'));

-- ---------------------------------------------------------------------------
-- 14. Who may call what
--
-- Supabase grants EXECUTE on every new function in `public` to `anon` and
-- `authenticated` by default, and `revoke ... from public` - which earlier
-- migrations relied on - does not undo a grant made to a named role. So every
-- internal helper was callable over the REST API, including the ones that
-- write ledger rows, account entries and audit lines without checking anyone.
--
-- From here the rule is the other way round: nothing is callable unless it is
-- on this list, and everything on the list checks its caller itself.
-- ---------------------------------------------------------------------------
do $grants$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and not exists (select 1 from pg_depend d
                        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
end
$grants$;

alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

do $allow$
declare
  v_name text;
  r      record;
  v_allowed text[] := array[
    -- Predicates evaluated inside row-level security policies and views, as
    -- the querying user. Each answers a question about the caller only.
    'current_member_id', 'my_member_no', 'my_member_status', 'my_loan_ids',
    'my_guaranteed_loan_ids', 'has_role', 'has_permission', 'is_staff_user', 'current_role_of',
    'can_view_operations', 'can_record_savings', 'can_manage_categories', 'can_view_finance',
    'can_record_finance', 'can_view_audit', 'can_manage_settings', 'can_approve_finance',
    'can_reconcile_finance', 'can_manage_finance_accounts', 'share_unit_price',

    -- Session
    'my_session', 'touch_last_login', 'settings_map', 'mark_notifications_read',

    -- Members, categories, fees
    'register_member', 'registration_fee_schedule', 'update_member_profile', 'set_member_status',
    'set_member_categories', 'search_members', 'search_guarantor_candidates',
    'member_collection_view', 'member_savings_overview', 'member_statement',
    'log_member_login_created',
    'create_fee', 'update_fee', 'set_fee_status', 'pay_member_fees', 'charge_member_fee',
    'waive_member_fee',
    'create_share_category', 'update_share_category', 'set_share_category_status',
    'create_savings_category', 'update_savings_category', 'set_savings_category_status',

    -- Staff accounts and roles
    'assert_can_assign_role', 'log_staff_account_created', 'set_user_role', 'set_user_active',
    'create_role', 'update_role', 'set_role_status', 'set_role_permissions',

    -- Savings, shares, loans
    'record_savings_payment', 'record_scheduled_savings', 'waive_savings_schedule',
    'open_savings_periods', 'open_savings_schedules', 'savings_dashboard', 'savings_performance',
    'savings_category_analytics', 'buy_shares', 'quote_loan', 'apply_for_loan', 'set_loan_status',
    'disburse_loan', 'record_loan_repayment', 'set_guarantor_status', 'remove_guarantor',
    'loan_portfolio', 'save_loan_product', 'set_loan_product_active',

    -- Transactions and finance
    'receipt_for_transaction', 'reverse_transaction', 'record_cash_movement', 'record_income',
    'record_expense', 'approve_expense', 'record_member_collection', 'record_other_receipt',
    'create_internal_transfer', 'submit_internal_transfer', 'decide_internal_transfer',
    'cancel_internal_transfer', 'create_payment', 'submit_payment', 'decide_payment',
    'cancel_payment', 'record_reconciliation', 'attach_finance_document',
    'create_financial_account', 'update_financial_account', 'set_financial_account_status',
    'save_finance_category', 'finance_account_balance_at', 'default_financial_account',
    'treasury_summary',
    'treasury_monthly_flow', 'cash_bank_report', 'receipts_and_payments', 'cashbook',
    'dashboard_metrics', 'collections_trend',

    -- Settings
    'update_settings', 'reset_setting', 'update_organisation_settings',
    'update_notification_settings', 'update_share_settings'
  ];
begin
  foreach v_name in array v_allowed loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = v_name) then
      raise exception 'Grant list names %, which does not exist.', v_name;
    end if;
    for r in
      select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = v_name
    loop
      execute format('grant execute on function %s to authenticated', r.sig);
    end loop;
  end loop;
end
$allow$;

-- The one thing a signed-out visitor may ask: the SACCO's name, for the
-- sign-in screen.
grant execute on function sacco_public_brand() to anon, authenticated;

-- The server's sign-in action, and nothing else.
grant execute on function member_login_verify(text, text, text) to service_role;

-- Tables: a signed-out visitor reads nothing; a signed-in one reads what RLS
-- allows and writes only where a policy was written for it.
revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from authenticated;
grant select on all tables in schema public to authenticated;

grant insert, update on savings_plans to authenticated;      -- policy savings_plans_staff_write
grant update (read_at) on notifications to authenticated;     -- policy notifications_self_update
grant insert on loan_documents to authenticated;              -- policies loan_documents_*_insert / _write

alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate, references, trigger on tables from authenticated;
