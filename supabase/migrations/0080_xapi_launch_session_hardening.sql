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
