-- ===========================================================================
-- BUD-SACCO - 0032 - One login for everyone: identifier + password
--
-- Replaces the member sign-in of 0030 (member number + phone number, with a
-- password derived on the server) and the separate staff sign-in.
--
-- From here, everyone signs in on one form with:
--
--   an identifier   - a member number (BND-M-0000123), a phone number
--                     (0772 123 456 / +256772123456) or, for staff who have
--                     one, an email address
--   a password      - which they chose themselves, held by Supabase Auth as a
--                     bcrypt hash. It is never stored or shown anywhere else.
--
-- The server resolves the identifier to the login account(s) it could belong
-- to (`login_resolve()`), tries the password against Supabase Auth, and only
-- then reads the account's role - from `app_users`, never from anything the
-- browser sent - and sends the person to that role's dashboard.
--
-- Nobody hands anybody a password. A new member or staff account starts with
-- a random password that no person knows, and a one-time SETUP CODE. The code
-- is shown once to the officer who created the account, who gives it to the
-- account holder; they enter it with their identifier on "Set up your account"
-- and choose their own password. "Initiate password reset" issues a new code
-- the same way. Only a bcrypt hash of a code is stored, codes expire, and each
-- works once. The code is the seam for SMS or OTP delivery later: the same
-- code can be sent by text instead of handed over.
--
-- Failed sign-ins are counted per identifier and per client; past the limit in
-- Settings -> Security the identifier is paused for the lock-out period, never
-- permanently. Every sign-in, failure, sign-out, reset and password change is
-- in the audit log; no password ever is.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Which dashboard each role lands on
-- ---------------------------------------------------------------------------
alter table roles add column if not exists dashboard text not null default 'overview';

do $$ begin
  alter table roles add constraint roles_dashboard_check check (dashboard in (
    'administration', 'overview', 'cashier', 'loans', 'finance', 'collections', 'portal'));
exception when duplicate_object then null; end $$;

update roles set dashboard = case key
    when 'super_admin'   then 'administration'
    when 'admin'         then 'administration'
    when 'manager'       then 'overview'
    when 'cashier'       then 'cashier'
    when 'loan_officer'  then 'loans'
    when 'accountant'    then 'finance'
    when 'field_officer' then 'collections'
    when 'member'        then 'portal'
    else dashboard end
 where is_system;

/** Choose the dashboard a role lands on after signing in. */
create or replace function set_role_dashboard(p_role_key text, p_dashboard text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role roles;
begin
  perform assert_permission('roles.manage');

  select * into v_role from roles where key = p_role_key for update;
  if not found then
    raise exception 'Role not found.' using errcode = 'no_data_found';
  end if;
  if v_role.kind = 'member' then
    raise exception 'Members always land on the member dashboard.' using errcode = 'check_violation';
  end if;
  if p_dashboard not in ('administration', 'overview', 'cashier', 'loans', 'finance', 'collections') then
    raise exception 'Choose a dashboard from the list.' using errcode = 'check_violation', hint = 'dashboard';
  end if;
  if v_role.dashboard = p_dashboard then
    return jsonb_build_object('role', v_role.key, 'dashboard', p_dashboard);
  end if;

  update roles set dashboard = p_dashboard, updated_by = auth.uid() where key = p_role_key;

  perform write_audit('role.dashboard_changed', 'User Management', p_role_key,
    format('%s now lands on the %s dashboard', v_role.name, p_dashboard),
    jsonb_build_object('dashboard', v_role.dashboard), jsonb_build_object('dashboard', p_dashboard), p_reason);

  return jsonb_build_object('role', v_role.key, 'dashboard', p_dashboard);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Accounts
-- ---------------------------------------------------------------------------

-- When the account holder last chose their own password. Null means they have
-- not yet: the account still has the random password it was created with.
alter table app_users add column if not exists password_set_at timestamptz;

-- Staff phone numbers are login identifiers now, so they are held in the same
-- one form as members'.
update app_users
   set phone = normalize_ug_phone(phone)
 where normalize_ug_phone(phone) is not null and phone is distinct from normalize_ug_phone(phone);

/**
 * A member's own-record access now also requires the membership and the login
 * to be in good standing. A suspended, inactive or archived member - or one
 * whose login has been switched off - reads nothing, even with a session
 * token issued before the change.
 */
create or replace function current_member_id()
returns uuid language sql stable security definer set search_path = public as $$
  select m.id
    from members m
    join app_users u on u.id = m.user_id
   where m.user_id = auth.uid()
     and u.is_active
     and m.status in ('active', 'pending');
$$;

-- The member's own row goes through the same test, rather than a bare
-- user_id comparison that would still match a suspended member.
drop policy if exists members_self_read on members;
create policy members_self_read on members for select using (id = current_member_id());

/** The session payload, now with the role's dashboard. */
create or replace function my_session()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id',             u.id,
    'full_name',      coalesce(m.full_name, u.full_name),
    'email',          u.email,
    'phone',          coalesce(m.phone, u.phone),
    'photo_url',      coalesce(m.photo_url, u.photo_url),
    'is_active',      u.is_active,
    'role',           u.role,
    'role_name',      r.name,
    'role_kind',      r.kind,
    'role_active',    r.status = 'active',
    'role_dashboard', r.dashboard,
    'password_set',   u.password_set_at is not null,
    'member',         case when m.id is null then null else jsonb_build_object(
                        'id', m.id, 'member_no', m.member_no, 'status', m.status) end,
    'permissions',    coalesce((
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
 * New auth accounts, as 0029 - plus: an internal sign-in address (the
 * `.invalid` addresses given to people with no email) is never copied into
 * `app_users.email`, and a staff phone arrives normalised.
 */
create or replace function handle_new_auth_user()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_role   text := nullif(new.raw_app_meta_data ->> 'role', '');
  v_member members;
  v_mid    uuid;
  v_phone  text := nullif(btrim(new.raw_user_meta_data ->> 'phone'), '');
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
    case when v_mid is null and new.email !~* '\.invalid$' then new.email end,
    coalesce(v_member.phone, normalize_ug_phone(v_phone), v_phone),
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

/** A phone number can sign in to only one active account, unless members share it by override. */
create or replace function assert_login_phone_available(p_phone text, p_except_user uuid default null)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v_phone text := normalize_ug_phone(p_phone);
  v_who   text;
begin
  if nullif(btrim(coalesce(p_phone, '')), '') is null then
    return null;
  end if;
  if v_phone is null then
    raise exception 'Enter a valid Ugandan mobile number, e.g. 0772 123 456.'
      using errcode = 'check_violation', hint = 'phone';
  end if;
  select u.full_name into v_who
    from app_users u
   where u.phone = v_phone and u.is_active and u.id is distinct from p_except_user
   limit 1;
  if v_who is null then
    select m.full_name into v_who from members m
     where m.phone = v_phone and m.status not in ('archived', 'exited')
       and m.user_id is distinct from p_except_user
     limit 1;
  end if;
  if v_who is not null then
    raise exception '% is already the sign-in number of another account. Use a different number, or leave it blank and sign in with email.',
      format_ug_phone(v_phone) using errcode = 'unique_violation', hint = 'phone';
  end if;
  return v_phone;
end;
$$;

/** Set or change a staff account's sign-in phone number. */
create or replace function set_user_phone(p_user_id uuid, p_phone text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user app_users;
  v_kind text;
  v_new  text;
begin
  if p_user_id is distinct from auth.uid() then
    perform assert_permission('users.manage');
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Give a reason for this change.' using errcode = 'check_violation', hint = 'reason';
  end if;

  select * into v_user from app_users where id = p_user_id for update;
  if not found then
    raise exception 'User not found.' using errcode = 'no_data_found';
  end if;
  select kind into v_kind from roles where key = v_user.role;
  if v_kind = 'member' then
    raise exception 'A member signs in with the phone on their member record. Change it there.'
      using errcode = 'check_violation';
  end if;
  if v_user.role = 'super_admin' and auth.uid() <> p_user_id and current_role_of() is distinct from 'super_admin' then
    raise exception 'Only a Super Admin can change a Super Admin''s sign-in details.'
      using errcode = 'insufficient_privilege';
  end if;

  v_new := assert_login_phone_available(p_phone, p_user_id);
  if v_new is not distinct from v_user.phone then
    raise exception 'Nothing changed.' using errcode = 'check_violation';
  end if;

  update app_users set phone = v_new where id = p_user_id;

  perform write_audit('user.phone_changed', 'User Management', p_user_id::text,
    format('%s sign-in phone changed from %s to %s', v_user.full_name,
           coalesce(format_ug_phone(v_user.phone), 'none'), coalesce(format_ug_phone(v_new), 'none')),
    jsonb_build_object('phone', v_user.phone), jsonb_build_object('phone', v_new), p_reason);

  return jsonb_build_object('user_id', p_user_id, 'phone', v_new);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Settings
-- ---------------------------------------------------------------------------
select define_setting('security.login_max_attempts', 'security',
  'Sign-in attempts before a pause', 'integer',
  coalesce((select value from system_settings where key = 'security.member_login_max_attempts'), '5'::jsonb),
  'After this many wrong passwords in a row for the same member number or phone, sign-in for it is paused for the period below. It is never locked permanently.',
  'attempts', 3, 20, null, false, 40);

select define_setting('security.login_lockout_minutes', 'security',
  'Sign-in pause', 'integer',
  coalesce((select value from system_settings where key = 'security.member_login_lockout_minutes'), '15'::jsonb),
  'How long sign-in stays paused after too many wrong passwords.',
  'minutes', 1, 1440, null, false, 50);

select define_setting('security.setup_code_valid_hours', 'security',
  'Setup codes stay valid for', 'integer', '72'::jsonb,
  'A setup or reset code, given to a member or colleague so they can choose their own password, stops working after this long.',
  'hours', 1, 720, null, false, 60);

-- define_setting() keeps an existing value, so carry the old one across once.
update system_settings n
   set value = o.value
  from system_settings o
 where (n.key, o.key) in (('security.login_max_attempts', 'security.member_login_max_attempts'),
                          ('security.login_lockout_minutes', 'security.member_login_lockout_minutes'));

delete from system_settings
 where key in ('security.member_login_max_attempts', 'security.member_login_lockout_minutes');

-- ---------------------------------------------------------------------------
-- 4. Sign-in attempts
-- ---------------------------------------------------------------------------
drop function if exists member_login_verify(text, text, text);

do $$ begin
  if to_regclass('public.member_login_attempts') is not null
     and to_regclass('public.login_attempts') is null then
    alter table member_login_attempts rename to login_attempts;
    alter table login_attempts rename column member_no to identifier;
    alter index if exists member_login_attempts_member_idx rename to login_attempts_identifier_idx;
    alter index if exists member_login_attempts_client_idx rename to login_attempts_client_idx;
    alter policy member_login_attempts_read on login_attempts rename to login_attempts_read;
  end if;
end $$;

alter table login_attempts
  add column if not exists user_id uuid references app_users (id) on delete set null,
  add column if not exists kind text not null default 'sign_in';

do $$ begin
  alter table login_attempts add constraint login_attempts_kind_check check (kind in ('sign_in', 'setup'));
exception when duplicate_object then null; end $$;

/**
 * The one form an identifier is counted and looked up in: a member number as
 * BND-M-0000123, a phone as +2567XXXXXXXX, an email in lower case. Anything
 * else is kept as typed, upper-cased, so it is still rate-limited.
 */
create or replace function login_identifier_key(p_identifier text)
returns text language plpgsql immutable as $$
declare
  v    text := btrim(coalesce(p_identifier, ''));
  v_up text := upper(regexp_replace(v, '\s', '', 'g'));
begin
  if v = '' then
    return '';
  end if;
  if position('@' in v) > 0 then
    return lower(v);
  end if;
  if v_up ~ '^(BND-?M-?)?[0-9]{1,7}$' then
    return 'BND-M-' || lpad(regexp_replace(v_up, '\D', '', 'g'), 7, '0');
  end if;
  return coalesce(normalize_ug_phone(v), v_up);
end;
$$;

/** The login accounts an identifier could belong to. */
create or replace function login_candidates(p_key text)
returns table (user_id uuid, auth_email text)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_key is null or p_key = '' then
    return;
  end if;

  if position('@' in p_key) > 0 then
    return query
      select a.id, a.email::text
        from auth.users a join app_users u on u.id = a.id
       where lower(a.email) = p_key;
  elsif p_key like 'BND-M-%' then
    return query
      select a.id, a.email::text
        from members m join auth.users a on a.id = m.user_id
       where m.member_no = p_key;
  elsif p_key ~ '^\+2567[0-9]{8}$' then
    return query
      select distinct a.id, a.email::text
        from auth.users a
        join app_users u on u.id = a.id
       where u.phone = p_key
          or a.id in (select m.user_id from members m
                       where m.phone = p_key and m.user_id is not null);
  end if;
end;
$$;

/** Is this identifier (or this client) paused? */
create or replace function login_lock_state(p_key text, p_client text, p_kind text)
returns timestamptz language plpgsql stable security definer set search_path = public as $$
declare
  v_max    integer := setting_int('security.login_max_attempts');
  v_window interval := make_interval(mins => setting_int('security.login_lockout_minutes'));
  v_since  timestamptz;
  v_fails  integer;
  v_last   timestamptz;
begin
  select coalesce(max(created_at), '-infinity') into v_since
    from login_attempts where identifier = p_key and kind = p_kind and succeeded;
  select count(*), max(created_at) into v_fails, v_last
    from login_attempts
   where identifier = p_key and kind = p_kind and not succeeded
     and created_at > greatest(v_since, now() - v_window);
  if v_fails >= v_max then
    return v_last + v_window;
  end if;

  if p_client is not null then
    select count(*), max(created_at) into v_fails, v_last
      from login_attempts
     where client = p_client and not succeeded and created_at > now() - v_window;
    if v_fails >= v_max * 4 then
      return v_last + v_window;
    end if;
  end if;
  return null;
end;
$$;

/**
 * Where the server's sign-in action starts. Service role only.
 *
 * Returns whether the identifier is paused, and the accounts to try the
 * password against. It says nothing about whether the identifier exists: an
 * unknown identifier returns an empty list, is still counted, and is paused
 * exactly like a real one.
 */
create or replace function login_resolve(p_identifier text, p_client text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_key    text := login_identifier_key(p_identifier);
  v_client text := nullif(left(btrim(coalesce(p_client, '')), 100), '');
  v_until  timestamptz := login_lock_state(v_key, v_client, 'sign_in');
begin
  if v_until is not null then
    return jsonb_build_object('key', v_key, 'locked', true, 'retry_at', v_until, 'candidates', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'key', v_key,
    'locked', false,
    'candidates', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', c.user_id, 'auth_email', c.auth_email))
        from login_candidates(v_key) c), '[]'::jsonb));
end;
$$;

/** Audit an event that happened to an account, as that account. */
create or replace function write_account_audit(
  p_user_id uuid, p_action text, p_summary text, p_new jsonb default null, p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_user app_users;
begin
  select * into v_user from app_users where id = p_user_id;
  insert into audit_logs (actor_id, actor_name, actor_role, action, module, record_id, summary, new_value, reason)
  values (p_user_id, coalesce(v_user.full_name, 'unknown'), v_user.role, p_action, 'Security',
          coalesce(p_user_id::text, (p_new ->> 'identifier')), p_summary, p_new, p_reason);
end;
$$;

/**
 * Record how a sign-in ended. Service role only.
 *
 *   succeeded   the password matched and the account may sign in
 *   'invalid'   no account took the password (or there was none)
 *   'disabled'  the password matched but the account is suspended, inactive
 *               or switched off - recorded, and counted as a failure
 */
create or replace function login_record(
  p_identifier text, p_client text, p_user_id uuid, p_succeeded boolean, p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_key    text := login_identifier_key(p_identifier);
  v_client text := nullif(left(btrim(coalesce(p_client, '')), 100), '');
begin
  insert into login_attempts (identifier, client, succeeded, reason, user_id, kind)
  values (v_key, v_client, p_succeeded, p_reason, p_user_id, 'sign_in');

  if p_succeeded then
    update app_users set last_login_at = now() where id = p_user_id;
    perform write_account_audit(p_user_id, 'auth.login_succeeded',
      format('Signed in with %s', case when v_key like 'BND-M-%' then 'member number'
                                       when v_key like '+256%' then 'phone number'
                                       when position('@' in v_key) > 0 then 'email'
                                       else 'identifier' end),
      jsonb_build_object('identifier', v_key, 'client', v_client));
  else
    insert into audit_logs (actor_id, actor_name, actor_role, action, module, record_id, summary, new_value, reason)
    values (p_user_id, coalesce((select full_name from app_users where id = p_user_id), 'unknown'),
            (select role from app_users where id = p_user_id),
            'auth.login_failed', 'Security', coalesce(p_user_id::text, v_key),
            format('Failed sign-in for %s', v_key),
            jsonb_build_object('identifier', v_key, 'client', v_client, 'reason', coalesce(p_reason, 'invalid')),
            null);
  end if;
end;
$$;

/** Sign-out, recorded by the signed-in user just before the session ends. */
create or replace function log_logout()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    perform write_account_audit(auth.uid(), 'auth.logout', 'Signed out');
  end if;
end;
$$;

/** A password change made by the account holder while signed in. */
create or replace function log_password_changed()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return;
  end if;
  update app_users set password_set_at = now() where id = auth.uid();
  update account_setup_codes set revoked_at = now()
   where user_id = auth.uid() and used_at is null and revoked_at is null;
  perform write_account_audit(auth.uid(), 'auth.password_changed', 'Changed their password');
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Setup codes: how a person gets their first password, or a new one
-- ---------------------------------------------------------------------------
create table if not exists account_setup_codes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references app_users (id) on delete cascade,
  code_hash   text not null,
  purpose     text not null check (purpose in ('setup', 'reset')),
  issued_by   uuid references app_users (id),
  issued_at   timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  revoked_at  timestamptz
);

create index if not exists account_setup_codes_user_idx
  on account_setup_codes (user_id) where used_at is null and revoked_at is null;

alter table account_setup_codes enable row level security;
-- No policy: codes are read only by the functions below.

/** Ten characters from an alphabet with no 0/O or 1/I, shown as XXXXX-XXXXX. */
create or replace function random_setup_code()
returns text language plpgsql volatile as $$
declare
  a text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  b bytea := extensions.gen_random_bytes(10);
  r text := '';
  i integer;
begin
  for i in 0..9 loop
    r := r || substr(a, (get_byte(b, i) % 32) + 1, 1);
    if i = 4 then
      r := r || '-';
    end if;
  end loop;
  return r;
end;
$$;

/**
 * Issue a one-time code with which an account holder chooses their own
 * password. Returns the code, once; only its hash is kept. Any earlier code
 * for the account stops working.
 *
 *   member logins  need 'Edit member records' - or, for the first code,
 *                  'Register members'
 *   staff accounts need 'Manage staff accounts'
 */
create or replace function issue_account_setup_code(p_user_id uuid, p_purpose text default 'reset')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user   app_users;
  v_kind   text;
  v_member members;
  v_code   text := random_setup_code();
  v_hours  integer := setting_int('security.setup_code_valid_hours');
  v_row    account_setup_codes;
begin
  if p_purpose not in ('setup', 'reset') then
    raise exception 'Unknown purpose %.', p_purpose using errcode = 'check_violation';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Change your own password from your profile.' using errcode = 'check_violation';
  end if;

  select * into v_user from app_users where id = p_user_id;
  if not found then
    raise exception 'That account does not exist.' using errcode = 'no_data_found';
  end if;
  select kind into v_kind from roles where key = v_user.role;
  select * into v_member from members where user_id = p_user_id;

  if v_kind = 'member' then
    perform assert_capability(
      has_permission('members.manage')
        or (p_purpose = 'setup' and has_permission('members.create') and v_user.password_set_at is null),
      'reset member passwords');
  else
    perform assert_permission('users.manage');
    if v_user.role = 'super_admin' and current_role_of() is distinct from 'super_admin' then
      raise exception 'Only a Super Admin can reset a Super Admin''s password.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  update account_setup_codes set revoked_at = now()
   where user_id = p_user_id and used_at is null and revoked_at is null;

  insert into account_setup_codes (user_id, code_hash, purpose, issued_by, expires_at)
  values (p_user_id, extensions.crypt(v_code, extensions.gen_salt('bf', 8)), p_purpose,
          auth.uid(), now() + make_interval(hours => v_hours))
  returning * into v_row;

  perform write_audit(
    case when p_purpose = 'setup' then 'account.setup_code_issued' else 'account.password_reset_initiated' end,
    'Security', p_user_id::text,
    format('%s for %s%s', case when p_purpose = 'setup' then 'Setup code issued' else 'Password reset initiated' end,
           v_user.full_name, case when v_member.member_no is not null then ' (' || v_member.member_no || ')' else '' end),
    null, jsonb_build_object('expires_at', v_row.expires_at, 'purpose', p_purpose), null);

  return jsonb_build_object('code', v_code, 'expires_at', v_row.expires_at, 'purpose', p_purpose);
end;
$$;

/**
 * Check an identifier and setup code. Service role only - the server's
 * "Set up your account" action. Failures are counted and paused exactly like
 * sign-in; the answer never says whether the identifier exists.
 */
create or replace function setup_code_verify(p_identifier text, p_code text, p_client text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_key    text := login_identifier_key(p_identifier);
  v_client text := nullif(left(btrim(coalesce(p_client, '')), 100), '');
  v_code   text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_until  timestamptz := login_lock_state(v_key, v_client, 'setup');
  v_row    account_setup_codes;
begin
  if v_until is not null then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'retry_at', v_until);
  end if;

  if length(v_code) = 10 then
    v_code := left(v_code, 5) || '-' || right(v_code, 5);
    select sc.* into v_row
      from account_setup_codes sc
      join login_candidates(v_key) c on c.user_id = sc.user_id
     where sc.used_at is null and sc.revoked_at is null and sc.expires_at > now()
       and sc.code_hash = extensions.crypt(v_code, sc.code_hash)
     order by sc.issued_at desc
     limit 1;
  end if;

  insert into login_attempts (identifier, client, succeeded, reason, user_id, kind)
  values (v_key, v_client, v_row.id is not null, case when v_row.id is null then 'bad_code' end,
          v_row.user_id, 'setup');

  if v_row.id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  return jsonb_build_object('ok', true, 'code_id', v_row.id, 'user_id', v_row.user_id);
end;
$$;

/** The password has been set: spend the code. Service role only. */
create or replace function setup_code_complete(p_code_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_row account_setup_codes;
begin
  update account_setup_codes set used_at = now()
   where id = p_code_id and used_at is null and revoked_at is null
   returning * into v_row;
  if not found then
    raise exception 'That setup code has already been used.';
  end if;
  update app_users set password_set_at = now() where id = v_row.user_id;
  perform write_account_audit(v_row.user_id, 'auth.password_set',
    case when v_row.purpose = 'setup' then 'Set up their account and chose a password'
         else 'Chose a new password with a reset code' end);
end;
$$;

/** Sign-in status of an account, for the staff screens. Never the password. */
create or replace function account_login_status(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_user app_users;
begin
  perform assert_capability(can_view_operations(), 'view sign-in status');
  select * into v_user from app_users where id = p_user_id;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'user_id',          v_user.id,
    'is_active',        v_user.is_active,
    'role',             v_user.role,
    'phone',            v_user.phone,
    'email',            v_user.email,
    'password_set_at',  v_user.password_set_at,
    'last_login_at',    v_user.last_login_at,
    'pending_code', (
      select jsonb_build_object('purpose', purpose, 'issued_at', issued_at, 'expires_at', expires_at)
        from account_setup_codes
       where user_id = p_user_id and used_at is null and revoked_at is null and expires_at > now()
       order by issued_at desc limit 1),
    'recent_failures', (
      select count(*) from login_attempts
       where user_id = p_user_id and not succeeded and created_at > now() - interval '24 hours'),
    'paused_until', (
      select max(login_lock_state(k.identifier, null, 'sign_in'))
        from (select distinct identifier from login_attempts
               where user_id = p_user_id and created_at > now() - interval '1 day') k)
  );
end;
$$;

/** Sign-in health, for the administration dashboard. */
create or replace function security_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_capability(has_permission('users.manage') or has_permission('audit.view'), 'view sign-in activity');
  return jsonb_build_object(
    'staff_accounts', (select count(*) from app_users u join roles r on r.key = u.role
                        where r.kind = 'staff' and u.is_active),
    'member_logins',  (select count(*) from app_users u join roles r on r.key = u.role
                        where r.kind = 'member' and u.is_active),
    'awaiting_setup', (select count(*) from app_users u where u.is_active and u.password_set_at is null),
    'codes_pending',  (select count(*) from account_setup_codes
                        where used_at is null and revoked_at is null and expires_at > now()),
    'signins_24h',    (select count(*) from login_attempts
                        where kind = 'sign_in' and succeeded and created_at > now() - interval '24 hours'),
    'failures_24h',   (select count(*) from login_attempts
                        where not succeeded and created_at > now() - interval '24 hours'),
    'paused_now',     (select count(*) from (
                         select distinct identifier from login_attempts
                          where not succeeded and created_at > now() - make_interval(mins => setting_int('security.login_lockout_minutes'))
                       ) k where login_lock_state(k.identifier, null, 'sign_in') is not null),
    'members_without_login', (select count(*) from members
                               where user_id is null and status in ('active', 'pending'))
  );
end;
$$;

-- The old signature-less helper from 0029 is replaced by login_record().
drop function if exists touch_last_login();

-- ---------------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------------
revoke execute on function
  set_role_dashboard(text, text, text), assert_login_phone_available(text, uuid),
  set_user_phone(uuid, text, text), login_identifier_key(text), login_candidates(text),
  login_lock_state(text, text, text), login_resolve(text, text), write_account_audit(uuid, text, text, jsonb, text),
  login_record(text, text, uuid, boolean, text), log_logout(), log_password_changed(),
  random_setup_code(), issue_account_setup_code(uuid, text), setup_code_verify(text, text, text),
  setup_code_complete(uuid), account_login_status(uuid), security_overview()
  from public, anon, authenticated;

grant execute on function
  set_role_dashboard(text, text, text), assert_login_phone_available(text, uuid),
  set_user_phone(uuid, text, text), log_logout(), log_password_changed(),
  issue_account_setup_code(uuid, text), account_login_status(uuid), security_overview(),
  current_member_id(), my_session()
  to authenticated;

-- The server's sign-in and setup actions, and nothing else.
grant execute on function
  login_resolve(text, text), login_record(text, text, uuid, boolean, text),
  setup_code_verify(text, text, text), setup_code_complete(uuid)
  to service_role;
