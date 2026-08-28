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
