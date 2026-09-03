-- Restore the authenticated read privileges required by the learner Actions
-- surface. Row visibility remains constrained by each table's existing RLS
-- policies; these grants only allow PostgreSQL to reach those policies.

grant select on table
  public.connection_requests,
  public.skill_validation_requests,
  public.organisation_members,
  public.organisations,
  public.employer_members,
  public.employers,
  public.employer_data_access_requests,
  public.course_assignments,
  public.course_catalogue,
  public.employer_skill_suggestions,
  public.profiles,
  public.skills
to authenticated;
