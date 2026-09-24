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
