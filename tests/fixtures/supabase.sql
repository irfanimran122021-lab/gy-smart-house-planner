-- Test-only stand-ins for the Supabase-managed auth/storage schema surface.
-- The real migration is loaded unchanged after this fixture. Never run this
-- fixture in Supabase: it is only for the disposable local PostgreSQL cluster.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema storage;
grant usage on schema auth, storage, public to anon, authenticated, service_role;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
create table storage.buckets (
  id text primary key, name text unique not null, public boolean not null default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  bucket_id text not null references storage.buckets(id),
  name text not null, owner_id text,
  unique(bucket_id, name)
);
create function storage.foldername(name text) returns text[] language sql immutable as $$
  with parts as (select pg_catalog.string_to_array(name, '/') as p)
  select p[1:pg_catalog.array_length(p, 1)-1] from parts;
$$;
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
-- Simulate legacy Supabase default grants; the migration must remove unwanted
-- client privileges rather than merely relying on RLS.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
-- A pre-created bucket must not retain public access or weak limits.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('references','references',true,10000000,array['text/plain']);
