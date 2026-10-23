create table public.projects (
 id uuid primary key, owner_id uuid not null references auth.users(id) on delete cascade,
 name text not null, model jsonb not null, updated_at timestamptz not null default now()
);
create table public.project_revisions (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
 owner_id uuid not null references auth.users(id) on delete cascade, model jsonb not null, created_at timestamptz not null default now()
);
alter table public.projects enable row level security;
alter table public.project_revisions enable row level security;
create policy "Owner project access" on public.projects for all to authenticated using (owner_id=auth.uid()) with check (owner_id=auth.uid());
create policy "Owner revision read" on public.project_revisions for select to authenticated using (owner_id=auth.uid());
create policy "Owner revision insert" on public.project_revisions for insert to authenticated with check (owner_id=auth.uid() and exists(select 1 from public.projects p where p.id=project_id and p.owner_id=auth.uid()));
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types) values ('references','references',false,3145728,array['image/jpeg','image/png','image/webp','application/pdf']) on conflict (id) do nothing;
create policy "Private reference read" on storage.objects for select to authenticated using (bucket_id='references' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "Private reference upload" on storage.objects for insert to authenticated with check (bucket_id='references' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "Private reference delete" on storage.objects for delete to authenticated using (bucket_id='references' and (storage.foldername(name))[1]=auth.uid()::text);
create table public.ai_usage (owner_id uuid not null references auth.users(id) on delete cascade, window_start timestamptz not null, requests integer not null default 0, primary key(owner_id,window_start));
alter table public.ai_usage enable row level security;
create or replace function public.consume_ai_request() returns boolean language plpgsql security definer set search_path=public as $$
declare n integer;
begin
 if auth.uid() is null then return false; end if;
 insert into public.ai_usage(owner_id,window_start,requests) values(auth.uid(),date_trunc('hour',now()),1)
 on conflict(owner_id,window_start) do update set requests=ai_usage.requests+1 returning requests into n;
 return n<=20;
end;
$$;
revoke all on function public.consume_ai_request() from public, anon;
grant execute on function public.consume_ai_request() to authenticated;
create index project_owner_updated on public.projects(owner_id,updated_at desc);
create index revision_project_created on public.project_revisions(project_id,created_at desc);
