-- 20260927212035 dropped organisations.type, but two BEFORE UPDATE triggers
-- on organisations still read new.type/old.type. PL/pgSQL resolves record
-- fields at run time, so every UPDATE to an organisation (logo upload,
-- settings save, platform-admin edits) has since failed with
-- `record "new" has no field "type"`. Redefine both without the column,
-- keeping every other guard unchanged. Capabilities (organisation_capabilities)
-- now describe what an organisation is, and they are a separate table with
-- their own access rules, so neither guard needs a replacement check here.

create or replace function prevent_org_identity_change_by_non_admin()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if (new.name is distinct from old.name
      or new.status is distinct from old.status
      or new.created_by is distinct from old.created_by)
     and auth.uid() is not null
     and not is_platform_admin(auth.uid()) then
    raise exception 'name, status, and created_by can only be changed by a platform admin';
  end if;
  return new;
end;
$$;

create or replace function public.protect_system_provider()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'DELETE' and old.is_system then
    raise exception 'The system provider cannot be deleted';
  end if;

  if tg_op = 'UPDATE' and old.is_system and (
    not new.is_system
    or new.org_code is distinct from old.org_code
    or new.status <> 'active'
  ) then
    raise exception 'The system provider identity and active status cannot be changed';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
