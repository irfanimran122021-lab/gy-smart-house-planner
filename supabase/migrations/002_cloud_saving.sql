-- Add to the EXISTING application database after 001_initial.sql.
-- Run the whole file once as postgres in the Supabase SQL Editor.
-- No existing projects, revisions, storage policies or AI quotas are removed.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';

create or replace function public.save_project(
  p_id uuid, p_owner_id uuid, p_name text, p_model jsonb,
  p_expected_updated_at timestamptz default null
)
returns table(saved_updated_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  requesting_user pg_catalog.uuid := auth.uid();
  receipt pg_catalog.timestamptz;
begin
  if requesting_user is null or requesting_user is distinct from p_owner_id then
    raise exception 'Sign in before saving a project' using errcode = '42501';
  end if;
  if pg_catalog.jsonb_typeof(p_model) is distinct from 'object'
     or (p_model->>'id') is distinct from p_id::text
     or p_name is null or pg_catalog.char_length(p_name) not between 1 and 120 then
    raise exception 'Invalid project identification or name' using errcode = '22023';
  end if;

  if p_expected_updated_at is null then
    -- First save never overwrites an existing UUID, including other owners.
    insert into public.projects(id,owner_id,name,model,updated_at)
    values(p_id,requesting_user,p_name,p_model,pg_catalog.clock_timestamp())
    on conflict(id) do nothing returning updated_at into receipt;
  else
    -- Optimistic concurrency: the row lock rechecks this version predicate.
    -- Every receipt advances, even for two saves within the same microsecond.
    update public.projects as p
    set name=p_name, model=p_model,
        updated_at=greatest(pg_catalog.clock_timestamp(),p.updated_at+interval '1 microsecond')
    where p.id=p_id and p.owner_id=requesting_user
      and p.updated_at=p_expected_updated_at
    returning p.updated_at into receipt;
  end if;
  if not found then
    raise exception 'Project changed on another device; preserve both copies'
      using errcode = '40001';
  end if;

  -- Same transaction: a failed revision insert also rolls back the project.
  insert into public.project_revisions(project_id,owner_id,model)
  values(p_id,requesting_user,p_model);
  return query select receipt;
end;
$function$;

revoke all on function public.save_project(uuid,uuid,text,jsonb,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.save_project(uuid,uuid,text,jsonb,timestamptz) to authenticated;
notify pgrst, 'reload schema';
commit;
