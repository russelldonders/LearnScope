\set ON_ERROR_STOP on

begin;

select plan(13);

-- A set a push-ups goal (then raised its target, so two goals in a chain) on
-- Running by mistake; it belongs on Strength. B is someone else.
insert into auth.users (id, email, email_confirmed_at) values
  ('7b000000-0000-0000-0000-00000000000a', 'goal-a@example.com', now()),
  ('7b000000-0000-0000-0000-00000000000b', 'goal-b@example.com', now());

insert into public.skills (id, user_id, name, category, level) values
  ('7b000000-0000-0000-0000-0000000000a1', '7b000000-0000-0000-0000-00000000000a', 'Running', 'Test', 1),
  ('7b000000-0000-0000-0000-0000000000a2', '7b000000-0000-0000-0000-00000000000a', 'Strength', 'Test', 1),
  ('7b000000-0000-0000-0000-0000000000a3', '7b000000-0000-0000-0000-00000000000a', 'Cycling', 'Test', 1),
  ('7b000000-0000-0000-0000-0000000000b1', '7b000000-0000-0000-0000-00000000000b', 'Running', 'Test', 1);

insert into public.skill_goals (id, skill_id, title, metric, measure_kind, unit, direction, aggregation, period, target_value, started_on, tracker_question, status, closed_on) values
  ('7b000000-0000-0000-0000-000000000301', '7b000000-0000-0000-0000-0000000000a1', 'Push-ups', 'push_ups', 'count', 'reps', 'higher', 'total', 'week', 100, '2026-11-01', 'How many?', 'replaced', '2026-11-10');
insert into public.skill_goals (id, skill_id, title, metric, measure_kind, unit, direction, aggregation, period, target_value, started_on, tracker_question, replaces_goal_id) values
  ('7b000000-0000-0000-0000-000000000302', '7b000000-0000-0000-0000-0000000000a1', 'Push-ups', 'push_ups', 'count', 'reps', 'higher', 'total', 'week', 150, '2026-11-01', 'How many?', '7b000000-0000-0000-0000-000000000301'),
  -- A goal that counts activities, on Cycling.
  ('7b000000-0000-0000-0000-000000000303', '7b000000-0000-0000-0000-0000000000a3', 'Ride often', 'activity_count', 'activities', 'activities', 'higher', 'total', 'week', 3, '2026-11-01', 'Did you ride?', null);

-- Two push-up entries and an ordinary run, on Running.
insert into public.xapi_statements (id, user_id, skill_id, recorded_at, statement) values
  ('7b000000-0000-0000-0000-000000000401', '7b000000-0000-0000-0000-00000000000a', '7b000000-0000-0000-0000-0000000000a1', now(),
   '{"verb":{"id":"x"},"object":{"definition":{"name":{"en-US":"Push-ups"}}},"result":{"extensions":{"https://learnscope.app/xapi/extensions/measurement":[{"metric":"push_ups","kind":"count","value":40,"unit":"reps"}]}},"context":{"extensions":{"https://learnscope.app/xapi/extensions/skill":[{"id":"7b000000-0000-0000-0000-0000000000a1","name":"Running"}]}}}'),
  ('7b000000-0000-0000-0000-000000000402', '7b000000-0000-0000-0000-00000000000a', '7b000000-0000-0000-0000-0000000000a1', now(),
   '{"verb":{"id":"x"},"object":{"definition":{"name":{"en-US":"Push-ups"}}},"result":{"extensions":{"https://learnscope.app/xapi/extensions/measurement":[{"metric":"push_ups","kind":"count","value":35,"unit":"reps"}]}}}'),
  ('7b000000-0000-0000-0000-000000000403', '7b000000-0000-0000-0000-00000000000a', '7b000000-0000-0000-0000-0000000000a1', now(),
   '{"verb":{"id":"x"},"object":{"definition":{"name":{"en-US":"Morning run"}}}}');
insert into public.xapi_statement_skills (statement_id, skill_id, user_id) values
  ('7b000000-0000-0000-0000-000000000402', '7b000000-0000-0000-0000-0000000000a1', '7b000000-0000-0000-0000-00000000000a');

-- The local stack lacks Staging's default table grants.
grant all on table public.skill_goals, public.skills, public.xapi_statements, public.xapi_statement_skills to authenticated;

set local role authenticated;

-- B can't move A's goal, nor A move a goal onto B's skill.
select set_config('request.jwt.claim.sub', '7b000000-0000-0000-0000-00000000000b', true);
select throws_ok(
  $$select public.move_skill_goal('7b000000-0000-0000-0000-000000000302', '7b000000-0000-0000-0000-0000000000b1')$$,
  null, 'Goal not found', 'no one moves someone else''s goal'
);
select set_config('request.jwt.claim.sub', '7b000000-0000-0000-0000-00000000000a', true);
select throws_ok(
  $$select public.move_skill_goal('7b000000-0000-0000-0000-000000000302', '7b000000-0000-0000-0000-0000000000b1')$$,
  null, 'Choose one of your own skills', 'a goal only moves to one of the learner''s own skills'
);

select is(
  public.move_skill_goal('7b000000-0000-0000-0000-000000000302', '7b000000-0000-0000-0000-0000000000a2'),
  2,
  'moving the goal moves its two entries with it'
);
select is(
  (select array_agg(distinct skill_id::text) from public.skill_goals where id in ('7b000000-0000-0000-0000-000000000301', '7b000000-0000-0000-0000-000000000302')),
  array['7b000000-0000-0000-0000-0000000000a2'],
  'the goal it replaced moves too, so the chain stays on one skill'
);
select is(
  (select array_agg(skill_id::text order by id) from public.xapi_statements where id in ('7b000000-0000-0000-0000-000000000401', '7b000000-0000-0000-0000-000000000402')),
  array['7b000000-0000-0000-0000-0000000000a2', '7b000000-0000-0000-0000-0000000000a2'],
  'the entries logged for it are on the new skill'
);
select is(
  (select statement -> 'context' -> 'extensions' -> 'https://learnscope.app/xapi/extensions/skill' from public.xapi_statements where id = '7b000000-0000-0000-0000-000000000401'),
  '[{"id": "7b000000-0000-0000-0000-0000000000a2", "name": "Strength"}]'::jsonb,
  'and name it'
);
select is(
  (select array_agg(skill_id::text) from public.xapi_statement_skills where statement_id = '7b000000-0000-0000-0000-000000000402'),
  array['7b000000-0000-0000-0000-0000000000a2'],
  'their extra skill links follow'
);
select is(
  (select skill_id::text from public.xapi_statements where id = '7b000000-0000-0000-0000-000000000403'),
  '7b000000-0000-0000-0000-0000000000a1',
  'an activity that isn''t one of its entries stays where it is'
);
select is(
  (select statement -> 'result' from public.xapi_statements where id = '7b000000-0000-0000-0000-000000000402'),
  '{"extensions": {"https://learnscope.app/xapi/extensions/measurement": [{"kind": "count", "unit": "reps", "value": 35, "metric": "push_ups"}]}}'::jsonb,
  'what was logged is unchanged'
);

-- A goal that counts activities has no entries of its own: only it moves.
select is(
  public.move_skill_goal('7b000000-0000-0000-0000-000000000303', '7b000000-0000-0000-0000-0000000000a1'),
  0,
  'a goal counting activities moves on its own'
);

-- Moving to where it already is changes nothing.
select is(
  public.move_skill_goal('7b000000-0000-0000-0000-000000000302', '7b000000-0000-0000-0000-0000000000a2'),
  0,
  'moving a goal to its own skill does nothing'
);

-- Another goal left on the old skill measures the same thing: its entries
-- can't be told apart, so they stay.
reset role;
insert into public.skill_goals (id, skill_id, title, metric, measure_kind, unit, direction, aggregation, period, target_value, started_on, tracker_question) values
  ('7b000000-0000-0000-0000-000000000304', '7b000000-0000-0000-0000-0000000000a3', 'Squats', 'squats', 'count', 'reps', 'higher', 'total', 'week', 50, '2026-11-01', 'How many?'),
  ('7b000000-0000-0000-0000-000000000305', '7b000000-0000-0000-0000-0000000000a3', 'More squats', 'squats', 'count', 'reps', 'higher', 'total', 'week', 80, '2026-11-01', 'How many?');
insert into public.xapi_statements (id, user_id, skill_id, recorded_at, statement) values
  ('7b000000-0000-0000-0000-000000000404', '7b000000-0000-0000-0000-00000000000a', '7b000000-0000-0000-0000-0000000000a3', now(),
   '{"verb":{"id":"x"},"result":{"extensions":{"https://learnscope.app/xapi/extensions/measurement":[{"metric":"squats","kind":"count","value":20,"unit":"reps"}]}}}');
set local role authenticated;
select set_config('request.jwt.claim.sub', '7b000000-0000-0000-0000-00000000000a', true);
select is(public.move_skill_goal('7b000000-0000-0000-0000-000000000304', '7b000000-0000-0000-0000-0000000000a2'), 0, 'with another goal measuring the same thing, no entries move');
select is((select skill_id::text from public.xapi_statements where id = '7b000000-0000-0000-0000-000000000404'), '7b000000-0000-0000-0000-0000000000a3', 'and the entry stays on its skill');

select * from finish();
rollback;
