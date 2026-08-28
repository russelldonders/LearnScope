-- Provider-specific skills: extends skill_library with a third scope
-- alongside "public" and "private to one user" (0028) -- an organisation's
-- own skill, visible only to that org's members (and platform admins)
-- unless it's actually in use on one of their approved catalogue courses,
-- mirroring content_resources' (0073) "own org, or linked into an approved
-- course" visibility rule. Mutually exclusive with is_private: that flag is
-- about one learner's personal privacy, this is about org ownership, and a
-- row can't be both at once.
alter table skill_library add column organisation_id uuid references organisations(id) on delete cascade;

alter table skill_library
  add constraint skill_library_org_not_private check (not (is_private and organisation_id is not null));

create index skill_library_organisation_id_idx on skill_library (organisation_id);

-- Org-scoped names only need to be unique within that org, same reasoning
-- as 0028's private-per-creator index.
create unique index skill_library_org_name_lower_idx
  on skill_library (organisation_id, lower(name))
  where organisation_id is not null;

-- Platform admins need to see every skill (public, everyone's private
-- entries, every org's provider-specific ones) for the new admin skill
-- console -- 0028's policy had no admin bypass at all, since AdminSkills.jsx
-- previously only ever managed public entries. Org-scoped entries are
-- otherwise visible to that org's own members, or to anyone if the skill is
-- actually targeted by one of their approved catalogue courses (so
-- CourseCatalogue.jsx's public skill tags keep resolving for non-members).
drop policy "Authenticated users can view public or their own private skill library entries" on skill_library;

create policy "View public, personal, own organisation's, or platform-admin-visible skill library entries"
  on skill_library for select
  to authenticated
  using (
    is_platform_admin(auth.uid())
    or (organisation_id is null and (not is_private or created_by = auth.uid()))
    or (
      organisation_id is not null
      and (
        is_org_member(organisation_id, auth.uid())
        or exists (
          select 1 from course_catalogue_skills ccs
          join course_catalogue cc on cc.id = ccs.course_catalogue_id
          where ccs.skill_library_id = skill_library.id and cc.status = 'approved'
        )
      )
    )
  );

-- Extends the existing "insert your own" rule (0013) to also allow an org
-- member to insert with organisation_id set to one of their own
-- organisations -- personal inserts (organisation_id null) are unaffected.
drop policy "Authenticated users can add to the skill library" on skill_library;

create policy "Users can add personal skill library entries; org members can add their organisation's"
  on skill_library for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and (organisation_id is null or is_org_member(organisation_id, auth.uid()))
  );

-- The standalone "which library skills does this org want to offer its
-- customers" roster -- decoupled from any specific course (a provider may
-- want to declare a skill focus before/without building a course for it
-- yet), unlike course_catalogue_skills which targets one course at a time.
create table organisation_offered_skills (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  skill_library_id uuid not null references skill_library(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organisation_id, skill_library_id)
);

create index organisation_offered_skills_organisation_idx on organisation_offered_skills (organisation_id);
create index organisation_offered_skills_skill_idx on organisation_offered_skills (skill_library_id);

alter table organisation_offered_skills enable row level security;

-- No learner-facing surface for this yet (not requested) -- kept scoped to
-- the owning org's own members and platform admins, same shape as
-- content_resources' "Org members manage their own organisation's
-- resources" policy.
create policy "Org members and platform admins manage their organisation's offered skills"
  on organisation_offered_skills for all
  to authenticated
  using (is_platform_admin(auth.uid()) or is_org_member(organisation_id, auth.uid()))
  with check (is_platform_admin(auth.uid()) or is_org_member(organisation_id, auth.uid()));

-- Per-level breakdown of count_skill_trackers (0053) -- same anonymous,
-- count-only shape (never returns rows/user identities), just grouped by
-- level for the new admin skill detail page's statistics section. Open to
-- any authenticated user like count_skill_trackers, since a level-bucketed
-- count carries no more privacy risk than the flat total already does.
create or replace function skill_level_stats(p_library_skill_id uuid)
returns table (level int, tracker_count int)
language sql
security definer
set search_path = public
stable
as $$
  select level, count(distinct user_id)::int as tracker_count
  from skills
  where library_skill_id = p_library_skill_id
  group by level
  order by level
$$;

grant execute on function skill_level_stats(uuid) to authenticated;
