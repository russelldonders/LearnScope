\set ON_ERROR_STOP on

begin;

select plan(4);

-- a: a team manager   m: member of Org One with goals from two teams
-- o: not a member of Org One
insert into auth.users (id, email, email_confirmed_at) values
  ('84000000-0000-0000-0000-00000000000a', 'team-manager@example.com', now()),
  ('84000000-0000-0000-0000-00000000000b', 'team-member@example.com', now()),
  ('84000000-0000-0000-0000-00000000000c', 'team-outsider@example.com', now());

insert into public.organisations (id, name) values ('84000000-0000-0000-0000-000000000010', 'Org One');
insert into public.employer_members (employer_id, user_id, role, status) values
  ('84000000-0000-0000-0000-000000000010', '84000000-0000-0000-0000-00000000000b', 'member', 'active');

-- Org One's own workspace (made with the organisation, or here if not).
insert into public.workspaces (workspace_type, name, organisation_id)
select 'organisation', 'Org One', '84000000-0000-0000-0000-000000000010'
where not exists (select 1 from public.workspaces where organisation_id = '84000000-0000-0000-0000-000000000010');

-- A manager's own workspace, outside any organisation.
insert into public.workspaces (id, workspace_type, name, owner_person_id)
select '84000000-0000-0000-0000-0000000000e1', 'manager', 'Own team', paa.person_id
from public.person_auth_accounts paa
where paa.auth_user_id = '84000000-0000-0000-0000-00000000000a' and paa.account_type = 'personal' and paa.status = 'active';

insert into public.manager_teams (id, workspace_id, name, created_by) values
  ('84000000-0000-0000-0000-0000000000f1',
   (select id from public.workspaces where organisation_id = '84000000-0000-0000-0000-000000000010' limit 1),
   'Org One sales', '84000000-0000-0000-0000-00000000000a'),
  ('84000000-0000-0000-0000-0000000000f2', '84000000-0000-0000-0000-0000000000e1', 'Side project', '84000000-0000-0000-0000-00000000000a');

insert into public.skill_library (id, name, status) values ('84000000-0000-0000-0000-0000000000d1', 'Negotiation', 'active');

insert into public.manager_skill_targets (learner_id, context_type, team_id, context_name, skill_library_id, target_level, target_date) values
  ('84000000-0000-0000-0000-00000000000b', 'team', '84000000-0000-0000-0000-0000000000f1', 'Org One sales', '84000000-0000-0000-0000-0000000000d1', 3, '2027-01-01'),
  ('84000000-0000-0000-0000-00000000000b', 'team', '84000000-0000-0000-0000-0000000000f2', 'Side project', '84000000-0000-0000-0000-0000000000d1', 4, '2027-01-01');

select set_config('request.jwt.claim.sub', '84000000-0000-0000-0000-00000000000b', true);
set local role authenticated;
select is(
  array(select public.list_my_organisation_skill_teams('84000000-0000-0000-0000-000000000010')),
  array['84000000-0000-0000-0000-0000000000f1'::uuid],
  'a member gets only the organisation''s teams among those that set their own goals'
);
reset role;

-- Someone else in the same team, with no goals of their own from it, gets nothing.
select set_config('request.jwt.claim.sub', '84000000-0000-0000-0000-00000000000c', true);
set local role authenticated;
select is(
  array(select public.list_my_organisation_skill_teams('84000000-0000-0000-0000-000000000010')),
  array[]::uuid[],
  'a non-member gets nothing'
);
reset role;

insert into public.employer_members (employer_id, user_id, role, status) values
  ('84000000-0000-0000-0000-000000000010', '84000000-0000-0000-0000-00000000000c', 'member', 'active');
select set_config('request.jwt.claim.sub', '84000000-0000-0000-0000-00000000000c', true);
set local role authenticated;
select is(
  array(select public.list_my_organisation_skill_teams('84000000-0000-0000-0000-000000000010')),
  array[]::uuid[],
  'a member with no team goals of their own gets nothing'
);
reset role;

select is(
  (select count(*)::integer from pg_proc where proname = 'list_my_organisation_skill_teams' and prosecdef),
  1, 'it runs as definer, with its own checks'
);

select * from finish();
rollback;
