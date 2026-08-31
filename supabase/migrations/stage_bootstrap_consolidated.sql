-- 0073's "View own org's resources, or linked into an approved course" policy
-- on content_resources joins into course_content_links to check for an
-- approved-course link. Evaluating that join requires Postgres to also check
-- course_content_links' own policies -- including its "Org members manage
-- links for their own editable courses" ("for all") policy, which queries
-- back into content_resources directly. That closes the loop: content_resources
-- -> course_content_links -> content_resources -> ..., which Postgres reports
-- as "infinite recursion detected in policy for relation content_resources".
--
-- Same shape of bug as 0052/0059, fixed the same way: move the self-
-- referencing check into a SECURITY DEFINER function so it bypasses RLS
-- internally instead of re-entering content_resources' policies while
-- content_resources' own policy is still being evaluated.
create or replace function can_manage_content_resource(p_resource_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from content_resources cr
    where cr.id = p_resource_id
      and (is_platform_admin(p_user_id) or is_org_member(cr.organisation_id, p_user_id))
  )
$$;

grant execute on function can_manage_content_resource(uuid, uuid) to authenticated;

drop policy "Org members manage links for their own editable courses" on course_content_links;
create policy "Org members manage links for their own editable courses"
  on course_content_links for all
  to authenticated
  using (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_content_links.course_id
        and (
          is_platform_admin(auth.uid())
          or (
            cc.organisation_id is not null
            and is_org_member(cc.organisation_id, auth.uid())
            and cc.status in ('draft', 'rejected')
          )
        )
    )
    and can_manage_content_resource(course_content_links.resource_id, auth.uid())
  )
  with check (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_content_links.course_id
        and (
          is_platform_admin(auth.uid())
          or (
            cc.organisation_id is not null
            and is_org_member(cc.organisation_id, auth.uid())
            and cc.status in ('draft', 'rejected')
          )
        )
    )
    and can_manage_content_resource(course_content_links.resource_id, auth.uid())
  );
-- prevent_last_platform_admin_removal (0067) reads `count(*) from
-- platform_admins` with no locking before deciding whether to allow the
-- delete. Two concurrent deletes targeting different admins (e.g. two of
-- exactly two remaining admins deleting each other, or an admin hard-
-- deleting another admin's account via api/admin/actions.js's deleteUser
-- while a second such delete runs at the same time) can each read the
-- pre-deletion count and both pass the check before either commits,
-- cascading platform_admins to zero rows and leaving no one who can reach
-- /admin. `for update` takes a row lock on every matching row for the
-- duration of the transaction, so the second trigger invocation blocks
-- until the first transaction commits (and re-reads a now-lower count) or
-- rolls back, making the check safe under concurrent deletes.
-- Postgres doesn't allow FOR UPDATE directly on an aggregate query (count(*)
-- FOR UPDATE is a syntax error), so the lock and the count are two
-- statements: the first blocks until it can lock every current row (waiting
-- out any concurrent trigger evaluation), the second then counts under a
-- fresh snapshot that reflects whatever the transaction we waited on did.
create or replace function prevent_last_platform_admin_removal()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  perform 1 from platform_admins for update;
  if (select count(*) from platform_admins) <= 1 then
    raise exception 'Cannot remove the last remaining platform admin.';
  end if;
  return old;
end;
$$;

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

-- 0076's organisation_offered_skills policy only checked the offered row's
-- own organisation_id against is_org_member -- it never confirmed the
-- referenced skill_library_id is actually one that organisation is allowed
-- to offer (public, or their own provider-specific skill). A direct API
-- call with a guessed skill_library.id could otherwise roster another
-- org's provider-only skill, or someone's private personal skill, into this
-- org's offered list. skill_library's own SELECT RLS still governs whether
-- the row's contents can be read back, so this was never a live data leak,
-- but it's a real authorization-completeness gap worth closing.
drop policy "Org members and platform admins manage their organisation's offered skills" on organisation_offered_skills;

create policy "Org members and platform admins manage their organisation's offered skills"
  on organisation_offered_skills for all
  to authenticated
  using (is_platform_admin(auth.uid()) or is_org_member(organisation_id, auth.uid()))
  with check (
    (is_platform_admin(auth.uid()) or is_org_member(organisation_id, auth.uid()))
    and exists (
      select 1 from skill_library sl
      where sl.id = organisation_offered_skills.skill_library_id
        and (sl.organisation_id is null or sl.organisation_id = organisation_offered_skills.organisation_id)
    )
  );

-- Named, ordered groups of content within one course_catalogue entry --
-- content_resources/course_content_links (0073) stay flat and reusable
-- across courses; a section only groups how one specific course presents
-- its links, so section ownership follows the course, not the resource.
-- Nothing in the schema grouped course content before this (course_
-- content_links.position was a single flat counter per course) -- this is
-- the provider-facing course editor's new structuring concept.
create table course_sections (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references course_catalogue(id) on delete cascade not null,
  title text not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index course_sections_course_id_idx on course_sections (course_id);

alter table course_content_links add column section_id uuid references course_sections(id) on delete set null;
create index course_content_links_section_id_idx on course_content_links (section_id);

-- Backfill: every course that already has content gets one "General"
-- section so existing links stay visible/grouped once the editor UI
-- expects every item to belong to a section, rather than becoming silently
-- orphaned. Existing course_content_links.position values were already
-- sequential per course, so relative order is preserved unchanged inside
-- this one bucket.
insert into course_sections (course_id, title, position)
select distinct course_id, 'General', 0
from course_content_links;

update course_content_links ccl
set section_id = cs.id
from course_sections cs
where cs.course_id = ccl.course_id and cs.position = 0 and cs.title = 'General';

alter table course_sections enable row level security;

-- Same visibility rule as course_content_links/content_resources: a
-- section is viewable wherever its course is (approved and public,
-- platform admin, or the owning org's own members).
create policy "View sections for viewable courses"
  on course_sections for select
  to authenticated
  using (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_sections.course_id
        and (
          cc.status = 'approved'
          or is_platform_admin(auth.uid())
          or (cc.organisation_id is not null and is_org_member(cc.organisation_id, auth.uid()))
        )
    )
  );

-- Same manage rule as course_catalogue's own org-members update policy
-- (0066): only while the course is still draft/rejected.
create policy "Org members manage sections for their own editable courses"
  on course_sections for all
  to authenticated
  using (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_sections.course_id
        and (
          is_platform_admin(auth.uid())
          or (
            cc.organisation_id is not null
            and is_org_member(cc.organisation_id, auth.uid())
            and cc.status in ('draft', 'rejected')
          )
        )
    )
  )
  with check (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_sections.course_id
        and (
          is_platform_admin(auth.uid())
          or (
            cc.organisation_id is not null
            and is_org_member(cc.organisation_id, auth.uid())
            and cc.status in ('draft', 'rejected')
          )
        )
    )
  );

-- Extends 0074's course_content_links manage policy (unchanged `using`) with
-- one more `with check` condition: a link's section_id, if set, must belong
-- to the same course_id it's linked into -- otherwise an org admin could
-- point a link at a section from an entirely different course, corrupting
-- that other course's structure even though resource/course ownership
-- checks both still pass individually.
drop policy "Org members manage links for their own editable courses" on course_content_links;

create policy "Org members manage links for their own editable courses"
  on course_content_links for all
  to authenticated
  using (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_content_links.course_id
        and (
          is_platform_admin(auth.uid())
          or (
            cc.organisation_id is not null
            and is_org_member(cc.organisation_id, auth.uid())
            and cc.status in ('draft', 'rejected')
          )
        )
    )
    and can_manage_content_resource(course_content_links.resource_id, auth.uid())
  )
  with check (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_content_links.course_id
        and (
          is_platform_admin(auth.uid())
          or (
            cc.organisation_id is not null
            and is_org_member(cc.organisation_id, auth.uid())
            and cc.status in ('draft', 'rejected')
          )
        )
    )
    and can_manage_content_resource(course_content_links.resource_id, auth.uid())
    and (
      course_content_links.section_id is null
      or exists (
        select 1 from course_sections cs
        where cs.id = course_content_links.section_id and cs.course_id = course_content_links.course_id
      )
    )
  );

-- xAPI (Tin Can) content packages as a fourth content_resources type,
-- alongside video/file/scorm (0071) -- uploaded/attached the same way as a
-- SCORM package, but launched via a URL + query-string launch payload
-- (endpoint/auth/actor/registration) rather than a window.API runtime,
-- since that's how the xAPI spec's own launch method works.
-- Constraint keeps its original name from before the course_content_items
-- -> content_resources rename (0073) -- table renames don't rename
-- constraints, same reasoning as that migration's own
-- course_content_items_storage_path_scoped drop.
alter table content_resources drop constraint course_content_items_type_check;
alter table content_resources add constraint content_resources_type_check
  check (type in ('video', 'file', 'scorm', 'xapi'));

-- Links a recorded statement back to the content package that produced it.
-- Nullable and "on delete set null" -- same "don't delete the underlying
-- record on unlink" rule as every other association in this schema; a
-- statement is evidence of what a learner did and must survive even if the
-- resource is later removed. Statements from the existing self-report flow
-- (RecordActivityModal etc.) keep resource_id null, exactly as before.
alter table xapi_statements add column resource_id uuid
  references content_resources(id) on delete set null;

create index xapi_statements_resource_id_idx on xapi_statements (resource_id);

-- One row per "launch" of an xAPI package -- the registration (this row's
-- id) and a random bearer token are embedded in the package's launch URL,
-- and the api/xapi/[...path].js LRS endpoint looks up incoming Basic-auth
-- requests against this table (via the service role, since the request has
-- no Supabase session -- it authenticates with this token instead) to learn
-- which user/resource/course a statement submission belongs to. Short-lived
-- by design: a launch is one learning session, not a standing credential.
create table xapi_launch_sessions (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid references content_resources(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  -- The learner's own `courses` row (not course_catalogue) -- mirrors
  -- xapi_statements.course_id (0020) so statements recorded via a package
  -- link to the same "course" a self-reported statement would. Nullable:
  -- previewing a resource from the org's library (not yet attached to any
  -- enrolled course) has no course context.
  course_id uuid references courses(id) on delete set null,
  token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '4 hours')
);

create index xapi_launch_sessions_token_idx on xapi_launch_sessions (token);

alter table xapi_launch_sessions enable row level security;

-- A learner creates their own launch session when opening an xAPI package
-- (self-service, like connection_invites); the LRS endpoint itself reads
-- this table via the service role, bypassing RLS entirely, since incoming
-- statement requests carry the session token, not a Supabase JWT.
create policy "Users create and view their own xapi launch sessions"
  on xapi_launch_sessions for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 0079's "for all" policy on xapi_launch_sessions had two gaps: (1) it
-- covered UPDATE with no restriction beyond "still my row", so a learner
-- could repoint their own session's resource_id/course_id to anything with
-- a matching row, and push expires_at arbitrarily into the future --
-- defeating the "one launch, short-lived, resource-scoped credential"
-- design entirely; (2) neither INSERT nor that UPDATE verified resource_id
-- was actually visible to the caller, or course_id actually belonged to
-- them -- only that the row existed (FK checks aren't an authorization
-- check). Splitting into SELECT/INSERT/DELETE (no UPDATE at all -- a
-- session is immutable once created; DELETE lets a learner revoke their own
-- early) and adding real ownership/visibility checks on INSERT closes both.
drop policy "Users create and view their own xapi launch sessions" on xapi_launch_sessions;

create policy "Users view their own xapi launch sessions"
  on xapi_launch_sessions for select
  to authenticated
  using (auth.uid() = user_id);

-- Mirrors content_resources' own select policy (0074) for the resource
-- visibility check, and courses' ownership for course_id -- a session can
-- only be minted for a resource/course the caller could actually see/owns
-- in the first place.
create policy "Users create their own xapi launch sessions"
  on xapi_launch_sessions for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from content_resources cr
      where cr.id = xapi_launch_sessions.resource_id
        and (
          is_platform_admin(auth.uid())
          or is_org_member(cr.organisation_id, auth.uid())
          or exists (
            select 1 from course_content_links ccl
            join course_catalogue cc on cc.id = ccl.course_id
            where ccl.resource_id = cr.id and cc.status = 'approved'
          )
        )
    )
    and (
      course_id is null
      or exists (select 1 from courses c where c.id = xapi_launch_sessions.course_id and c.user_id = auth.uid())
    )
  );

create policy "Users delete their own xapi launch sessions"
  on xapi_launch_sessions for delete
  to authenticated
  using (auth.uid() = user_id);

-- Table-level backstop (not just RLS): even a direct insert can't set
-- expires_at further out than the intended 4-hour window from created_at,
-- regardless of what the client-side call omits/includes.
alter table xapi_launch_sessions
  add constraint xapi_launch_sessions_expiry_bounded
  check (expires_at <= created_at + interval '4 hours');

-- Provider self-service org settings: a logo and an "about us" blurb, plus
-- genuine self-service editing of the website url (0068) -- previously
-- organisations had no update policy at all except for platform admins
-- (0065), so a provider could never edit their own org's url either, only
-- ask a platform admin to do it via AdminProviders.jsx.
alter table organisations add column logo_url text;
alter table organisations add column about text;

-- Additive to (not a replacement for) the existing platform-admin update
-- policy -- RLS can't restrict this to specific columns, so name/status/
-- type stay platform-admin-only via the trigger below instead, same
-- approach as 0065's prevent_self_account_status_change guard on profiles:
-- renaming, deactivating, or changing an org's type has moderation
-- implications (deactivation revokes staff access org-wide, 0069) that
-- should stay a platform decision, while url/logo/about are the org's own
-- identity to manage.
create policy "Org admins can update their own organisation"
  on organisations for update
  to authenticated
  using (is_org_admin(id, auth.uid()))
  with check (is_org_admin(id, auth.uid()));

create or replace function prevent_org_identity_change_by_non_admin()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if (new.name is distinct from old.name
      or new.status is distinct from old.status
      or new.type is distinct from old.type)
     and auth.uid() is not null
     and not is_platform_admin(auth.uid()) then
    raise exception 'name, status, and type can only be changed by a platform admin';
  end if;
  return new;
end;
$$;

create trigger prevent_org_identity_change_by_non_admin_trigger
  before update on organisations
  for each row execute procedure prevent_org_identity_change_by_non_admin();

-- Org logos: same public-bucket, path-scoped-by-owner pattern as avatars
-- (0004_avatar_and_current_role.sql), scoped by organisation_id instead of
-- user_id. Upload/replace/remove restricted to that organisation's own
-- admins (is_org_admin), matching the Users tab's admin-only gating in the
-- provider console -- trainers can build training/resources but org
-- identity settings are an admin-only action.
insert into storage.buckets (id, name, public)
values ('org-logos', 'org-logos', true)
on conflict (id) do nothing;

create policy "Organisation logos are publicly accessible"
  on storage.objects for select
  using (bucket_id = 'org-logos');

create policy "Org admins can upload their own organisation's logo"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'org-logos'
    and exists (
      select 1 from organisations o
      where o.id::text = (storage.foldername(name))[1] and is_org_admin(o.id, auth.uid())
    )
  );

create policy "Org admins can replace their own organisation's logo"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'org-logos'
    and exists (
      select 1 from organisations o
      where o.id::text = (storage.foldername(name))[1] and is_org_admin(o.id, auth.uid())
    )
  )
  with check (
    bucket_id = 'org-logos'
    and exists (
      select 1 from organisations o
      where o.id::text = (storage.foldername(name))[1] and is_org_admin(o.id, auth.uid())
    )
  );

create policy "Org admins can remove their own organisation's logo"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'org-logos'
    and exists (
      select 1 from organisations o
      where o.id::text = (storage.foldername(name))[1] and is_org_admin(o.id, auth.uid())
    )
  );

-- 0081's identity-change trigger guarded name/status/type but missed
-- created_by -- an audit-only field (not used in any RLS/authorization
-- check, per this schema's convention), but an org admin could still
-- rewrite it via a raw PostgREST PATCH bypassing updateOrganisation()'s own
-- JS wrapper. No live privilege-escalation impact, but cheap to close for
-- defense in depth and consistency with the trigger's own stated intent:
-- org admins manage their own identity, not provenance.
create or replace function prevent_org_identity_change_by_non_admin()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if (new.name is distinct from old.name
      or new.status is distinct from old.status
      or new.type is distinct from old.type
      or new.created_by is distinct from old.created_by)
     and auth.uid() is not null
     and not is_platform_admin(auth.uid()) then
    raise exception 'name, status, type, and created_by can only be changed by a platform admin';
  end if;
  return new;
end;
$$;

-- Skill-specific level guide text (practical_level_guide/knowledge_level_
-- guide, 0047/0057) is cached per learner instance on `skills`, not shared
-- by `skill_library` -- a platform admin has no standing RLS access to any
-- learner's own skills rows (owner-only, 0001), so the admin skill detail
-- page needs a way to see *some* real, already-generated guide for a
-- library skill. Anonymous, content-only lookup -- same shape as
-- count_skill_trackers (0053) and skill_level_stats (0076): no user
-- identity in the result, so no privacy opt-in needed, open to any
-- authenticated user like those two. Prefers a row with both axes
-- populated, then the most recently added.
create or replace function skill_level_guide_sample(p_library_skill_id uuid)
returns table (practical_level_guide jsonb, knowledge_level_guide jsonb)
language sql
security definer
set search_path = public
stable
as $$
  select practical_level_guide, knowledge_level_guide
  from skills
  where library_skill_id = p_library_skill_id
    and (practical_level_guide is not null or knowledge_level_guide is not null)
  order by
    (practical_level_guide is not null and knowledge_level_guide is not null) desc,
    date_added desc
  limit 1
$$;

grant execute on function skill_level_guide_sample(uuid) to authenticated;

-- External video (YouTube/Vimeo) as a fifth content_resources type, alongside
-- video/file/scorm/xapi (0071, 0079) -- a link the provider pastes, not a
-- file they upload, so there's nothing to put in storage_path. Reuses the
-- same table/course_content_links attachment mechanism rather than a
-- parallel "linked resource" concept (see CLAUDE.md's domain-duplication
-- rule) -- an external video is just another kind of launchable content item.
alter table content_resources drop constraint content_resources_type_check;
alter table content_resources add constraint content_resources_type_check
  check (type in ('video', 'file', 'scorm', 'xapi', 'external_video'));

alter table content_resources alter column storage_path drop not null;

alter table content_resources add column external_url text;

-- external_video rows carry a URL and no storage; every other type carries
-- storage and no URL. The app stores its own canonicalized embed URL here
-- (youtube.com/embed/{id} or player.vimeo.com/video/{id}), not whatever the
-- provider originally pasted -- see courseContent.js's addExternalVideoResource.
alter table content_resources add constraint content_resources_storage_or_external_check
  check (
    (type = 'external_video' and storage_path is null and external_url is not null)
    or (type <> 'external_video' and storage_path is not null and external_url is null)
  );

-- 0073's and 0081's storage.objects policies for course-content and
-- org-logos each run `select 1 from organisations o where o.id::text =
-- (storage.foldername(name))[1] ...` inside the policy's USING/WITH CHECK.
-- Postgres resolves that unqualified `name` against the *closest* enclosing
-- FROM clause first -- and organisations has its own `name` column (the
-- org's display name), so it silently binds to `o.name` instead of the
-- intended (correlated) `storage.objects.name`, i.e. the actual upload
-- path. `pg_policies` confirms every one of these shipped as
-- `(storage.foldername(o.name))[1]`.
--
-- An org's display name is never a valid uuid, so `o.id::text = (...)[1]`
-- can never match -- these five policies have silently rejected every
-- upload/replace/remove since the day each shipped: course-content video/
-- file/SCORM/xAPI uploads (0073) and org logo uploads (0081). Only
-- external_video resources (content_resources-only, no storage write) and
-- avatar/skill-evidence uploads (different, unaffected policies) ever
-- worked. Fix: qualify the storage object's own path column explicitly so
-- it can't be shadowed by the subquery's organisations alias.

drop policy "Org members can upload their own organisation's resources" on storage.objects;
create policy "Org members can upload their own organisation's resources"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'course-content'
    and exists (
      select 1 from organisations o
      where o.id::text = (storage.foldername(storage.objects.name))[1]
        and (is_platform_admin(auth.uid()) or is_org_member(o.id, auth.uid()))
    )
  );

drop policy "Org members can remove their own organisation's resources" on storage.objects;
create policy "Org members can remove their own organisation's resources"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'course-content'
    and exists (
      select 1 from organisations o
      where o.id::text = (storage.foldername(storage.objects.name))[1]
        and (is_platform_admin(auth.uid()) or is_org_member(o.id, auth.uid()))
    )
  );

drop policy "Org admins can upload their own organisation's logo" on storage.objects;
create policy "Org admins can upload their own organisation's logo"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'org-logos'
    and exists (
      select 1 from organisations o
      where o.id::text = (storage.foldername(storage.objects.name))[1] and is_org_admin(o.id, auth.uid())
    )
  );

drop policy "Org admins can replace their own organisation's logo" on storage.objects;
create policy "Org admins can replace their own organisation's logo"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'org-logos'
    and exists (
      select 1 from organisations o
      where o.id::text = (storage.foldername(storage.objects.name))[1] and is_org_admin(o.id, auth.uid())
    )
  )
  with check (
    bucket_id = 'org-logos'
    and exists (
      select 1 from organisations o
      where o.id::text = (storage.foldername(storage.objects.name))[1] and is_org_admin(o.id, auth.uid())
    )
  );

drop policy "Org admins can remove their own organisation's logo" on storage.objects;
create policy "Org admins can remove their own organisation's logo"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'org-logos'
    and exists (
      select 1 from organisations o
      where o.id::text = (storage.foldername(storage.objects.name))[1] and is_org_admin(o.id, auth.uid())
    )
  );

-- Lets a learner set light/dark/system appearance from their profile
-- settings, mirroring the existing language/country self-service fields on
-- this table. 'system' (follow the OS/browser) is the default so nobody's
-- display flips unexpectedly on first load after this ships.
alter table profiles add column theme_preference text not null default 'system'
  check (theme_preference in ('light', 'dark', 'system'));

-- Non-destructive video editing (trim/filter/speed + text & sticker
-- overlays) for provider training videos: the edit is stored as data and
-- applied at playback time (EditedVideoPlayer.jsx), never baked into the
-- uploaded file itself -- no re-encoding, no new storage write path, and
-- the original upload stays byte-for-byte untouched. Lives directly on
-- content_resources (one video = one edit) rather than a new table, since
-- it's never queried independently of its resource and inherits that
-- table's existing RLS ("Org members manage their own organisation's
-- resources") with no policy changes needed.
alter table content_resources add column video_edit jsonb;

-- Providers previously had no way back into an approved course at all --
-- every provider-facing UPDATE policy (course_catalogue's own edit policy,
-- course_content_links' attach/detach policy, and course sections' policies,
-- 0066/0071/0078) requires status in ('draft', 'rejected'), and even a
-- platform admin's only lever on an approved course (AdminCatalogue's
-- "Deactivate" -> status 'inactive') doesn't unlock those either. Decision
-- (see conversation): self-service -- a provider can unpublish their own
-- approved course straight back to draft, edit it, and resubmit, same as
-- any other draft. This migration adds only the one missing capability
-- (the unpublish transition itself); once a course is back in 'draft', the
-- existing draft-editing policies already handle everything else
-- unchanged.
--
-- Deliberately a separate, narrow policy rather than widening the existing
-- "Organisation members can edit their own draft or rejected entries"
-- policy to include 'approved' -- that would let updateProviderCourse's
-- plain field edits (name/synopsis/etc, which never touch status) succeed
-- directly against a still-approved, live row. Keeping this policy scoped
-- to approved-only-going-to-draft means every other write path stays
-- blocked until the course has actually been unpublished first.
create policy "Organisation members can unpublish their own approved course"
  on course_catalogue for update
  to authenticated
  using (
    organisation_id is not null
    and is_org_member(organisation_id, auth.uid())
    and status = 'approved'
  )
  with check (
    organisation_id is not null
    and is_org_member(organisation_id, auth.uid())
    and status = 'draft'
  );

-- Decision: a learner already partway through a course keeps their access
-- to it even while the provider has it back in draft for edits -- only new
-- discovery/enrollment is hidden (course_catalogue's public "status =
-- approved" branch, unchanged). Extends the four course-visibility SELECT
-- policies (plus the xapi launch-session policy that embeds the same
-- check) with an additional branch: the requesting user has their own
-- `courses` row already pointing at this catalogue entry. `courses`' own
-- RLS ("Users manage their own courses") only checks user_id = auth.uid()
-- and never references any of these tables back, so this can't recreate
-- 0074's policy-recursion bug.

drop policy "View approved courses, your own organisation's, or as a platform admin" on course_catalogue;
create policy "View approved courses, your own organisation's, as a platform admin, or your own enrollment"
  on course_catalogue for select
  to authenticated
  using (
    status = 'approved'
    or is_platform_admin(auth.uid())
    or (organisation_id is not null and is_org_member(organisation_id, auth.uid()))
    or exists (select 1 from courses c where c.catalogue_course_id = course_catalogue.id and c.user_id = auth.uid())
  );

drop policy "View sections for viewable courses" on course_sections;
create policy "View sections for viewable courses"
  on course_sections for select
  to authenticated
  using (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_sections.course_id
        and (
          cc.status = 'approved'
          or is_platform_admin(auth.uid())
          or (cc.organisation_id is not null and is_org_member(cc.organisation_id, auth.uid()))
          or exists (select 1 from courses c where c.catalogue_course_id = cc.id and c.user_id = auth.uid())
        )
    )
  );

drop policy "View links for viewable courses" on course_content_links;
create policy "View links for viewable courses"
  on course_content_links for select
  to authenticated
  using (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_content_links.course_id
        and (
          cc.status = 'approved'
          or is_platform_admin(auth.uid())
          or (cc.organisation_id is not null and is_org_member(cc.organisation_id, auth.uid()))
          or exists (select 1 from courses c where c.catalogue_course_id = cc.id and c.user_id = auth.uid())
        )
    )
  );

drop policy "View own org's resources, or linked into an approved course" on content_resources;
create policy "View own org's resources, linked into an approved course, or your own enrollment"
  on content_resources for select
  to authenticated
  using (
    is_platform_admin(auth.uid())
    or is_org_member(organisation_id, auth.uid())
    or exists (
      select 1 from course_content_links ccl
      join course_catalogue cc on cc.id = ccl.course_id
      where ccl.resource_id = content_resources.id
        and (
          cc.status = 'approved'
          or exists (select 1 from courses c where c.catalogue_course_id = cc.id and c.user_id = auth.uid())
        )
    )
  );

drop policy "Users create their own xapi launch sessions" on xapi_launch_sessions;
create policy "Users create their own xapi launch sessions"
  on xapi_launch_sessions for insert
  to authenticated
  with check (
    auth.uid() = user_id
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
  );

-- AI-generated level guide text (knowledge_level_guide/practical_level_guide,
-- 0047/0057) only ever depends on the skill *name*, so it was wasteful to
-- cache it per learner instance on `skills` -- every learner tracking, say,
-- "Python" was independently generating and paying for an identical guide.
-- Moves the cache onto the shared `skill_library` row instead, so the first
-- learner to need a guide for a given library skill generates it for
-- everyone. Custom skills with no library_skill_id (0013) still fall back to
-- the existing per-instance columns on `skills`, which stay as-is.
--
-- A private library entry (is_private, 0028) is only ever readable by its
-- creator anyway, so caching there is already correctly scoped to just that
-- one person -- no special-casing needed between public/private entries.
alter table skill_library add column knowledge_level_guide jsonb;
alter table skill_library add column practical_level_guide jsonb;

-- skill_library intentionally has no update policy (0013) -- entries are
-- immutable once created, by design. Rather than opening a general UPDATE
-- policy (which would also let any authenticated user rewrite name/category/
-- description), this narrow security-definer function is the only write
-- path: it only ever touches the two guide columns, and only when a column
-- is still null, so a slower concurrent generation can never clobber one
-- that already landed. Same pattern as the read-only skill_level_guide_sample
-- (0083).
create or replace function set_skill_library_level_guide(p_skill_library_id uuid, p_axis text, p_statements jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_axis = 'knowledge' then
    update skill_library
    set knowledge_level_guide = coalesce(knowledge_level_guide, p_statements)
    where id = p_skill_library_id;
  elsif p_axis = 'practical' then
    update skill_library
    set practical_level_guide = coalesce(practical_level_guide, p_statements)
    where id = p_skill_library_id;
  else
    raise exception 'invalid axis: %', p_axis;
  end if;
end;
$$;

grant execute on function set_skill_library_level_guide(uuid, text, jsonb) to authenticated;

-- Public provider profile pages: an opt-in, anonymously-readable page at
-- /providers/:slug listing an organisation's offered skills and approved
-- training courses. 0076 deliberately kept offered-skills visibility scoped
-- to org members only ("no learner-facing surface for this yet, not
-- requested") -- this is that request, but still opt-in per-organisation
-- (public_profile_enabled, default false) rather than making every
-- provider's roster public the moment this ships.
alter table organisations add column slug text unique;
alter table organisations add column public_profile_enabled boolean not null default false;

-- Lowercase, non-alphanumeric runs collapsed to a single hyphen, trimmed --
-- e.g. "Acme Training Ltd." -> "acme-training-ltd".
create or replace function slugify_organisation_name(p_name text)
returns text
language sql
immutable
as $$
  select trim(both '-' from regexp_replace(lower(trim(p_name)), '[^a-z0-9]+', '-', 'g'))
$$;

-- Appends -2, -3, ... on collision. p_existing_id excludes the row being
-- (re)slugged itself, so re-running this for an unchanged name doesn't
-- collide with its own current slug.
create or replace function generate_unique_organisation_slug(p_name text, p_existing_id uuid)
returns text
language plpgsql
as $$
declare
  base_slug text := nullif(slugify_organisation_name(p_name), '');
  candidate text;
  suffix int := 1;
begin
  base_slug := coalesce(base_slug, 'provider');
  candidate := base_slug;
  while exists (
    select 1 from organisations
    where slug = candidate and id is distinct from p_existing_id
  ) loop
    suffix := suffix + 1;
    candidate := base_slug || '-' || suffix;
  end loop;
  return candidate;
end;
$$;

create or replace function set_organisation_slug()
returns trigger
language plpgsql
as $$
begin
  if new.slug is null then
    new.slug := generate_unique_organisation_slug(new.name, new.id);
  end if;
  return new;
end;
$$;

create trigger set_organisation_slug_trigger
  before insert on organisations
  for each row execute procedure set_organisation_slug();

-- Backfill existing organisations one row at a time (not a single bulk
-- UPDATE) so two orgs sharing a name still get distinct slugs -- a
-- statement-level snapshot wouldn't see an earlier row's new slug within
-- the same UPDATE, but each iteration of this loop is its own statement.
do $$
declare
  r record;
begin
  for r in select id, name from organisations where slug is null order by created_at loop
    update organisations set slug = generate_unique_organisation_slug(r.name, r.id) where id = r.id;
  end loop;
end $$;

-- Anonymous-safe read: a single security-definer RPC (same pattern as
-- get_invite_preview, 0010) rather than opening organisations/
-- course_catalogue/organisation_offered_skills RLS to anon directly. Returns
-- null organisation (and empty skills/courses) uniformly whether the slug
-- doesn't exist, the org is inactive, or public_profile_enabled is false --
-- so this can't be used to enumerate which providers exist vs. have opted
-- out.
create or replace function get_provider_profile(p_slug text)
returns json
language sql
security definer
set search_path = public
stable
as $$
  select json_build_object(
    'organisation', (
      select json_build_object(
        'id', o.id,
        'name', o.name,
        'about', o.about,
        'logoUrl', o.logo_url,
        'url', o.url
      )
      from organisations o
      where o.slug = p_slug and o.status = 'active' and o.public_profile_enabled = true
    ),
    'skills', (
      select coalesce(json_agg(json_build_object(
        'id', sl.id,
        'name', sl.name,
        'category', sl.category,
        'description', sl.description
      ) order by sl.name), '[]'::json)
      from organisation_offered_skills oos
      join skill_library sl on sl.id = oos.skill_library_id
      join organisations o on o.id = oos.organisation_id
      where o.slug = p_slug and o.status = 'active' and o.public_profile_enabled = true
    ),
    'courses', (
      select coalesce(json_agg(json_build_object(
        'id', cc.id,
        'name', cc.name,
        'synopsis', cc.synopsis,
        'courseType', cc.course_type,
        'duration', cc.duration
      ) order by cc.name), '[]'::json)
      from course_catalogue cc
      join organisations o on o.id = cc.organisation_id
      where o.slug = p_slug and o.status = 'active' and o.public_profile_enabled = true
        and cc.status = 'approved'
    )
  )
$$;

grant execute on function get_provider_profile(text) to anon, authenticated;

-- The public provider page's course tiles should look like the catalogue's
-- own browse card (same skill/tag chips), not a stripped-down summary --
-- replace get_provider_profile's courses branch to also aggregate
-- course_catalogue_skills/course_catalogue_tags per course, matching what
-- src/lib/courseCatalogue.js's listCatalogueCourses() already returns for
-- these same rows.
create or replace function get_provider_profile(p_slug text)
returns json
language sql
security definer
set search_path = public
stable
as $$
  select json_build_object(
    'organisation', (
      select json_build_object(
        'id', o.id,
        'name', o.name,
        'about', o.about,
        'logoUrl', o.logo_url,
        'url', o.url
      )
      from organisations o
      where o.slug = p_slug and o.status = 'active' and o.public_profile_enabled = true
    ),
    'skills', (
      select coalesce(json_agg(json_build_object(
        'id', sl.id,
        'name', sl.name,
        'category', sl.category,
        'description', sl.description
      ) order by sl.name), '[]'::json)
      from organisation_offered_skills oos
      join skill_library sl on sl.id = oos.skill_library_id
      join organisations o on o.id = oos.organisation_id
      where o.slug = p_slug and o.status = 'active' and o.public_profile_enabled = true
    ),
    'courses', (
      select coalesce(json_agg(json_build_object(
        'id', cc.id,
        'name', cc.name,
        'synopsis', cc.synopsis,
        'courseType', cc.course_type,
        'duration', cc.duration,
        'skillEntries', (
          select coalesce(json_agg(json_build_object(
            'skillId', ccs.skill_library_id,
            'skillName', sl2.name,
            'level', ccs.level
          )), '[]'::json)
          from course_catalogue_skills ccs
          join skill_library sl2 on sl2.id = ccs.skill_library_id
          where ccs.course_catalogue_id = cc.id
        ),
        'tags', (
          select coalesce(json_agg(json_build_object('id', t.id, 'name', t.name)), '[]'::json)
          from course_catalogue_tags cct
          join tags t on t.id = cct.tag_id
          where cct.course_catalogue_id = cc.id
        )
      ) order by cc.name), '[]'::json)
      from course_catalogue cc
      join organisations o on o.id = cc.organisation_id
      where o.slug = p_slug and o.status = 'active' and o.public_profile_enabled = true
        and cc.status = 'approved'
    )
  )
$$;

grant execute on function get_provider_profile(text) to anon, authenticated;

-- Per-knowledge-level breakdown of self-rated vs assessed trackers, for the
-- platform admin skill detail page's new "assessment stats" view. Same
-- anonymous, count-only shape as skill_level_stats (0076)/count_skill_trackers
-- (0053) -- never returns user identities, just grouped counts, so it needs
-- no privacy opt-in.
--
-- Buckets each tracker under their *current* skills.knowledge_level (the
-- same column skill_level_stats groups practical level by), using the source
-- of that user's most recent knowledge-axis skill_assessments row to decide
-- self vs assessed. A tracker with no knowledge-axis assessment row at all
-- (knowledge_level set some other way) counts toward neither bucket.
create or replace function skill_knowledge_level_source_stats(p_library_skill_id uuid)
returns table (level int, self_count int, assessed_count int)
language sql
security definer
set search_path = public
stable
as $$
  with latest_knowledge_assessment as (
    select distinct on (sa.user_id)
      sa.user_id, sa.source
    from skill_assessments sa
    join skills s on s.id = sa.skill_id
    where s.library_skill_id = p_library_skill_id
      and sa.axis = 'knowledge'
    order by sa.user_id, sa.assessed_at desc
  )
  select
    s.knowledge_level as level,
    count(*) filter (where lka.source = 'self')::int as self_count,
    count(*) filter (where lka.source is not null and lka.source != 'self')::int as assessed_count
  from skills s
  left join latest_knowledge_assessment lka on lka.user_id = s.user_id
  where s.library_skill_id = p_library_skill_id
    and s.knowledge_level is not null
  group by s.knowledge_level
  order by s.knowledge_level
$$;

grant execute on function skill_knowledge_level_source_stats(uuid) to authenticated;

-- Course cover image, overtaking CourseThumbnail's generated gradient
-- placeholder once set. Distinct from organisations.logo_url (0081), which
-- is a small provider badge, not the course's own image.
alter table course_catalogue add column image_url text;

insert into storage.buckets (id, name, public)
values ('course-catalogue-images', 'course-catalogue-images', true)
on conflict (id) do nothing;

-- No SELECT policy, matching the course-content bucket (0072) rather than
-- org-logos (0081): the bucket's public=true flag already serves images via
-- an unauthenticated GET that bypasses storage.objects RLS entirely, so a
-- SELECT policy here would only ever grant *listing* the bucket's contents
-- -- a capability nothing in this feature needs.
--
-- Write access mirrors 0072's course-content bucket exactly: an
-- organisation member may upload/replace/remove their own course's image
-- while it's draft/rejected (the same window course_catalogue's own update
-- policy allows them to edit the rest of the course in), or a platform
-- admin at any status. Authorization is derived from the literal object
-- path's course-id folder segment, not from course_catalogue.image_url --
-- a row's own claimed URL can't be trusted to prove which folder it's
-- actually allowed to touch.
create policy "Course editors can upload their course's image"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'course-catalogue-images'
    and exists (
      select 1 from course_catalogue cc
      where cc.id::text = (storage.foldername(name))[1]
        and (
          is_platform_admin(auth.uid())
          or (
            cc.organisation_id is not null
            and is_org_member(cc.organisation_id, auth.uid())
            and cc.status in ('draft', 'rejected')
          )
        )
    )
  );

create policy "Course editors can replace their course's image"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'course-catalogue-images'
    and exists (
      select 1 from course_catalogue cc
      where cc.id::text = (storage.foldername(name))[1]
        and (
          is_platform_admin(auth.uid())
          or (
            cc.organisation_id is not null
            and is_org_member(cc.organisation_id, auth.uid())
            and cc.status in ('draft', 'rejected')
          )
        )
    )
  )
  with check (
    bucket_id = 'course-catalogue-images'
    and exists (
      select 1 from course_catalogue cc
      where cc.id::text = (storage.foldername(name))[1]
        and (
          is_platform_admin(auth.uid())
          or (
            cc.organisation_id is not null
            and is_org_member(cc.organisation_id, auth.uid())
            and cc.status in ('draft', 'rejected')
          )
        )
    )
  );

create policy "Course editors can remove their course's image"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'course-catalogue-images'
    and exists (
      select 1 from course_catalogue cc
      where cc.id::text = (storage.foldername(name))[1]
        and (
          is_platform_admin(auth.uid())
          or (
            cc.organisation_id is not null
            and is_org_member(cc.organisation_id, auth.uid())
            and cc.status in ('draft', 'rejected')
          )
        )
    )
  );

-- The public provider page (0091) built its course tiles before 0093 added
-- course_catalogue.image_url -- surface it here too, the same way 0091
-- added skill/tag chips, so an uploaded course image replaces
-- CourseThumbnail's placeholder on the public page exactly as it already
-- does on the learner-facing catalogue (src/lib/courseCatalogue.js, a plain
-- `select *` that already carries the new column with no query change
-- needed there).
create or replace function get_provider_profile(p_slug text)
returns json
language sql
security definer
set search_path = public
stable
as $$
  select json_build_object(
    'organisation', (
      select json_build_object(
        'id', o.id,
        'name', o.name,
        'about', o.about,
        'logoUrl', o.logo_url,
        'url', o.url
      )
      from organisations o
      where o.slug = p_slug and o.status = 'active' and o.public_profile_enabled = true
    ),
    'skills', (
      select coalesce(json_agg(json_build_object(
        'id', sl.id,
        'name', sl.name,
        'category', sl.category,
        'description', sl.description
      ) order by sl.name), '[]'::json)
      from organisation_offered_skills oos
      join skill_library sl on sl.id = oos.skill_library_id
      join organisations o on o.id = oos.organisation_id
      where o.slug = p_slug and o.status = 'active' and o.public_profile_enabled = true
    ),
    'courses', (
      select coalesce(json_agg(json_build_object(
        'id', cc.id,
        'name', cc.name,
        'synopsis', cc.synopsis,
        'courseType', cc.course_type,
        'duration', cc.duration,
        'imageUrl', cc.image_url,
        'skillEntries', (
          select coalesce(json_agg(json_build_object(
            'skillId', ccs.skill_library_id,
            'skillName', sl2.name,
            'level', ccs.level
          )), '[]'::json)
          from course_catalogue_skills ccs
          join skill_library sl2 on sl2.id = ccs.skill_library_id
          where ccs.course_catalogue_id = cc.id
        ),
        'tags', (
          select coalesce(json_agg(json_build_object('id', t.id, 'name', t.name)), '[]'::json)
          from course_catalogue_tags cct
          join tags t on t.id = cct.tag_id
          where cct.course_catalogue_id = cc.id
        )
      ) order by cc.name), '[]'::json)
      from course_catalogue cc
      join organisations o on o.id = cc.organisation_id
      where o.slug = p_slug and o.status = 'active' and o.public_profile_enabled = true
        and cc.status = 'approved'
    )
  )
$$;

grant execute on function get_provider_profile(text) to anon, authenticated;

-- "Recommend this skill" reuses the exact same connection_invites/share_code
-- mechanism as the existing invite-to-rate flow, rather than a parallel
-- table -- the two are the same underlying concept (an invite, addressed to
-- an email or shared as a link, redeemed once via share_code) with a
-- different outcome on accept. invite_type distinguishes the two so each
-- accept path only ever consumes its own kind of invite.
alter table connection_invites add column invite_type text not null default 'rate'
  check (invite_type in ('rate', 'recommend'));

-- Replaces the pending-dedup index from 0032 -- a learner may reasonably
-- want to both ask someone to rate a skill AND recommend they pick it up
-- themselves, so the two invite types shouldn't collide on uniqueness.
drop index connection_invites_unique_pending_idx;
create unique index connection_invites_unique_pending_idx
  on connection_invites (skill_id, lower(invitee_email), invite_type)
  where status = 'pending' and invitee_email is not null;

-- Recommending a skill only makes sense for one that's tied to the shared
-- library catalog (see 0013) -- that's what lets the invitee's new skill
-- reference the same library_skill_id instead of a same-named duplicate.
-- Recorded here too, not just in the UI gate, so a stale/tampered share
-- link can't be used to invite a recommendation for a purely private skill.
-- Return shape gained a column (invite_type), which Postgres won't let a
-- plain create-or-replace apply to an existing function -- has to be
-- dropped and recreated instead.
drop function get_invite_preview(text);

create function get_invite_preview(p_code text)
returns table (
  skill_name text,
  skill_category text,
  inviter_name text,
  status text,
  invite_type text
)
language sql
security definer
set search_path = public
as $$
  select s.name, s.category, coalesce(p.full_name, ''), ci.status, ci.invite_type
  from connection_invites ci
  join skills s on s.id = ci.skill_id
  left join profiles p on p.id = ci.inviter_id
  where ci.share_code = p_code
$$;

grant execute on function get_invite_preview(text) to anon, authenticated;

-- Unchanged except for the added invite_type guard, so a recommend invite's
-- share_code can never be redeemed as a rating (or vice versa) even if
-- someone hand-edits the URL.
create or replace function accept_invite_and_rate(p_code text, p_level int, p_comments text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite connection_invites%rowtype;
  v_skill skills%rowtype;
  v_rater_name text;
  v_rater_email text;
  v_rating_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_invite from connection_invites where share_code = p_code for update;
  if not found then
    raise exception 'Invite not found';
  end if;
  if v_invite.invite_type != 'rate' then
    raise exception 'This invite is not a rating invite.';
  end if;
  if v_invite.status != 'pending' then
    raise exception 'This invite has already been used.';
  end if;
  if v_invite.inviter_id = auth.uid() then
    raise exception 'You can''t rate your own skill.';
  end if;
  if p_level < 1 or p_level > 5 then
    raise exception 'Invalid level';
  end if;

  select * into v_skill from skills where id = v_invite.skill_id;
  select full_name into v_rater_name from profiles where id = auth.uid();
  select email into v_rater_email from auth.users where id = auth.uid();

  insert into skill_peer_ratings (
    skill_id, skill_name, skill_category, skill_owner_id,
    invite_id, rater_id, rater_name, rater_email, level, comments
  )
  values (
    v_invite.skill_id, v_skill.name, v_skill.category, v_skill.user_id,
    v_invite.id, auth.uid(), v_rater_name, v_rater_email, p_level, nullif(p_comments, '')
  )
  returning id into v_rating_id;

  update connection_invites
  set status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
  where id = v_invite.id;

  update skills s
  set level = latest.level
  from (
    select level, ts from (
      select level, assessed_at as ts from skill_assessments where skill_id = v_invite.skill_id
      union all
      select level, rated_at as ts from skill_peer_ratings where skill_id = v_invite.skill_id
    ) combined
    order by ts desc
    limit 1
  ) latest
  where s.id = v_invite.skill_id;

  return v_rating_id;
end;
$$;

grant execute on function accept_invite_and_rate(text, int, text) to authenticated;

-- Recommending a skill hands the invitee their own skills row, not a rating
-- on the inviter's -- library_skill_id is carried across so it's the same
-- reusable catalog entry, not a same-named duplicate (see 0013). Mirrors the
-- "pick an existing library skill" path in FindSkillModal, just server-side
-- since the invitee otherwise has no way to read an invite addressed to
-- them (connection_invites' only SELECT policy is "inviter can view their
-- own", same reasoning as accept_invite_and_rate above).
create or replace function accept_invite_and_recommend(p_code text, p_tracking_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite connection_invites%rowtype;
  v_skill skills%rowtype;
  v_new_skill_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_invite from connection_invites where share_code = p_code for update;
  if not found then
    raise exception 'Invite not found';
  end if;
  if v_invite.invite_type != 'recommend' then
    raise exception 'This invite is not a skill recommendation.';
  end if;
  if v_invite.status != 'pending' then
    raise exception 'This invite has already been used.';
  end if;
  if v_invite.inviter_id = auth.uid() then
    raise exception 'You can''t recommend a skill to yourself.';
  end if;

  select * into v_skill from skills where id = v_invite.skill_id;
  if v_skill.library_skill_id is null then
    raise exception 'This skill can no longer be recommended.';
  end if;

  insert into skills (
    user_id, name, library_skill_id, tracking_reason, lifecycle_stage, source, is_current_role
  )
  values (
    auth.uid(), v_skill.name, v_skill.library_skill_id, p_tracking_reason, 'identified', 'recommend', false
  )
  returning id into v_new_skill_id;

  update connection_invites
  set status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
  where id = v_invite.id;

  return v_new_skill_id;
end;
$$;

grant execute on function accept_invite_and_recommend(text, text) to authenticated;

alter table skills drop constraint skills_source_check;
alter table skills add constraint skills_source_check
  check (source in ('manual', 'cv_import', 'recommend'));

-- Mirrors list_incoming_rate_invites (0061) exactly, scoped to the other
-- invite_type -- see there for why this needs SECURITY DEFINER rather than a
-- plain table select.
create or replace function list_incoming_recommend_invites()
returns table (
  id uuid,
  inviter_id uuid,
  inviter_name text,
  skill_id uuid,
  skill_name text,
  skill_category text,
  share_code text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select ci.id, ci.inviter_id, p.full_name, ci.skill_id, s.name, s.category, ci.share_code, ci.created_at
  from connection_invites ci
  join skills s on s.id = ci.skill_id
  left join profiles p on p.id = ci.inviter_id
  where ci.status = 'pending'
    and ci.invite_type = 'recommend'
    and ci.invitee_email is not null
    and lower(ci.invitee_email) = lower((select email from auth.users where id = auth.uid()))
  order by ci.created_at desc
$$;

grant execute on function list_incoming_recommend_invites() to authenticated;

-- Scope the existing rate-invite listing to its own type, now that
-- connection_invites carries both kinds -- otherwise a pending recommend
-- invite would incorrectly show up as "wants your rating".
create or replace function list_incoming_rate_invites()
returns table (
  id uuid,
  inviter_id uuid,
  inviter_name text,
  skill_id uuid,
  skill_name text,
  skill_category text,
  share_code text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select ci.id, ci.inviter_id, p.full_name, ci.skill_id, s.name, s.category, ci.share_code, ci.created_at
  from connection_invites ci
  join skills s on s.id = ci.skill_id
  left join profiles p on p.id = ci.inviter_id
  where ci.status = 'pending'
    and ci.invite_type = 'rate'
    and ci.invitee_email is not null
    and lower(ci.invitee_email) = lower((select email from auth.users where id = auth.uid()))
  order by ci.created_at desc
$$;

grant execute on function list_incoming_rate_invites() to authenticated;

-- Lets an invitee dismiss a pending invite addressed to their own verified
-- email, for either invite_type. Needed most for 'recommend' invites: unlike
-- a rating (which always succeeds), accept_invite_and_recommend can fail
-- permanently for a given invitee (e.g. they already track a same-named
-- skill -- see skills_user_id_name_lower_idx), and until now there was no
-- way for that invitee to get the invite out of their own pending-actions
-- list/badge count (only the inviter could revoke it, via the policy added
-- in 0032). Reuses the existing 'revoked' status rather than adding a new
-- one -- from the data model's perspective a declined invite and a
-- withdrawn one are the same "no longer active, never acted on" state.
create or replace function decline_invite(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite connection_invites%rowtype;
  v_own_email text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_invite from connection_invites where share_code = p_code for update;
  if not found then
    raise exception 'Invite not found';
  end if;
  if v_invite.status != 'pending' then
    raise exception 'This invite has already been used.';
  end if;

  select email into v_own_email from auth.users where id = auth.uid();
  if v_invite.invitee_email is null or lower(v_invite.invitee_email) != lower(v_own_email) then
    raise exception 'You can''t decline this invite.';
  end if;

  update connection_invites set status = 'revoked' where id = v_invite.id;
end;
$$;

grant execute on function decline_invite(text) to authenticated;

-- 0093's policies accidentally bind `name` to course_catalogue.name instead
-- of the storage object's path, so every UUID-folder check fails.

drop policy "Course editors can upload their course's image" on storage.objects;
create policy "Course editors can upload their course's image"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'course-catalogue-images' and exists (
      select 1 from course_catalogue cc
      where cc.id::text = (storage.foldername(storage.objects.name))[1]
        and (is_platform_admin((select auth.uid())) or (
          cc.organisation_id is not null
          and is_org_member(cc.organisation_id, (select auth.uid()))
          and cc.status in ('draft', 'rejected')
        ))
    )
  );

drop policy "Course editors can replace their course's image" on storage.objects;
create policy "Course editors can replace their course's image"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'course-catalogue-images' and exists (
      select 1 from course_catalogue cc
      where cc.id::text = (storage.foldername(storage.objects.name))[1]
        and (is_platform_admin((select auth.uid())) or (
          cc.organisation_id is not null
          and is_org_member(cc.organisation_id, (select auth.uid()))
          and cc.status in ('draft', 'rejected')
        ))
    )
  )
  with check (
    bucket_id = 'course-catalogue-images' and exists (
      select 1 from course_catalogue cc
      where cc.id::text = (storage.foldername(storage.objects.name))[1]
        and (is_platform_admin((select auth.uid())) or (
          cc.organisation_id is not null
          and is_org_member(cc.organisation_id, (select auth.uid()))
          and cc.status in ('draft', 'rejected')
        ))
    )
  );

-- Storage upsert also performs a SELECT before UPDATE. Keep that SELECT
-- path-scoped to editors; the public object endpoint remains unaffected.
create policy "Course editors can read their course image object for replacement"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'course-catalogue-images' and exists (
      select 1 from course_catalogue cc
      where cc.id::text = (storage.foldername(storage.objects.name))[1]
        and (is_platform_admin((select auth.uid())) or (
          cc.organisation_id is not null
          and is_org_member(cc.organisation_id, (select auth.uid()))
          and cc.status in ('draft', 'rejected')
        ))
    )
  );

drop policy "Course editors can remove their course's image" on storage.objects;
create policy "Course editors can remove their course's image"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'course-catalogue-images' and exists (
      select 1 from course_catalogue cc
      where cc.id::text = (storage.foldername(storage.objects.name))[1]
        and (is_platform_admin((select auth.uid())) or (
          cc.organisation_id is not null
          and is_org_member(cc.organisation_id, (select auth.uid()))
          and cc.status in ('draft', 'rejected')
        ))
    )
  );

-- Screen recordings share the existing secure video storage and playback
-- pipeline, but remain a distinct resource kind throughout the product.
alter table content_resources drop constraint content_resources_type_check;
alter table content_resources add constraint content_resources_type_check
  check (type in ('video', 'screen_recording', 'file', 'scorm', 'xapi', 'external_video'));

-- Generic web links are stored resources, distinct from canonicalized
-- YouTube/Vimeo embeds. Both URL-backed types carry external_url and no
-- storage path; uploaded resource types retain the inverse invariant.
alter table content_resources drop constraint content_resources_type_check;
alter table content_resources add constraint content_resources_type_check
  check (type in ('video', 'screen_recording', 'file', 'scorm', 'xapi', 'external_video', 'web_url'));

alter table content_resources drop constraint content_resources_storage_or_external_check;
alter table content_resources add constraint content_resources_storage_or_external_check
  check (
    (
      type in ('external_video', 'web_url')
      and storage_path is null
      and external_url is not null
      and external_url ~ '^https?://'
    )
    or (type not in ('external_video', 'web_url') and storage_path is not null and external_url is null)
  );

-- Flips skills-profile sharing from opt-in to opt-out, per explicit product
-- decision: new accounts (and new skills) now start shared with connections
-- rather than private, and a learner turns sharing off if they don't want
-- it, instead of turning it on. This only touches the "share with
-- connections" surface (profiles.skills_profile_visible / per-skill
-- visible_on_profile) -- skill_search_visibility (discoverability to people
-- you're NOT yet connected with) is untouched and still defaults to
-- 'hidden'; that's a materially bigger exposure (search vs. existing
-- connections only) and wasn't part of this change.
--
-- Existing accounts are included, not just new signups -- every row
-- currently at the old default (false) is flipped to true. There is no way
-- to distinguish "never touched, still at the old default" from "a learner
-- explicitly turned it back off" (both look like `false`), so this is a
-- one-time blanket flip for anyone not already sharing. Any row already
-- `true` (an explicit past opt-in) is untouched, and is excluded from the
-- WHERE clause below rather than reassigned, since it's already correct.
alter table profiles alter column skills_profile_visible set default true;
update profiles set skills_profile_visible = true where skills_profile_visible = false;

alter table skills alter column visible_on_profile set default true;
update skills set visible_on_profile = true where visible_on_profile = false;

-- Lets list_connections_activity (0063) be scoped to a single connection
-- instead of always aggregating across all of them -- needed so
-- SkillsProfile.jsx can show "what this person's been up to" on their own
-- profile page, reusing the exact same query/privacy checks (is_connected +
-- the actor's own activity_feed_visible opt-in) rather than a second
-- function. p_user_id defaults to null, which preserves the existing
-- "across every connection" behavior Dashboard.jsx already relies on.
create or replace function list_connections_activity(p_limit int default 30, p_user_id uuid default null)
returns table (
  event_type text,
  actor_id uuid,
  full_name text,
  avatar_url text,
  event_at timestamptz,
  skill_name text,
  level int,
  detail text
)
language sql
security definer
set search_path = public
stable
as $$
  select * from (
    select
      'skill_confirmed' as event_type,
      sa.user_id as actor_id,
      p.full_name,
      p.avatar_url,
      sa.created_at as event_at,
      s.name as skill_name,
      sa.level,
      (case sa.source
        when 'diagnostic_confirmed' then 'Confirmed via knowledge check'
        when 'ai_baseline' then 'AI-assessed baseline'
        when 'ai_evaluation' then 'AI assessment'
        else null
      end)::text as detail
    from skill_assessments sa
    join skills s on s.id = sa.skill_id
    join profiles p on p.id = sa.user_id
    where sa.source in ('diagnostic_confirmed', 'ai_baseline', 'ai_evaluation')
      and sa.user_id <> auth.uid()
      and (p_user_id is null or sa.user_id = p_user_id)
      and is_connected(auth.uid(), sa.user_id)
      and p.activity_feed_visible = true

    union all

    select
      'skill_validated',
      svr.requester_id,
      p.full_name,
      p.avatar_url,
      svr.decided_at,
      s.name,
      svr.target_level,
      'Validated by a connection'::text
    from skill_validation_requests svr
    join skills s on s.id = svr.skill_id
    join profiles p on p.id = svr.requester_id
    where svr.status = 'confirmed'
      and svr.requester_id <> auth.uid()
      and (p_user_id is null or svr.requester_id = p_user_id)
      and is_connected(auth.uid(), svr.requester_id)
      and p.activity_feed_visible = true

    union all

    select
      'skill_added',
      s.user_id,
      p.full_name,
      p.avatar_url,
      s.date_added,
      s.name,
      null::int,
      null::text
    from skills s
    join profiles p on p.id = s.user_id
    where s.user_id <> auth.uid()
      and (p_user_id is null or s.user_id = p_user_id)
      and is_connected(auth.uid(), s.user_id)
      and p.activity_feed_visible = true

    union all

    select
      'experience_added',
      e.user_id,
      p.full_name,
      p.avatar_url,
      e.created_at,
      null::text,
      null::int,
      (e.type || ' at ' || e.organization || ': ' || e.title)::text
    from experience e
    join profiles p on p.id = e.user_id
    where e.user_id <> auth.uid()
      and (p_user_id is null or e.user_id = p_user_id)
      and is_connected(auth.uid(), e.user_id)
      and p.activity_feed_visible = true

    union all

    select
      'course_started',
      c.user_id,
      p.full_name,
      p.avatar_url,
      c.created_at,
      null::text,
      null::int,
      (c.name || coalesce(' · ' || c.provider, ''))::text
    from courses c
    join profiles p on p.id = c.user_id
    where c.completed_date is null
      and c.user_id <> auth.uid()
      and (p_user_id is null or c.user_id = p_user_id)
      and is_connected(auth.uid(), c.user_id)
      and p.activity_feed_visible = true

    union all

    select
      'target_set',
      st.user_id,
      p.full_name,
      p.avatar_url,
      st.created_at,
      s.name,
      st.target_level,
      null::text
    from skill_targets st
    join skills s on s.id = st.skill_id
    join profiles p on p.id = st.user_id
    where st.user_id <> auth.uid()
      and (p_user_id is null or st.user_id = p_user_id)
      and is_connected(auth.uid(), st.user_id)
      and p.activity_feed_visible = true
  ) events
  order by event_at desc
  limit p_limit
$$;

grant execute on function list_connections_activity(int, uuid) to authenticated;

-- Backs two additions to SkillsProfile.jsx: a "member since" date in the
-- header, and a "recent growth" panel replacing the plain activity feed.

-- auth.users.created_at is the true signup date -- deliberately not
-- duplicated onto profiles (would be a second representation of the same
-- fact, out of sync the moment either drifted). profiles.full_name/
-- avatar_url are already visible to any authenticated user (see 0061's
-- "Authenticated users can view profile names" policy), so signup date
-- sits at the same visibility level -- identity-ish metadata, not the
-- skill/activity data that's actually access-gated.
create or replace function get_member_since(p_user_id uuid)
returns timestamptz
language sql
security definer
set search_path = public
stable
as $$
  select created_at from auth.users where id = p_user_id
$$;

grant execute on function get_member_since(uuid) to authenticated;

-- Same shape as Dashboard.jsx's own loadRecentGrowth (recent practical-axis
-- level jumps, each paired with the level just before it and any current
-- target), just scoped to one other person and re-derived server-side --
-- skill_assessments/skill_targets are RLS'd to their own owner, so a
-- connection has no client-side way to read this directly. Gated by the
-- exact same is_connected + activity_feed_visible check as
-- list_connections_activity (0063/0102): this is the same privacy boundary,
-- just a richer per-skill shape than that feed's flat event rows.
create or replace function list_connection_recent_growth(p_user_id uuid, p_limit int default 5)
returns table (
  skill_id uuid,
  skill_name text,
  level int,
  previous_level int,
  assessed_at timestamptz,
  target_level int,
  target_date date
)
language sql
security definer
set search_path = public
stable
as $$
  select
    sa.skill_id,
    s.name,
    sa.level,
    (
      select sa2.level
      from skill_assessments sa2
      where sa2.skill_id = sa.skill_id
        and sa2.axis = 'practical'
        and sa2.assessed_at < sa.assessed_at
      order by sa2.assessed_at desc
      limit 1
    ) as previous_level,
    sa.assessed_at,
    t.target_level,
    t.target_date
  from skill_assessments sa
  join skills s on s.id = sa.skill_id
  left join lateral (
    select target_level, target_date
    from skill_targets
    where skill_id = sa.skill_id and user_id = p_user_id
    order by created_at desc
    limit 1
  ) t on true
  where sa.axis = 'practical'
    and sa.user_id = p_user_id
    and sa.assessed_at >= now() - interval '28 days'
    and sa.user_id <> auth.uid()
    and is_connected(auth.uid(), sa.user_id)
    and exists (
      select 1 from profiles p where p.id = p_user_id and p.activity_feed_visible = true
    )
  order by sa.assessed_at desc
  limit p_limit
$$;

grant execute on function list_connection_recent_growth(uuid, int) to authenticated;

-- Same opt-in-to-opt-out flip as 0101 (skills profile sharing), applied to
-- the two remaining cross-user visibility defaults: connections seeing your
-- activity feed, and being discoverable in skill search by anyone tracking
-- the same skill (not just existing connections). Existing accounts are
-- included, not just new signups -- every row currently at the old default
-- is flipped. As with 0101, a row already at a non-default value (an
-- explicit past choice, including 'selective' for skill search) is left
-- alone, since a plain UPDATE can't tell "never touched" apart from
-- "deliberately set back to the old default" -- both look identical.
alter table profiles alter column activity_feed_visible set default true;
update profiles set activity_feed_visible = true where activity_feed_visible = false;

alter table profiles alter column skill_search_visibility set default 'all';
update profiles set skill_search_visibility = 'all' where skill_search_visibility = 'hidden';

-- Provider-admin participant reporting for catalogue courses.

create index if not exists courses_catalogue_course_created_at_idx
  on courses (catalogue_course_id, created_at)
  where catalogue_course_id is not null;

create index if not exists course_content_progress_content_item_user_idx
  on course_content_progress (content_item_id, user_id);

-- Keep course/progress policies out of course_catalogue's own RLS graph:
-- its learner visibility policy refers back to courses, so a direct lookup
-- here would recurse. This bounded helper only answers an authorization
-- question and follows the project's existing is_org_admin helper pattern.
create or replace function is_course_provider_admin(check_course_id uuid, check_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from course_catalogue cc
    where cc.id = check_course_id
      and cc.organisation_id is not null
      and is_org_admin(cc.organisation_id, check_user_id)
  )
$$;

revoke all on function is_course_provider_admin(uuid, uuid) from public;
grant execute on function is_course_provider_admin(uuid, uuid) to authenticated;

drop policy if exists "Provider admins can view their course participants" on courses;
create policy "Provider admins can view their course participants"
  on courses for select
  to authenticated
  using (
    catalogue_course_id is not null
    and is_course_provider_admin(catalogue_course_id, (select auth.uid()))
  );

drop policy if exists "Provider admins can view participant progress" on course_content_progress;
create policy "Provider admins can view participant progress"
  on course_content_progress for select
  to authenticated
  using (
    exists (
      select 1
      from course_content_links ccl
      where ccl.resource_id = course_content_progress.content_item_id
        and is_course_provider_admin(ccl.course_id, (select auth.uid()))
    )
  );

-- 0097 still bound the path expression inside its course_catalogue
-- subquery to course_catalogue.name. Pass the storage object path into a
-- bounded helper instead, so PostgreSQL cannot rebind the outer name.

create or replace function can_manage_course_catalogue_image(object_path text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from course_catalogue cc
    where cc.id::text = (storage.foldername(object_path))[1]
      and (
        is_platform_admin((select auth.uid()))
        or (
          cc.organisation_id is not null
          and is_org_member(cc.organisation_id, (select auth.uid()))
          and cc.status in ('draft', 'rejected')
        )
      )
  )
$$;

revoke all on function can_manage_course_catalogue_image(text) from public;
grant execute on function can_manage_course_catalogue_image(text) to authenticated;

drop policy if exists "Course editors can upload their course's image" on storage.objects;
create policy "Course editors can upload their course's image"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'course-catalogue-images'
    and can_manage_course_catalogue_image(name)
  );

drop policy if exists "Course editors can replace their course's image" on storage.objects;
create policy "Course editors can replace their course's image"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'course-catalogue-images'
    and can_manage_course_catalogue_image(name)
  )
  with check (
    bucket_id = 'course-catalogue-images'
    and can_manage_course_catalogue_image(name)
  );

drop policy if exists "Course editors can read their course image object for replacement" on storage.objects;
create policy "Course editors can read their course image object for replacement"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'course-catalogue-images'
    and can_manage_course_catalogue_image(name)
  );

drop policy if exists "Course editors can remove their course's image" on storage.objects;
create policy "Course editors can remove their course's image"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'course-catalogue-images'
    and can_manage_course_catalogue_image(name)
  );

-- Immutable published course versions. Providers edit a cloned draft while
-- the currently approved version remains live for learners.

alter table course_catalogue
  add column course_code text,
  add column version_group_id uuid,
  add column version_number integer not null default 1 check (version_number > 0),
  add column is_current_published boolean not null default false;

update course_catalogue
set version_group_id = id,
    is_current_published = (status = 'approved');

alter table course_catalogue alter column version_group_id set not null;

create unique index course_catalogue_group_version_idx
  on course_catalogue (version_group_id, version_number);

create unique index course_catalogue_one_current_published_idx
  on course_catalogue (version_group_id)
  where is_current_published;

create index course_catalogue_org_group_version_idx
  on course_catalogue (organisation_id, version_group_id, version_number desc);

drop policy if exists "Organisation members can unpublish their own approved course" on course_catalogue;

create or replace function create_course_draft_version(p_course_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source course_catalogue%rowtype;
  v_existing_id uuid;
  v_new_id uuid := gen_random_uuid();
  v_new_version integer;
  v_section record;
  v_new_section_id uuid;
begin
  select * into v_source
  from course_catalogue
  where id = p_course_id and status = 'approved';

  if not found then
    raise exception 'Only an approved course can be versioned';
  end if;

  if not (
    is_platform_admin((select auth.uid()))
    or (
      v_source.organisation_id is not null
      and is_org_member(v_source.organisation_id, (select auth.uid()))
    )
  ) then
    raise exception 'Not authorized';
  end if;

  select id into v_existing_id
  from course_catalogue
  where version_group_id = v_source.version_group_id
    and status in ('draft', 'pending_approval', 'rejected')
  order by version_number desc
  limit 1;

  if v_existing_id is not null then
    return v_existing_id;
  end if;

  select coalesce(max(version_number), 0) + 1 into v_new_version
  from course_catalogue
  where version_group_id = v_source.version_group_id;

  insert into course_catalogue (
    id, name, provider, course_type, duration, synopsis, organisation_id,
    status, created_by, image_url, course_code, version_group_id,
    version_number, is_current_published
  ) values (
    v_new_id, v_source.name, v_source.provider, v_source.course_type,
    v_source.duration, v_source.synopsis, v_source.organisation_id,
    'draft', (select auth.uid()), v_source.image_url, v_source.course_code,
    v_source.version_group_id, v_new_version, false
  );

  insert into course_catalogue_skills (course_catalogue_id, skill_library_id, level)
  select v_new_id, skill_library_id, level
  from course_catalogue_skills
  where course_catalogue_id = p_course_id;

  insert into course_catalogue_tags (course_catalogue_id, tag_id)
  select v_new_id, tag_id
  from course_catalogue_tags
  where course_catalogue_id = p_course_id;

  for v_section in
    select id, title, position
    from course_sections
    where course_id = p_course_id
    order by position, created_at
  loop
    v_new_section_id := gen_random_uuid();
    insert into course_sections (id, course_id, title, position)
    values (v_new_section_id, v_new_id, v_section.title, v_section.position);

    insert into course_content_links (course_id, resource_id, position, section_id)
    select v_new_id, resource_id, position, v_new_section_id
    from course_content_links
    where course_id = p_course_id and section_id = v_section.id;
  end loop;

  insert into course_content_links (course_id, resource_id, position, section_id)
  select v_new_id, resource_id, position, null
  from course_content_links
  where course_id = p_course_id and section_id is null;

  return v_new_id;
end;
$$;

revoke all on function create_course_draft_version(uuid) from public;
grant execute on function create_course_draft_version(uuid) to authenticated;

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
end;
$$;

revoke all on function publish_course_version(uuid) from public;
grant execute on function publish_course_version(uuid) to authenticated;

create or replace function get_provider_profile(p_slug text)
returns json
language sql
security definer
set search_path = public
stable
as $$
  select json_build_object(
    'organisation', (
      select json_build_object('id', o.id, 'name', o.name, 'about', o.about, 'logoUrl', o.logo_url, 'url', o.url)
      from organisations o
      where o.slug = p_slug and o.status = 'active' and o.public_profile_enabled = true
    ),
    'skills', (
      select coalesce(json_agg(json_build_object(
        'id', sl.id, 'name', sl.name, 'category', sl.category, 'description', sl.description
      ) order by sl.name), '[]'::json)
      from organisation_offered_skills oos
      join skill_library sl on sl.id = oos.skill_library_id
      join organisations o on o.id = oos.organisation_id
      where o.slug = p_slug and o.status = 'active' and o.public_profile_enabled = true
    ),
    'courses', (
      select coalesce(json_agg(json_build_object(
        'id', cc.id, 'name', cc.name, 'synopsis', cc.synopsis,
        'courseType', cc.course_type, 'duration', cc.duration,
        'imageUrl', cc.image_url, 'courseCode', cc.course_code,
        'versionNumber', cc.version_number,
        'skillEntries', (
          select coalesce(json_agg(json_build_object(
            'skillId', ccs.skill_library_id, 'skillName', sl2.name, 'level', ccs.level
          )), '[]'::json)
          from course_catalogue_skills ccs
          join skill_library sl2 on sl2.id = ccs.skill_library_id
          where ccs.course_catalogue_id = cc.id
        ),
        'tags', (
          select coalesce(json_agg(json_build_object('id', t.id, 'name', t.name)), '[]'::json)
          from course_catalogue_tags cct
          join tags t on t.id = cct.tag_id
          where cct.course_catalogue_id = cc.id
        )
      ) order by cc.name), '[]'::json)
      from course_catalogue cc
      join organisations o on o.id = cc.organisation_id
      where o.slug = p_slug and o.status = 'active' and o.public_profile_enabled = true
        and cc.status = 'approved' and cc.is_current_published
    )
  )
$$;

grant execute on function get_provider_profile(text) to anon, authenticated;

-- Optional learner-facing guidance for each course section. Keep version
-- cloning in sync so a provider's instructions carry into the next draft.

alter table course_sections
  add column instructions text;

create or replace function create_course_draft_version(p_course_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source course_catalogue%rowtype;
  v_existing_id uuid;
  v_new_id uuid := gen_random_uuid();
  v_new_version integer;
  v_section record;
  v_new_section_id uuid;
begin
  select * into v_source
  from course_catalogue
  where id = p_course_id and status = 'approved';

  if not found then
    raise exception 'Only an approved course can be versioned';
  end if;

  if not (
    is_platform_admin((select auth.uid()))
    or (
      v_source.organisation_id is not null
      and is_org_member(v_source.organisation_id, (select auth.uid()))
    )
  ) then
    raise exception 'Not authorized';
  end if;

  select id into v_existing_id
  from course_catalogue
  where version_group_id = v_source.version_group_id
    and status in ('draft', 'pending_approval', 'rejected')
  order by version_number desc
  limit 1;

  if v_existing_id is not null then
    return v_existing_id;
  end if;

  select coalesce(max(version_number), 0) + 1 into v_new_version
  from course_catalogue
  where version_group_id = v_source.version_group_id;

  insert into course_catalogue (
    id, name, provider, course_type, duration, synopsis, organisation_id,
    status, created_by, image_url, course_code, version_group_id,
    version_number, is_current_published
  ) values (
    v_new_id, v_source.name, v_source.provider, v_source.course_type,
    v_source.duration, v_source.synopsis, v_source.organisation_id,
    'draft', (select auth.uid()), v_source.image_url, v_source.course_code,
    v_source.version_group_id, v_new_version, false
  );

  insert into course_catalogue_skills (course_catalogue_id, skill_library_id, level)
  select v_new_id, skill_library_id, level
  from course_catalogue_skills
  where course_catalogue_id = p_course_id;

  insert into course_catalogue_tags (course_catalogue_id, tag_id)
  select v_new_id, tag_id
  from course_catalogue_tags
  where course_catalogue_id = p_course_id;

  for v_section in
    select id, title, instructions, position
    from course_sections
    where course_id = p_course_id
    order by position, created_at
  loop
    v_new_section_id := gen_random_uuid();
    insert into course_sections (id, course_id, title, instructions, position)
    values (v_new_section_id, v_new_id, v_section.title, v_section.instructions, v_section.position);

    insert into course_content_links (course_id, resource_id, position, section_id)
    select v_new_id, resource_id, position, v_new_section_id
    from course_content_links
    where course_id = p_course_id and section_id = v_section.id;
  end loop;

  insert into course_content_links (course_id, resource_id, position, section_id)
  select v_new_id, resource_id, position, null
  from course_content_links
  where course_id = p_course_id and section_id is null;

  return v_new_id;
end;
$$;

revoke all on function create_course_draft_version(uuid) from public;
grant execute on function create_course_draft_version(uuid) to authenticated;

-- Platform-admin-configurable first-login wizard: each row is one of the
-- steps Onboarding.jsx already knows how to render (CV/history import,
-- skills to learn), toggleable on/off from /admin/onboarding. `key` stays
-- fixed and matches the step identifiers in Onboarding.jsx -- this table
-- only controls which known steps show and in what order, not what a step
-- does, so no dynamic step-creation UI is needed.
create table onboarding_steps (
  key text primary key,
  label text not null,
  enabled boolean not null default true,
  order_index integer not null,
  updated_at timestamptz not null default now()
);
insert into onboarding_steps (key, label, order_index) values
  ('import', 'Import your CV or LinkedIn history', 0),
  ('skills', 'Choose skills you want to learn', 1);

alter table onboarding_steps enable row level security;

-- Every signed-in user needs to read this to render their own onboarding
-- wizard -- it's shared platform configuration, not private data.
create policy "Authenticated users can view onboarding steps"
  on onboarding_steps for select
  to authenticated
  using (true);

create policy "Platform admins can update onboarding steps"
  on onboarding_steps for update
  to authenticated
  using (is_platform_admin(auth.uid()))
  with check (is_platform_admin(auth.uid()));

-- Drives the "import your CV/history" banner on the dashboard: shown until
-- the learner has actually run an import once, or explicitly dismissed it.
-- Kept as its own flag rather than inferring from skills.source='cv_import'
-- (0008) -- an import can add only courses/experience with no skills at
-- all, which that column alone wouldn't catch.
alter table profiles add column cv_imported_at timestamptz;
alter table profiles add column cv_import_banner_dismissed_at timestamptz;

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

-- Redesigned against 0111's real per-catalogue model (a provider can own
-- several named catalogues, plus the platform-managed Global catalogue) --
-- an org admin designates specific active members of their own org as
-- approvers of one of their org's own (non-global) catalogues, able to
-- approve/reject/deactivate a course being published into that catalogue,
-- without needing a platform admin. Nobody can be an approver of the
-- Global catalogue (it has no organisation_id, so the insert policy below
-- can never match it) -- publishing anything into it stays platform-admin
-- only, same as today.

create table catalogue_approvers (
  id uuid primary key default gen_random_uuid(),
  catalogue_id uuid not null references catalogues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (catalogue_id, user_id)
);

create index catalogue_approvers_catalogue_idx on catalogue_approvers (catalogue_id);
create index catalogue_approvers_user_idx on catalogue_approvers (user_id);

-- security definer, same shape/reason as is_org_admin/is_org_member (0065),
-- including the organisations.status = 'active' check 0069 added to those
-- two -- without it, a platform admin deactivating a provider org would
-- leave a previously-designated approver still able to move that org's
-- course_catalogue rows.
create or replace function is_catalogue_approver(p_catalogue_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from catalogue_approvers ca
    join catalogues c on c.id = ca.catalogue_id
    join organisations o on o.id = c.organisation_id
    where ca.catalogue_id = p_catalogue_id
      and ca.user_id = p_user_id
      and o.status = 'active'
  )
$$;

grant execute on function is_catalogue_approver(uuid, uuid) to authenticated;

alter table catalogue_approvers enable row level security;

create policy "Org members can view their organisation's catalogue approvers"
  on catalogue_approvers for select
  to authenticated
  using (
    exists (
      select 1 from catalogues c
      where c.id = catalogue_approvers.catalogue_id
        and c.organisation_id is not null
        and is_org_member(c.organisation_id, auth.uid())
    )
  );

-- The target catalogue must belong to the calling admin's own organisation
-- (never the Global catalogue, since it has no organisation_id), and the
-- designated user must already be an active member of that same
-- organisation (not a still-pending invite, matching is_org_member's own
-- 0070 status check) -- this is a list of that org's own users against
-- that org's own catalogue, not an arbitrary allowlist. added_by is pinned
-- to the caller so a crafted request can't misattribute (or null out) who
-- granted the approval right.
create policy "Org admins can designate catalogue approvers from their own users"
  on catalogue_approvers for insert
  to authenticated
  with check (
    added_by = auth.uid()
    and exists (
      select 1 from catalogues c
      where c.id = catalogue_approvers.catalogue_id
        and c.organisation_id is not null
        and is_org_admin(c.organisation_id, auth.uid())
        and exists (
          select 1 from organisation_members om
          where om.organisation_id = c.organisation_id
            and om.user_id = catalogue_approvers.user_id
            and om.status = 'active'
        )
    )
  );

create policy "Org admins can remove catalogue approvers"
  on catalogue_approvers for delete
  to authenticated
  using (
    exists (
      select 1 from catalogues c
      where c.id = catalogue_approvers.catalogue_id
        and c.organisation_id is not null
        and is_org_admin(c.organisation_id, auth.uid())
    )
  );

-- catalogue_approvers has no FK to organisation_members (it points at
-- catalogues/auth.users, since an approver grant should outlive a role
-- change), so removing someone's staff access (removeOrganisationMember --
-- a hard delete, not a status flip) wouldn't otherwise also revoke an
-- existing approver grant on that org's catalogues.
create or replace function revoke_catalogue_approver_on_membership_removal()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  delete from catalogue_approvers
  using catalogues
  where catalogue_approvers.catalogue_id = catalogues.id
    and catalogues.organisation_id = old.organisation_id
    and catalogue_approvers.user_id = old.user_id;
  return old;
end;
$$;

create trigger revoke_catalogue_approver_on_membership_removal_trigger
  after delete on organisation_members
  for each row execute procedure revoke_catalogue_approver_on_membership_removal();

-- Reject/deactivate/approve are all authorized through security-definer
-- RPCs rather than plain-table-update RLS grants. A general-purpose RLS
-- UPDATE policy for a catalogue approver (who may be an ordinary staff
-- member, not an org admin) can only constrain the columns it names in its
-- with-check -- it can't stop the same statement from also rewriting
-- name/synopsis/image_url/etc on a pending_approval or already-approved
-- row, since 0066's own org-member edit policy only ever applies while
-- status is draft/rejected. Routing every transition through a function
-- that performs its own narrow `set status = ..., <specific columns>`
-- closes that off entirely, and lets each one check authorization against
-- the *specific* catalogue(s) the course was actually submitted to
-- (course_catalogue_publications), not just "approver of some catalogue in
-- this org" -- matching what an org that splits approval authority across
-- multiple catalogues actually expects.
--
-- All three also front-load the authorization check ahead of any
-- course-specific detail: a non-admin caller always gets a flat 'Not
-- authorized' whether the course doesn't exist, has no publications yet, or
-- they're simply not an approver for all of its selected catalogues, so
-- probing an arbitrary course id can't be used to learn anything about it.
-- Platform admins (who can already see everything) get the more specific
-- diagnostic instead.

create or replace function publish_course_version(p_course_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_caller uuid := (select auth.uid());
  v_is_admin boolean := is_platform_admin(v_caller);
  v_has_publications boolean;
  v_approved_for_all boolean;
begin
  select version_group_id into v_group_id
  from course_catalogue
  where id = p_course_id
  for update;

  v_has_publications := v_group_id is not null and exists (
    select 1 from course_catalogue_publications where course_id = p_course_id
  );

  v_approved_for_all := v_group_id is not null and not exists (
    select 1
    from course_catalogue_publications ccp
    where ccp.course_id = p_course_id
      and not is_catalogue_approver(ccp.catalogue_id, v_caller)
  );

  if not v_is_admin and (v_group_id is null or not v_has_publications or not v_approved_for_all) then
    raise exception 'Not authorized';
  end if;

  if v_is_admin and v_group_id is null then
    raise exception 'Course not found';
  end if;

  if not v_has_publications then
    raise exception 'Choose at least one publication catalogue';
  end if;

  update course_catalogue
  set status = 'inactive', is_current_published = false
  where version_group_id = v_group_id
    and is_current_published
    and id <> p_course_id;

  update course_catalogue
  set status = 'approved',
      is_current_published = true,
      approved_by = v_caller,
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

create or replace function reject_course_submission(p_course_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
  v_is_admin boolean := is_platform_admin(v_caller);
  v_status text;
  v_found boolean;
  v_has_publications boolean;
  v_approved_for_all boolean;
begin
  select status into v_status
  from course_catalogue
  where id = p_course_id
  for update;

  v_found := found;

  v_has_publications := v_found and exists (
    select 1 from course_catalogue_publications where course_id = p_course_id
  );

  v_approved_for_all := v_found and not exists (
    select 1
    from course_catalogue_publications ccp
    where ccp.course_id = p_course_id
      and not is_catalogue_approver(ccp.catalogue_id, v_caller)
  );

  if not v_is_admin and (not v_found or not v_has_publications or not v_approved_for_all) then
    raise exception 'Not authorized';
  end if;

  if not v_found then
    raise exception 'Course not found';
  end if;

  if v_status <> 'pending_approval' then
    raise exception 'Only a pending submission can be rejected';
  end if;

  update course_catalogue
  set status = 'rejected',
      rejection_reason = p_reason,
      approved_by = null,
      approved_at = null,
      is_current_published = false
  where id = p_course_id;
end;
$$;

revoke all on function reject_course_submission(uuid, text) from public;
grant execute on function reject_course_submission(uuid, text) to authenticated;

create or replace function deactivate_course_publication(p_course_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
  v_is_admin boolean := is_platform_admin(v_caller);
  v_status text;
  v_found boolean;
  v_has_publications boolean;
  v_approved_for_all boolean;
begin
  select status into v_status
  from course_catalogue
  where id = p_course_id
  for update;

  v_found := found;

  v_has_publications := v_found and exists (
    select 1 from course_catalogue_publications where course_id = p_course_id
  );

  v_approved_for_all := v_found and not exists (
    select 1
    from course_catalogue_publications ccp
    where ccp.course_id = p_course_id
      and not is_catalogue_approver(ccp.catalogue_id, v_caller)
  );

  if not v_is_admin and (not v_found or not v_has_publications or not v_approved_for_all) then
    raise exception 'Not authorized';
  end if;

  if not v_found then
    raise exception 'Course not found';
  end if;

  if v_status <> 'approved' then
    raise exception 'Only an approved course can be deactivated';
  end if;

  update course_catalogue
  set status = 'inactive', is_current_published = false
  where id = p_course_id;
end;
$$;

revoke all on function deactivate_course_publication(uuid) from public;
grant execute on function deactivate_course_publication(uuid) to authenticated;

-- Prefixed sequential reference codes (CRS-00001, ORG-00001, USR-00001,
-- SKL-00001) for courses, providers, users and shared-library skills --
-- admin-facing identifiers for support/reference conversations, distinct
-- from organisations.slug (0090, learner/public-facing, used in URLs).
-- Follows the same auto-generate-on-insert-if-null + one-time-backfill
-- shape 0090 already established for slugs.

create sequence course_code_seq;
create sequence organisation_code_seq;
create sequence user_code_seq;
create sequence skill_code_seq;

create or replace function generate_course_code()
returns text
language sql
as $$
  select 'CRS-' || lpad(nextval('course_code_seq')::text, 5, '0')
$$;

create or replace function generate_organisation_code()
returns text
language sql
as $$
  select 'ORG-' || lpad(nextval('organisation_code_seq')::text, 5, '0')
$$;

create or replace function generate_user_code()
returns text
language sql
as $$
  select 'USR-' || lpad(nextval('user_code_seq')::text, 5, '0')
$$;

create or replace function generate_skill_code()
returns text
language sql
as $$
  select 'SKL-' || lpad(nextval('skill_code_seq')::text, 5, '0')
$$;

-- Courses -- course_code (0107) already exists as a plain nullable text
-- column with no generation or uniqueness. A course is versioned
-- (version_group_id/version_number, 0107): every version of the same
-- course shares one code (create_course_draft_version already copies it
-- forward), so uniqueness is enforced against each version_group's v1 row
-- only, not every row -- a plain unique index on the column would reject
-- v2+ rows carrying their v1's own code.
create or replace function set_course_code()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.course_code is null then
    new.course_code := generate_course_code();
  end if;
  return new;
end;
$$;

create trigger set_course_code_trigger
  before insert on course_catalogue
  for each row execute procedure set_course_code();

-- Backfill: one code per version_group, reusing an existing non-null code
-- already present anywhere in that group (defensive) before generating a
-- fresh one, then propagated to every row in the group.
do $$
declare
  r record;
  v_code text;
begin
  for r in
    select distinct version_group_id
    from course_catalogue
    where version_group_id in (
      select version_group_id from course_catalogue where course_code is null
    )
    order by version_group_id
  loop
    select course_code into v_code
    from course_catalogue
    where version_group_id = r.version_group_id and course_code is not null
    limit 1;

    if v_code is null then
      v_code := generate_course_code();
    end if;

    update course_catalogue
    set course_code = v_code
    where version_group_id = r.version_group_id and course_code is null;
  end loop;
end $$;

create unique index course_catalogue_code_unique_idx
  on course_catalogue (course_code)
  where version_number = 1;

-- Providers -- new admin-only reference code, alongside (not replacing)
-- the existing public-facing slug.
alter table organisations add column org_code text;

create or replace function set_organisation_code()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.org_code is null then
    new.org_code := generate_organisation_code();
  end if;
  return new;
end;
$$;

create trigger set_organisation_code_trigger
  before insert on organisations
  for each row execute procedure set_organisation_code();

update organisations set org_code = generate_organisation_code() where org_code is null;

alter table organisations alter column org_code set not null;
create unique index organisations_org_code_unique_idx on organisations (org_code);

-- Users
alter table profiles add column user_code text;

create or replace function set_user_code()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.user_code is null then
    new.user_code := generate_user_code();
  end if;
  return new;
end;
$$;

create trigger set_user_code_trigger
  before insert on profiles
  for each row execute procedure set_user_code();

update profiles set user_code = generate_user_code() where user_code is null;

alter table profiles alter column user_code set not null;
create unique index profiles_user_code_unique_idx on profiles (user_code);

-- Skills -- the shared skill_library catalogue only (personal per-user
-- tracked skills, the `skills` table, are a different concept and were
-- explicitly out of scope for this).
alter table skill_library add column skill_code text;

create or replace function set_skill_code()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.skill_code is null then
    new.skill_code := generate_skill_code();
  end if;
  return new;
end;
$$;

create trigger set_skill_code_trigger
  before insert on skill_library
  for each row execute procedure set_skill_code();

update skill_library set skill_code = generate_skill_code() where skill_code is null;

alter table skill_library alter column skill_code set not null;
create unique index skill_library_skill_code_unique_idx on skill_library (skill_code);

-- Subjects are experience records nested beneath an Education experience.
-- Reusing the existing parent relationship means they automatically appear
-- in the education timeline and can carry their own dates, description and
-- linked skills without introducing a parallel content model.

alter table public.experience drop constraint experience_type_check;
alter table public.experience add constraint experience_type_check
  check (type in ('education', 'employment', 'project', 'volunteer', 'other', 'course', 'subject'));

create or replace function public.validate_experience_parent_type()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  parent_type text;
  parent_user_id uuid;
begin
  if new.parent_experience_id is null then
    if new.type = 'subject' then
      raise exception 'A subject must belong to an education experience';
    end if;
    return new;
  end if;

  if new.parent_experience_id = new.id then
    raise exception 'An experience cannot be its own parent';
  end if;

  select type, user_id
    into parent_type, parent_user_id
  from public.experience
  where id = new.parent_experience_id;

  if not found then
    raise exception 'Parent experience not found';
  end if;

  if parent_user_id <> new.user_id then
    raise exception 'Parent and child experiences must belong to the same user';
  end if;

  if parent_type = 'education' and new.type <> 'subject' then
    raise exception 'Education experiences can only contain subjects';
  end if;

  if new.type = 'subject' and parent_type <> 'education' then
    raise exception 'Subjects can only belong to education experiences';
  end if;

  if parent_type in ('employment', 'volunteer') and new.type not in ('project', 'course', 'other') then
    raise exception 'This experience type cannot be added to a job or volunteer position';
  end if;

  if parent_type not in ('education', 'employment', 'volunteer') then
    raise exception 'This experience type cannot contain sub-experiences';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_experience_parent_type() from public;

create trigger validate_experience_parent_type_before_write
before insert or update of type, parent_experience_id, user_id
on public.experience
for each row execute function public.validate_experience_parent_type();

-- Subjects may be recorded with exact dates, a human-readable study
-- duration, or both. Other experience types retain the app's required-date
-- behaviour even though the column must become nullable for subjects.

alter table public.experience
  alter column start_date drop not null,
  add column study_duration text;

alter table public.experience
  add constraint experience_subject_timing_check check (
    (
      type = 'subject'
      and (start_date is not null or length(trim(study_duration)) > 0)
      and (end_date is null or start_date is not null)
    )
    or (
      type <> 'subject'
      and start_date is not null
      and study_duration is null
    )
  );

-- Replace free-text duration entry with a queryable number and fixed unit.
-- Keep the old text column as a legacy fallback so any duration entered
-- between the preceding deployment and this one is not discarded.

alter table public.experience
  add column study_duration_value integer,
  add column study_duration_unit text;

update public.experience e
set study_duration_value = parsed.duration_value,
    study_duration_unit = parsed.duration_unit,
    study_duration = null
from (
  select id,
         parts[1]::integer as duration_value,
         case
           when lower(parts[2]) like 'day%' then 'days'
           when lower(parts[2]) like 'month%' then 'months'
           else 'years'
         end as duration_unit
  from public.experience
  cross join lateral regexp_match(study_duration, '^\s*([0-9]+)\s*(day|days|month|months|year|years)\s*$', 'i') as parsed_match(parts)
  where type = 'subject'
) parsed
where e.id = parsed.id;

alter table public.experience drop constraint experience_subject_timing_check;

alter table public.experience
  add constraint experience_subject_timing_check check (
    (
      type = 'subject'
      and (
        start_date is not null
        or (study_duration_value is not null and study_duration_unit is not null)
        or length(trim(study_duration)) > 0
      )
      and (end_date is null or start_date is not null)
      and (study_duration_value is null or study_duration_value > 0)
      and (study_duration_unit is null or study_duration_unit in ('days', 'months', 'years'))
      and ((study_duration_value is null) = (study_duration_unit is null))
    )
    or (
      type <> 'subject'
      and start_date is not null
      and study_duration is null
      and study_duration_value is null
      and study_duration_unit is null
    )
  );

-- Institution details are owned by the parent education row. Copy them on
-- every subject write so direct API calls cannot create conflicting values.
create or replace function public.validate_experience_parent_type()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  parent_type text;
  parent_user_id uuid;
  parent_organization text;
  parent_organization_url text;
begin
  if new.parent_experience_id is null then
    if new.type = 'subject' then
      raise exception 'A subject must belong to an education experience';
    end if;
    return new;
  end if;

  if new.parent_experience_id = new.id then
    raise exception 'An experience cannot be its own parent';
  end if;

  select type, user_id, organization, organization_url
    into parent_type, parent_user_id, parent_organization, parent_organization_url
  from public.experience
  where id = new.parent_experience_id;

  if not found then raise exception 'Parent experience not found'; end if;
  if parent_user_id <> new.user_id then raise exception 'Parent and child experiences must belong to the same user'; end if;
  if parent_type = 'education' and new.type <> 'subject' then raise exception 'Education experiences can only contain subjects'; end if;
  if new.type = 'subject' and parent_type <> 'education' then raise exception 'Subjects can only belong to education experiences'; end if;
  if parent_type in ('employment', 'volunteer') and new.type not in ('project', 'course', 'other') then raise exception 'This experience type cannot be added to a job or volunteer position'; end if;
  if parent_type not in ('education', 'employment', 'volunteer') then raise exception 'This experience type cannot contain sub-experiences'; end if;

  if new.type = 'subject' then
    new.organization := parent_organization;
    new.organization_url := parent_organization_url;
  end if;

  return new;
end;
$$;

drop trigger validate_experience_parent_type_before_write on public.experience;
create trigger validate_experience_parent_type_before_write
before insert or update of type, parent_experience_id, user_id, organization, organization_url
on public.experience
for each row execute function public.validate_experience_parent_type();

create or replace function public.sync_subject_organization_from_parent()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.type = 'education'
     and (new.organization is distinct from old.organization
          or new.organization_url is distinct from old.organization_url) then
    update public.experience
    set organization = new.organization,
        organization_url = new.organization_url
    where parent_experience_id = new.id
      and type = 'subject';
  end if;

  return new;
end;
$$;

revoke all on function public.sync_subject_organization_from_parent() from public;

create trigger sync_subject_organization_after_parent_update
after update of organization, organization_url
on public.experience
for each row execute function public.sync_subject_organization_from_parent();

-- Keep nested experiences within their parent's period at the database
-- boundary, including writes made outside the web client.

create or replace function public.validate_experience_parent_type()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  parent_type text;
  parent_user_id uuid;
  parent_organization text;
  parent_organization_url text;
  parent_start_date date;
  parent_end_date date;
begin
  if new.parent_experience_id is null then
    if new.type = 'subject' then
      raise exception 'A subject must belong to an education experience';
    end if;

    if tg_op = 'UPDATE'
       and (new.start_date is distinct from old.start_date
            or new.end_date is distinct from old.end_date)
       and exists (
         select 1
         from public.experience child
         where child.parent_experience_id = new.id
           and (
             child.start_date < new.start_date
             or child.end_date < new.start_date
             or (new.end_date is not null and child.start_date > new.end_date)
             or (new.end_date is not null and child.end_date > new.end_date)
           )
       ) then
      raise exception 'Parent dates cannot exclude an existing sub-experience';
    end if;

    return new;
  end if;

  if new.parent_experience_id = new.id then
    raise exception 'An experience cannot be its own parent';
  end if;

  select type, user_id, organization, organization_url, start_date, end_date
    into parent_type, parent_user_id, parent_organization, parent_organization_url,
         parent_start_date, parent_end_date
  from public.experience
  where id = new.parent_experience_id;

  if not found then raise exception 'Parent experience not found'; end if;
  if parent_user_id <> new.user_id then raise exception 'Parent and child experiences must belong to the same user'; end if;
  if parent_type = 'education' and new.type <> 'subject' then raise exception 'Education experiences can only contain subjects'; end if;
  if new.type = 'subject' and parent_type <> 'education' then raise exception 'Subjects can only belong to education experiences'; end if;
  if parent_type in ('employment', 'volunteer') and new.type not in ('project', 'course', 'other') then raise exception 'This experience type cannot be added to a job or volunteer position'; end if;
  if parent_type not in ('education', 'employment', 'volunteer') then raise exception 'This experience type cannot contain sub-experiences'; end if;

  if new.start_date < parent_start_date or new.end_date < parent_start_date then
    raise exception 'Sub-experience dates cannot be before the parent start date';
  end if;
  if parent_end_date is not null
     and (new.start_date > parent_end_date or new.end_date > parent_end_date) then
    raise exception 'Sub-experience dates cannot be after the parent end date';
  end if;
  if new.start_date is not null and new.end_date < new.start_date then
    raise exception 'Sub-experience end date cannot be before its start date';
  end if;

  if new.type = 'subject' then
    new.organization := parent_organization;
    new.organization_url := parent_organization_url;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_experience_parent_type() from public;

drop trigger validate_experience_parent_type_before_write on public.experience;
create trigger validate_experience_parent_type_before_write
before insert or update of type, parent_experience_id, user_id, organization,
  organization_url, start_date, end_date
on public.experience
for each row execute function public.validate_experience_parent_type();

-- A logged skill activity can optionally happen within a specific work,
-- education, subject, project, or other experience. The xAPI statement keeps
-- the portable context extension; this column is its queryable mirror.

alter table public.xapi_statements
  add column experience_id uuid references public.experience(id) on delete set null;

create index xapi_statements_experience_id_recorded_at_idx
  on public.xapi_statements (experience_id, recorded_at desc)
  where experience_id is not null;

create or replace function public.validate_xapi_statement_context_ownership()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.skill_id is not null and not exists (
    select 1 from public.skills
    where id = new.skill_id and user_id = new.user_id
  ) then
    raise exception 'Activity skill must belong to the same user';
  end if;

  if new.experience_id is not null and not exists (
    select 1 from public.experience
    where id = new.experience_id and user_id = new.user_id
  ) then
    raise exception 'Activity experience must belong to the same user';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_xapi_statement_context_ownership() from public;

create trigger validate_xapi_statement_context_ownership_before_write
before insert or update of user_id, skill_id, experience_id
on public.xapi_statements
for each row execute function public.validate_xapi_statement_context_ownership();

-- A logged skill activity can now carry evidence, the same shape
-- skill_assessments has had since 0007 (a link plus uploaded files) --
-- reuses the existing skill-evidence storage bucket and its RLS policy
-- (scoped only by the uploading user's own folder, not by table), so no
-- storage/policy changes are needed here.
alter table xapi_statements add column evidence_url text;
alter table xapi_statements add column evidence_paths text[];

-- Expand provider catalogues into scoped workspaces with skills and role-based users.
alter table catalogue_approvers
  add column role text not null default 'approver'
  check (role in ('admin', 'approver'));

create table catalogue_skills (
  id uuid primary key default gen_random_uuid(),
  catalogue_id uuid not null references catalogues(id) on delete cascade,
  skill_library_id uuid not null references skill_library(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (catalogue_id, skill_library_id)
);

create index catalogue_skills_catalogue_idx on catalogue_skills (catalogue_id);
create index catalogue_skills_skill_idx on catalogue_skills (skill_library_id);

create or replace function is_catalogue_admin(p_catalogue_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from catalogue_approvers ca
    join catalogues c on c.id = ca.catalogue_id
    join organisations o on o.id = c.organisation_id
    where ca.catalogue_id = p_catalogue_id
      and ca.user_id = p_user_id
      and ca.role = 'admin'
      and o.status = 'active'
  )
$$;

revoke all on function is_catalogue_admin(uuid, uuid) from public;
grant execute on function is_catalogue_admin(uuid, uuid) to authenticated;

create policy "Catalogue admins can update their catalogue"
  on catalogues for update to authenticated
  using (is_catalogue_admin(id, (select auth.uid())))
  with check (is_catalogue_admin(id, (select auth.uid())));

create policy "Catalogue admins can add catalogue users"
  on catalogue_approvers for insert to authenticated
  with check (
    added_by = (select auth.uid())
    and is_catalogue_admin(catalogue_id, (select auth.uid()))
    and exists (
      select 1 from catalogues c
      join organisation_members om on om.organisation_id = c.organisation_id
      where c.id = catalogue_id and om.user_id = catalogue_approvers.user_id and om.status = 'active'
    )
  );

create policy "Catalogue admins can update catalogue users"
  on catalogue_approvers for update to authenticated
  using (is_catalogue_admin(catalogue_id, (select auth.uid())))
  with check (is_catalogue_admin(catalogue_id, (select auth.uid())));

create policy "Organisation admins can update catalogue users"
  on catalogue_approvers for update to authenticated
  using (
    exists (select 1 from catalogues c where c.id = catalogue_id and is_org_admin(c.organisation_id, (select auth.uid())))
  )
  with check (
    exists (select 1 from catalogues c where c.id = catalogue_id and is_org_admin(c.organisation_id, (select auth.uid())))
  );

create policy "Catalogue admins can remove catalogue users"
  on catalogue_approvers for delete to authenticated
  using (is_catalogue_admin(catalogue_id, (select auth.uid())));

alter table catalogue_skills enable row level security;

create policy "Organisation members can view catalogue skills"
  on catalogue_skills for select to authenticated
  using (
    exists (
      select 1 from catalogues c
      where c.id = catalogue_id and is_org_member(c.organisation_id, (select auth.uid()))
    )
  );

create policy "Catalogue admins manage catalogue skills"
  on catalogue_skills for all to authenticated
  using (
    is_catalogue_admin(catalogue_id, (select auth.uid()))
    or exists (select 1 from catalogues c where c.id = catalogue_id and is_org_admin(c.organisation_id, (select auth.uid())))
  )
  with check (
    (
      is_catalogue_admin(catalogue_id, (select auth.uid()))
      or exists (select 1 from catalogues c where c.id = catalogue_id and is_org_admin(c.organisation_id, (select auth.uid())))
    )
    and exists (
      select 1
      from catalogues c
      join organisation_offered_skills os on os.organisation_id = c.organisation_id
      where c.id = catalogue_id and os.skill_library_id = catalogue_skills.skill_library_id
    )
  );

-- Organisation provider admins automatically administer every catalogue
-- owned by their organisation; explicit catalogue-admin grants remain for
-- non-admin provider users.
create or replace function is_catalogue_admin(p_catalogue_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from catalogues c
    where c.id = p_catalogue_id
      and is_org_admin(c.organisation_id, p_user_id)
  ) or exists (
    select 1
    from catalogue_approvers ca
    join catalogues c on c.id = ca.catalogue_id
    join organisations o on o.id = c.organisation_id
    where ca.catalogue_id = p_catalogue_id
      and ca.user_id = p_user_id
      and ca.role = 'admin'
      and o.status = 'active'
  )
$$;

revoke all on function is_catalogue_admin(uuid, uuid) from public;
grant execute on function is_catalogue_admin(uuid, uuid) to authenticated;

-- Allow an organisation resource to be assigned to one or more catalogues
-- without duplicating or transferring ownership of the underlying resource.
create table catalogue_resources (
  id uuid primary key default gen_random_uuid(),
  catalogue_id uuid not null references catalogues(id) on delete cascade,
  resource_id uuid not null references content_resources(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (catalogue_id, resource_id)
);

create index catalogue_resources_catalogue_idx on catalogue_resources (catalogue_id);
create index catalogue_resources_resource_idx on catalogue_resources (resource_id);

alter table catalogue_resources enable row level security;

revoke all on table catalogue_resources from anon, authenticated;
grant select, insert, delete on table catalogue_resources to authenticated;

create policy "Organisation members can view catalogue resources"
  on catalogue_resources for select to authenticated
  using (
    exists (
      select 1
      from catalogues c
      where c.id = catalogue_resources.catalogue_id
        and is_org_member(c.organisation_id, (select auth.uid()))
    )
  );

create policy "Catalogue admins can assign resources"
  on catalogue_resources for insert to authenticated
  with check (
    is_catalogue_admin(catalogue_resources.catalogue_id, (select auth.uid()))
    and catalogue_resources.created_by = (select auth.uid())
    and exists (
      select 1
      from catalogues c
      join content_resources cr on cr.organisation_id = c.organisation_id
      where c.id = catalogue_resources.catalogue_id
        and cr.id = catalogue_resources.resource_id
    )
  );

create policy "Catalogue admins can unassign resources"
  on catalogue_resources for delete to authenticated
  using (is_catalogue_admin(catalogue_resources.catalogue_id, (select auth.uid())));

-- Catalogue admins can assign an existing course owned by the catalogue's
-- organisation. Approved current versions are published immediately;
-- editable versions enter (or remain in) the normal approval workflow.
create or replace function assign_course_to_catalogue(p_catalogue_id uuid, p_course_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
  v_catalogue_organisation_id uuid;
  v_course_organisation_id uuid;
  v_course_status text;
  v_is_current_published boolean;
begin
  if v_caller is null or not is_catalogue_admin(p_catalogue_id, v_caller) then
    raise exception 'Not authorized';
  end if;

  select organisation_id
  into v_catalogue_organisation_id
  from catalogues
  where id = p_catalogue_id
    and not is_global;

  select organisation_id, status, is_current_published
  into v_course_organisation_id, v_course_status, v_is_current_published
  from course_catalogue
  where id = p_course_id
  for update;

  if v_catalogue_organisation_id is null
    or v_course_organisation_id is distinct from v_catalogue_organisation_id then
    raise exception 'Course and catalogue must belong to the same organisation';
  end if;

  if v_course_status not in ('draft', 'rejected', 'pending_approval', 'approved')
    or (v_course_status = 'approved' and not v_is_current_published) then
    raise exception 'This course version cannot be added to a catalogue';
  end if;

  insert into course_catalogue_publications (
    course_id,
    catalogue_id,
    selected_by,
    published_at
  )
  values (
    p_course_id,
    p_catalogue_id,
    v_caller,
    case when v_course_status = 'approved' then now() else null end
  )
  on conflict (course_id, catalogue_id) do nothing;

  if v_course_status in ('draft', 'rejected') then
    update course_catalogue
    set status = 'pending_approval', rejection_reason = null
    where id = p_course_id;
  end if;
end;
$$;

revoke all on function assign_course_to_catalogue(uuid, uuid) from public, anon, authenticated;
grant execute on function assign_course_to_catalogue(uuid, uuid) to authenticated;

-- Tighten catalogue assignment: only a current course version that has
-- already been approved and published to at least one catalogue may be
-- added from inside another catalogue.
create or replace function assign_course_to_catalogue(p_catalogue_id uuid, p_course_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
  v_catalogue_organisation_id uuid;
  v_course_organisation_id uuid;
  v_course_status text;
  v_is_current_published boolean;
begin
  if v_caller is null or not is_catalogue_admin(p_catalogue_id, v_caller) then
    raise exception 'Not authorized';
  end if;

  select organisation_id
  into v_catalogue_organisation_id
  from catalogues
  where id = p_catalogue_id
    and not is_global;

  select organisation_id, status, is_current_published
  into v_course_organisation_id, v_course_status, v_is_current_published
  from course_catalogue
  where id = p_course_id
  for update;

  if v_catalogue_organisation_id is null
    or v_course_organisation_id is distinct from v_catalogue_organisation_id then
    raise exception 'Course and catalogue must belong to the same organisation';
  end if;

  if v_course_status <> 'approved'
    or not v_is_current_published
    or not is_course_published_to_catalogue(p_course_id) then
    raise exception 'Only published courses can be added to a catalogue';
  end if;

  insert into course_catalogue_publications (
    course_id,
    catalogue_id,
    selected_by,
    published_at
  )
  values (p_course_id, p_catalogue_id, v_caller, now())
  on conflict (course_id, catalogue_id) do nothing;
end;
$$;

revoke all on function assign_course_to_catalogue(uuid, uuid) from public, anon, authenticated;
grant execute on function assign_course_to_catalogue(uuid, uuid) to authenticated;

-- A current approved course may receive its first catalogue destination;
-- it does not need to have a pre-existing publication row.
create or replace function assign_course_to_catalogue(p_catalogue_id uuid, p_course_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
  v_catalogue_organisation_id uuid;
  v_course_organisation_id uuid;
  v_course_status text;
  v_is_current_published boolean;
begin
  if v_caller is null or not is_catalogue_admin(p_catalogue_id, v_caller) then
    raise exception 'Not authorized';
  end if;

  select organisation_id
  into v_catalogue_organisation_id
  from catalogues
  where id = p_catalogue_id
    and not is_global;

  select organisation_id, status, is_current_published
  into v_course_organisation_id, v_course_status, v_is_current_published
  from course_catalogue
  where id = p_course_id
  for update;

  if v_catalogue_organisation_id is null
    or v_course_organisation_id is distinct from v_catalogue_organisation_id then
    raise exception 'Course and catalogue must belong to the same organisation';
  end if;

  if v_course_status <> 'approved' or not v_is_current_published then
    raise exception 'Only published courses can be added to a catalogue';
  end if;

  insert into course_catalogue_publications (
    course_id,
    catalogue_id,
    selected_by,
    published_at
  )
  values (p_course_id, p_catalogue_id, v_caller, now())
  on conflict (course_id, catalogue_id) do nothing;
end;
$$;

revoke all on function assign_course_to_catalogue(uuid, uuid) from public, anon, authenticated;
grant execute on function assign_course_to_catalogue(uuid, uuid) to authenticated;

-- Immutable resource version families. Existing rows remain live as
-- published v1, preserving every course and catalogue link.
alter table content_resources
  add column version_group_id uuid,
  add column version_number integer,
  add column status text,
  add column is_current_published boolean,
  add column published_at timestamptz,
  add column published_by uuid references auth.users(id) on delete set null;

update content_resources
set version_group_id = id,
    version_number = 1,
    status = 'published',
    is_current_published = true,
    published_at = created_at,
    published_by = created_by;

alter table content_resources
  alter column version_group_id set not null,
  alter column version_number set not null,
  alter column version_number set default 1,
  alter column status set not null,
  alter column status set default 'published',
  alter column is_current_published set not null,
  alter column is_current_published set default true,
  add constraint content_resources_version_number_positive check (version_number > 0),
  add constraint content_resources_status_check check (status in ('draft', 'published', 'inactive')),
  add constraint content_resources_version_group_version_key unique (version_group_id, version_number);

create unique index content_resources_one_current_published_idx
  on content_resources (version_group_id)
  where is_current_published;

create index content_resources_version_group_idx
  on content_resources (version_group_id, version_number desc);

create or replace function initialise_resource_version()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.version_group_id := coalesce(new.version_group_id, new.id);
  new.version_number := coalesce(new.version_number, 1);
  new.status := coalesce(new.status, 'published');
  new.is_current_published := coalesce(new.is_current_published, new.status = 'published');
  if new.status = 'published' then
    new.published_at := coalesce(new.published_at, now());
    new.published_by := coalesce(new.published_by, new.created_by);
  end if;
  return new;
end;
$$;

create trigger initialise_resource_version_trigger
  before insert on content_resources
  for each row execute procedure initialise_resource_version();

create or replace function create_resource_draft_version(p_resource_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_source public.content_resources%rowtype;
  v_new_id uuid := gen_random_uuid();
  v_next_version integer;
begin
  select * into v_source
  from public.content_resources
  where id = p_resource_id
  for update;

  if v_source.id is null
    or v_caller is null
    or not public.is_org_member(v_source.organisation_id, v_caller) then
    raise exception 'Not authorized';
  end if;

  if v_source.status <> 'published' or not v_source.is_current_published then
    raise exception 'Create a version from the current published resource';
  end if;

  if exists (
    select 1 from public.content_resources
    where version_group_id = v_source.version_group_id and status = 'draft'
  ) then
    raise exception 'This resource already has a draft version';
  end if;

  select coalesce(max(version_number), 0) + 1 into v_next_version
  from public.content_resources
  where version_group_id = v_source.version_group_id;

  insert into public.content_resources (
    id, organisation_id, type, title, storage_path, file_name, launch_path,
    external_url, video_edit, created_by, version_group_id, version_number,
    status, is_current_published, published_at, published_by
  ) values (
    v_new_id, v_source.organisation_id, v_source.type, v_source.title,
    v_source.storage_path, v_source.file_name, v_source.launch_path,
    v_source.external_url, v_source.video_edit, v_caller,
    v_source.version_group_id, v_next_version, 'draft', false, null, null
  );

  return v_new_id;
end;
$$;

create or replace function publish_resource_version(p_resource_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_resource public.content_resources%rowtype;
begin
  select * into v_resource
  from public.content_resources
  where id = p_resource_id
  for update;

  if v_resource.id is null
    or v_caller is null
    or not public.is_org_member(v_resource.organisation_id, v_caller) then
    raise exception 'Not authorized';
  end if;

  if v_resource.status <> 'draft' then
    raise exception 'Only a draft resource version can be published';
  end if;

  update public.content_resources
  set status = 'inactive', is_current_published = false, updated_at = now()
  where version_group_id = v_resource.version_group_id
    and is_current_published;

  update public.content_resources
  set status = 'published',
      is_current_published = true,
      published_at = now(),
      published_by = v_caller,
      updated_at = now()
  where id = p_resource_id;

  update public.catalogue_resources cr
  set resource_id = p_resource_id
  where cr.resource_id in (
    select id from public.content_resources
    where version_group_id = v_resource.version_group_id
      and id <> p_resource_id
  )
  and not exists (
    select 1 from public.catalogue_resources existing
    where existing.catalogue_id = cr.catalogue_id
      and existing.resource_id = p_resource_id
  );
end;
$$;

revoke all on function create_resource_draft_version(uuid) from public, anon, authenticated;
revoke all on function publish_resource_version(uuid) from public, anon, authenticated;
grant execute on function create_resource_draft_version(uuid) to authenticated;
grant execute on function publish_resource_version(uuid) to authenticated;

-- Resource rows are immutable once published. Direct client updates are
-- limited to drafts; the narrowly-scoped publish function performs the
-- controlled state transition.
drop policy "Org members manage their own organisation's resources" on content_resources;

create policy "Org members create resources for their organisation"
  on content_resources for insert to authenticated
  with check (
    is_platform_admin((select auth.uid()))
    or is_org_member(organisation_id, (select auth.uid()))
  );

create policy "Org members update draft resources"
  on content_resources for update to authenticated
  using (
    status = 'draft'
    and (
      is_platform_admin((select auth.uid()))
      or is_org_member(organisation_id, (select auth.uid()))
    )
  )
  with check (
    status = 'draft'
    and not is_current_published
    and (
      is_platform_admin((select auth.uid()))
      or is_org_member(organisation_id, (select auth.uid()))
    )
  );

create policy "Org members delete resources for their organisation"
  on content_resources for delete to authenticated
  using (
    is_platform_admin((select auth.uid()))
    or is_org_member(organisation_id, (select auth.uid()))
  );

-- Catalogue assignments accept only the current published version.
drop policy "Catalogue admins can assign resources" on catalogue_resources;
create policy "Catalogue admins can assign resources"
  on catalogue_resources for insert to authenticated
  with check (
    is_catalogue_admin(catalogue_resources.catalogue_id, (select auth.uid()))
    and catalogue_resources.created_by = (select auth.uid())
    and exists (
      select 1
      from catalogues c
      join content_resources cr on cr.organisation_id = c.organisation_id
      where c.id = catalogue_resources.catalogue_id
        and cr.id = catalogue_resources.resource_id
        and cr.status = 'published'
        and cr.is_current_published
    )
  );

-- Authored content pages are reusable organisation resources, attached to
-- courses through the existing course_content_links relationship. Their
-- versioned block document lives on the resource row; unlike uploaded media
-- there is no storage object or external URL to manage.
alter table content_resources drop constraint content_resources_type_check;
alter table content_resources add constraint content_resources_type_check
  check (type in ('video', 'screen_recording', 'file', 'scorm', 'xapi', 'external_video', 'web_url', 'page'));

alter table content_resources add column page_content jsonb;

alter table content_resources drop constraint content_resources_storage_or_external_check;
alter table content_resources add constraint content_resources_storage_or_external_check
  check (
    (type in ('external_video', 'web_url') and storage_path is null and external_url is not null and external_url ~ '^https?://' and page_content is null)
    or (type = 'page' and storage_path is null and external_url is null and page_content is not null)
    or (type not in ('external_video', 'web_url', 'page') and storage_path is not null and external_url is null and page_content is null)
  );

alter table content_resources add constraint content_resources_page_content_check
  check (
    page_content is null
    or (
      jsonb_typeof(page_content) = 'object'
      and page_content->>'version' = '1'
      and jsonb_typeof(page_content->'blocks') = 'array'
      and jsonb_array_length(page_content->'blocks') <= 100
    )
  );

-- Education entries can now also contain "project" children, not just
-- subjects (e.g. a dissertation or capstone project completed during a
-- degree), reusing the same "project" type already allowed under jobs and
-- volunteer positions rather than inventing a new concept.

create or replace function public.validate_experience_parent_type()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  parent_type text;
  parent_user_id uuid;
  parent_organization text;
  parent_organization_url text;
  parent_start_date date;
  parent_end_date date;
begin
  if new.parent_experience_id is null then
    if new.type = 'subject' then
      raise exception 'A subject must belong to an education experience';
    end if;

    if tg_op = 'UPDATE'
       and (new.start_date is distinct from old.start_date
            or new.end_date is distinct from old.end_date)
       and exists (
         select 1
         from public.experience child
         where child.parent_experience_id = new.id
           and (
             child.start_date < new.start_date
             or child.end_date < new.start_date
             or (new.end_date is not null and child.start_date > new.end_date)
             or (new.end_date is not null and child.end_date > new.end_date)
           )
       ) then
      raise exception 'Parent dates cannot exclude an existing sub-experience';
    end if;

    return new;
  end if;

  if new.parent_experience_id = new.id then
    raise exception 'An experience cannot be its own parent';
  end if;

  select type, user_id, organization, organization_url, start_date, end_date
    into parent_type, parent_user_id, parent_organization, parent_organization_url,
         parent_start_date, parent_end_date
  from public.experience
  where id = new.parent_experience_id;

  if not found then raise exception 'Parent experience not found'; end if;
  if parent_user_id <> new.user_id then raise exception 'Parent and child experiences must belong to the same user'; end if;
  if parent_type = 'education' and new.type not in ('subject', 'project') then raise exception 'Education experiences can only contain subjects or projects'; end if;
  if new.type = 'subject' and parent_type <> 'education' then raise exception 'Subjects can only belong to education experiences'; end if;
  if parent_type in ('employment', 'volunteer') and new.type not in ('project', 'course', 'other') then raise exception 'This experience type cannot be added to a job or volunteer position'; end if;
  if parent_type not in ('education', 'employment', 'volunteer') then raise exception 'This experience type cannot contain sub-experiences'; end if;

  if new.start_date < parent_start_date or new.end_date < parent_start_date then
    raise exception 'Sub-experience dates cannot be before the parent start date';
  end if;
  if parent_end_date is not null
     and (new.start_date > parent_end_date or new.end_date > parent_end_date) then
    raise exception 'Sub-experience dates cannot be after the parent end date';
  end if;
  if new.start_date is not null and new.end_date < new.start_date then
    raise exception 'Sub-experience end date cannot be before its start date';
  end if;

  if new.type = 'subject' then
    new.organization := parent_organization;
    new.organization_url := parent_organization_url;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_experience_parent_type() from public;

drop trigger validate_experience_parent_type_before_write on public.experience;
create trigger validate_experience_parent_type_before_write
before insert or update of type, parent_experience_id, user_id, organization,
  organization_url, start_date, end_date
on public.experience
for each row execute function public.validate_experience_parent_type();

-- External data source connections (OAuth), starting with Strava. This is
-- deliberately a different concept from "connections" (0058, learner-to-
-- learner social relationships) -- an external_connection links a learner
-- to their own account on a third-party service, not to another learner.
--
-- Tokens are held server-side only and never exposed to the client's own
-- Supabase session: RLS is enabled with zero policies granted to
-- authenticated/anon, so a plain client query returns nothing regardless of
-- ownership. The only two sanctioned access paths are (a) the service-role
-- client (supabaseAdmin(), used from api/strava/[...path].js -- same
-- pattern as api/xapi/[...path].js's launch-session lookups) for anything
-- touching the token columns, and (b) get_my_external_connections() below
-- for the one safe, non-secret read the client needs (status/last synced),
-- mirroring the existing is_connected()/upsert_connection() security-
-- definer precedent from 0058.
create table external_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  provider text not null check (provider in ('strava')),
  provider_account_id text not null,
  access_token text not null,
  refresh_token text not null,
  token_expires_at timestamptz not null,
  scope text,
  status text not null default 'active' check (status in ('active', 'error')),
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz,
  unique (user_id, provider)
);

alter table external_connections enable row level security;

create index external_connections_user_id_idx on external_connections (user_id);

create or replace function get_my_external_connections()
returns table (
  id uuid,
  provider text,
  provider_account_id text,
  status text,
  connected_at timestamptz,
  last_synced_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select id, provider, provider_account_id, status, connected_at, last_synced_at
  from external_connections
  where user_id = auth.uid()
$$;

revoke all on function get_my_external_connections() from public;
grant execute on function get_my_external_connections() to authenticated;

-- A skill created from reviewing synced activity (e.g. importing "Running"
-- the first time a Strava run is reviewed) is a new source distinct from
-- 'cv_import' -- generic across providers rather than 'strava_import', so a
-- future connector reuses this same value instead of widening the
-- constraint again.
alter table skills drop constraint skills_source_check;
alter table skills add constraint skills_source_check
  check (source in ('manual', 'cv_import', 'recommend', 'external_import'));

-- Provider-managed alignment between an offered skill and the organisation's
-- reusable resources. The resource remains the source record; removing an
-- alignment only removes this association.
create table content_resource_skills (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references content_resources(id) on delete cascade,
  skill_library_id uuid not null references skill_library(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (resource_id, skill_library_id)
);

create index content_resource_skills_resource_idx on content_resource_skills (resource_id);
create index content_resource_skills_skill_idx on content_resource_skills (skill_library_id);

alter table content_resource_skills enable row level security;

revoke all on table content_resource_skills from anon, authenticated;
grant select, insert, delete on table content_resource_skills to authenticated;

create policy "Org members and platform admins view resource skill alignments"
  on content_resource_skills for select
  to authenticated
  using (
    is_platform_admin((select auth.uid()))
    or exists (
      select 1
      from content_resources cr
      where cr.id = content_resource_skills.resource_id
        and is_org_member(cr.organisation_id, (select auth.uid()))
    )
  );

create policy "Org members align their resources to offered skills"
  on content_resource_skills for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1
      from content_resources cr
      join organisation_offered_skills oos
        on oos.organisation_id = cr.organisation_id
       and oos.skill_library_id = content_resource_skills.skill_library_id
      where cr.id = content_resource_skills.resource_id
        and is_org_member(cr.organisation_id, (select auth.uid()))
    )
  );

create policy "Org members remove their resource skill alignments"
  on content_resource_skills for delete
  to authenticated
  using (
    is_platform_admin((select auth.uid()))
    or exists (
      select 1
      from content_resources cr
      where cr.id = content_resource_skills.resource_id
        and is_org_member(cr.organisation_id, (select auth.uid()))
    )
  );

-- course_catalogue_skills is the existing source of truth for which skills a
-- course targets. Providers may manage those rows only for editable courses
-- owned by one of their organisations, and only for skills on that
-- organisation's offered-skills roster.
grant insert, update, delete on table course_catalogue_skills to authenticated;

create policy "Org members add offered skills to editable training"
  on course_catalogue_skills for insert
  to authenticated
  with check (
    exists (
      select 1
      from course_catalogue cc
      join organisation_offered_skills oos
        on oos.organisation_id = cc.organisation_id
       and oos.skill_library_id = course_catalogue_skills.skill_library_id
      where cc.id = course_catalogue_skills.course_catalogue_id
        and cc.status in ('draft', 'rejected')
        and is_org_member(cc.organisation_id, (select auth.uid()))
    )
  );

create policy "Org members update offered skills on editable training"
  on course_catalogue_skills for update
  to authenticated
  using (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_catalogue_skills.course_catalogue_id
        and cc.status in ('draft', 'rejected')
        and is_org_member(cc.organisation_id, (select auth.uid()))
    )
  )
  with check (
    exists (
      select 1
      from course_catalogue cc
      join organisation_offered_skills oos
        on oos.organisation_id = cc.organisation_id
       and oos.skill_library_id = course_catalogue_skills.skill_library_id
      where cc.id = course_catalogue_skills.course_catalogue_id
        and cc.status in ('draft', 'rejected')
        and is_org_member(cc.organisation_id, (select auth.uid()))
    )
  );

create policy "Org members remove skills from editable training"
  on course_catalogue_skills for delete
  to authenticated
  using (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_catalogue_skills.course_catalogue_id
        and cc.status in ('draft', 'rejected')
        and is_org_member(cc.organisation_id, (select auth.uid()))
    )
  );
