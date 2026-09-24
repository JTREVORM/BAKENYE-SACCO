-- Minimal Supabase Storage stand-in: enough for the migrations' bucket row and
-- object policies. No file upload path is exercised in this test environment.
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  owner              uuid,
  public             boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

create table if not exists storage.objects (
  id             uuid primary key default gen_random_uuid(),
  bucket_id      text references storage.buckets (id),
  name           text,
  owner          uuid,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now(),
  last_accessed_at timestamptz default now(),
  metadata       jsonb,
  path_tokens    text[]
);
alter table storage.objects enable row level security;
grant select, insert on storage.objects to authenticated;
grant select on storage.buckets to authenticated, anon;

-- ---------------------------------------------------------------------------
-- The remaining auth tables a real Supabase project has. The application never
-- reads them, but the repository's own scripts/reset-data.sql clears them, so
-- the stand-in carries them too - otherwise "start again from nothing" cannot
-- be tested here.
-- ---------------------------------------------------------------------------
create table if not exists auth.identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  provider text, provider_id text, identity_data jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create table if not exists auth.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create table if not exists auth.refresh_tokens (
  id bigserial primary key, token text, user_id text,
  session_id uuid references auth.sessions (id) on delete cascade,
  revoked boolean default false, created_at timestamptz default now()
);
create table if not exists auth.audit_log_entries (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid, payload json, created_at timestamptz default now(), ip_address varchar(64)
);
create table if not exists auth.flow_state (
  id uuid primary key default gen_random_uuid(),
  user_id uuid, auth_code text, created_at timestamptz default now()
);
create table if not exists auth.one_time_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  token_hash text, relates_to text, created_at timestamptz default now()
);
create table if not exists auth.mfa_factors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  created_at timestamptz default now()
);
grant all on all tables in schema auth to service_role;
