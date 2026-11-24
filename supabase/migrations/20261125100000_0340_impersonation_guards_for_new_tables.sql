-- The admin read-only user preview (impersonation) guards, on the tables
-- added since they were last applied everywhere: coaching (0335-0339) and
-- Google Meet attendance (20261121131433). Every application table blocks
-- writes during a preview (prevent_admin_impersonation_write) and stops
-- reads once a preview has expired (the restrictive "Active impersonation
-- sessions can read" policy), as supabase/tests/admin_impersonation.sql
-- checks. Same pattern as 0328.
--
-- Not destructive: adds a trigger and a policy to each table; no data
-- changes. Rollback: drop them.

create trigger prevent_admin_impersonation_write
  before insert or update or delete on public.coach_interests
  for each row execute function public.prevent_admin_impersonation_write();

create policy "Active impersonation sessions can read"
  on public.coach_interests as restrictive for select
  to authenticated
  using ((select public.admin_impersonation_session_can_read()));

create trigger prevent_admin_impersonation_write
  before insert or update or delete on public.coaching_relationships
  for each row execute function public.prevent_admin_impersonation_write();

create policy "Active impersonation sessions can read"
  on public.coaching_relationships as restrictive for select
  to authenticated
  using ((select public.admin_impersonation_session_can_read()));

create trigger prevent_admin_impersonation_write
  before insert or update or delete on public.coaching_sessions
  for each row execute function public.prevent_admin_impersonation_write();

create policy "Active impersonation sessions can read"
  on public.coaching_sessions as restrictive for select
  to authenticated
  using ((select public.admin_impersonation_session_can_read()));

create trigger prevent_admin_impersonation_write
  before insert or update or delete on public.coach_reviews
  for each row execute function public.prevent_admin_impersonation_write();

create policy "Active impersonation sessions can read"
  on public.coach_reviews as restrictive for select
  to authenticated
  using ((select public.admin_impersonation_session_can_read()));

create trigger prevent_admin_impersonation_write
  before insert or update or delete on public.coach_review_reports
  for each row execute function public.prevent_admin_impersonation_write();

create policy "Active impersonation sessions can read"
  on public.coach_review_reports as restrictive for select
  to authenticated
  using ((select public.admin_impersonation_session_can_read()));

create trigger prevent_admin_impersonation_write
  before insert or update or delete on public.coach_approvals
  for each row execute function public.prevent_admin_impersonation_write();

create policy "Active impersonation sessions can read"
  on public.coach_approvals as restrictive for select
  to authenticated
  using ((select public.admin_impersonation_session_can_read()));

create trigger prevent_admin_impersonation_write
  before insert or update or delete on public.course_session_google_meet
  for each row execute function public.prevent_admin_impersonation_write();

create policy "Active impersonation sessions can read"
  on public.course_session_google_meet as restrictive for select
  to authenticated
  using ((select public.admin_impersonation_session_can_read()));

create trigger prevent_admin_impersonation_write
  before insert or update or delete on public.google_meet_conferences
  for each row execute function public.prevent_admin_impersonation_write();

create policy "Active impersonation sessions can read"
  on public.google_meet_conferences as restrictive for select
  to authenticated
  using ((select public.admin_impersonation_session_can_read()));

create trigger prevent_admin_impersonation_write
  before insert or update or delete on public.google_meet_attendance_segments
  for each row execute function public.prevent_admin_impersonation_write();

create policy "Active impersonation sessions can read"
  on public.google_meet_attendance_segments as restrictive for select
  to authenticated
  using ((select public.admin_impersonation_session_can_read()));

create trigger prevent_admin_impersonation_write
  before insert or update or delete on public.course_session_attendance
  for each row execute function public.prevent_admin_impersonation_write();

create policy "Active impersonation sessions can read"
  on public.course_session_attendance as restrictive for select
  to authenticated
  using ((select public.admin_impersonation_session_can_read()));

create trigger prevent_admin_impersonation_write
  before insert or update or delete on public.course_session_launches
  for each row execute function public.prevent_admin_impersonation_write();

create policy "Active impersonation sessions can read"
  on public.course_session_launches as restrictive for select
  to authenticated
  using ((select public.admin_impersonation_session_can_read()));
