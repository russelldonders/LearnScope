-- Allow/deny proof for prevent_employer_admin_provider_removal
-- (20260905110000_employer_admin_provider_access_permanent.sql). Run against
-- a local database only; the script rolls back everything it does.
--
-- Proves:
--   1. Removing the organisation_members admin row derived from an active
--      employer_members admin role fails with a clear error.
--   2. The row is unaffected by the failed attempt.
--   3. Once the employer_members admin role itself is removed first (the
--      correct path), the same organisation_members row can be freely
--      removed.
--   4. An organisation_members row with no corresponding employer_members
--      admin role at all (an ordinary, independently-added provider staff
--      member) is unaffected by this trigger.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email, email_confirmed_at)
values
  ('80000000-0000-0000-0000-000000000001', 'employer-admin@example.com', now()),
  ('80000000-0000-0000-0000-000000000002', 'ordinary-staff@example.com', now());

insert into organisations (id, name)
values ('80000000-0000-0000-0000-00000000aaaa', 'Acme Corp');

insert into employers (id, name, provider_organisation_id)
values ('80000000-0000-0000-0000-00000000bbbb', 'Acme Corp', '80000000-0000-0000-0000-00000000aaaa');

insert into employer_members (employer_id, user_id, role, status)
values ('80000000-0000-0000-0000-00000000bbbb', '80000000-0000-0000-0000-000000000001', 'admin', 'active');

insert into organisation_members (organisation_id, user_id, role, status)
values
  ('80000000-0000-0000-0000-00000000aaaa', '80000000-0000-0000-0000-000000000001', 'admin', 'active'),
  ('80000000-0000-0000-0000-00000000aaaa', '80000000-0000-0000-0000-000000000002', 'admin', 'active');

-- 1 & 2. Cannot remove the employer-admin-derived provider membership.
do $$
begin
  delete from organisation_members
  where organisation_id = '80000000-0000-0000-0000-00000000aaaa'
    and user_id = '80000000-0000-0000-0000-000000000001';
  raise exception 'removing the employer-admin-derived provider membership unexpectedly succeeded';
exception
  when others then
    if sqlerrm not like '%automatic while they are an admin of the linked employer%' then raise; end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from organisation_members
    where organisation_id = '80000000-0000-0000-0000-00000000aaaa'
      and user_id = '80000000-0000-0000-0000-000000000001'
  ) then
    raise exception 'the protected row was removed despite the failed delete attempt';
  end if;
end
$$;

-- 4. An ordinary provider staff member (no employer_members admin row at
--    all) is unaffected by the trigger.
delete from organisation_members
where organisation_id = '80000000-0000-0000-0000-00000000aaaa'
  and user_id = '80000000-0000-0000-0000-000000000002';

do $$
begin
  if exists (
    select 1 from organisation_members
    where organisation_id = '80000000-0000-0000-0000-00000000aaaa'
      and user_id = '80000000-0000-0000-0000-000000000002'
  ) then
    raise exception 'an ordinary provider staff member could not be removed -- trigger is too broad';
  end if;
end
$$;

-- 3. Removing the employer-admin role first, then the provider membership
--    becomes freely removable.
delete from employer_members
where user_id = '80000000-0000-0000-0000-000000000001'
  and employer_id = '80000000-0000-0000-0000-00000000bbbb';

delete from organisation_members
where organisation_id = '80000000-0000-0000-0000-00000000aaaa'
  and user_id = '80000000-0000-0000-0000-000000000001';

do $$
begin
  if exists (
    select 1 from organisation_members
    where organisation_id = '80000000-0000-0000-0000-00000000aaaa'
      and user_id = '80000000-0000-0000-0000-000000000001'
  ) then
    raise exception 'the provider membership could not be removed after the employer-admin role was properly removed first';
  end if;
end
$$;

rollback;
