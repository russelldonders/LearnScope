-- Deactivating a provider organisation (organisations.status = 'inactive')
-- previously had no effect on its staff's actual access -- is_org_admin/
-- is_org_member never checked status, so a "deactivated" org's own admins
-- and trainers could still manage staff and submit training exactly as
-- before. Now that the provider console (built on top of these functions)
-- gives that access real consequence, tie it to status: the
-- organisation_members-based branch now also requires the organisation to
-- be active. The is_platform_admin(...) fallback is left unconditional on
-- both functions, so platform admins retain full access to inactive orgs
-- (e.g. to reactivate one, or inspect it while deciding whether to).

create or replace function is_org_admin(org_id uuid, check_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from organisation_members
    join organisations on organisations.id = organisation_members.organisation_id
    where organisation_members.organisation_id = org_id
      and organisation_members.user_id = check_user_id
      and organisation_members.role = 'admin'
      and organisations.status = 'active'
  ) or is_platform_admin(check_user_id)
$$;

create or replace function is_org_member(org_id uuid, check_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from organisation_members
    join organisations on organisations.id = organisation_members.organisation_id
    where organisation_members.organisation_id = org_id
      and organisation_members.user_id = check_user_id
      and organisations.status = 'active'
  ) or is_platform_admin(check_user_id)
$$;
