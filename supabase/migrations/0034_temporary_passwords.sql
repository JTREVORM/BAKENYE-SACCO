-- ===========================================================================
-- BUD-SACCO - 0034 - Temporary passwords, changed at first sign-in
--
-- Replaces the one-time setup codes of 0032.
--
-- When staff register a member or create a staff account, the login is made
-- at once with a generated temporary password. The server shows it to that
-- officer once - it is never stored in readable form - and the account holder
-- must choose their own password the first time they sign in. "Reset password"
-- does the same: a new temporary password, and a forced change.
--
-- Until the temporary password is changed the account can do exactly one
-- thing: change it. `must_change_password` is honoured by the database itself -
-- `has_permission()`, `is_staff_user()` and `current_member_id()` all answer
-- "no" - so a temporary password is no way into the data through the REST API
-- either, only into the change-password screen.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The flag
-- ---------------------------------------------------------------------------
alter table app_users add column if not exists must_change_password boolean not null default false;

-- Logins that never chose a password (members whose password was derived by
-- the server before 0032, accounts still waiting on a setup code) now need a
-- temporary password from staff; when they get one, the change is forced.
update app_users set must_change_password = true
 where password_set_at is null and is_active
   and role in (select key from roles where kind = 'member');

-- ---------------------------------------------------------------------------
-- 2. Setup codes go
-- ---------------------------------------------------------------------------
drop function if exists issue_account_setup_code(uuid, text);
drop function if exists setup_code_verify(text, text, text);
drop function if exists setup_code_complete(uuid);
drop function if exists random_setup_code();

-- log_password_changed() referred to the codes table; restated below first.
create or replace function log_password_changed()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return;
  end if;
  update app_users
     set password_set_at = now(), must_change_password = false
   where id = auth.uid();
  perform write_account_audit(auth.uid(), 'auth.password_changed', 'Changed their password');
end;
$$;

drop table if exists account_setup_codes;

-- ---------------------------------------------------------------------------
-- 3. An account on a temporary password can do nothing but change it
-- ---------------------------------------------------------------------------
create or replace function is_staff_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from app_users u join roles r on r.key = u.role
     where u.id = auth.uid() and u.is_active and not u.must_change_password
       and r.status = 'active' and r.kind = 'staff'
  );
$$;

create or replace function has_permission(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from app_users u
      join roles r       on r.key = u.role and r.status = 'active'
      join permissions p on p.key = p_key and p.scope = r.kind
     where u.id = auth.uid()
       and u.is_active
       and not u.must_change_password
       and (u.role = 'super_admin'
            or p.is_core
            or exists (select 1 from role_permissions rp
                        where rp.role_key = u.role and rp.permission_key = p_key))
  );
$$;

create or replace function current_member_id()
returns uuid language sql stable security definer set search_path = public as $$
  select m.id
    from members m
    join app_users u on u.id = m.user_id
   where m.user_id = auth.uid()
     and u.is_active
     and not u.must_change_password
     and m.status in ('active', 'pending');
$$;

create or replace function my_session()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id',                   u.id,
    'full_name',            coalesce(m.full_name, u.full_name),
    'email',                u.email,
    'phone',                coalesce(m.phone, u.phone),
    'photo_url',            coalesce(m.photo_url, u.photo_url),
    'is_active',            u.is_active,
    'role',                 u.role,
    'role_name',            r.name,
    'role_kind',            r.kind,
    'role_active',          r.status = 'active',
    'role_dashboard',       r.dashboard,
    'password_set',         u.password_set_at is not null,
    'must_change_password', u.must_change_password,
    'member',               case when m.id is null then null else jsonb_build_object(
                              'id', m.id, 'member_no', m.member_no, 'status', m.status) end,
    'permissions',          coalesce((
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

-- ---------------------------------------------------------------------------
-- 4. New accounts start on a temporary password
-- ---------------------------------------------------------------------------
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

  insert into app_users (id, full_name, email, phone, role, is_active, must_change_password)
  values (
    new.id,
    coalesce(v_member.full_name,
             nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
             split_part(new.email, '@', 1)),
    case when v_mid is null and new.email !~* '\.invalid$' then new.email end,
    coalesce(v_member.phone, normalize_ug_phone(v_phone), v_phone),
    coalesce(v_role, 'member'),
    v_role is not null,
    -- Every account the SACCO provisions starts on a password the person did
    -- not choose. They choose their own the first time they sign in.
    v_role is not null
  )
  on conflict (id) do nothing;

  if v_mid is not null then
    update members set user_id = new.id where id = v_mid;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Reset password
-- ---------------------------------------------------------------------------

/**
 * Authorise and record a password reset. The server action calls this with
 * the officer's session, then - only if it succeeds - sets the new temporary
 * password through Supabase Auth and shows it to the officer once.
 *
 *   member logins  need 'Edit member records'
 *   staff accounts need 'Manage staff accounts'; a Super Admin's only another
 *                  Super Admin's
 */
create or replace function issue_temporary_password(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user   app_users;
  v_kind   text;
  v_member members;
begin
  if p_user_id = auth.uid() then
    raise exception 'Change your own password from your profile.' using errcode = 'check_violation';
  end if;

  select * into v_user from app_users where id = p_user_id for update;
  if not found then
    raise exception 'That account does not exist.' using errcode = 'no_data_found';
  end if;
  select kind into v_kind from roles where key = v_user.role;
  select * into v_member from members where user_id = p_user_id;

  if v_kind = 'member' then
    perform assert_permission('members.manage');
  else
    perform assert_permission('users.manage');
    if v_user.role = 'super_admin' and current_role_of() is distinct from 'super_admin' then
      raise exception 'Only a Super Admin can reset a Super Admin''s password.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  update app_users set must_change_password = true where id = p_user_id;

  perform write_audit('account.password_reset', 'Security', p_user_id::text,
    format('Temporary password issued for %s%s; it must be changed at next sign-in', v_user.full_name,
           case when v_member.member_no is not null then ' (' || v_member.member_no || ')' else '' end),
    null, jsonb_build_object('must_change_password', true), null);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. What staff see
-- ---------------------------------------------------------------------------
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
    'user_id',              v_user.id,
    'is_active',            v_user.is_active,
    'role',                 v_user.role,
    'phone',                v_user.phone,
    'email',                v_user.email,
    'password_set_at',      v_user.password_set_at,
    'must_change_password', v_user.must_change_password,
    'last_login_at',        v_user.last_login_at,
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

create or replace function security_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_capability(has_permission('users.manage') or has_permission('audit.view'), 'view sign-in activity');
  return jsonb_build_object(
    'staff_accounts', (select count(*) from app_users u join roles r on r.key = u.role
                        where r.kind = 'staff' and u.is_active),
    'member_logins',  (select count(*) from app_users u join roles r on r.key = u.role
                        where r.kind = 'member' and u.is_active),
    'must_change',    (select count(*) from app_users u where u.is_active and u.must_change_password),
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

delete from system_settings where key = 'security.setup_code_valid_hours';

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------
revoke execute on function issue_temporary_password(uuid) from public, anon, authenticated;
grant execute on function issue_temporary_password(uuid) to authenticated;
grant execute on function log_password_changed(), account_login_status(uuid), security_overview(),
  is_staff_user(), has_permission(text), current_member_id(), my_session() to authenticated;
