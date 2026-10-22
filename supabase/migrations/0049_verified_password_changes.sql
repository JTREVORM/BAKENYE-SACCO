-- ===========================================================================
-- BUD-SACCO - 0049 - Verified password changes and failure-safe staff resets
--
-- Closes F-01 (BKC-01) and F-04 of the 22 October 2026 diagnostic.
--
-- F-01. `log_password_changed()` was the *bookkeeping* half of a password
-- change: it cleared `must_change_password` and stamped `password_set_at`,
-- unconditionally, for `auth.uid()`. The *credential* half happens elsewhere,
-- in `supabase.auth.updateUser()`. Because the database never checked that the
-- credential had actually changed, an account sitting on a staff-issued
-- temporary password could call the bookkeeping half on its own and lift its
-- own lock - keeping the temporary password the issuing officer was shown as a
-- permanently live credential, and leaving an audit row claiming the holder had
-- chosen a password of their own.
--
-- The fix keeps the database as the authority. A password change is now a
-- two-step, server-only ceremony around the native Auth write:
--
--   begin_password_change(user)    -> snapshot the current Auth password hash,
--                                     mint a single-use, short-lived nonce
--   supabase.auth.updateUser()        the real credential change
--   complete_password_change(...)  -> the hash must differ from the snapshot
--                                     before the lock is lifted and the audit
--                                     row is written
--
-- Both halves are reachable only by the service role, which lives on the
-- server. A member's bearer token cannot call either, so there is no longer a
-- way to clear the flag without the credential having demonstrably changed.
--
-- F-04. A staff-assisted reset committed `must_change_password = true` and an
-- `account.password_reset` audit row *before* asking Supabase Auth to install
-- the replacement temporary password. When that second call failed the record
-- said a temporary password had been issued when none had, and the officer had
-- no way to tell which state the account was in.
--
-- The reset is now a reservation: begin -> install -> complete, with an
-- explicit abort. The lock is still taken first, deliberately - of the two
-- possible partial states, "locked with the old password still live" is the
-- safe one, and "new temporary password live with no forced change" is not -
-- but the audit trail now distinguishes a reset that was *started* from one
-- that was *issued* or *failed*, and an abort restores the account to exactly
-- the standing it had.
--
-- No role assignment, RLS predicate, permission, financial function or
-- business rule is changed by this migration.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Retire the unsafe endpoint
--
-- Kept as a function that raises, rather than dropped, so that any caller
-- still holding an old grant fails loudly and visibly instead of silently
-- finding nothing. `security invoker` so it carries no elevated rights at all.
-- ---------------------------------------------------------------------------
create or replace function public.log_password_changed()
returns void language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'Password completion requires a verified server flow.'
    using errcode = 'insufficient_privilege';
end;
$$;

revoke all on function public.log_password_changed()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Where the proofs live
--
-- A private schema, not exposed through PostgREST, and not in any API schema.
-- A proof holds no plaintext password: only the account it belongs to, the
-- bcrypt hash that was current when the change began, a random nonce and an
-- expiry. Nothing here is readable or writable by `anon`, `authenticated` or
-- `service_role` - only the SECURITY DEFINER functions below touch it.
-- ---------------------------------------------------------------------------
create schema if not exists password_security;
revoke all on schema password_security from public, anon, authenticated, service_role;

create table if not exists password_security.change_proofs (
  user_id       uuid primary key references public.app_users(id) on delete cascade,
  nonce         uuid        not null,
  previous_hash text        not null,
  expires_at    timestamptz not null
);
alter table password_security.change_proofs enable row level security;
revoke all on password_security.change_proofs from public, anon, authenticated, service_role;

create table if not exists password_security.reset_reservations (
  user_id              uuid primary key references public.app_users(id) on delete cascade,
  token                uuid        not null,
  previous_must_change boolean     not null,
  previous_hash        text        not null,
  officer_id           uuid,
  expires_at           timestamptz not null
);
alter table password_security.reset_reservations enable row level security;
revoke all on password_security.reset_reservations from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The verified self-service password change
-- ---------------------------------------------------------------------------

/**
 * Open a password change for one account and return its single-use nonce.
 *
 * Service role only: this is called by the server, never by the browser, and
 * the account it names always comes from the server's own `getUser()` - never
 * from a submitted form field.
 */
create or replace function public.begin_password_change(p_user_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_nonce uuid := gen_random_uuid();
  v_hash  text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Server access required.' using errcode = 'insufficient_privilege';
  end if;

  -- Serialise against a staff reset and against a second change on the same
  -- account before the snapshot is taken.
  perform 1 from public.app_users where id = p_user_id for update;
  if not found then
    raise exception 'Account not found.' using errcode = 'no_data_found';
  end if;

  select encrypted_password into v_hash from auth.users where id = p_user_id;
  if coalesce(v_hash, '') = '' then
    raise exception 'Password sign-in is unavailable for this account.'
      using errcode = 'check_violation';
  end if;

  insert into password_security.change_proofs (user_id, nonce, previous_hash, expires_at)
  values (p_user_id, v_nonce, v_hash, clock_timestamp() + interval '10 minutes')
  on conflict (user_id) do update
     set nonce         = excluded.nonce,
         previous_hash = excluded.previous_hash,
         expires_at    = excluded.expires_at;

  return v_nonce;
end;
$$;

/**
 * Finish a password change: lift the temporary-password lock, stamp
 * `password_set_at` and write the audit row - but only once the account's Auth
 * password hash has demonstrably changed from the snapshot the matching
 * `begin_password_change()` took.
 *
 * A proof is single-use (deleted here), expires in ten minutes, and is
 * destroyed outright by any staff reset that arrives while it is outstanding,
 * so an in-flight change can never undo a newer reset.
 *
 * Note what this function deliberately does *not* do: it does not make an
 * account active, un-suspend a member, or change a role. Standing is decided
 * elsewhere and stays decided elsewhere; all this lifts is the forced-change
 * lock.
 */
create or replace function public.complete_password_change(p_user_id uuid, p_nonce uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_proof password_security.change_proofs;
  v_hash  text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Server access required.' using errcode = 'insufficient_privilege';
  end if;

  perform 1 from public.app_users where id = p_user_id for update;
  if not found then
    raise exception 'Account not found.' using errcode = 'no_data_found';
  end if;

  select * into v_proof from password_security.change_proofs
   where user_id = p_user_id and nonce = p_nonce
     for update;
  if not found or v_proof.expires_at <= clock_timestamp() then
    raise exception 'Password change proof is invalid or expired.'
      using errcode = 'insufficient_privilege';
  end if;

  select encrypted_password into v_hash from auth.users where id = p_user_id;
  if coalesce(v_hash, '') = '' or v_hash is not distinct from v_proof.previous_hash then
    raise exception 'The Auth password has not changed.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.app_users
     set password_set_at      = clock_timestamp(),
         must_change_password = false
   where id = p_user_id;

  delete from password_security.change_proofs where user_id = p_user_id;

  perform public.write_account_audit(p_user_id, 'auth.password_changed',
    'Changed their password through verified Supabase Auth');
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. A staff reset that cannot lie about what happened
-- ---------------------------------------------------------------------------

/**
 * The authorisation half of a staff-assisted reset, on its own and writing
 * nothing - so that `begin`, `complete` and `abort` all enforce exactly the
 * same rules, in the database, on every step.
 *
 *   member logins  need 'Edit member records'   (members.manage)
 *   staff accounts need 'Manage staff accounts' (users.manage), and only a
 *                  Super Admin may reset another Super Admin's
 */
create or replace function password_security.assert_may_reset(p_user_id uuid)
returns public.app_users language plpgsql security definer set search_path = '' as $$
declare
  v_user public.app_users;
  v_kind text;
begin
  if p_user_id = auth.uid() then
    raise exception 'Change your own password from your profile.' using errcode = 'check_violation';
  end if;

  select * into v_user from public.app_users where id = p_user_id for update;
  if not found then
    raise exception 'That account does not exist.' using errcode = 'no_data_found';
  end if;

  select kind into v_kind from public.roles where key = v_user.role;

  if v_kind = 'member' then
    perform public.assert_permission('members.manage');
  else
    perform public.assert_permission('users.manage');
    if v_user.role = 'super_admin' and public.current_role_of() is distinct from 'super_admin' then
      raise exception 'Only a Super Admin can reset a Super Admin''s password.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  return v_user;
end;
$$;

/**
 * Step 1 of a staff-assisted reset: reserve it.
 *
 * Takes the forced-change lock at once - the account is confined from this
 * moment, which is the safe side of the window - snapshots the standing it had
 * so an abort can put it back exactly, and records that a reset was *started*.
 * The definitive `account.password_reset` row is written only by step 2.
 *
 * Returns the reservation token and what the officer's screen needs. No
 * password is generated here: the plaintext never reaches the database.
 */
create or replace function public.begin_temporary_password_reset(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user   public.app_users;
  v_member public.members;
  v_token  uuid := gen_random_uuid();
  v_hash   text;
begin
  v_user := password_security.assert_may_reset(p_user_id);
  select * into v_member from public.members where user_id = p_user_id;
  select encrypted_password into v_hash from auth.users where id = p_user_id;

  insert into password_security.reset_reservations
    (user_id, token, previous_must_change, previous_hash, officer_id, expires_at)
  values (p_user_id, v_token, v_user.must_change_password, coalesce(v_hash, ''),
          auth.uid(), clock_timestamp() + interval '10 minutes')
  on conflict (user_id) do update
     set token                = excluded.token,
         previous_must_change = excluded.previous_must_change,
         previous_hash        = excluded.previous_hash,
         officer_id           = excluded.officer_id,
         expires_at           = excluded.expires_at;

  -- Confines the account, and destroys any password change this account has in
  -- flight (see the trigger in section 6), so a change begun a moment ago
  -- cannot clear the lock this reset is taking.
  update public.app_users set must_change_password = true where id = p_user_id;

  perform public.write_audit('account.password_reset_started', 'Security', p_user_id::text,
    format('Password reset started for %s%s; the account is locked until a temporary password is issued',
           v_user.full_name,
           case when v_member.member_no is not null then ' (' || v_member.member_no || ')' else '' end),
    null, jsonb_build_object('must_change_password', true), null);

  return jsonb_build_object(
    'token',     v_token,
    'user_id',   p_user_id,
    'full_name', v_user.full_name,
    'member_no', v_member.member_no);
end;
$$;

/**
 * Step 2: the officer's Auth write landed. Confirm the reset.
 *
 * The Auth password hash must differ from the snapshot taken in step 1 - that
 * is the evidence the replacement credential was really installed. Only then
 * is the definitive `account.password_reset` audit row written.
 *
 * The lock stays on: the holder must still choose their own password at their
 * next successful sign-in.
 */
create or replace function public.complete_temporary_password_reset(p_user_id uuid, p_token uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user     public.app_users;
  v_member   public.members;
  v_reserved password_security.reset_reservations;
  v_hash     text;
begin
  v_user := password_security.assert_may_reset(p_user_id);
  select * into v_member from public.members where user_id = p_user_id;

  select * into v_reserved from password_security.reset_reservations
   where user_id = p_user_id and token = p_token
     for update;
  if not found or v_reserved.expires_at <= clock_timestamp() then
    raise exception 'This password reset has expired or been superseded. Start it again.'
      using errcode = 'insufficient_privilege';
  end if;

  select encrypted_password into v_hash from auth.users where id = p_user_id;
  if coalesce(v_hash, '') = '' or v_hash is not distinct from v_reserved.previous_hash then
    raise exception 'The temporary password was not installed. Start the reset again.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.app_users set must_change_password = true where id = p_user_id;
  delete from password_security.reset_reservations where user_id = p_user_id;

  perform public.write_audit('account.password_reset', 'Security', p_user_id::text,
    format('Temporary password issued for %s%s; it must be changed at next sign-in',
           v_user.full_name,
           case when v_member.member_no is not null then ' (' || v_member.member_no || ')' else '' end),
    null, jsonb_build_object('must_change_password', true), null);
end;
$$;

/**
 * Step 2, the other way: the officer's Auth write failed. Put the account back.
 *
 * Restores the standing recorded in step 1 and says so in the audit trail. If
 * this call is itself lost, the account is left locked with its previous
 * password still live - recoverable by another reset, and never an account
 * opened by a credential somebody else knows.
 */
create or replace function public.abort_temporary_password_reset(p_user_id uuid, p_token uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user     public.app_users;
  v_reserved password_security.reset_reservations;
begin
  v_user := password_security.assert_may_reset(p_user_id);

  select * into v_reserved from password_security.reset_reservations
   where user_id = p_user_id and token = p_token
     for update;
  if not found then
    -- Already completed, aborted or superseded. Nothing to undo, and saying so
    -- is not an error the officer needs to act on.
    return;
  end if;

  update public.app_users
     set must_change_password = v_reserved.previous_must_change
   where id = p_user_id;
  delete from password_security.reset_reservations where user_id = p_user_id;

  perform public.write_audit('account.password_reset_failed', 'Security', p_user_id::text,
    format('Password reset for %s could not be completed; no password was changed', v_user.full_name),
    null, jsonb_build_object('must_change_password', v_reserved.previous_must_change), null);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Retire the non-atomic reset entry point
--
-- `issue_temporary_password()` committed the lock and the audit row with no
-- way to tell whether the credential had followed. Replaced by the three
-- functions above; kept as a raising stub so an old caller fails visibly.
-- ---------------------------------------------------------------------------
create or replace function public.issue_temporary_password(p_user_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'Use begin_temporary_password_reset() and complete_temporary_password_reset().'
    using errcode = 'insufficient_privilege';
end;
$$;

revoke all on function public.issue_temporary_password(uuid)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. A newer reset always beats an older change
--
-- Any write that sets `must_change_password` true - a staff reset, or a future
-- caller doing the same - destroys that account's outstanding change proof. So
-- a member who began a password change a moment before an officer reset them
-- cannot complete it and clear the lock the officer just took.
-- ---------------------------------------------------------------------------
create or replace function password_security.invalidate_change_proof()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from password_security.change_proofs where user_id = new.id;
  return new;
end;
$$;

drop trigger if exists invalidate_change_proof_on_lock on public.app_users;
create trigger invalidate_change_proof_on_lock
  after update of must_change_password on public.app_users
  for each row when (new.must_change_password)
  execute function password_security.invalidate_change_proof();

-- ---------------------------------------------------------------------------
-- 7. Grants
--
-- The two halves of a self-service change: service role only, so a member's
-- bearer token cannot reach either.
-- The three reset steps: the officer's own session, so the permission checks
-- in `assert_may_reset()` run as that officer and the database stays the
-- authority on who may reset whom.
-- ---------------------------------------------------------------------------
revoke all on function password_security.assert_may_reset(uuid),
                      password_security.invalidate_change_proof()
  from public, anon, authenticated, service_role;

revoke all on function public.begin_password_change(uuid),
                      public.complete_password_change(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.begin_password_change(uuid),
                          public.complete_password_change(uuid, uuid)
  to service_role;

revoke all on function public.begin_temporary_password_reset(uuid),
                      public.complete_temporary_password_reset(uuid, uuid),
                      public.abort_temporary_password_reset(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.begin_temporary_password_reset(uuid),
                          public.complete_temporary_password_reset(uuid, uuid),
                          public.abort_temporary_password_reset(uuid, uuid)
  to authenticated, service_role;

commit;
