-- prevent_last_platform_admin_removal (0067) reads `count(*) from
-- platform_admins` with no locking before deciding whether to allow the
-- delete. Two concurrent deletes targeting different admins (e.g. two of
-- exactly two remaining admins deleting each other, or an admin hard-
-- deleting another admin's account via api/admin/actions.js's deleteUser
-- while a second such delete runs at the same time) can each read the
-- pre-deletion count and both pass the check before either commits,
-- cascading platform_admins to zero rows and leaving no one who can reach
-- /admin. `for update` takes a row lock on every matching row for the
-- duration of the transaction, so the second trigger invocation blocks
-- until the first transaction commits (and re-reads a now-lower count) or
-- rolls back, making the check safe under concurrent deletes.
-- Postgres doesn't allow FOR UPDATE directly on an aggregate query (count(*)
-- FOR UPDATE is a syntax error), so the lock and the count are two
-- statements: the first blocks until it can lock every current row (waiting
-- out any concurrent trigger evaluation), the second then counts under a
-- fresh snapshot that reflects whatever the transaction we waited on did.
create or replace function prevent_last_platform_admin_removal()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  perform 1 from platform_admins for update;
  if (select count(*) from platform_admins) <= 1 then
    raise exception 'Cannot remove the last remaining platform admin.';
  end if;
  return old;
end;
$$;
