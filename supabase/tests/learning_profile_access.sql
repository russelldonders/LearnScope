-- Allow/deny proof for the additive learning-profile access helper added in
-- 20260904090000_learning_profile_access_helper.sql, applied to courses/
-- experience in 20260904110000_courses_experience_access_helper.sql, to
-- their dependent tables in
-- 20260904120000_skills_courses_experience_dependents_access_helper.sql, and
-- to connections in 20260904150000_connections_access_helper.sql, and to
-- manager_team_memberships in
-- 20260904160000_manager_team_memberships_access_helper.sql. Run against a
-- local database only; the script rolls back everything it does.
--
-- Proves the full scenario matrix for skills, courses, and experience, and
-- (since all eleven dependent tables share the exact same policy shape and
-- the same already-proven helper) spot-checks it against one representative
-- table per family instead of exhaustively fixturing all eleven: skill_targets
-- (skills family), course_experience_links (courses family), and
-- xapi_statements (xAPI family). connections has its own scenario matrix
-- further down, since it is two-party (user_a_id/user_b_id) rather than
-- single-owner and each side's linked account must be proven independent of
-- the other's.
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

insert into public.skill_targets (id, skill_id, user_id, target_level, target_date)
values ('40000000-0000-0000-0000-00000000dddd', '40000000-0000-0000-0000-00000000aaaa', '40000000-0000-0000-0000-000000000004', 5, '2027-01-01');

insert into public.course_experience_links (id, user_id, course_id, experience_id)
values ('40000000-0000-0000-0000-00000000eeee', '40000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-00000000bbbb', '40000000-0000-0000-0000-00000000cccc');

insert into public.xapi_statements (id, user_id, statement, recorded_at)
values ('40000000-0000-0000-0000-00000000ffff', '40000000-0000-0000-0000-000000000004', '{}'::jsonb, now());

create or replace function pg_temp.assert_owner_visibility(p_as_user uuid, p_expect_visible boolean, p_label text)
returns void
language plpgsql
as $$
declare
  v_sees_skill boolean;
  v_sees_course boolean;
  v_sees_experience boolean;
  v_sees_skill_target boolean;
  v_sees_course_experience_link boolean;
  v_sees_xapi_statement boolean;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', p_as_user::text, true);

  select exists (select 1 from public.skills where id = '40000000-0000-0000-0000-00000000aaaa') into v_sees_skill;
  select exists (select 1 from public.courses where id = '40000000-0000-0000-0000-00000000bbbb') into v_sees_course;
  select exists (select 1 from public.experience where id = '40000000-0000-0000-0000-00000000cccc') into v_sees_experience;
  select exists (select 1 from public.skill_targets where id = '40000000-0000-0000-0000-00000000dddd') into v_sees_skill_target;
  select exists (select 1 from public.course_experience_links where id = '40000000-0000-0000-0000-00000000eeee') into v_sees_course_experience_link;
  select exists (select 1 from public.xapi_statements where id = '40000000-0000-0000-0000-00000000ffff') into v_sees_xapi_statement;

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
  if v_sees_skill_target is distinct from p_expect_visible then
    raise exception '% : expected skill_target visibility=%, got %', p_label, p_expect_visible, v_sees_skill_target;
  end if;
  if v_sees_course_experience_link is distinct from p_expect_visible then
    raise exception '% : expected course_experience_link visibility=%, got %', p_label, p_expect_visible, v_sees_course_experience_link;
  end if;
  if v_sees_xapi_statement is distinct from p_expect_visible then
    raise exception '% : expected xapi_statement visibility=%, got %', p_label, p_expect_visible, v_sees_xapi_statement;
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

-- ----------------------------------------------------------------------------
-- connections (20260904150000_connections_access_helper.sql): two owning
-- parties per row, not one, so it needs its own scenario matrix proving each
-- side's linked account is evaluated independently.
-- ----------------------------------------------------------------------------

insert into auth.users (id, email, email_confirmed_at)
values
  ('70000000-0000-0000-0000-000000000007', 'owner-b@example.com', now()),
  ('80000000-0000-0000-0000-000000000008', 'linked-work-b@example.com', now());

insert into public.connections (id, user_a_id, user_b_id, source)
values (
  '40000000-0000-0000-0000-000000009999',
  least('40000000-0000-0000-0000-000000000004'::uuid, '70000000-0000-0000-0000-000000000007'::uuid),
  greatest('40000000-0000-0000-0000-000000000004'::uuid, '70000000-0000-0000-0000-000000000007'::uuid),
  'request'
);

create or replace function pg_temp.assert_sees_connection(p_as_user uuid, p_expect_visible boolean, p_label text)
returns void
language plpgsql
as $$
declare
  v_sees boolean;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', p_as_user::text, true);

  select exists (select 1 from public.connections where id = '40000000-0000-0000-0000-000000009999') into v_sees;

  reset role;

  if v_sees is distinct from p_expect_visible then
    raise exception '% : expected connection visibility=%, got %', p_label, p_expect_visible, v_sees;
  end if;
end
$$;

-- 1. Both owning parties' own logins see the connection (unchanged).
select pg_temp.assert_sees_connection('40000000-0000-0000-0000-000000000004', true, 'connection: owner a login');
select pg_temp.assert_sees_connection('70000000-0000-0000-0000-000000000007', true, 'connection: owner b login');

-- 2. Unrelated login is denied.
select pg_temp.assert_sees_connection('60000000-0000-0000-0000-000000000006', false, 'connection: unrelated login');

-- 3. Account 50000000...05 is linked to owner a (40000000...04) but, at this
--    point in the file, its verified_account_link was revoked in scenario 6
--    above (its workspace_access grant is active, but the link is not) --
--    so it is denied.
select pg_temp.assert_sees_connection('50000000-0000-0000-0000-000000000005', false, 'connection: link-a login before link reactivated');

-- 4. Reactivating that link makes owner a's side resolve true, which alone
--    is enough to see the connection.
update public.verified_account_links
set status = 'active', revoked_at = null
where least(auth_account_a_id, auth_account_b_id) = least('40000000-0000-0000-0000-000000000004'::uuid, '50000000-0000-0000-0000-000000000005'::uuid)
  and greatest(auth_account_a_id, auth_account_b_id) = greatest('40000000-0000-0000-0000-000000000004'::uuid, '50000000-0000-0000-0000-000000000005'::uuid);

select pg_temp.assert_sees_connection('50000000-0000-0000-0000-000000000005', true, 'connection: link-a login with link and grant active');

-- 5. A link+grant on owner b's side is evaluated independently: before it
--    exists, owner b's linked account is denied even though owner a's side
--    already grants visibility to a *different* account.
insert into public.verified_account_links (auth_account_a_id, auth_account_b_id)
values (
  least('70000000-0000-0000-0000-000000000007'::uuid, '80000000-0000-0000-0000-000000000008'::uuid),
  greatest('70000000-0000-0000-0000-000000000007'::uuid, '80000000-0000-0000-0000-000000000008'::uuid)
);

select pg_temp.assert_sees_connection('80000000-0000-0000-0000-000000000008', false, 'connection: link-b login before workspace_access grant');

insert into public.workspace_access (workspace_id, auth_account_id, access_role)
values ('70000000-0000-0000-0000-000000000007', '80000000-0000-0000-0000-000000000008', 'owner');

select pg_temp.assert_sees_connection('80000000-0000-0000-0000-000000000008', true, 'connection: link-b login with link and grant active');

-- 6. Revoking owner b's link denies that side again without affecting owner
--    a's side, which is still active from step 4.
update public.verified_account_links
set status = 'revoked', revoked_at = now()
where least(auth_account_a_id, auth_account_b_id) = least('70000000-0000-0000-0000-000000000007'::uuid, '80000000-0000-0000-0000-000000000008'::uuid)
  and greatest(auth_account_a_id, auth_account_b_id) = greatest('70000000-0000-0000-0000-000000000007'::uuid, '80000000-0000-0000-0000-000000000008'::uuid);

select pg_temp.assert_sees_connection('80000000-0000-0000-0000-000000000008', false, 'connection: link-b login after link revoked');
select pg_temp.assert_sees_connection('50000000-0000-0000-0000-000000000005', true, 'connection: link-a login unaffected by link-b revoke');

-- 7. Unrelated login remains denied throughout.
select pg_temp.assert_sees_connection('60000000-0000-0000-0000-000000000006', false, 'connection: unrelated login (end of scenario)');

-- ----------------------------------------------------------------------------
-- manager_team_memberships (20260904160000_manager_team_memberships_access_
-- helper.sql): member_user_id identifies which learner a row is about, not
-- an owner column, but the shape of what's being proven is the same as
-- connections' single-side case -- a linked account should see exactly what
-- the member's own login could already see, nothing about a manager's own
-- can_manage_manager_team visibility changes here.
-- ----------------------------------------------------------------------------

insert into auth.users (id, email, email_confirmed_at)
values ('b0000000-0000-0000-0000-00000000000b', 'manager@example.com', now());

insert into public.workspaces (id, workspace_type, name, owner_person_id)
select 'b0000000-0000-0000-0000-0000000000b1', 'manager', 'Test Manager Workspace', paa.person_id
from public.person_auth_accounts paa
where paa.auth_user_id = 'b0000000-0000-0000-0000-00000000000b'
  and paa.account_type = 'personal' and paa.status = 'active';

insert into public.manager_teams (id, workspace_id, name, created_by)
values ('b0000000-0000-0000-0000-0000000000b2', 'b0000000-0000-0000-0000-0000000000b1', 'Test Team', 'b0000000-0000-0000-0000-00000000000b');

-- Owner a (40000000...04, the learner) is the team member. Its linked
-- account (50000000...05) already has an active link and an active
-- workspace_access grant carried over from the connections scenario above.
insert into public.manager_team_memberships (id, team_id, member_user_id, role, status, invited_by, decided_at)
values (
  'b0000000-0000-0000-0000-0000000000b3',
  'b0000000-0000-0000-0000-0000000000b2',
  '40000000-0000-0000-0000-000000000004',
  'member', 'active', 'b0000000-0000-0000-0000-00000000000b', now()
);

create or replace function pg_temp.assert_sees_membership(p_as_user uuid, p_expect_visible boolean, p_label text)
returns void
language plpgsql
as $$
declare
  v_sees boolean;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', p_as_user::text, true);

  select exists (select 1 from public.manager_team_memberships where id = 'b0000000-0000-0000-0000-0000000000b3') into v_sees;

  reset role;

  if v_sees is distinct from p_expect_visible then
    raise exception '% : expected membership visibility=%, got %', p_label, p_expect_visible, v_sees;
  end if;
end
$$;

-- 1. The member's own login is unaffected (already true via the pre-existing
--    "member_user_id = auth.uid()" clause; proves the new policy doesn't
--    change or duplicate-break that).
select pg_temp.assert_sees_membership('40000000-0000-0000-0000-000000000004', true, 'membership: member login');

-- 2. A genuinely unrelated login (no team role, no link to the member) is
--    denied.
select pg_temp.assert_sees_membership('60000000-0000-0000-0000-000000000006', false, 'membership: unrelated login');

-- 3. The member's linked account (already carrying an active link and grant
--    from the connections scenario above) can see the membership row.
select pg_temp.assert_sees_membership('50000000-0000-0000-0000-000000000005', true, 'membership: linked login with active link and grant');

-- 4. Revoking the workspace_access grant denies the linked login again --
--    proves visibility is actually gated by the helper, not a static true.
update public.workspace_access
set status = 'revoked', revoked_at = now()
where workspace_id = '40000000-0000-0000-0000-000000000004'
  and auth_account_id = '50000000-0000-0000-0000-000000000005';

select pg_temp.assert_sees_membership('50000000-0000-0000-0000-000000000005', false, 'membership: linked login after workspace_access revoked');

rollback;
