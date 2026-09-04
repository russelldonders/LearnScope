-- Allow/deny proof for the additive learning-profile access helper added in
-- 20260904090000_learning_profile_access_helper.sql, applied to courses/
-- experience in 20260904110000_courses_experience_access_helper.sql, to
-- their dependent tables in
-- 20260904120000_skills_courses_experience_dependents_access_helper.sql, and
-- to connections in 20260904150000_connections_access_helper.sql, to
-- manager_team_memberships in
-- 20260904160000_manager_team_memberships_access_helper.sql, to its
-- dependents in 20260904170000_manager_team_dependents_access_helper.sql,
-- to connection_requests/connection_invites in
-- 20260904180000_connection_requests_invites_access_helper.sql, and to
-- employer_data_access_requests/employer_data_access_shared_skills/
-- employer_skill_suggestions/course_assignments in
-- 20260904190000_employer_sharing_access_helper.sql, and to
-- skill_peer_ratings/skill_validation_requests in
-- 20260904200000_peer_ratings_validation_requests_access_helper.sql, and to
-- profile_searchable_skills/profile_share_links/profile_share_link_skills
-- in 20260904210000_searchable_and_share_link_skills_access_helper.sql. Run
-- against a local database only; the script rolls back everything it does.
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

-- ----------------------------------------------------------------------------
-- manager_team_memberships' dependents
-- (20260904170000_manager_team_dependents_access_helper.sql): reuses the
-- team/membership fixture above. All three tables share the same
-- member_user_id-via-membership_id shape, so one representative row per
-- table is enough -- same proportionate-coverage rationale already used for
-- skills' own dependent tables.
-- ----------------------------------------------------------------------------

insert into public.manager_team_shared_skills (membership_id, skill_id)
values ('b0000000-0000-0000-0000-0000000000b3', '40000000-0000-0000-0000-00000000aaaa');

insert into public.manager_team_learning_activities (id, team_id, title, created_by)
values ('b0000000-0000-0000-0000-0000000000b4', 'b0000000-0000-0000-0000-0000000000b2', 'Test Activity', 'b0000000-0000-0000-0000-00000000000b');

insert into public.manager_team_activity_participants (activity_id, membership_id)
values ('b0000000-0000-0000-0000-0000000000b4', 'b0000000-0000-0000-0000-0000000000b3');

create or replace function pg_temp.assert_sees_team_dependents(p_as_user uuid, p_expect_visible boolean, p_label text)
returns void
language plpgsql
as $$
declare
  v_sees_shared_skill boolean;
  v_sees_activity boolean;
  v_sees_participant boolean;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', p_as_user::text, true);

  select exists (select 1 from public.manager_team_shared_skills where membership_id = 'b0000000-0000-0000-0000-0000000000b3' and skill_id = '40000000-0000-0000-0000-00000000aaaa') into v_sees_shared_skill;
  select exists (select 1 from public.manager_team_learning_activities where id = 'b0000000-0000-0000-0000-0000000000b4') into v_sees_activity;
  select exists (select 1 from public.manager_team_activity_participants where activity_id = 'b0000000-0000-0000-0000-0000000000b4' and membership_id = 'b0000000-0000-0000-0000-0000000000b3') into v_sees_participant;

  reset role;

  if v_sees_shared_skill is distinct from p_expect_visible then
    raise exception '% : expected shared-skill visibility=%, got %', p_label, p_expect_visible, v_sees_shared_skill;
  end if;
  if v_sees_activity is distinct from p_expect_visible then
    raise exception '% : expected activity visibility=%, got %', p_label, p_expect_visible, v_sees_activity;
  end if;
  if v_sees_participant is distinct from p_expect_visible then
    raise exception '% : expected participant visibility=%, got %', p_label, p_expect_visible, v_sees_participant;
  end if;
end
$$;

-- 1. The member's own login is unaffected.
select pg_temp.assert_sees_team_dependents('40000000-0000-0000-0000-000000000004', true, 'team dependents: member login');

-- 2. Unrelated login is denied.
select pg_temp.assert_sees_team_dependents('60000000-0000-0000-0000-000000000006', false, 'team dependents: unrelated login');

-- 3. Linked login, workspace_access still revoked from the membership
--    scenario above, is denied.
select pg_temp.assert_sees_team_dependents('50000000-0000-0000-0000-000000000005', false, 'team dependents: linked login before grant reactivated');

-- 4. Reactivating the grant restores visibility through all three tables.
update public.workspace_access
set status = 'active', revoked_at = null
where workspace_id = '40000000-0000-0000-0000-000000000004'
  and auth_account_id = '50000000-0000-0000-0000-000000000005';

select pg_temp.assert_sees_team_dependents('50000000-0000-0000-0000-000000000005', true, 'team dependents: linked login with grant reactivated');

-- ----------------------------------------------------------------------------
-- connection_requests and connection_invites
-- (20260904180000_connection_requests_invites_access_helper.sql). Reuses
-- owner a (...004) and its already-active linked account (...005) from
-- above. connection_requests is two-party (already exhaustively proven
-- independent-per-side on connections itself, so this is a proportionate
-- one-side spot check); connection_invites is single-owner, same shape as
-- skills/courses/experience.
-- ----------------------------------------------------------------------------

insert into auth.users (id, email, email_confirmed_at)
values ('c0000000-0000-0000-0000-00000000000c', 'unrelated-2@example.com', now());

insert into public.connection_requests (id, requester_id, recipient_id, status)
values ('40000000-0000-0000-0000-00000000cccd', '40000000-0000-0000-0000-000000000004', '60000000-0000-0000-0000-000000000006', 'pending');

insert into public.connection_invites (id, inviter_id, skill_id)
values ('40000000-0000-0000-0000-00000000ccce', '40000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-00000000aaaa');

create or replace function pg_temp.assert_sees_request_and_invite(p_as_user uuid, p_expect_visible boolean, p_label text)
returns void
language plpgsql
as $$
declare
  v_sees_request boolean;
  v_sees_invite boolean;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', p_as_user::text, true);

  select exists (select 1 from public.connection_requests where id = '40000000-0000-0000-0000-00000000cccd') into v_sees_request;
  select exists (select 1 from public.connection_invites where id = '40000000-0000-0000-0000-00000000ccce') into v_sees_invite;

  reset role;

  if v_sees_request is distinct from p_expect_visible then
    raise exception '% : expected connection_request visibility=%, got %', p_label, p_expect_visible, v_sees_request;
  end if;
  if v_sees_invite is distinct from p_expect_visible then
    raise exception '% : expected connection_invite visibility=%, got %', p_label, p_expect_visible, v_sees_invite;
  end if;
end
$$;

-- 1. The requester/inviter's own login is unaffected.
select pg_temp.assert_sees_request_and_invite('40000000-0000-0000-0000-000000000004', true, 'request/invite: owner login');

-- 2. A genuinely unrelated login (not the requester, recipient, or inviter)
--    is denied.
select pg_temp.assert_sees_request_and_invite('c0000000-0000-0000-0000-00000000000c', false, 'request/invite: unrelated login');

-- 3. The requester/inviter's linked account (already active from the
--    connections scenario above) can see both.
select pg_temp.assert_sees_request_and_invite('50000000-0000-0000-0000-000000000005', true, 'request/invite: linked login with active link and grant');

-- 4. The recipient's own login sees the connection_request (unchanged,
--    already covered by the pre-existing policy) -- connection_invites has
--    no recipient/accepter column to check symmetrically, so this checks
--    connection_requests alone rather than reusing the combined assertion.
create or replace function pg_temp.assert_sees_connection_request(p_as_user uuid, p_expect_visible boolean, p_label text)
returns void
language plpgsql
as $$
declare
  v_sees boolean;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', p_as_user::text, true);

  select exists (select 1 from public.connection_requests where id = '40000000-0000-0000-0000-00000000cccd') into v_sees;

  reset role;

  if v_sees is distinct from p_expect_visible then
    raise exception '% : expected connection_request visibility=%, got %', p_label, p_expect_visible, v_sees;
  end if;
end
$$;

select pg_temp.assert_sees_connection_request('60000000-0000-0000-0000-000000000006', true, 'request: recipient login');

-- ----------------------------------------------------------------------------
-- employer sharing: employer_data_access_requests, employer_data_access_
-- shared_skills, employer_skill_suggestions, course_assignments
-- (20260904190000_employer_sharing_access_helper.sql). Reuses owner a
-- (...004) and its already-active linked account (...005).
-- ----------------------------------------------------------------------------

insert into public.organisations (id, name, type)
values ('d0000000-0000-0000-0000-00000000000d', 'Test Provider Org', 'provider');

insert into public.employers (id, name, provider_organisation_id)
values ('d0000000-0000-0000-0000-0000000000d1', 'Test Employer', 'd0000000-0000-0000-0000-00000000000d');

insert into public.employer_data_access_requests (id, employer_id, learner_id, status)
values ('d0000000-0000-0000-0000-0000000000d2', 'd0000000-0000-0000-0000-0000000000d1', '40000000-0000-0000-0000-000000000004', 'approved');

insert into public.employer_data_access_shared_skills (request_id, skill_id)
values ('d0000000-0000-0000-0000-0000000000d2', '40000000-0000-0000-0000-00000000aaaa');

insert into public.skill_library (id, name)
values ('d0000000-0000-0000-0000-0000000000d3', 'Test Library Skill');

insert into public.employer_skill_suggestions (id, employer_id, learner_id, skill_library_id, skill_name)
values ('d0000000-0000-0000-0000-0000000000d4', 'd0000000-0000-0000-0000-0000000000d1', '40000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-0000000000d3', 'Test Library Skill');

insert into public.course_catalogue (id, name, version_group_id)
values ('d0000000-0000-0000-0000-0000000000d5', 'Test Catalogue Course', 'd0000000-0000-0000-0000-0000000000d5');

insert into public.course_assignments (id, employer_id, catalogue_course_id, assigned_to, assigned_by)
values ('d0000000-0000-0000-0000-0000000000d6', 'd0000000-0000-0000-0000-0000000000d1', 'd0000000-0000-0000-0000-0000000000d5', '40000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000004');

create or replace function pg_temp.assert_sees_employer_sharing(p_as_user uuid, p_expect_visible boolean, p_label text)
returns void
language plpgsql
as $$
declare
  v_sees_request boolean;
  v_sees_shared_skill boolean;
  v_sees_suggestion boolean;
  v_sees_assignment boolean;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', p_as_user::text, true);

  select exists (select 1 from public.employer_data_access_requests where id = 'd0000000-0000-0000-0000-0000000000d2') into v_sees_request;
  select exists (select 1 from public.employer_data_access_shared_skills where request_id = 'd0000000-0000-0000-0000-0000000000d2') into v_sees_shared_skill;
  select exists (select 1 from public.employer_skill_suggestions where id = 'd0000000-0000-0000-0000-0000000000d4') into v_sees_suggestion;
  select exists (select 1 from public.course_assignments where id = 'd0000000-0000-0000-0000-0000000000d6') into v_sees_assignment;

  reset role;

  if v_sees_request is distinct from p_expect_visible then
    raise exception '% : expected data-access-request visibility=%, got %', p_label, p_expect_visible, v_sees_request;
  end if;
  if v_sees_shared_skill is distinct from p_expect_visible then
    raise exception '% : expected shared-skill visibility=%, got %', p_label, p_expect_visible, v_sees_shared_skill;
  end if;
  if v_sees_suggestion is distinct from p_expect_visible then
    raise exception '% : expected suggestion visibility=%, got %', p_label, p_expect_visible, v_sees_suggestion;
  end if;
  if v_sees_assignment is distinct from p_expect_visible then
    raise exception '% : expected course-assignment visibility=%, got %', p_label, p_expect_visible, v_sees_assignment;
  end if;
end
$$;

-- 1. The learner's own login is unaffected.
select pg_temp.assert_sees_employer_sharing('40000000-0000-0000-0000-000000000004', true, 'employer sharing: learner login');

-- 2. Unrelated login is denied.
select pg_temp.assert_sees_employer_sharing('c0000000-0000-0000-0000-00000000000c', false, 'employer sharing: unrelated login');

-- 3. Linked account (already active) sees all four.
select pg_temp.assert_sees_employer_sharing('50000000-0000-0000-0000-000000000005', true, 'employer sharing: linked login with active link and grant');

-- 4. Revoking the workspace_access grant denies the linked login again.
update public.workspace_access
set status = 'revoked', revoked_at = now()
where workspace_id = '40000000-0000-0000-0000-000000000004'
  and auth_account_id = '50000000-0000-0000-0000-000000000005';

select pg_temp.assert_sees_employer_sharing('50000000-0000-0000-0000-000000000005', false, 'employer sharing: linked login after workspace_access revoked');

-- ----------------------------------------------------------------------------
-- skill_peer_ratings and skill_validation_requests
-- (20260904200000_peer_ratings_validation_requests_access_helper.sql).
-- Reuses owner a (...004) and its linked account (...005), currently
-- revoked from the employer-sharing scenario above -- reactivated first.
-- ----------------------------------------------------------------------------

update public.workspace_access
set status = 'active', revoked_at = null
where workspace_id = '40000000-0000-0000-0000-000000000004'
  and auth_account_id = '50000000-0000-0000-0000-000000000005';

insert into auth.users (id, email, email_confirmed_at)
values ('e0000000-0000-0000-0000-00000000000e', 'validator@example.com', now());

insert into public.skill_peer_ratings (id, skill_id, skill_name, skill_category, skill_owner_id, rater_id, level)
values ('e0000000-0000-0000-0000-0000000000e1', '40000000-0000-0000-0000-00000000aaaa', 'SQL', 'Technical', '40000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-00000000000e', 4);

insert into public.skill_validation_requests (id, skill_id, requester_id, validator_id, target_level)
values ('e0000000-0000-0000-0000-0000000000e2', '40000000-0000-0000-0000-00000000aaaa', '40000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-00000000000e', 4);

create or replace function pg_temp.assert_sees_ratings_and_validation(p_as_user uuid, p_expect_visible boolean, p_label text)
returns void
language plpgsql
as $$
declare
  v_sees_rating boolean;
  v_sees_validation boolean;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', p_as_user::text, true);

  select exists (select 1 from public.skill_peer_ratings where id = 'e0000000-0000-0000-0000-0000000000e1') into v_sees_rating;
  select exists (select 1 from public.skill_validation_requests where id = 'e0000000-0000-0000-0000-0000000000e2') into v_sees_validation;

  reset role;

  if v_sees_rating is distinct from p_expect_visible then
    raise exception '% : expected peer-rating visibility=%, got %', p_label, p_expect_visible, v_sees_rating;
  end if;
  if v_sees_validation is distinct from p_expect_visible then
    raise exception '% : expected validation-request visibility=%, got %', p_label, p_expect_visible, v_sees_validation;
  end if;
end
$$;

-- 1. The skill owner/requester's own login is unaffected.
select pg_temp.assert_sees_ratings_and_validation('40000000-0000-0000-0000-000000000004', true, 'ratings/validation: owner login');

-- 2. Unrelated login is denied.
select pg_temp.assert_sees_ratings_and_validation('60000000-0000-0000-0000-000000000006', false, 'ratings/validation: unrelated login');

-- 3. Linked account (reactivated above) sees both.
select pg_temp.assert_sees_ratings_and_validation('50000000-0000-0000-0000-000000000005', true, 'ratings/validation: linked login with active link and grant');

-- 4. Revoking the workspace_access grant denies the linked login again.
update public.workspace_access
set status = 'revoked', revoked_at = now()
where workspace_id = '40000000-0000-0000-0000-000000000004'
  and auth_account_id = '50000000-0000-0000-0000-000000000005';

select pg_temp.assert_sees_ratings_and_validation('50000000-0000-0000-0000-000000000005', false, 'ratings/validation: linked login after workspace_access revoked');

-- ----------------------------------------------------------------------------
-- profile_searchable_skills, profile_share_links, and profile_share_link_
-- skills (20260904210000_searchable_and_share_link_skills_access_helper.sql).
-- Reuses owner a (...004) and its linked account (...005), reactivating the
-- grant revoked above.
-- ----------------------------------------------------------------------------

update public.workspace_access
set status = 'active', revoked_at = null
where workspace_id = '40000000-0000-0000-0000-000000000004'
  and auth_account_id = '50000000-0000-0000-0000-000000000005';

insert into public.profile_searchable_skills (profile_id, skill_id)
values ('40000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-00000000aaaa');

insert into public.profile_share_links (id, user_id, expires_at)
values ('f0000000-0000-0000-0000-0000000000f1', '40000000-0000-0000-0000-000000000004', now() + interval '7 days');

insert into public.profile_share_link_skills (share_link_id, skill_id)
values ('f0000000-0000-0000-0000-0000000000f1', '40000000-0000-0000-0000-00000000aaaa');

create or replace function pg_temp.assert_sees_searchable_and_share_links(p_as_user uuid, p_expect_visible boolean, p_label text)
returns void
language plpgsql
as $$
declare
  v_sees_searchable boolean;
  v_sees_share_link boolean;
  v_sees_share_link_skill boolean;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', p_as_user::text, true);

  select exists (select 1 from public.profile_searchable_skills where profile_id = '40000000-0000-0000-0000-000000000004' and skill_id = '40000000-0000-0000-0000-00000000aaaa') into v_sees_searchable;
  select exists (select 1 from public.profile_share_links where id = 'f0000000-0000-0000-0000-0000000000f1') into v_sees_share_link;
  select exists (select 1 from public.profile_share_link_skills where share_link_id = 'f0000000-0000-0000-0000-0000000000f1') into v_sees_share_link_skill;

  reset role;

  if v_sees_searchable is distinct from p_expect_visible then
    raise exception '% : expected searchable-skill visibility=%, got %', p_label, p_expect_visible, v_sees_searchable;
  end if;
  if v_sees_share_link is distinct from p_expect_visible then
    raise exception '% : expected share-link visibility=%, got %', p_label, p_expect_visible, v_sees_share_link;
  end if;
  if v_sees_share_link_skill is distinct from p_expect_visible then
    raise exception '% : expected share-link-skill visibility=%, got %', p_label, p_expect_visible, v_sees_share_link_skill;
  end if;
end
$$;

-- 1. The learner's own login is unaffected.
select pg_temp.assert_sees_searchable_and_share_links('40000000-0000-0000-0000-000000000004', true, 'searchable/share links: owner login');

-- 2. Unrelated login is denied.
select pg_temp.assert_sees_searchable_and_share_links('60000000-0000-0000-0000-000000000006', false, 'searchable/share links: unrelated login');

-- 3. Linked account (reactivated above) sees all three.
select pg_temp.assert_sees_searchable_and_share_links('50000000-0000-0000-0000-000000000005', true, 'searchable/share links: linked login with active link and grant');

-- 4. Revoking the workspace_access grant denies the linked login again.
update public.workspace_access
set status = 'revoked', revoked_at = now()
where workspace_id = '40000000-0000-0000-0000-000000000004'
  and auth_account_id = '50000000-0000-0000-0000-000000000005';

select pg_temp.assert_sees_searchable_and_share_links('50000000-0000-0000-0000-000000000005', false, 'searchable/share links: linked login after workspace_access revoked');

rollback;
