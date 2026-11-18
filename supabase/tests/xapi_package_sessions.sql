\set ON_ERROR_STOP on

begin;

select plan(12);

-- A owns an xAPI package on their skill and shares it with B, a connection.
insert into auth.users (id, email, email_confirmed_at) values
  ('7a000000-0000-0000-0000-00000000000a', 'sess-a@example.com', now()),
  ('7a000000-0000-0000-0000-00000000000b', 'sess-b@example.com', now());

insert into public.skill_library (id, name, status)
values ('7a000000-0000-0000-0000-000000000100', 'Package sessions', 'active');

insert into public.skills (id, user_id, name, category, level, library_skill_id) values
  ('7a000000-0000-0000-0000-0000000000a1', '7a000000-0000-0000-0000-00000000000a', 'Package sessions', 'Test', 1, '7a000000-0000-0000-0000-000000000100'),
  ('7a000000-0000-0000-0000-0000000000b1', '7a000000-0000-0000-0000-00000000000b', 'Package sessions', 'Test', 1, '7a000000-0000-0000-0000-000000000100');

insert into public.connections (user_a_id, user_b_id, source) values
  (least('7a000000-0000-0000-0000-00000000000a'::uuid, '7a000000-0000-0000-0000-00000000000b'::uuid),
   greatest('7a000000-0000-0000-0000-00000000000a'::uuid, '7a000000-0000-0000-0000-00000000000b'::uuid), 'request');

insert into public.skill_resources (id, user_id, skill_id, kind, title, package_path, launch_path, audience) values
  ('7a000000-0000-0000-0000-000000000201', '7a000000-0000-0000-0000-00000000000a', '7a000000-0000-0000-0000-0000000000a1',
   'xapi', 'Fire drill', 'learners/7a000000-0000-0000-0000-00000000000a/7a000000-0000-0000-0000-000000000201', 'story.html', 'connections');

-- The local stack lacks Staging's default table grants.
grant all on table public.skill_resources, public.skill_resource_recipients, public.skills, public.connections,
  public.profiles, public.xapi_launch_sessions, public.xapi_statements to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', '7a000000-0000-0000-0000-00000000000a', true);

-- A caller can't pick the registration or the activity's id.
insert into public.xapi_launch_sessions (id, skill_resource_id, user_id, skill_id, registration, summary_statement_id) values
  ('7a000000-0000-0000-0000-000000000301', '7a000000-0000-0000-0000-000000000201', '7a000000-0000-0000-0000-00000000000a',
   '7a000000-0000-0000-0000-0000000000a1', '7a000000-0000-0000-0000-0000000009aa', '7a000000-0000-0000-0000-0000000009bb');
select ok(
  (select registration <> '7a000000-0000-0000-0000-0000000009aa' and summary_statement_id <> '7a000000-0000-0000-0000-0000000009bb'
   from public.xapi_launch_sessions where id = '7a000000-0000-0000-0000-000000000301'),
  'the database sets a launch''s registration and activity id, not the caller'
);

insert into public.xapi_launch_sessions (id, skill_resource_id, user_id, skill_id) values
  ('7a000000-0000-0000-0000-000000000302', '7a000000-0000-0000-0000-000000000201', '7a000000-0000-0000-0000-00000000000a', '7a000000-0000-0000-0000-0000000000a1');
select is(
  (select count(distinct registration) from public.xapi_launch_sessions where user_id = '7a000000-0000-0000-0000-00000000000a'),
  1::bigint,
  'launching the same package again keeps its registration, so it can resume'
);
select is(
  (select count(distinct summary_statement_id) from public.xapi_launch_sessions where user_id = '7a000000-0000-0000-0000-00000000000a'),
  2::bigint,
  'but each launch is its own session, with its own activity'
);

select throws_ok(
  $$insert into public.xapi_launch_sessions (skill_resource_id, user_id, skill_id)
    values ('7a000000-0000-0000-0000-000000000201', '7a000000-0000-0000-0000-00000000000a', '7a000000-0000-0000-0000-0000000000b1')$$,
  '42501', null, 'a session can only be an activity on the launcher''s own skill'
);

-- B launches the shared package from their own skill: their own registration.
select set_config('request.jwt.claim.sub', '7a000000-0000-0000-0000-00000000000b', true);
insert into public.xapi_launch_sessions (id, skill_resource_id, user_id, skill_id) values
  ('7a000000-0000-0000-0000-000000000303', '7a000000-0000-0000-0000-000000000201', '7a000000-0000-0000-0000-00000000000b', '7a000000-0000-0000-0000-0000000000b1');
select pass('someone a package is shared with launches it from their own skill');

-- State: written by the LRS only; each learner sees and clears their own.
reset role;
select is(
  (select count(*) from public.xapi_launch_sessions
   where registration = (select registration from public.xapi_launch_sessions where id = '7a000000-0000-0000-0000-000000000303')),
  1::bigint,
  'each learner has their own registration for a package'
);

-- A deleted session activity is remembered, so the LRS doesn't write it
-- again; deleting anything else changes nothing.
insert into public.xapi_statements (id, user_id, launch_session_id, statement, recorded_at)
select summary_statement_id, user_id, id, '{"verb":{"id":"http://adlnet.gov/expapi/verbs/experienced"}}'::jsonb, now()
from public.xapi_launch_sessions where id in ('7a000000-0000-0000-0000-000000000301', '7a000000-0000-0000-0000-000000000302');
insert into public.xapi_statements (id, user_id, skill_resource_id, launch_session_id, statement, recorded_at) values
  ('7a000000-0000-0000-0000-000000000401', '7a000000-0000-0000-0000-00000000000a', '7a000000-0000-0000-0000-000000000201',
   '7a000000-0000-0000-0000-000000000302', '{"verb":{"id":"http://adlnet.gov/expapi/verbs/initialized"}}'::jsonb, now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '7a000000-0000-0000-0000-00000000000a', true);
delete from public.xapi_statements
where id = (select summary_statement_id from public.xapi_launch_sessions where id = '7a000000-0000-0000-0000-000000000301');
delete from public.xapi_statements where id = '7a000000-0000-0000-0000-000000000401';
reset role;
select is(
  (select summary_dismissed from public.xapi_launch_sessions where id = '7a000000-0000-0000-0000-000000000301'),
  true,
  'deleting a session''s activity marks that session so it isn''t written again'
);
select is(
  (select summary_dismissed from public.xapi_launch_sessions where id = '7a000000-0000-0000-0000-000000000302'),
  false,
  'deleting one of a package''s own statements doesn''t'
);

insert into public.xapi_activity_state (user_id, skill_resource_id, activity_id, registration, state_id, document) values
  ('7a000000-0000-0000-0000-00000000000a', '7a000000-0000-0000-0000-000000000201', 'https://example.com/a', null, 'bookmark', 'slide-4'),
  ('7a000000-0000-0000-0000-00000000000b', '7a000000-0000-0000-0000-000000000201', 'https://example.com/a', null, 'bookmark', 'slide-9');

select throws_ok(
  $$insert into public.xapi_activity_state (user_id, skill_resource_id, activity_id, registration, state_id, document)
    values ('7a000000-0000-0000-0000-00000000000a', '7a000000-0000-0000-0000-000000000201', 'https://example.com/a', null, 'bookmark', 'again')$$,
  '23505', null, 'one document per learner, package, activity, registration and state id'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '7a000000-0000-0000-0000-00000000000a', true);
select is(
  (select array_agg(document) from public.xapi_activity_state),
  array['slide-4'],
  'a learner sees only their own saved state'
);

select throws_ok(
  $$insert into public.xapi_activity_state (user_id, skill_resource_id, activity_id, state_id, document)
    values ('7a000000-0000-0000-0000-00000000000a', '7a000000-0000-0000-0000-000000000201', 'https://example.com/b', 'x', 'y')$$,
  '42501', null, 'a learner can''t write state directly'
);

delete from public.xapi_activity_state;
reset role;
select is(
  (select array_agg(document) from public.xapi_activity_state),
  array['slide-9'],
  'a learner clears their own saved state, and only theirs'
);

select * from finish();
rollback;
