begin;

create temp table t_result (n serial, step text, ok boolean, detail text);
create temp table t_ctx (key text primary key, id uuid, txt text);
grant all on t_result, t_ctx to authenticated, service_role;
grant usage on sequence t_result_n_seq to authenticated, service_role;

-- ===========================================================================
-- Password security: the temporary-password lock, under attempted bypass.
--
-- Covers F-01 (BKC-01) and F-04 of the 22 October 2026 diagnostic.
--
-- The point of this suite is the point F-14 made: the existing
-- temporary-password checks assert that the lock holds when nobody tries to
-- lift it. Every assertion below tries to lift it. A control that is only
-- tested while unchallenged is not tested.
--
-- Runs inside a transaction that is always rolled back. Every account it
-- touches is created here, from synthetic values; no seeded or real account is
-- modified, and no plaintext password exists anywhere in this file - the
-- `encrypted_password` values are opaque markers standing in for the bcrypt
-- hashes Supabase Auth writes, which is all the database ever sees.
-- ===========================================================================

reset role;

-- The hashes Auth would hold before and after a real credential change.
-- Opaque to the database, which only ever compares them for equality.
do $$ begin
  perform set_config('bud.h_temp',  '$2a$10$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', false);
  perform set_config('bud.h_chosen','$2a$10$BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', false);
  perform set_config('bud.h_third', '$2a$10$CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC', false);
end $$;

-- ---------------------------------------------------------------------------
-- 0. Two synthetic member logins and one cashier, provisioned exactly the way
--    Supabase Auth's admin API does it: the row first, the app metadata in a
--    second statement.
-- ---------------------------------------------------------------------------
do $$
declare
  v_admin  text := current_setting('request.jwt.claims', true);
  v_m1     uuid;
  v_m2     uuid;
  v_u1     uuid := gen_random_uuid();
  v_u2     uuid := gen_random_uuid();
  v_cash   uuid := gen_random_uuid();
begin
  insert into t_ctx values ('admin_claims', null, v_admin);

  select id into v_m1 from members where user_id is null order by member_no limit 1;
  select id into v_m2 from members where user_id is null and id <> v_m1 order by member_no limit 1;
  if v_m1 is null or v_m2 is null then
    raise exception 'This suite needs two seeded members without logins.';
  end if;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at)
  values (v_u1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'pwsec1@members.bnd-sacco.invalid', current_setting('bud.h_temp'), now(),
          jsonb_build_object('provider', 'email'), '{}'::jsonb, now(), now()),
         (v_u2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'pwsec2@members.bnd-sacco.invalid', current_setting('bud.h_temp'), now(),
          jsonb_build_object('provider', 'email'), '{}'::jsonb, now(), now()),
         (v_cash, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'pwsec-cashier@staff.bnd-sacco.invalid', current_setting('bud.h_chosen'), now(),
          jsonb_build_object('provider', 'email'),
          jsonb_build_object('full_name', 'Password Suite Cashier'), now(), now());

  update auth.users set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('member_id', v_m1) where id = v_u1;
  update auth.users set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('member_id', v_m2) where id = v_u2;
  update auth.users set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('role', 'cashier') where id = v_cash;

  -- The cashier has already chosen their own password.
  update app_users set must_change_password = false, password_set_at = now() where id = v_cash;

  insert into t_ctx values ('m1', v_m1, null), ('m2', v_m2, null),
                           ('u1', v_u1, null), ('u2', v_u2, null), ('cashier', v_cash, null);

  insert into t_result (step, ok, detail)
  values ('0a two member logins provisioned, both on a staff-issued temporary password',
          (select count(*) from app_users
            where id in (v_u1, v_u2) and must_change_password and is_active
              and role = 'member' and password_set_at is null) = 2, null);
end $$;

-- ---------------------------------------------------------------------------
-- 1. The lock itself: a temporary password reaches no data
-- ---------------------------------------------------------------------------
set role authenticated;

do $$
declare v_u1 uuid := (select id from t_ctx where key = 'u1');
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_u1, 'role', 'authenticated')::text, true);

  insert into t_result (step, ok, detail)
  values ('1a on a temporary password the account reads no transactions, no members and holds no permission',
          (select count(*) from transactions) = 0
          and (select count(*) from members) = 0
          and (select count(*) from account_ledger_entries) = 0
          and current_member_id() is null
          and not has_permission('portal.view')
          and not is_staff_user()
          and (my_session() ->> 'must_change_password')::boolean, null);
end $$;

-- ---------------------------------------------------------------------------
-- 2. F-01: the retired RPC cannot lift the lock
-- ---------------------------------------------------------------------------
do $$
declare
  v_u1 uuid := (select id from t_ctx where key = 'u1');
  v_denied boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_u1, 'role', 'authenticated')::text, true);
  begin
    perform log_password_changed();
  exception when insufficient_privilege then
    v_denied := true;
  end;

  insert into t_result (step, ok, detail)
  values ('2a calling the retired log_password_changed() is refused', v_denied, null);

  insert into t_result (step, ok, detail)
  values ('2b and the lock still holds: no data, no permission, flag untouched',
          (select count(*) from transactions) = 0
          and (select count(*) from members) = 0
          and current_member_id() is null
          and not has_permission('portal.view')
          and (select must_change_password from app_users where id = v_u1), null);

  insert into t_result (step, ok, detail)
  values ('2c no audit row falsely claims the password was changed',
          not exists (select 1 from audit_logs
                       where action = 'auth.password_changed' and record_id = v_u1::text), null);
end $$;

-- Reading the catalogue, as the owner: naming an object inside the private
-- schema is itself something `authenticated` may not do.
reset role;

insert into t_result (step, ok, detail)
select '2d a signed-in caller holds no grant on either half of a password change, nor on the retired RPCs',
       not has_function_privilege('authenticated', 'public.begin_password_change(uuid)', 'execute')
       and not has_function_privilege('authenticated', 'public.complete_password_change(uuid, uuid)', 'execute')
       and not has_function_privilege('authenticated', 'public.log_password_changed()', 'execute')
       and not has_function_privilege('authenticated', 'public.issue_temporary_password(uuid)', 'execute')
       and not has_function_privilege('anon', 'public.begin_password_change(uuid)', 'execute')
       and not has_function_privilege('anon', 'public.complete_password_change(uuid, uuid)', 'execute'), null;

insert into t_result (step, ok, detail)
select '2e the proof store is in a private schema and unreachable by any API role',
       not has_schema_privilege('authenticated', 'password_security', 'usage')
       and not has_schema_privilege('anon', 'password_security', 'usage')
       and not has_schema_privilege('service_role', 'password_security', 'usage')
       and not has_table_privilege('authenticated', 'password_security.change_proofs', 'select')
       and not has_table_privilege('service_role', 'password_security.change_proofs', 'select')
       and not has_table_privilege('authenticated', 'password_security.reset_reservations', 'select'), null;

-- ---------------------------------------------------------------------------
-- 3. The in-function guard, independent of the grants
--
--    Run as the owner, which no grant can stop, with an ordinary
--    `authenticated` JWT. The function must still refuse.
-- ---------------------------------------------------------------------------
reset role;

do $$
declare
  v_u1 uuid := (select id from t_ctx where key = 'u1');
  v_b boolean := false;
  v_c boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_u1, 'role', 'authenticated')::text, true);
  begin
    perform begin_password_change(v_u1);
  exception when insufficient_privilege then v_b := true;
  end;
  begin
    perform complete_password_change(v_u1, gen_random_uuid());
  exception when insufficient_privilege then v_c := true;
  end;

  insert into t_result (step, ok, detail)
  values ('3a both halves refuse a non-service-role caller even when the grant is bypassed', v_b and v_c, null);
end $$;

-- ---------------------------------------------------------------------------
-- 4. A legitimate password change unlocks the account - and nothing less does
-- ---------------------------------------------------------------------------
do $$
declare
  v_u1   uuid := (select id from t_ctx where key = 'u1');
  v_m1   uuid := (select id from t_ctx where key = 'm1');
  v_nonce uuid;
  v_stale uuid;
  v_failed boolean := false;
  v_reused boolean := false;
  v_expired boolean := false;
begin
  -- ---- the server's identity -------------------------------------------
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- An Auth password that has NOT changed must not lift the lock.
  v_nonce := begin_password_change(v_u1);
  begin
    perform complete_password_change(v_u1, v_nonce);
  exception when insufficient_privilege then v_failed := true;
  end;
  insert into t_result (step, ok, detail)
  values ('4a a completion whose Auth password never changed is refused', v_failed, null);
  insert into t_result (step, ok, detail)
  values ('4b and the account is left locked, not opened',
          (select must_change_password from app_users where id = v_u1)
          and (select password_set_at is null from app_users where id = v_u1), null);

  -- A wrong nonce is refused.
  v_failed := false;
  begin
    perform complete_password_change(v_u1, gen_random_uuid());
  exception when insufficient_privilege then v_failed := true;
  end;
  insert into t_result (step, ok, detail)
  values ('4c a completion presenting the wrong nonce is refused', v_failed, null);

  -- An expired proof is refused.
  v_stale := begin_password_change(v_u1);
  update password_security.change_proofs
     set expires_at = clock_timestamp() - interval '1 minute' where user_id = v_u1;
  update auth.users set encrypted_password = current_setting('bud.h_chosen') where id = v_u1;
  begin
    perform complete_password_change(v_u1, v_stale);
  exception when insufficient_privilege then v_expired := true;
  end;
  insert into t_result (step, ok, detail)
  values ('4d an expired proof is refused even though the Auth password did change', v_expired, null);
  insert into t_result (step, ok, detail)
  values ('4e an account whose verification failed stays restricted',
          (select must_change_password from app_users where id = v_u1), null);

  -- The genuine article: snapshot, a real Auth change, then completion.
  update auth.users set encrypted_password = current_setting('bud.h_temp') where id = v_u1;
  v_nonce := begin_password_change(v_u1);
  update auth.users set encrypted_password = current_setting('bud.h_chosen') where id = v_u1;
  perform complete_password_change(v_u1, v_nonce);

  insert into t_result (step, ok, detail)
  values ('4f a verified password change lifts the lock and stamps the change',
          not (select must_change_password from app_users where id = v_u1)
          and (select password_set_at is not null from app_users where id = v_u1), null);

  insert into t_result (step, ok, detail)
  values ('4g and only then is the change recorded, once',
          (select count(*) from audit_logs
            where action = 'auth.password_changed' and record_id = v_u1::text) = 1, null);

  -- The same proof cannot be presented twice.
  update auth.users set encrypted_password = current_setting('bud.h_third') where id = v_u1;
  begin
    perform complete_password_change(v_u1, v_nonce);
  exception when insufficient_privilege then v_reused := true;
  end;
  insert into t_result (step, ok, detail)
  values ('4h a proof is single-use: replaying it is refused', v_reused, null);
  insert into t_result (step, ok, detail)
  values ('4i and the replay adds no second audit row',
          (select count(*) from audit_logs
            where action = 'auth.password_changed' and record_id = v_u1::text) = 1, null);

  perform set_config('request.jwt.claims', (select txt from t_ctx where key = 'admin_claims'), true);
end $$;

-- The unlocked account now reaches exactly its own record, and no more.
set role authenticated;

do $$
declare
  v_u1 uuid := (select id from t_ctx where key = 'u1');
  v_m1 uuid := (select id from t_ctx where key = 'm1');
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_u1, 'role', 'authenticated')::text, true);
  insert into t_result (step, ok, detail)
  values ('4j the unlocked member reads their own record and only their own',
          current_member_id() = v_m1
          and has_permission('portal.view')
          and (select count(*) from members) = 1
          and (select count(*) from account_ledger_entries) = 0, null);
end $$;

-- ---------------------------------------------------------------------------
-- 5. No privilege escalation from a locked account
-- ---------------------------------------------------------------------------
do $$
declare
  v_u2   uuid := (select id from t_ctx where key = 'u2');
  v_u1   uuid := (select id from t_ctx where key = 'u1');
  v_cash uuid := (select id from t_ctx where key = 'cashier');
  v_reset boolean := false;
  v_role  boolean := false;
  v_perm  boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_u2, 'role', 'authenticated')::text, true);

  -- u2 is still on a temporary password. It may not reset anybody.
  begin
    perform begin_temporary_password_reset(v_u1);
  exception when others then v_reset := true;
  end;
  begin
    perform set_user_role(v_cash, 'super_admin', 'escalation attempt');
  exception when others then v_role := true;
  end;
  begin
    perform set_role_permissions('member', array['users.manage'], 'escalation attempt');
  exception when others then v_perm := true;
  end;

  insert into t_result (step, ok, detail)
  values ('5a a locked account cannot reset another account, grant itself a role, or grant itself a permission',
          v_reset and v_role and v_perm, null);

  insert into t_result (step, ok, detail)
  values ('5b and it is still locked, and still reads nothing',
          (select count(*) from transactions) = 0
          and current_member_id() is null, null);
end $$;

-- A member who HAS chosen their password still cannot reset anybody.
do $$
declare
  v_u1 uuid := (select id from t_ctx where key = 'u1');
  v_u2 uuid := (select id from t_ctx where key = 'u2');
  v_denied boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_u1, 'role', 'authenticated')::text, true);
  begin
    perform begin_temporary_password_reset(v_u2);
  exception when others then v_denied := true;
  end;
  insert into t_result (step, ok, detail)
  values ('5c an ordinary member, fully signed in, cannot start a reset on another account', v_denied, null);
end $$;

-- ---------------------------------------------------------------------------
-- 6. F-04: the staff-assisted reset, and what happens when Auth fails
-- ---------------------------------------------------------------------------
reset role;

do $$
declare
  v_u2    uuid := (select id from t_ctx where key = 'u2');
  v_res   jsonb;
  v_token uuid;
  v_early boolean := false;
begin
  -- As the super administrator the runner signed in as.
  perform set_config('request.jwt.claims', (select txt from t_ctx where key = 'admin_claims'), true);

  -- ---- the failure path: Auth never installs the password ---------------
  update auth.users set encrypted_password = current_setting('bud.h_temp') where id = v_u2;
  update app_users set must_change_password = false, password_set_at = now() where id = v_u2;

  v_res := begin_temporary_password_reset(v_u2);
  v_token := (v_res ->> 'token')::uuid;

  insert into t_result (step, ok, detail)
  values ('6a a reset starts by confining the account, and says only that it was started',
          (select must_change_password from app_users where id = v_u2)
          and exists (select 1 from audit_logs
                       where action = 'account.password_reset_started' and record_id = v_u2::text)
          and not exists (select 1 from audit_logs
                       where action = 'account.password_reset' and record_id = v_u2::text), null);

  -- Auth failed, so the hash is unchanged. Completion must refuse.
  begin
    perform complete_temporary_password_reset(v_u2, v_token);
  exception when insufficient_privilege then v_early := true;
  end;
  insert into t_result (step, ok, detail)
  values ('6b completion is refused while the Auth password is unchanged, so no reset is ever falsely recorded',
          v_early
          and not exists (select 1 from audit_logs
                           where action = 'account.password_reset' and record_id = v_u2::text), null);

  -- The officer's screen reports the failure; the server rolls the reset back.
  perform abort_temporary_password_reset(v_u2, v_token);
  insert into t_result (step, ok, detail)
  values ('6c an aborted reset restores the standing the account had, and records the failure',
          not (select must_change_password from app_users where id = v_u2)
          and exists (select 1 from audit_logs
                       where action = 'account.password_reset_failed' and record_id = v_u2::text)
          and not exists (select 1 from audit_logs
                       where action = 'account.password_reset' and record_id = v_u2::text), null);

  -- A lost response means the officer's screen may abort twice. The second
  -- abort must not raise, and must not change anything.
  perform abort_temporary_password_reset(v_u2, v_token);
  insert into t_result (step, ok, detail)
  values ('6d aborting a reset twice raises nothing and changes nothing',
          not (select must_change_password from app_users where id = v_u2)
          and (select count(*) from audit_logs
                where action = 'account.password_reset_failed' and record_id = v_u2::text) = 1, null);

  -- ---- the success path --------------------------------------------------
  v_res := begin_temporary_password_reset(v_u2);
  v_token := (v_res ->> 'token')::uuid;
  update auth.users set encrypted_password = current_setting('bud.h_third') where id = v_u2;
  perform complete_temporary_password_reset(v_u2, v_token);

  insert into t_result (step, ok, detail)
  values ('6e a completed reset leaves the account locked and records the issue exactly once',
          (select must_change_password from app_users where id = v_u2)
          and (select count(*) from audit_logs
                where action = 'account.password_reset' and record_id = v_u2::text) = 1, null);

  insert into t_result (step, ok, detail)
  values ('6f the reservation is consumed: the same token cannot be completed again',
          not exists (select 1 from password_security.reset_reservations where user_id = v_u2), null);

  insert into t_result (step, ok, detail)
  values ('6g no plaintext or temporary password is anywhere in the audit trail',
          not exists (select 1 from audit_logs
                       where action like 'account.password_reset%'
                         and (coalesce(new_value::text, '') ~* '"(current_|new_|temp_|temporary_)?password"\s*:'
                           or coalesce(old_value::text, '') ~* '"(current_|new_|temp_|temporary_)?password"\s*:')), null);

  -- The application schema keeps a flag and a timestamp about passwords, and
  -- nothing else. The one hash the remediation does keep - the snapshot a
  -- change proof compares against - lives in `password_security`, which step
  -- 2e proves no API role can reach.
  insert into t_result (step, ok, detail)
  values ('6h in the public schema the only password columns are a flag and a timestamp, never a credential',
          not exists (select 1 from information_schema.columns
                       where table_schema = 'public'
                         and column_name ~* 'passw'
                         and column_name not in ('must_change_password', 'password_set_at')), null);
end $$;

-- An officer still cannot reset their own password this way, nor an unknown account.
do $$
declare
  v_self boolean := false;
  v_ghost boolean := false;
begin
  perform set_config('request.jwt.claims', (select txt from t_ctx where key = 'admin_claims'), true);
  begin
    perform begin_temporary_password_reset((current_setting('request.jwt.claims')::jsonb ->> 'sub')::uuid);
  exception when others then v_self := true;
  end;
  begin
    perform begin_temporary_password_reset(gen_random_uuid());
  exception when others then v_ghost := true;
  end;
  insert into t_result (step, ok, detail)
  values ('6i an officer cannot reset their own password here, nor an account that does not exist',
          v_self and v_ghost, null);
end $$;

-- ---------------------------------------------------------------------------
-- 7. Concurrency: a reset and a change racing on one account
--
--    Whichever order they interleave, the account must never end up unlocked
--    by the older of the two operations.
-- ---------------------------------------------------------------------------
do $$
declare
  v_u1    uuid := (select id from t_ctx where key = 'u1');
  v_nonce uuid;
  v_res   jsonb;
  v_token uuid;
  v_blocked boolean := false;
begin
  -- The member is settled on their own password.
  update auth.users set encrypted_password = current_setting('bud.h_chosen') where id = v_u1;
  update app_users set must_change_password = false, password_set_at = now() where id = v_u1;

  -- (i) The member begins a change; an officer's reset lands mid-flight.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_nonce := begin_password_change(v_u1);

  perform set_config('request.jwt.claims', (select txt from t_ctx where key = 'admin_claims'), true);
  v_res := begin_temporary_password_reset(v_u1);
  v_token := (v_res ->> 'token')::uuid;
  update auth.users set encrypted_password = current_setting('bud.h_third') where id = v_u1;
  perform complete_temporary_password_reset(v_u1, v_token);

  -- The member's own Auth write then lands, and they try to finish.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  update auth.users set encrypted_password = current_setting('bud.h_temp') where id = v_u1;
  begin
    perform complete_password_change(v_u1, v_nonce);
  exception when insufficient_privilege then v_blocked := true;
  end;

  insert into t_result (step, ok, detail)
  values ('7a a change begun before a staff reset cannot complete afterwards', v_blocked, null);
  insert into t_result (step, ok, detail)
  values ('7b so the newer reset stands: the account is still locked',
          (select must_change_password from app_users where id = v_u1), null);

  -- (ii) Two resets racing: the later reservation wins, the earlier is dead,
  --      and the account stays locked throughout.
  perform set_config('request.jwt.claims', (select txt from t_ctx where key = 'admin_claims'), true);
  v_res := begin_temporary_password_reset(v_u1);
  v_token := (v_res ->> 'token')::uuid;            -- officer A
  perform begin_temporary_password_reset(v_u1);     -- officer B supersedes A
  update auth.users set encrypted_password = current_setting('bud.h_chosen') where id = v_u1;

  v_blocked := false;
  begin
    perform complete_temporary_password_reset(v_u1, v_token);
  exception when insufficient_privilege then v_blocked := true;
  end;
  insert into t_result (step, ok, detail)
  values ('7c a superseded reset cannot be completed by the officer who started it', v_blocked, null);
  insert into t_result (step, ok, detail)
  values ('7d and the account is locked the whole way through',
          (select must_change_password from app_users where id = v_u1), null);

  -- (iii) An abort presented with a superseded token leaves the newer reset alone.
  perform abort_temporary_password_reset(v_u1, v_token);
  insert into t_result (step, ok, detail)
  values ('7e an abort carrying a superseded token cannot unlock the account',
          (select must_change_password from app_users where id = v_u1), null);
end $$;

-- ---------------------------------------------------------------------------
-- 8. Standing is decided elsewhere, and a password change does not touch it
-- ---------------------------------------------------------------------------
do $$
declare
  v_u2    uuid := (select id from t_ctx where key = 'u2');
  v_m2    uuid := (select id from t_ctx where key = 'm2');
  v_nonce uuid;
begin
  perform set_config('request.jwt.claims', (select txt from t_ctx where key = 'admin_claims'), true);
  update members set status = 'suspended' where id = v_m2;

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  update auth.users set encrypted_password = current_setting('bud.h_temp') where id = v_u2;
  v_nonce := begin_password_change(v_u2);
  update auth.users set encrypted_password = current_setting('bud.h_chosen') where id = v_u2;
  perform complete_password_change(v_u2, v_nonce);

  insert into t_result (step, ok, detail)
  values ('8a a suspended member who changes their password is still suspended',
          (select status from members where id = v_m2) = 'suspended', null);
end $$;

set role authenticated;

do $$
declare
  v_u2 uuid := (select id from t_ctx where key = 'u2');
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_u2, 'role', 'authenticated')::text, true);
  insert into t_result (step, ok, detail)
  values ('8b and the session the server reads still reports the suspension, so sign-in is refused',
          (my_session() -> 'member' ->> 'status') = 'suspended'
          and not (my_session() ->> 'must_change_password')::boolean, null);
end $$;

reset role;

do $$
declare
  v_u2    uuid := (select id from t_ctx where key = 'u2');
  v_nonce uuid;
begin
  -- A switched-off account: the lock lifts, the account still opens nothing.
  perform set_config('request.jwt.claims', (select txt from t_ctx where key = 'admin_claims'), true);
  update app_users set is_active = false, must_change_password = true where id = v_u2;

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  update auth.users set encrypted_password = current_setting('bud.h_temp') where id = v_u2;
  v_nonce := begin_password_change(v_u2);
  update auth.users set encrypted_password = current_setting('bud.h_third') where id = v_u2;
  perform complete_password_change(v_u2, v_nonce);
end $$;

set role authenticated;

do $$
declare v_u2 uuid := (select id from t_ctx where key = 'u2');
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_u2, 'role', 'authenticated')::text, true);
  insert into t_result (step, ok, detail)
  values ('8c a deactivated account that changes its password still holds no permission and reads nothing',
          not has_permission('portal.view')
          and current_member_id() is null
          and not is_staff_user()
          and (select count(*) from transactions) = 0, null);
end $$;

-- ---------------------------------------------------------------------------
-- 9. The permission gates that stand behind all of this are unchanged
-- ---------------------------------------------------------------------------
reset role;

insert into t_result (step, ok, detail)
select '9a the three gate functions still refuse an account on a temporary password',
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname in ('is_staff_user', 'has_permission', 'current_member_id')
           and p.prosrc like '%must_change_password%') = 3, null;

insert into t_result (step, ok, detail)
select '9b the retired helpers are stubs that raise, not silent no-ops, and nobody may call them',
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname in ('log_password_changed', 'issue_temporary_password')
           and p.prosrc like '%raise exception%'
           and not p.prosecdef) = 2, null;

insert into t_result (step, ok, detail)
select '9c the three reset steps are callable by a signed-in officer, so the database keeps deciding who may reset whom',
       has_function_privilege('authenticated', 'public.begin_temporary_password_reset(uuid)', 'execute')
       and has_function_privilege('authenticated', 'public.complete_temporary_password_reset(uuid, uuid)', 'execute')
       and has_function_privilege('authenticated', 'public.abort_temporary_password_reset(uuid, uuid)', 'execute')
       and not has_function_privilege('anon', 'public.begin_temporary_password_reset(uuid)', 'execute'), null;

select n, step, case when ok then 'PASS' else 'FAIL' end as result, detail
  from t_result order by n;

rollback;
