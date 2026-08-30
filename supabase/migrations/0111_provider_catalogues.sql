-- Provider-owned catalogue destinations plus the platform-managed global
-- catalogue. Publication choices belong to a specific immutable course
-- version, so a new version can request a different destination set without
-- changing where the currently published version appears.

create table catalogues (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references organisations(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  description text,
  is_global boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (is_global and organisation_id is null)
    or (not is_global and organisation_id is not null)
  )
);

create unique index catalogues_one_global_idx
  on catalogues (is_global)
  where is_global;

create unique index catalogues_organisation_name_idx
  on catalogues (organisation_id, lower(name))
  where organisation_id is not null;

create index catalogues_organisation_idx on catalogues (organisation_id, name);

insert into catalogues (name, description, is_global)
values ('Global catalogue', 'Training published across LearnScope.', true);

create table course_catalogue_publications (
  course_id uuid references course_catalogue(id) on delete cascade not null,
  catalogue_id uuid references catalogues(id) on delete cascade not null,
  selected_by uuid references auth.users(id) on delete set null,
  selected_at timestamptz not null default now(),
  published_at timestamptz,
  primary key (course_id, catalogue_id)
);

create index course_catalogue_publications_catalogue_idx
  on course_catalogue_publications (catalogue_id, published_at, course_id);

-- Preserve the existing learner catalogue exactly: every version that is
-- live when this migration runs starts published to the Global catalogue.
insert into course_catalogue_publications (course_id, catalogue_id, selected_by, selected_at, published_at)
select cc.id, c.id, cc.created_by, cc.created_at, coalesce(cc.approved_at, cc.created_at)
from course_catalogue cc
cross join catalogues c
where cc.status = 'approved'
  and cc.is_current_published
  and c.is_global;

alter table catalogues enable row level security;

alter table course_catalogue_publications enable row level security;

create policy "Authenticated users can view catalogues"
  on catalogues for select
  to authenticated
  using (true);

create policy "Provider admins and platform admins can create catalogues"
  on catalogues for insert
  to authenticated
  with check (
    is_platform_admin((select auth.uid()))
    or (
      not is_global
      and organisation_id is not null
      and is_org_admin(organisation_id, (select auth.uid()))
    )
  );

create policy "Provider admins and platform admins can update catalogues"
  on catalogues for update
  to authenticated
  using (
    is_platform_admin((select auth.uid()))
    or (
      not is_global
      and organisation_id is not null
      and is_org_admin(organisation_id, (select auth.uid()))
    )
  )
  with check (
    is_platform_admin((select auth.uid()))
    or (
      not is_global
      and organisation_id is not null
      and is_org_admin(organisation_id, (select auth.uid()))
    )
  );

create policy "Provider admins can delete their own catalogues"
  on catalogues for delete
  to authenticated
  using (
    not is_global
    and organisation_id is not null
    and (
      is_platform_admin((select auth.uid()))
      or is_org_admin(organisation_id, (select auth.uid()))
    )
  );

create policy "View publication destinations for viewable courses"
  on course_catalogue_publications for select
  to authenticated
  using (
    exists (
      select 1
      from course_catalogue cc
      where cc.id = course_catalogue_publications.course_id
        and (
          (cc.status = 'approved' and cc.is_current_published and course_catalogue_publications.published_at is not null)
          or is_platform_admin((select auth.uid()))
          or (
            cc.organisation_id is not null
            and is_org_member(cc.organisation_id, (select auth.uid()))
          )
          or exists (
            select 1 from courses c
            where c.catalogue_course_id = cc.id
              and c.user_id = (select auth.uid())
          )
        )
    )
  );

create policy "Manage destinations for editable provider courses"
  on course_catalogue_publications for all
  to authenticated
  using (
    exists (
      select 1
      from course_catalogue cc
      join catalogues c on c.id = course_catalogue_publications.catalogue_id
      where cc.id = course_catalogue_publications.course_id
        and (
          is_platform_admin((select auth.uid()))
          or (
            cc.organisation_id is not null
            and is_org_member(cc.organisation_id, (select auth.uid()))
            and cc.status in ('draft', 'rejected')
            and (c.is_global or c.organisation_id = cc.organisation_id)
          )
        )
    )
  )
  with check (
    exists (
      select 1
      from course_catalogue cc
      join catalogues c on c.id = course_catalogue_publications.catalogue_id
      where cc.id = course_catalogue_publications.course_id
        and (
          is_platform_admin((select auth.uid()))
          or (
            cc.organisation_id is not null
            and is_org_member(cc.organisation_id, (select auth.uid()))
            and cc.status in ('draft', 'rejected')
            and (c.is_global or c.organisation_id = cc.organisation_id)
          )
        )
    )
  );

grant select, insert, update, delete on table catalogues to authenticated;

grant select, insert, update, delete on table course_catalogue_publications to authenticated;

create or replace function submit_course_for_publication(p_course_id uuid, p_catalogue_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_organisation_id uuid;
begin
  select organisation_id into v_organisation_id
  from course_catalogue
  where id = p_course_id
    and status in ('draft', 'rejected')
  for update;

  if v_organisation_id is null then
    raise exception 'Course is not editable or does not belong to a provider';
  end if;

  if not (
    is_platform_admin((select auth.uid()))
    or is_org_member(v_organisation_id, (select auth.uid()))
  ) then
    raise exception 'Not authorized';
  end if;

  if coalesce(cardinality(p_catalogue_ids), 0) = 0 then
    raise exception 'Choose at least one catalogue';
  end if;

  if exists (
    select 1
    from unnest(p_catalogue_ids) selected_id
    left join catalogues c
      on c.id = selected_id
      and (c.is_global or c.organisation_id = v_organisation_id)
    where c.id is null
  ) then
    raise exception 'One or more catalogues are not available to this provider';
  end if;

  delete from course_catalogue_publications where course_id = p_course_id;

  insert into course_catalogue_publications (course_id, catalogue_id, selected_by)
  select p_course_id, selected_id, (select auth.uid())
  from (select distinct unnest(p_catalogue_ids) as selected_id) selected;

  update course_catalogue
  set status = 'pending_approval', rejection_reason = null
  where id = p_course_id;
end;
$$;

revoke all on function submit_course_for_publication(uuid, uuid[]) from public;

grant execute on function submit_course_for_publication(uuid, uuid[]) to authenticated;

create or replace function publish_course_version(p_course_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_group_id uuid;
begin
  if not is_platform_admin((select auth.uid())) then
    raise exception 'Not authorized';
  end if;

  if not exists (
    select 1 from course_catalogue_publications
    where course_id = p_course_id
  ) then
    raise exception 'Choose at least one publication catalogue';
  end if;

  select version_group_id into v_group_id
  from course_catalogue
  where id = p_course_id
  for update;

  if v_group_id is null then
    raise exception 'Course not found';
  end if;

  update course_catalogue
  set status = 'inactive', is_current_published = false
  where version_group_id = v_group_id
    and is_current_published
    and id <> p_course_id;

  update course_catalogue
  set status = 'approved',
      is_current_published = true,
      approved_by = (select auth.uid()),
      approved_at = now(),
      rejection_reason = null
  where id = p_course_id;

  update course_catalogue_publications
  set published_at = now()
  where course_id = p_course_id;
end;
$$;

revoke all on function publish_course_version(uuid) from public;

grant execute on function publish_course_version(uuid) to authenticated;

-- Approved courses only appear to general learners after at least one
-- selected catalogue destination has actually been published. Provider
-- staff, platform admins, and existing enrollees retain their prior access.
-- Keep the lookup out of course_catalogue_publications' RLS graph: that
-- table's own SELECT policy checks its parent course, so an inline EXISTS
-- here would recurse back into course_catalogue.
create or replace function is_course_published_to_catalogue(check_course_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from course_catalogue_publications
    where course_id = check_course_id
      and published_at is not null
  )
$$;

revoke all on function is_course_published_to_catalogue(uuid) from public;

grant execute on function is_course_published_to_catalogue(uuid) to authenticated;

drop policy if exists "View approved courses, your own organisation's, as a platform admin, or your own enrollment" on course_catalogue;

create policy "View published courses, your own organisation's, as a platform admin, or your own enrollment"
  on course_catalogue for select
  to authenticated
  using (
    (
      status = 'approved'
      and is_current_published
      and is_course_published_to_catalogue(id)
    )
    or is_platform_admin((select auth.uid()))
    or (
      organisation_id is not null
      and is_org_member(organisation_id, (select auth.uid()))
    )
    or exists (
      select 1 from courses c
      where c.catalogue_course_id = course_catalogue.id
        and c.user_id = (select auth.uid())
    )
  );
