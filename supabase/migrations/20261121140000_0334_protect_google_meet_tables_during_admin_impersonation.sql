-- The Google Meet attendance tables (20261121131433_google_meet_attendance)
-- were created after the read-only impersonation feature (0305), so they need
-- the same permanent write guard and active-session read boundary as every
-- other application table. The admin_impersonation pgTAP contract enforces
-- this.

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
