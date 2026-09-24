-- Supabase-compatible bootstrap for a LOCAL DOCUMENTATION/TEST database only.
-- Recreates the parts of a Supabase project the migrations depend on:
-- the auth schema, auth.users, auth.uid()/jwt()/role(), and the API roles.

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";
create extension if not exists "citext";

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit password 'authenticator';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin noinherit;
  end if;
end $$;

grant anon, authenticated, service_role to authenticator;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role, authenticator;

create table if not exists auth.users (
  id                  uuid primary key default gen_random_uuid(),
  instance_id         uuid default '00000000-0000-0000-0000-000000000000',
  is_sso_user         boolean not null default false,
  is_anonymous        boolean not null default false,
  aud                 varchar(255) default 'authenticated',
  role                varchar(255) default 'authenticated',
  email               varchar(255) unique,
  encrypted_password  varchar(255),
  email_confirmed_at  timestamptz default now(),
  invited_at          timestamptz,
  confirmation_token  varchar(255),
  recovery_token      varchar(255),
  recovery_sent_at    timestamptz,
  last_sign_in_at     timestamptz,
  raw_app_meta_data   jsonb default '{}'::jsonb,
  raw_user_meta_data  jsonb default '{}'::jsonb,
  is_super_admin      boolean,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now(),
  phone               text unique,
  phone_confirmed_at  timestamptz,
  banned_until        timestamptz,
  deleted_at          timestamptz
);

grant select on auth.users to anon, authenticated, service_role;
grant all on auth.users to supabase_auth_admin;

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ), '')::uuid;
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text;
$$;

create or replace function auth.email() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text;
$$;

grant execute on function auth.uid(), auth.jwt(), auth.role(), auth.email() to anon, authenticated, service_role, authenticator;
