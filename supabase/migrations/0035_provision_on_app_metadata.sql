-- ===========================================================================
-- BUD-SACCO - 0035 - Provision a login when its app metadata arrives
--
-- Supabase Auth's admin "create user" inserts the auth.users row first and
-- writes the app metadata - the role for a staff account, the member id for a
-- member login - in a second statement a moment later. The provisioning
-- trigger ran only on the insert, so it saw no role, took the account for a
-- self-service sign-up and created it switched off with no role and no member
-- link. Every account made from the Users screen, and every member login made
-- at registration, came out that way.
--
-- The trigger now also runs when `raw_app_meta_data` changes, and provisions
-- an account that has not been provisioned yet. Only the service role can
-- write app metadata, so this is still the one trusted channel; and an account
-- that is already provisioned - active, or linked to a member - is never
-- re-provisioned by a later metadata change.
-- ===========================================================================

create or replace function provision_app_user(
  p_id    uuid,
  p_email text,
  p_app   jsonb,
  p_user  jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_role   text := nullif(p_app ->> 'role', '');
  v_member members;
  v_mid    uuid;
  v_phone  text := nullif(btrim(p_user ->> 'phone'), '');
begin
  begin
    v_mid := nullif(p_app ->> 'member_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'Invalid member reference on a new login.';
  end;

  if v_mid is not null then
    select * into v_member from members where id = v_mid for update;
    if not found then
      raise exception 'A login was requested for a member that does not exist.';
    end if;
    if v_member.user_id is not null and v_member.user_id <> p_id then
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
    p_id,
    coalesce(v_member.full_name, nullif(btrim(p_user ->> 'full_name'), ''), split_part(p_email, '@', 1)),
    case when v_mid is null and p_email !~* '\.invalid$' then p_email end,
    coalesce(v_member.phone, normalize_ug_phone(v_phone), v_phone),
    coalesce(v_role, 'member'),
    -- An account nobody provisioned (no role, no member) is switched off.
    v_role is not null,
    -- Every account the SACCO provisions starts on a temporary password.
    v_role is not null
  )
  on conflict (id) do update
     set full_name            = excluded.full_name,
         email                = excluded.email,
         phone                = excluded.phone,
         role                 = excluded.role,
         is_active            = excluded.is_active,
         must_change_password = excluded.must_change_password;

  if v_mid is not null then
    update members set user_id = p_id where id = v_mid;
  end if;
end;
$$;

revoke execute on function provision_app_user(uuid, text, jsonb, jsonb) from public, anon, authenticated;

/** Has this login been provisioned already? Then metadata changes leave it alone. */
create or replace function app_user_is_provisioned(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_users where id = p_id and (is_active or role <> 'member'))
      or exists (select 1 from members where user_id = p_id);
$$;

revoke execute on function app_user_is_provisioned(uuid) from public, anon, authenticated;

create or replace function handle_new_auth_user()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform provision_app_user(new.id, new.email, new.raw_app_meta_data, new.raw_user_meta_data);
    return new;
  end if;

  -- UPDATE: only a change that brings a role or a member link, to a login
  -- that does not yet have one.
  if (new.raw_app_meta_data ->> 'role') is not distinct from (old.raw_app_meta_data ->> 'role')
     and (new.raw_app_meta_data ->> 'member_id') is not distinct from (old.raw_app_meta_data ->> 'member_id') then
    return new;
  end if;
  if nullif(new.raw_app_meta_data ->> 'role', '') is null
     and nullif(new.raw_app_meta_data ->> 'member_id', '') is null then
    return new;
  end if;
  if app_user_is_provisioned(new.id) then
    return new;
  end if;

  perform provision_app_user(new.id, new.email, new.raw_app_meta_data, new.raw_user_meta_data);
  return new;
end;
$$;

drop trigger if exists on_auth_user_app_metadata on auth.users;
create trigger on_auth_user_app_metadata
  after update of raw_app_meta_data on auth.users
  for each row execute function handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- Repair the logins created while the gap was open: switched off, no member
-- link, but carrying a role or member id the SACCO put there.
-- ---------------------------------------------------------------------------
do $repair$
declare
  r record;
begin
  for r in
    select a.id, a.email, a.raw_app_meta_data, a.raw_user_meta_data
      from auth.users a
      join app_users u on u.id = a.id
     where not app_user_is_provisioned(a.id)
       and (nullif(a.raw_app_meta_data ->> 'role', '') is not null
            or nullif(a.raw_app_meta_data ->> 'member_id', '') is not null)
  loop
    perform provision_app_user(r.id, r.email, r.raw_app_meta_data, r.raw_user_meta_data);
    insert into audit_logs (actor_name, action, module, record_id, summary, reason)
    values ('system', 'user.provisioning_repaired', 'User Management', r.id::text,
            format('Login %s given the role it was created with (%s); it must be reset before first sign-in',
                   r.email, coalesce(r.raw_app_meta_data ->> 'role', 'member')),
            'The account was created while provisioning ignored app metadata written after the insert');
  end loop;
end
$repair$;
