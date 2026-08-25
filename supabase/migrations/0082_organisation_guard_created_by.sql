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
