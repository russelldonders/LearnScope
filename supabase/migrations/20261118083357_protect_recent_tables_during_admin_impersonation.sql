-- Tables created after the read-only impersonation feature need the same
-- permanent write guard and active-session read boundary as the existing
-- application tables. The admin_impersonation pgTAP contract detects future
-- omissions of either protection.

create trigger prevent_admin_impersonation_write
  before insert or update or delete on public.notification_dismissals
  for each row execute function public.prevent_admin_impersonation_write();

create policy "Active impersonation sessions can read"
  on public.notification_dismissals as restrictive for select
  to authenticated
  using ((select public.admin_impersonation_session_can_read()));

create trigger prevent_admin_impersonation_write
  before insert or update or delete on public.learner_plan_prerequisite_groups
  for each row execute function public.prevent_admin_impersonation_write();

create policy "Active impersonation sessions can read"
  on public.learner_plan_prerequisite_groups as restrictive for select
  to authenticated
  using ((select public.admin_impersonation_session_can_read()));

create trigger prevent_admin_impersonation_write
  before insert or update or delete on public.learner_plan_prerequisites
  for each row execute function public.prevent_admin_impersonation_write();

create policy "Active impersonation sessions can read"
  on public.learner_plan_prerequisites as restrictive for select
  to authenticated
  using ((select public.admin_impersonation_session_can_read()));
