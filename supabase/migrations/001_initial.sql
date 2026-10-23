-- GY Smart House Planner: initial schema for a NEW Supabase project.
-- Run this entire file once in the Supabase SQL Editor as the postgres role.
-- Do not run on an installation where the original 001 migration was applied:
-- existing application tables cause an error and roll back this whole transaction.
-- Supabase's managed auth/storage schemas must already be provisioned.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '60s';

-- Verify managed Storage prerequisites without altering shared Storage grants,
-- table ownership, or RLS settings (which Supabase itself manages).
do $preflight$
begin
  if not pg_catalog.has_table_privilege('authenticated', 'storage.objects', 'SELECT')
     or not pg_catalog.has_table_privilege('authenticated', 'storage.objects', 'INSERT')
     or not pg_catalog.has_table_privilege('authenticated', 'storage.objects', 'DELETE') then
    raise exception 'Supabase Storage grants are not provisioned for authenticated users. Restore the managed Storage configuration before applying this migration.';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_class as c
    join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'storage' and c.relname = 'objects' and c.relrowsecurity
  ) then
    raise exception 'Supabase Storage RLS is not enabled. Restore the managed Storage configuration before applying this migration.';
  end if;
end;
$preflight$;

create table public.projects (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  model jsonb not null,
  updated_at timestamptz not null default pg_catalog.now(),
  -- This key permits a composite FK that enforces revision ownership even for
  -- privileged SQL writes which bypass RLS.
  constraint projects_id_owner_unique unique (id, owner_id)
);

create table public.project_revisions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  project_id uuid not null,
  owner_id uuid not null,
  model jsonb not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint revision_project_owner_fk foreign key (project_id, owner_id)
    references public.projects(id, owner_id)
    on update restrict on delete cascade
);

create table public.ai_usage (
  owner_id uuid not null references auth.users(id) on delete cascade,
  window_start timestamptz not null,
  requests integer not null default 1,
  primary key (owner_id, window_start),
  constraint ai_usage_requests_range check (requests between 1 and 20),
  constraint ai_usage_utc_hour check (
    window_start = pg_catalog.date_trunc('hour', window_start, 'UTC')
  )
);

alter table public.projects enable row level security;
alter table public.project_revisions enable row level security;
alter table public.ai_usage enable row level security;

-- Set privileges explicitly: Supabase projects can have different default ACLs.
-- authenticated needs UPDATE as well as INSERT for the client's project upsert.
-- Revisions are append-only from the browser. No client can inspect/reset quotas.
revoke all on table public.projects, public.project_revisions, public.ai_usage
  from public, anon, authenticated;
grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.projects to authenticated;
grant select, insert on table public.project_revisions to authenticated;

create policy "Owner project access" on public.projects
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "Owner revision read" on public.project_revisions
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.projects as p
      where p.id = project_revisions.project_id
        and p.owner_id = project_revisions.owner_id
        and p.owner_id = (select auth.uid())
    )
  );

create policy "Owner revision insert" on public.project_revisions
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.projects as p
      where p.id = project_revisions.project_id
        and p.owner_id = project_revisions.owner_id
        and p.owner_id = (select auth.uid())
    )
  );

-- Reconcile a pre-created references bucket instead of silently retaining a
-- public bucket or weaker upload limits. No existing objects are deleted.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'references', 'references', false, 3145728,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Object names are <auth.uid()>/<project-id>/<filename> in the application.
-- The first path component is authoritative; owner/owner_id metadata is not
-- trusted. A missing prefix or unauthenticated uid never matches.
create policy "Private reference read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'references'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "Private reference upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'references'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "Private reference delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'references'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Permissive RLS policies combine with OR. This restrictive guard prevents an
-- unrelated broad Storage policy from exposing references to another user.
-- Other buckets retain their existing policies and behavior.
create policy "Reference namespace isolation" on storage.objects
  as restrictive for all to public
  using (
    bucket_id <> 'references'
    or (
      (select auth.uid()) is not null
      and (storage.foldername(name))[1] = (select auth.uid())::text
    )
  )
  with check (
    bucket_id <> 'references'
    or (
      (select auth.uid()) is not null
      and (storage.foldername(name))[1] = (select auth.uid())::text
    )
  );

-- The client uses upload(upsert:false). Disable reference object UPDATE/move
-- even if another bucket's permissive policy happens to allow UPDATE globally.
create policy "Reference objects are immutable" on storage.objects
  as restrictive for update to public
  using (bucket_id <> 'references')
  with check (bucket_id <> 'references');

create or replace function public.consume_ai_request()
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  requesting_user pg_catalog.uuid := auth.uid();
  request_hour pg_catalog.timestamptz := pg_catalog.date_trunc(
    'hour', pg_catalog.statement_timestamp(), 'UTC'
  );
begin
  if requesting_user is null then
    return false;
  end if;

  -- A unique (user, UTC hour) key serializes competing inserts/updates.
  -- The WHERE predicate is evaluated against the locked, current row, so
  -- parallel requests cannot admit more than 20 or increment rejected calls.
  insert into public.ai_usage as usage (owner_id, window_start, requests)
  values (requesting_user, request_hour, 1)
  on conflict (owner_id, window_start) do update
    set requests = usage.requests + 1
    where usage.requests < 20;

  -- INSERT sets FOUND only when it actually inserted/updated a row.
  return found;
end;
$function$;

-- The narrow, zero-argument RPC operates only on the authenticated JWT uid.
-- Keep its owner trusted and remove PostgreSQL's default PUBLIC execution grant.
alter function public.consume_ai_request() owner to postgres;
revoke all on function public.consume_ai_request()
  from public, anon, authenticated, service_role;
grant execute on function public.consume_ai_request() to authenticated;

create index project_owner_updated on public.projects(owner_id, updated_at desc);
create index revision_project_created on public.project_revisions(project_id, created_at desc);

commit;
