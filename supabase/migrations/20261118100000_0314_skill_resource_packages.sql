-- SCORM and xAPI packages as skill resources (see 0288), opened right on the
-- skill page.
--
-- A package is a zip of many files linking to each other by relative path,
-- so it can't live in the private skill-resources bucket: a signed URL covers
-- one file, not the package's own assets. It is unpacked into the
-- course-content bucket instead, the same way an organisation's packages are
-- (0071/0079), under learners/<owner>/<resource id>/ -- served through the
-- same /course-content/* proxy, and reachable, like those, only by its
-- unguessable address. Who sees the resource on their skill page still
-- follows its audience; packages can be shared like links (owner's choice,
-- 2026-11-18), including with everyone tracking the skill.
--
-- An xAPI package launched from a skill records its statements through the
-- existing LRS endpoint (api/xapi), against a launch session that now names
-- either an organisation's content resource or a skill resource.

-- 1. The resource.
alter table public.skill_resources
  add column package_path text,
  add column launch_path text check (
    launch_path is null or (
      char_length(launch_path) between 1 and 1000
      and launch_path !~ '^[/\\]'
      and launch_path !~ '(^|[/\\])\.\.([/\\]|$)'
      -- Nor an encoded dot, which a browser would read as one.
      and launch_path !~* '%2e'
    )
  );

alter table public.skill_resources drop constraint skill_resources_kind_check;
alter table public.skill_resources add constraint skill_resources_kind_check
  check (kind in ('link', 'video', 'file', 'scorm', 'xapi'));

-- A file is stored in the owner's own folder; a link or video has a URL; a
-- package sits in its own folder, named after the owner and the resource.
alter table public.skill_resources drop constraint skill_resources_check;
alter table public.skill_resources add constraint skill_resources_check check (
  (kind = 'file' and file_path is not null and url is null and package_path is null and launch_path is null
    and split_part(file_path, '/', 1) = user_id::text)
  or (kind in ('link', 'video') and url is not null and file_path is null and package_path is null and launch_path is null)
  or (kind in ('scorm', 'xapi') and url is null and file_path is null and launch_path is not null
    and package_path = 'learners/' || user_id::text || '/' || id::text)
);

-- What a resource is never changes once added (0288, 0292): the package
-- folder and launch page are frozen with the rest. Otherwise unchanged from
-- 0292.
create or replace function public.set_skill_resource_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  new.user_id := old.user_id;
  new.skill_id := old.skill_id;
  new.created_at := old.created_at;
  new.kind := old.kind;
  new.url := old.url;
  new.file_path := old.file_path;
  new.file_name := old.file_name;
  new.file_size := old.file_size;
  new.mime_type := old.mime_type;
  new.package_path := old.package_path;
  new.launch_path := old.launch_path;
  if coalesce(current_setting('app.moderating', true), '') <> 'on'
     or not public.is_platform_admin((select auth.uid())) then
    new.moderation_removed_at := old.moderation_removed_at;
    new.moderation_removed_by := old.moderation_removed_by;
  end if;
  if new.moderation_removed_at is not null then
    new.audience := 'private';
  end if;
  return new;
end;
$$;

-- 2. Lists gain where a package is and its launch page, so they're dropped
-- and created again. Otherwise unchanged from 0292.
drop function public.list_shared_skill_resources(uuid);

create function public.list_shared_skill_resources(p_skill_id uuid)
returns table (
  id uuid,
  kind text,
  title text,
  url text,
  file_path text,
  file_name text,
  package_path text,
  launch_path text,
  note text,
  audience text,
  knowledge_level smallint,
  practical_level smallint,
  created_at timestamptz,
  sharer_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.kind, r.title, r.url, r.file_path, r.file_name, r.package_path, r.launch_path,
         r.note, r.audience, r.knowledge_level, r.practical_level, r.created_at,
         coalesce(nullif(btrim(p.full_name), ''), 'A LearnScope learner') as sharer_name
  from public.skills mine
  join public.skills theirs
    on theirs.library_skill_id = mine.library_skill_id and theirs.user_id <> mine.user_id
  join public.skill_resources r on r.skill_id = theirs.id
  left join public.profiles p on p.id = r.user_id
  where mine.id = p_skill_id
    and mine.user_id = (select auth.uid())
    and mine.library_skill_id is not null
    and r.audience <> 'private'
    and private.can_view_skill_resource(r.id, (select auth.uid()))
    and not exists (
      select 1 from public.skill_resource_hides h
      where h.user_id = (select auth.uid()) and h.resource_id = r.id
    )
  order by r.created_at desc
  limit 200
$$;

revoke all on function public.list_shared_skill_resources(uuid) from public, anon;
grant execute on function public.list_shared_skill_resources(uuid) to authenticated;

drop function public.admin_list_skill_resource_reports();

create function public.admin_list_skill_resource_reports()
returns table (
  resource_id uuid,
  kind text,
  title text,
  url text,
  file_path text,
  file_name text,
  package_path text,
  launch_path text,
  note text,
  audience text,
  skill_name text,
  owner_id uuid,
  owner_label text,
  resource_created_at timestamptz,
  report_count bigint,
  reasons text[],
  details text[],
  first_reported_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin((select auth.uid())) then
    raise insufficient_privilege using message = 'Platform administrator access required';
  end if;
  return query
  select r.id, r.kind, r.title, r.url, r.file_path, r.file_name, r.package_path, r.launch_path,
         r.note, r.audience,
         s.name, r.user_id, public.admin_activity_actor_label(r.user_id), r.created_at,
         count(rep.id),
         array_agg(distinct rep.reason),
         array_remove(array_agg(rep.details order by rep.created_at), null),
         min(rep.created_at)
  from public.skill_resource_reports rep
  join public.skill_resources r on r.id = rep.resource_id
  join public.skills s on s.id = r.skill_id
  where rep.status = 'open'
  group by r.id, s.name
  order by count(rep.id) desc, min(rep.created_at);
end;
$$;

revoke all on function public.admin_list_skill_resource_reports() from public, anon;
grant execute on function public.admin_list_skill_resource_reports() to authenticated;

-- 3. Package files: each learner writes, lists and removes only within
-- learners/<their id>/ in course-content. Reading needs no policy: the
-- bucket is public, served through /course-content/* (see vercel.json).
-- Writing needs the package resource itself to exist first (it's added
-- private, then shared once uploaded), so the bucket can't be used to host
-- files that no resource -- and so no report or clean-up -- ever points at.
create policy "Learners upload skill resource packages to their own folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'course-content'
    and (storage.foldername(storage.objects.name))[1] = 'learners'
    and (storage.foldername(storage.objects.name))[2] = (select auth.uid())::text
    and exists (
      select 1 from public.skill_resources r
      where r.user_id = (select auth.uid())
        and r.kind in ('scorm', 'xapi')
        and r.package_path = 'learners/' || (storage.foldername(storage.objects.name))[2]
          || '/' || (storage.foldername(storage.objects.name))[3]
    )
  );

create policy "Learners list their own skill resource packages"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'course-content'
    and (storage.foldername(storage.objects.name))[1] = 'learners'
    and (storage.foldername(storage.objects.name))[2] = (select auth.uid())::text
  );

create policy "Learners remove their own skill resource packages"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'course-content'
    and (storage.foldername(storage.objects.name))[1] = 'learners'
    and (storage.foldername(storage.objects.name))[2] = (select auth.uid())::text
  );

-- 4. xAPI launches from a skill resource.
alter table public.xapi_launch_sessions
  alter column resource_id drop not null,
  add column skill_resource_id uuid references public.skill_resources(id) on delete cascade,
  add constraint xapi_launch_sessions_one_resource
    check (num_nonnulls(resource_id, skill_resource_id) = 1),
  -- A skill resource is no course's content.
  add constraint xapi_launch_sessions_skill_resource_no_course
    check (skill_resource_id is null or course_id is null);

create index xapi_launch_sessions_skill_resource_idx on public.xapi_launch_sessions (skill_resource_id)
  where skill_resource_id is not null;

-- Statements a skill resource's package records point back at it. Like
-- resource_id (0079), the link clears rather than taking the statement with
-- it when the resource goes: the statement is the learner's record.
alter table public.xapi_statements
  add column skill_resource_id uuid references public.skill_resources(id) on delete set null;

create index xapi_statements_skill_resource_id_idx on public.xapi_statements (skill_resource_id)
  where skill_resource_id is not null;

-- Whether the caller may launch an xAPI package resource: one they can see
-- (theirs, or shared with them). Takes no viewer, so it can't be used to ask
-- about anyone else.
create or replace function public.can_launch_skill_resource_package(p_resource_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (select auth.uid()) is not null
    and exists (select 1 from public.skill_resources r where r.id = p_resource_id and r.kind = 'xapi')
    and private.can_view_skill_resource(p_resource_id, (select auth.uid()))
$$;

revoke all on function public.can_launch_skill_resource_package(uuid) from public, anon;
grant execute on function public.can_launch_skill_resource_package(uuid) to authenticated;

-- Otherwise unchanged from 0088: an organisation resource launch is checked
-- as before; a skill resource launch needs a resource the caller can see.
drop policy "Users create their own xapi launch sessions" on public.xapi_launch_sessions;
create policy "Users create their own xapi launch sessions"
  on public.xapi_launch_sessions for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and (
      (
        resource_id is not null
        and exists (
          select 1 from content_resources cr
          where cr.id = xapi_launch_sessions.resource_id
            and (
              is_platform_admin(auth.uid())
              or is_org_member(cr.organisation_id, auth.uid())
              or exists (
                select 1 from course_content_links ccl
                join course_catalogue cc on cc.id = ccl.course_id
                where ccl.resource_id = cr.id
                  and (
                    cc.status = 'approved'
                    or exists (select 1 from courses c where c.catalogue_course_id = cc.id and c.user_id = auth.uid())
                  )
              )
            )
        )
        and (course_id is null or exists (select 1 from courses c where c.id = xapi_launch_sessions.course_id and c.user_id = auth.uid()))
      )
      or (
        skill_resource_id is not null
        and public.can_launch_skill_resource_package(skill_resource_id)
      )
    )
  );
