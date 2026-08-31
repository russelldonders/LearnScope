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
