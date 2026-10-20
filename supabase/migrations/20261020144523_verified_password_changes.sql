-- BKC-01: only the trusted server may complete a native Auth password update.
-- No change to role assignments, RLS predicates or financial functions.
begin;

-- Retire the unsafe endpoint, including callers with an old service grant.
create or replace function public.log_password_changed()
returns void language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'Password completion requires a verified server flow.'
    using errcode = 'insufficient_privilege';
end;
$$;
revoke all on function public.log_password_changed() from public, anon, authenticated, service_role;

-- Not an exposed API schema. A proof contains no plaintext password and is
-- bound to one account, its current Auth hash and a short-lived random nonce.
create schema password_security;
revoke all on schema password_security from public, anon, authenticated, service_role;
create table password_security.change_proofs (
  user_id uuid primary key references public.app_users(id) on delete cascade,
  nonce uuid not null,
  previous_hash text not null,
  expires_at timestamptz not null
);
alter table password_security.change_proofs enable row level security;
revoke all on password_security.change_proofs from public, anon, authenticated, service_role;

create function public.begin_password_change(p_user_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_nonce uuid := gen_random_uuid();
  v_hash text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Server access required.' using errcode = 'insufficient_privilege';
  end if;
  -- Serialize with staff resets and completion before taking the snapshot.
  perform 1 from public.app_users where id = p_user_id for update;
  if not found then
    raise exception 'Account not found.' using errcode = 'no_data_found';
  end if;
  select encrypted_password into v_hash from auth.users where id = p_user_id;
  if coalesce(v_hash, '') = '' then
    raise exception 'Password sign-in is unavailable.' using errcode = 'check_violation';
  end if;
  insert into password_security.change_proofs(user_id, nonce, previous_hash, expires_at)
  values (p_user_id, v_nonce, v_hash, clock_timestamp() + interval '10 minutes')
  on conflict (user_id) do update set nonce = excluded.nonce,
    previous_hash = excluded.previous_hash, expires_at = excluded.expires_at;
  return v_nonce;
end;
$$;

create function public.complete_password_change(p_user_id uuid, p_nonce uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_proof password_security.change_proofs;
  v_hash text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Server access required.' using errcode = 'insufficient_privilege';
  end if;
  perform 1 from public.app_users where id = p_user_id for update;
  select * into v_proof from password_security.change_proofs
    where user_id = p_user_id and nonce = p_nonce for update;
  if not found or v_proof.expires_at <= clock_timestamp() then
    raise exception 'Password change proof is invalid or expired.' using errcode = 'insufficient_privilege';
  end if;
  select encrypted_password into v_hash from auth.users where id = p_user_id;
  if coalesce(v_hash, '') = '' or v_hash is not distinct from v_proof.previous_hash then
    raise exception 'Auth password has not changed.' using errcode = 'insufficient_privilege';
  end if;
  update public.app_users set password_set_at = clock_timestamp(), must_change_password = false
    where id = p_user_id;
  delete from password_security.change_proofs where user_id = p_user_id;
  perform public.write_account_audit(p_user_id, 'auth.password_changed',
    'Changed their password through verified Supabase Auth');
end;
$$;

-- issue_temporary_password() writes true even if already locked. Invalidate a
-- proof on every such write so an in-flight change cannot undo a newer reset.
create function password_security.invalidate_password_proof()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from password_security.change_proofs where user_id = new.id;
  return new;
end;
$$;
create trigger invalidate_password_proof_on_reset
  after update of must_change_password on public.app_users
  for each row when (new.must_change_password)
  execute function password_security.invalidate_password_proof();

revoke all on function password_security.invalidate_password_proof() from public, anon, authenticated, service_role;
revoke all on function public.begin_password_change(uuid), public.complete_password_change(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.begin_password_change(uuid), public.complete_password_change(uuid, uuid)
  to service_role;

commit;
