-- Main providers are represented by employers.provider_organisation_id, never removable link rows.
delete from public.employer_linked_providers l using public.employers e where l.employer_id=e.id and l.provider_organisation_id=e.provider_organisation_id;
-- Existing associations were never consented to: keep them as pending employer requests.
alter table public.employer_linked_providers
  add column status text not null default 'pending' check (status in ('pending','accepted','declined')),
  add column initiated_by text not null default 'employer' check (initiated_by in ('employer','provider')),
  add column sharing jsonb not null default '{"all":true,"catalogues":[]}'::jsonb,
  add column decided_at timestamptz,
  add column decided_by uuid references auth.users(id) on delete set null;

create schema if not exists private;
grant usage on schema private to authenticated;

-- Trigger is privileged only to validate cross-organisation references hidden by RLS.
create or replace function private.guard_employer_provider_sharing()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v public.employer_linked_providers;
  item jsonb;
  course jsonb;
  actor uuid := auth.uid();
begin
  -- Foreign-key cascades may clear audit users or remove a deleted parent.
  -- Only nested trigger operations qualify; ordinary client writes still use consent checks.
  if pg_trigger_depth() > 1 then
    if TG_OP = 'DELETE' and (
      not exists(select 1 from public.employers where id=old.employer_id)
      or not exists(select 1 from public.organisations where id=old.provider_organisation_id)
    ) then return old; end if;
    if TG_OP = 'UPDATE'
      and (to_jsonb(new)-array['linked_by','decided_by']) = (to_jsonb(old)-array['linked_by','decided_by'])
      and (new.linked_by is null or new.linked_by is not distinct from old.linked_by)
      and (new.decided_by is null or new.decided_by is not distinct from old.decided_by)
    then return new; end if;
  end if;
  if TG_OP = 'DELETE' then v := old; else v := new; end if;
  if actor is null or not (public.is_employer_admin(v.employer_id,actor) or public.is_org_admin(v.provider_organisation_id,actor)) then
    raise exception 'Not authorized';
  end if;
  if exists(select 1 from public.employers e where e.id=v.employer_id and e.provider_organisation_id=v.provider_organisation_id) then
    raise exception 'The main provider connection is permanent';
  end if;
  if TG_OP = 'DELETE' then return old; end if;
  if TG_OP = 'INSERT' then
    if new.status <> 'pending' or new.linked_by is distinct from actor or new.decided_by is not null or new.decided_at is not null then
      raise exception 'A connection must start as a pending request';
    end if;
    if not (case new.initiated_by when 'employer' then public.is_employer_admin(new.employer_id,actor) else public.is_org_admin(new.provider_organisation_id,actor) end) then
      raise exception 'Not authorized to send this request';
    end if;
  else
    if (to_jsonb(new) - array['status','decided_at','decided_by']) is distinct from (to_jsonb(old) - array['status','decided_at','decided_by']) then
      raise exception 'Sharing selections cannot change after sending; cancel and send a new request';
    end if;
    if old.status <> 'pending' or new.status not in ('accepted','declined') then raise exception 'This request has already been decided'; end if;
    if not (case old.initiated_by when 'employer' then public.is_org_admin(old.provider_organisation_id,actor) else public.is_employer_admin(old.employer_id,actor) end) then
      raise exception 'Only the receiving organisation can approve or decline';
    end if;
    new.decided_at := now(); new.decided_by := actor;
    return new;
  end if;
  if jsonb_typeof(new.sharing) is distinct from 'object'
    or jsonb_typeof(new.sharing->'all') is distinct from 'boolean'
    or jsonb_typeof(new.sharing->'catalogues') is distinct from 'array' then raise exception 'Invalid sharing selection'; end if;
  if not (new.sharing->>'all')::boolean and jsonb_array_length(new.sharing->'catalogues')=0 then raise exception 'Select at least one catalogue'; end if;
  for item in select value from jsonb_array_elements(new.sharing->'catalogues') loop
    if not exists(select 1 from public.catalogues c where c.id=(item->>'id')::uuid and c.organisation_id=new.provider_organisation_id and not c.is_global) then raise exception 'Select a catalogue owned by this provider'; end if;
    if jsonb_typeof(item->'all') is distinct from 'boolean' or jsonb_typeof(item->'courses') is distinct from 'array' then raise exception 'Invalid course selection'; end if;
    if not (item->>'all')::boolean and jsonb_array_length(item->'courses')=0 then raise exception 'Select at least one course in each catalogue'; end if;
    for course in select value from jsonb_array_elements(item->'courses') loop
      if not exists(select 1 from public.course_catalogue_publications p join public.course_catalogue cc on cc.id=p.course_id where p.catalogue_id=(item->>'id')::uuid and p.course_id=(course#>>'{}')::uuid and p.published_at is not null and cc.status='approved' and cc.is_current_published) then raise exception 'Select a published course in this catalogue'; end if;
    end loop;
  end loop;
  return new;
end $$;
revoke all on function private.guard_employer_provider_sharing() from public,anon,authenticated;
create trigger guard_employer_provider_sharing before insert or update or delete on public.employer_linked_providers for each row execute function private.guard_employer_provider_sharing();

drop policy "Employer admins can link providers" on public.employer_linked_providers;
drop policy "Employer admins can unlink providers" on public.employer_linked_providers;
create policy "Both organisations can read sharing" on public.employer_linked_providers for select to authenticated using (public.is_org_admin(provider_organisation_id,(select auth.uid())));
create policy "Admins can propose sharing" on public.employer_linked_providers for insert to authenticated with check (public.is_employer_admin(employer_id,(select auth.uid())) or public.is_org_admin(provider_organisation_id,(select auth.uid())));
create policy "Admins can decide sharing" on public.employer_linked_providers for update to authenticated using (public.is_employer_admin(employer_id,(select auth.uid())) or public.is_org_admin(provider_organisation_id,(select auth.uid()))) with check (public.is_employer_admin(employer_id,(select auth.uid())) or public.is_org_admin(provider_organisation_id,(select auth.uid())));
create policy "Admins can end sharing" on public.employer_linked_providers for delete to authenticated using (public.is_employer_admin(employer_id,(select auth.uid())) or public.is_org_admin(provider_organisation_id,(select auth.uid())));
revoke all on public.employer_linked_providers from anon;
grant select,insert,update,delete on public.employer_linked_providers to authenticated;

-- Expose only directory names to provider admins, never the employer's members or data.
create function private.sharing_employer_directory(p_provider uuid)
returns table(id uuid,name text,provider_organisation_id uuid) language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.is_org_admin(p_provider,auth.uid()) then raise exception 'Not authorized'; end if;
  return query select e.id,e.name,e.provider_organisation_id from public.employers e order by e.name;
end $$;
revoke all on function private.sharing_employer_directory(uuid) from public,anon;
grant execute on function private.sharing_employer_directory(uuid) to authenticated;
create function public.sharing_employer_directory(p_provider uuid)
returns table(id uuid,name text,provider_organisation_id uuid) language sql security invoker set search_path='' as $$ select * from private.sharing_employer_directory(p_provider) $$;
revoke all on function public.sharing_employer_directory(uuid) from public,anon;
grant execute on function public.sharing_employer_directory(uuid) to authenticated;

-- Evaluate current publications each time so 'all' follows future additions/removals.
create function public.employer_course_is_enabled(p_employer uuid,p_course uuid)
returns boolean language sql stable security invoker set search_path='' as $$
select exists (
 select 1 from public.course_catalogue_publications p
 join public.catalogues c on c.id=p.catalogue_id
 join public.course_catalogue cc on cc.id=p.course_id
 join public.employers e on e.id=p_employer
 where p.course_id=p_course and p.published_at is not null and cc.status='approved' and cc.is_current_published
 and (c.organisation_id=e.provider_organisation_id or exists (
  select 1 from public.employer_linked_providers l
  where l.employer_id=e.id and l.provider_organisation_id=c.organisation_id and l.status='accepted'
  and ((l.sharing->>'all')::boolean or exists (
   select 1 from jsonb_array_elements(l.sharing->'catalogues') s
   where (s->>'id')::uuid=c.id and ((s->>'all')::boolean or s->'courses' @> jsonb_build_array(p_course::text))
  ))
 ))
) $$;
revoke all on function public.employer_course_is_enabled(uuid,uuid) from public,anon;
grant execute on function public.employer_course_is_enabled(uuid,uuid) to authenticated;
create function public.list_employer_shared_courses(p_employer uuid)
returns setof public.course_catalogue language sql stable security invoker set search_path='' as $$
select cc.* from public.course_catalogue cc where public.is_employer_admin(p_employer,auth.uid()) and public.employer_course_is_enabled(p_employer,cc.id) order by cc.name
$$;
revoke all on function public.list_employer_shared_courses(uuid) from public,anon;
grant execute on function public.list_employer_shared_courses(uuid) to authenticated;

create or replace function assign_course_to_employer_members(
  p_employer_id uuid,
  p_catalogue_course_id uuid,
  p_user_ids uuid[]
)
returns setof course_assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
  v_provider_organisation_id uuid;
begin
  if v_caller is null or not is_employer_admin(p_employer_id, v_caller) then
    raise exception 'Not authorized';
  end if;

  select provider_organisation_id into v_provider_organisation_id
  from employers
  where id = p_employer_id;

  if v_provider_organisation_id is null then
    raise exception 'Employer not found';
  end if;

  if not public.employer_course_is_enabled(p_employer_id, p_catalogue_course_id) then
    raise exception 'This course is not enabled by a confirmed sharing agreement';
  end if;

  return query
    insert into course_assignments (employer_id, catalogue_course_id, assigned_to, assigned_by)
    select p_employer_id, p_catalogue_course_id, uid.user_id, v_caller
    from unnest(p_user_ids) as uid(user_id)
    where exists (
      select 1 from employer_members
      where employer_id = p_employer_id
        and user_id = uid.user_id
        and status = 'active'
    )
    on conflict (employer_id, catalogue_course_id, assigned_to) do nothing
    returning *;
end;
$$;

revoke all on function assign_course_to_employer_members(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function assign_course_to_employer_members(uuid, uuid, uuid[]) to authenticated;
