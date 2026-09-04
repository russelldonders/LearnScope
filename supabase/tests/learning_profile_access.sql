-- Allow/deny proof for the additive learning-profile access helper added in
-- 20260904090000_learning_profile_access_helper.sql and applied to courses/
-- experience in 20260904110000_courses_experience_access_helper.sql. Run
-- against a local database only; the script rolls back everything it does.
--
-- Proves, for each converted domain root table (skills, courses, experience):
--   1. The profile owner's own personal login is unaffected.
--   2. A truly unrelated login is denied throughout.
--   3. A verified account link alone (no workspace_access grant) grants
--      nothing.
--   4. An active verified account link *and* an active workspace_access
--      grant together allow the linked login to view the record.
--   5. Revoking only the workspace_access grant denies access again.
--   6. Revoking only the verified account link (grant left active) also
--      denies access -- defense in depth, both facts must hold at once.
--
-- profiles is intentionally not exercised here: it already carries a
-- pre-existing, unrelated "Authenticated users can view profile names"
-- policy with `using (true)`, so it has no ownership-scoped visibility to
-- prove or deny.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email, email_confirmed_at)
values
  ('40000000-0000-0000-0000-000000000004', 'owner@example.com', now()),
  ('50000000-0000-0000-0000-000000000005', 'linked-work@example.com', now()),
  ('60000000-0000-0000-0000-000000000006', 'unrelated@example.com', now());

-- The on_auth_user_created / bootstrap_personal_context triggers give each of
-- these three fresh accounts its own person, personal learning_profile and
-- personal workspace, all reusing the same uuid as auth.users.id.

insert into public.skills (id, user_id, name, category, level)
values ('40000000-0000-0000-0000-00000000aaaa', '40000000-0000-0000-0000-000000000004', 'SQL', 'Technical', 3);

insert into public.courses (id, user_id, name)
values ('40000000-0000-0000-0000-00000000bbbb', '40000000-0000-0000-0000-000000000004', 'Advanced SQL');

insert into public.experience (id, user_id, type, title, organization, start_date)
values ('40000000-0000-0000-0000-00000000cccc', '40000000-0000-0000-0000-000000000004', 'employment', 'Engineer', 'Acme', '2020-01-01');

create or replace function pg_temp.assert_owner_visibility(p_as_user uuid, p_expect_visible boolean, p_label text)
returns void
language plpgsql
as $$
declare
  v_sees_skill boolean;
  v_sees_course boolean;
  v_sees_experience boolean;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', p_as_user::text, true);

  select exists (select 1 from public.skills where id = '40000000-0000-0000-0000-00000000aaaa') into v_sees_skill;
  select exists (select 1 from public.courses where id = '40000000-0000-0000-0000-00000000bbbb') into v_sees_course;
  select exists (select 1 from public.experience where id = '40000000-0000-0000-0000-00000000cccc') into v_sees_experience;

  reset role;

  if v_sees_skill is distinct from p_expect_visible then
    raise exception '% : expected skill visibility=%, got %', p_label, p_expect_visible, v_sees_skill;
  end if;
  if v_sees_course is distinct from p_expect_visible then
    raise exception '% : expected course visibility=%, got %', p_label, p_expect_visible, v_sees_course;
  end if;
  if v_sees_experience is distinct from p_expect_visible then
    raise exception '% : expected experience visibility=%, got %', p_label, p_expect_visible, v_sees_experience;
  end if;
end
$$;

-- 1. Owner's own personal login sees their own skill/course/experience
--    (unchanged).
select pg_temp.assert_owner_visibility('40000000-0000-0000-0000-000000000004', true, 'owner login');

-- 2. Unrelated login, no link and no grant, is denied.
select pg_temp.assert_owner_visibility('60000000-0000-0000-0000-000000000006', false, 'unrelated login (before any grant)');

-- 3. Linked-but-not-yet-granted work login is denied: a verified account
--    link alone never grants workspace access.
select pg_temp.assert_owner_visibility('50000000-0000-0000-0000-000000000005', false, 'linked login before any workspace_access grant');

-- Seed what a future explicit "grant controlled cross-account access" flow
-- would produce. No production RPC exists yet for this grant -- building one
-- is out of scope until this ownership/RLS phase is complete.
insert into public.verified_account_links (auth_account_a_id, auth_account_b_id)
values (
  least('40000000-0000-0000-0000-000000000004'::uuid, '50000000-0000-0000-0000-000000000005'::uuid),
  greatest('40000000-0000-0000-0000-000000000004'::uuid, '50000000-0000-0000-0000-000000000005'::uuid)
);

insert into public.workspace_access (workspace_id, auth_account_id, access_role)
values ('40000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-000000000005', 'owner');

-- 4. Both facts active: the linked work login can now view the profile/skill.
select pg_temp.assert_owner_visibility('50000000-0000-0000-0000-000000000005', true, 'linked login with active link and active grant');

-- 5. Revoking only the workspace_access grant denies access again.
update public.workspace_access
set status = 'revoked', revoked_at = now()
where workspace_id = '40000000-0000-0000-0000-000000000004'
  and auth_account_id = '50000000-0000-0000-0000-000000000005';

select pg_temp.assert_owner_visibility('50000000-0000-0000-0000-000000000005', false, 'linked login after workspace_access revoked');

-- 6. Re-grant workspace_access, then revoke only the verified account link:
--    still denied (both facts must hold at once).
update public.workspace_access
set status = 'active', revoked_at = null
where workspace_id = '40000000-0000-0000-0000-000000000004'
  and auth_account_id = '50000000-0000-0000-0000-000000000005';

update public.verified_account_links
set status = 'revoked', revoked_at = now()
where least(auth_account_a_id, auth_account_b_id) = least('40000000-0000-0000-0000-000000000004'::uuid, '50000000-0000-0000-0000-000000000005'::uuid)
  and greatest(auth_account_a_id, auth_account_b_id) = greatest('40000000-0000-0000-0000-000000000004'::uuid, '50000000-0000-0000-0000-000000000005'::uuid);

select pg_temp.assert_owner_visibility('50000000-0000-0000-0000-000000000005', false, 'linked login after verified account link revoked');

-- 7. Unrelated login remains denied throughout.
select pg_temp.assert_owner_visibility('60000000-0000-0000-0000-000000000006', false, 'unrelated login (end of scenario)');

rollback;
