-- ===========================================================================
-- BUD-SACCO - 0052 - Retire the dead role helpers
--
-- Closes F-19.
--
-- `has_role(variadic user_role[])` and `assert_role(variadic user_role[])` are
-- the pre-permissions way of asking "is this person one of these roles?". Every
-- call site from migrations 0002, 0003, 0006 and 0018 has since been superseded
-- by a `create or replace` that asks `assert_permission()` or
-- `assert_capability()` instead, so both are dead code.
--
-- They are not harmless dead code. `has_role()` is SECURITY DEFINER and still
-- granted to `authenticated`, and - unlike the three gate functions migration
-- 0034 fixed - it does not test `must_change_password`:
--
--   select exists (select 1 from app_users
--                   where id = auth.uid() and is_active and role = any (...));
--
-- Calling it today grants nothing, because nothing consults it. But anything
-- built on it tomorrow would silently reopen exactly the temporary-password
-- hole that F-01 was about, in a function whose name makes it look like a
-- safe authorisation check. Removing it is cheaper than remembering it.
--
-- NO ROLE OR PERMISSION CHANGES. This migration removes two functions nothing
-- calls. Every role, every permission, every role-permission grant and every
-- RLS policy is left exactly as it was.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- Prove they are unused on THIS database before removing them.
--
-- The check matters because it runs wherever the migration runs. The audit
-- verified the repository's migration chain and a clean rebuild of it; this
-- asserts the same thing about the schema actually in front of us, so if the
-- hosted database has a function or policy the chain does not, the migration
-- stops instead of breaking authorisation.
-- ---------------------------------------------------------------------------
do $$
declare
  v_funcs text;
  v_pols  text;
  v_views text;
begin
  select string_agg(p.proname, ', ') into v_funcs
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname not in ('has_role', 'assert_role')
     and (p.prosrc ~* '\yhas_role\s*\(' or p.prosrc ~* '\yassert_role\s*\(');

  select string_agg(format('%s on %s', policyname, tablename), ', ') into v_pols
    from pg_policies
   where schemaname = 'public'
     and (coalesce(qual, '') ~* '\y(has|assert)_role\s*\('
       or coalesce(with_check, '') ~* '\y(has|assert)_role\s*\(');

  select string_agg(viewname, ', ') into v_views
    from pg_views
   where schemaname = 'public' and definition ~* '\y(has|assert)_role\s*\(';

  if v_funcs is not null or v_pols is not null or v_views is not null then
    raise exception
      'Refusing to retire has_role()/assert_role(): still referenced by functions [%], policies [%], views [%].',
      coalesce(v_funcs, 'none'), coalesce(v_pols, 'none'), coalesce(v_views, 'none');
  end if;
end $$;

drop function if exists public.has_role(variadic user_role[]);
drop function if exists public.assert_role(variadic user_role[]);

commit;
