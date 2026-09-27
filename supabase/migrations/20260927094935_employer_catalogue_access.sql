-- Employer catalogue discovery. Provider publication continues to own the
-- catalogue/course relationship; these rows only describe which audience an
-- employer exposes that same catalogue to.

create table public.employer_catalogue_access (
  id uuid primary key default gen_random_uuid(),
  employer_id uuid not null references public.employers(id) on delete cascade,
  catalogue_id uuid not null references public.catalogues(id) on delete cascade,
  visibility text not null default 'hidden'
    check (visibility in ('public', 'all_members', 'role_profiles', 'hidden')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  unique (employer_id, catalogue_id)
);

create index employer_catalogue_access_employer_visibility_idx
  on public.employer_catalogue_access (employer_id, visibility, catalogue_id);

create table public.employer_catalogue_role_profiles (
  access_id uuid not null references public.employer_catalogue_access(id) on delete cascade,
  role_profile_id uuid not null references public.employer_role_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (access_id, role_profile_id)
);

create index employer_catalogue_role_profiles_role_idx
  on public.employer_catalogue_role_profiles (role_profile_id, access_id);

alter table public.employer_catalogue_access enable row level security;
alter table public.employer_catalogue_role_profiles enable row level security;

create policy "Employer admins can view catalogue access"
  on public.employer_catalogue_access for select to authenticated
  using (public.is_employer_admin(employer_id, (select auth.uid())));

create policy "Employer admins can view catalogue role access"
  on public.employer_catalogue_role_profiles for select to authenticated
  using (
    exists (
      select 1
      from public.employer_catalogue_access access
      where access.id = access_id
        and public.is_employer_admin(access.employer_id, (select auth.uid()))
    )
  );

revoke all on table public.employer_catalogue_access from public, anon, authenticated;
revoke all on table public.employer_catalogue_role_profiles from public, anon, authenticated;
grant select on table public.employer_catalogue_access to authenticated;
grant select on table public.employer_catalogue_role_profiles to authenticated;

-- A catalogue is configurable when it is owned by the employer's permanent
-- provider, or is included in an accepted provider-sharing agreement. Course
-- subsets are honoured later per course by employer_course_is_enabled.
create function private.employer_catalogue_is_enabled(p_employer uuid, p_catalogue uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.employers employer
    join public.catalogues catalogue on catalogue.id = p_catalogue
    where employer.id = p_employer
      and not catalogue.is_global
      and (
        catalogue.organisation_id = employer.provider_organisation_id
        or exists (
          select 1
          from public.employer_linked_providers link
          where link.employer_id = employer.id
            and link.provider_organisation_id = catalogue.organisation_id
            and link.status = 'accepted'
            and (
              (link.sharing ->> 'all')::boolean
              or exists (
                select 1
                from jsonb_array_elements(link.sharing -> 'catalogues') selection
                where (selection ->> 'id')::uuid = catalogue.id
              )
            )
        )
      )
      and exists (
        select 1
        from public.course_catalogue_publications publication
        where publication.catalogue_id = catalogue.id
          and publication.published_at is not null
          and public.employer_course_is_enabled(employer.id, publication.course_id)
      )
  )
$$;

revoke all on function private.employer_catalogue_is_enabled(uuid, uuid) from public, anon, authenticated;

create function public.list_employer_catalogue_access(p_employer uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_employer_admin(p_employer, auth.uid()) then
    raise exception 'Not authorized';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'catalogueId', catalogue.id,
        'name', catalogue.name,
        'description', catalogue.description,
        'providerName', organisation.name,
        'visibility', coalesce(access.visibility, 'hidden'),
        'roleProfileIds', coalesce((
          select jsonb_agg(link.role_profile_id order by profile.name)
          from public.employer_catalogue_role_profiles link
          join public.employer_role_profiles profile on profile.id = link.role_profile_id
          where link.access_id = access.id
        ), '[]'::jsonb)
      ) order by organisation.name, catalogue.name
    )
    from public.catalogues catalogue
    join public.organisations organisation on organisation.id = catalogue.organisation_id
    left join public.employer_catalogue_access access
      on access.employer_id = p_employer and access.catalogue_id = catalogue.id
    where private.employer_catalogue_is_enabled(p_employer, catalogue.id)
  ), '[]'::jsonb);
end
$$;

revoke all on function public.list_employer_catalogue_access(uuid) from public, anon, authenticated;
grant execute on function public.list_employer_catalogue_access(uuid) to authenticated;

create function public.set_employer_catalogue_access(
  p_employer uuid,
  p_catalogue uuid,
  p_visibility text,
  p_role_profile_ids uuid[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_access_id uuid;
  v_role_profile_ids uuid[] := coalesce(p_role_profile_ids, '{}'::uuid[]);
begin
  if auth.uid() is null or not public.is_employer_admin(p_employer, auth.uid()) then
    raise exception 'Not authorized';
  end if;
  if p_visibility not in ('public', 'all_members', 'role_profiles', 'hidden') then
    raise exception 'Invalid catalogue visibility';
  end if;
  if not private.employer_catalogue_is_enabled(p_employer, p_catalogue) then
    raise exception 'This catalogue is not enabled for the employer';
  end if;
  if p_visibility = 'role_profiles' and cardinality(v_role_profile_ids) = 0 then
    raise exception 'Select at least one role profile';
  end if;
  if exists (
    select 1
    from unnest(v_role_profile_ids) requested(id)
    where not exists (
      select 1
      from public.employer_role_profiles profile
      where profile.id = requested.id
        and profile.employer_id = p_employer
        and profile.status = 'active'
    )
  ) then
    raise exception 'Role profiles must be active and belong to this employer';
  end if;

  insert into public.employer_catalogue_access (
    employer_id, catalogue_id, visibility, updated_at, updated_by
  ) values (
    p_employer, p_catalogue, p_visibility, now(), auth.uid()
  )
  on conflict (employer_id, catalogue_id) do update
    set visibility = excluded.visibility,
        updated_at = now(),
        updated_by = auth.uid()
  returning id into v_access_id;

  delete from public.employer_catalogue_role_profiles where access_id = v_access_id;
  if p_visibility = 'role_profiles' then
    insert into public.employer_catalogue_role_profiles (access_id, role_profile_id)
    select v_access_id, id from unnest(v_role_profile_ids) requested(id);
  end if;
end
$$;

revoke all on function public.set_employer_catalogue_access(uuid, uuid, text, uuid[]) from public, anon, authenticated;
grant execute on function public.set_employer_catalogue_access(uuid, uuid, text, uuid[]) to authenticated;

-- The course projection is deliberately built inside the database. The
-- caller never receives rows from catalogues it cannot discover, and public
-- and signed-in views both use the same employer access record.
create function private.employer_catalogue_courses_json(
  p_employer uuid,
  p_user uuid,
  p_public_only boolean
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with allowed_access as (
    select access.id, access.catalogue_id
    from public.employer_catalogue_access access
    where access.employer_id = p_employer
      and private.employer_catalogue_is_enabled(p_employer, access.catalogue_id)
      and (
        (p_public_only and access.visibility = 'public')
        or (
          not p_public_only
          and exists (
            select 1 from public.employer_members member
            where member.employer_id = p_employer
              and member.user_id = p_user
              and member.status = 'active'
          )
          and (
            access.visibility in ('public', 'all_members')
            or (
              access.visibility = 'role_profiles'
              and exists (
                select 1
                from public.employer_catalogue_role_profiles role_access
                join public.employer_role_assignments assignment
                  on assignment.role_profile_id = role_access.role_profile_id
                 and assignment.status = 'linked'
                join public.employer_members member on member.id = assignment.employer_member_id
                where role_access.access_id = access.id
                  and member.employer_id = p_employer
                  and member.user_id = p_user
                  and member.status = 'active'
              )
            )
          )
        )
      )
  ), accessible_courses as (
    select distinct course.id
    from allowed_access access
    join public.course_catalogue_publications publication
      on publication.catalogue_id = access.catalogue_id
     and publication.published_at is not null
    join public.course_catalogue course
      on course.id = publication.course_id
     and course.status = 'approved'
     and course.is_current_published
    where public.employer_course_is_enabled(p_employer, course.id)
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', course.id,
      'name', course.name,
      'provider', course.provider,
      'synopsis', course.synopsis,
      'courseType', course.course_type,
      'course_type', course.course_type,
      'duration', course.duration,
      'imageUrl', course.image_url,
      'catalogues', coalesce((
        select jsonb_agg(distinct jsonb_build_object('id', catalogue.id, 'name', catalogue.name))
        from allowed_access access
        join public.catalogues catalogue on catalogue.id = access.catalogue_id
        join public.course_catalogue_publications publication
          on publication.catalogue_id = catalogue.id
         and publication.course_id = course.id
         and publication.published_at is not null
      ), '[]'::jsonb),
      'skillEntries', coalesce((
        select jsonb_agg(jsonb_build_object(
          'skillId', skill.id, 'skillName', skill.name, 'level', course_skill.level
        ))
        from public.course_catalogue_skills course_skill
        join public.skill_library skill on skill.id = course_skill.skill_library_id
        where course_skill.course_catalogue_id = course.id
      ), '[]'::jsonb),
      'tags', coalesce((
        select jsonb_agg(jsonb_build_object('id', tag.id, 'name', tag.name))
        from public.course_catalogue_tags course_tag
        join public.tags tag on tag.id = course_tag.tag_id
        where course_tag.course_catalogue_id = course.id
      ), '[]'::jsonb)
    ) order by course.name
  ), '[]'::jsonb)
  from accessible_courses allowed_course
  join public.course_catalogue course on course.id = allowed_course.id
$$;

revoke all on function private.employer_catalogue_courses_json(uuid, uuid, boolean) from public, anon, authenticated;

create function public.list_my_employer_catalogue_courses(p_employer uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.employer_members member
    where member.employer_id = p_employer
      and member.user_id = auth.uid()
      and member.status = 'active'
  ) then
    raise exception 'Not authorized';
  end if;
  return private.employer_catalogue_courses_json(p_employer, auth.uid(), false);
end
$$;

revoke all on function public.list_my_employer_catalogue_courses(uuid) from public, anon, authenticated;
grant execute on function public.list_my_employer_catalogue_courses(uuid) to authenticated;

create function public.get_public_employer_catalogue_courses(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.employer_catalogue_courses_json(employer.id, null, true), '[]'::jsonb)
  from public.employers employer
  join public.organisations organisation on organisation.id = employer.provider_organisation_id
  where organisation.slug = p_slug
    and organisation.status = 'active'
    and organisation.public_profile_enabled = true
$$;

revoke all on function public.get_public_employer_catalogue_courses(text) from public, anon, authenticated;
grant execute on function public.get_public_employer_catalogue_courses(text) to anon, authenticated;
