-- Guards against removing the platform's only remaining admin. 0065's RLS
-- on platform_admins only restricts *who* may delete a row (any platform
-- admin) -- it says nothing about how many would be left afterwards, so as
-- written a lone admin (or two admins deleting each other) could delete
-- every row and leave nobody able to reach the console at all, including
-- via a future "revoke platform admin" feature that doesn't exist yet, or
-- direct SQL. That's a job for a trigger, not RLS.
create or replace function prevent_last_platform_admin_removal()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if (select count(*) from platform_admins) <= 1 then
    raise exception 'Cannot remove the last remaining platform admin.';
  end if;
  return old;
end;
$$;

create trigger prevent_last_platform_admin_removal_trigger
  before delete on platform_admins
  for each row execute procedure prevent_last_platform_admin_removal();
