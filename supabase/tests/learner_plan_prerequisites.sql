\set ON_ERROR_STOP on

begin;

select plan(18);

-- Staging's public tables carry Supabase's default grants to authenticated;
-- a local reset doesn't, so mirror them here (rolled back at the end).
grant all on all tables in schema public to authenticated;

-- A created the plan; B follows it; D is not on it.
insert into auth.users (id, email, email_confirmed_at) values
  ('85000000-0000-0000-0000-00000000000a', 'prereq-a@example.com', now()),
  ('85000000-0000-0000-0000-00000000000b', 'prereq-b@example.com', now()),
  ('85000000-0000-0000-0000-00000000000d', 'prereq-d@example.com', now());

insert into public.skill_library (id, name) values
  ('85000000-0000-0000-0000-0000000000f1', 'Prerequisite test: Facilitation');

-- One catalogue course in two versions; v2 is the current one.
insert into public.course_catalogue (id, name, organisation_id, status, is_current_published, version_group_id, version_number)
select fixture.id, 'Prerequisite test: Safety basics', organisation.id, 'approved', fixture.current,
  '85000000-0000-0000-0000-0000000000c1'::uuid, fixture.version
from (
  values
    ('85000000-0000-0000-0000-0000000000c1'::uuid, false, 1),
    ('85000000-0000-0000-0000-0000000000c2'::uuid, true, 2)
) fixture(id, current, version)
cross join lateral (select id from public.organisations where is_system limit 1) organisation;
insert into public.course_catalogue_publications (course_id, catalogue_id, published_at)
select '85000000-0000-0000-0000-0000000000c2', id, now() from public.catalogues where is_global limit 1;

insert into public.learner_plans (id, user_id, title, status) values
  ('85000000-0000-0000-0000-000000000100', '85000000-0000-0000-0000-00000000000a', 'Lead workshops', 'active'),
  ('85000000-0000-0000-0000-000000000200', '85000000-0000-0000-0000-00000000000a', 'Another plan', 'active');
insert into public.learner_plan_members (plan_id, user_id, role) values
  ('85000000-0000-0000-0000-000000000100', '85000000-0000-0000-0000-00000000000b', 'follower');
insert into public.learner_plan_items (id, plan_id, position, item_type, step_title) values
  ('85000000-0000-0000-0000-000000000121', '85000000-0000-0000-0000-000000000100', 0, 'step', 'Run a practice session');

select is(
  (select sequence from public.learner_plans where id = '85000000-0000-0000-0000-000000000100'),
  'none',
  'a plan is in any order unless its owner says otherwise'
);

-- The owner sets the plan up.
select set_config('request.jwt.claim.sub', '85000000-0000-0000-0000-00000000000a', true);
set local role authenticated;

update public.learner_plans set sequence = 'sections' where id = '85000000-0000-0000-0000-000000000100';
select is(
  (select sequence from public.learner_plans where id = '85000000-0000-0000-0000-000000000100'),
  'sections',
  'an owner can put a plan in order'
);
select throws_ok(
  $$update public.learner_plans set sequence = 'random' where id = '85000000-0000-0000-0000-000000000100'$$,
  '23514', null,
  'only the known orders are allowed'
);
update public.learner_plans set duration_amount = 6, duration_unit = 'months', target_on = null
  where id = '85000000-0000-0000-0000-000000000100';
select throws_ok(
  $$update public.learner_plans set target_on = current_date + 30 where id = '85000000-0000-0000-0000-000000000100'$$,
  '23514', null,
  'a plan has a fixed end date or a period from each person''s start, not both'
);
select throws_ok(
  $$update public.learner_plans set duration_unit = null where id = '85000000-0000-0000-0000-000000000100'$$,
  '23514', null,
  'a period needs both an amount and a unit'
);

insert into public.learner_plan_prerequisite_groups (id, plan_id, position, enforcement) values
  ('85000000-0000-0000-0000-000000000301', '85000000-0000-0000-0000-000000000100', 0, 'required'),
  ('85000000-0000-0000-0000-000000000302', '85000000-0000-0000-0000-000000000100', 1, 'guidance'),
  ('85000000-0000-0000-0000-000000000303', '85000000-0000-0000-0000-000000000200', 0, 'guidance');
-- Required: Facilitation at Capable (3) OR the safety course.
insert into public.learner_plan_prerequisites (plan_id, group_id, kind, library_skill_id, min_practical_level) values
  ('85000000-0000-0000-0000-000000000100', '85000000-0000-0000-0000-000000000301', 'skill', '85000000-0000-0000-0000-0000000000f1', 3);
insert into public.learner_plan_prerequisites (plan_id, group_id, kind, catalogue_course_id) values
  ('85000000-0000-0000-0000-000000000100', '85000000-0000-0000-0000-000000000301', 'course', '85000000-0000-0000-0000-0000000000c2');
-- Guidance: Facilitation knowledge at Familiar (3).
insert into public.learner_plan_prerequisites (plan_id, group_id, kind, library_skill_id, min_knowledge_level) values
  ('85000000-0000-0000-0000-000000000100', '85000000-0000-0000-0000-000000000302', 'skill', '85000000-0000-0000-0000-0000000000f1', 3);

select throws_ok(
  $$insert into public.learner_plan_prerequisites (plan_id, group_id, kind, catalogue_course_id)
    values ('85000000-0000-0000-0000-000000000100', '85000000-0000-0000-0000-000000000303', 'course', '85000000-0000-0000-0000-0000000000c2')$$,
  '23514', null,
  'an option can only go in a group on the same plan'
);
select throws_ok(
  $$insert into public.learner_plan_prerequisites (plan_id, group_id, kind, library_skill_id)
    values ('85000000-0000-0000-0000-000000000100', '85000000-0000-0000-0000-000000000302', 'skill', '85000000-0000-0000-0000-0000000000f1')$$,
  '23514', null,
  'a skill prerequisite needs a level'
);

-- The follower
select set_config('request.jwt.claim.sub', '85000000-0000-0000-0000-00000000000b', true);

select is(
  (select count(*)::int from public.learner_plan_prerequisites),
  3,
  'a follower sees the plan''s prerequisites'
);
select throws_ok(
  $$insert into public.learner_plan_prerequisite_groups (plan_id) values ('85000000-0000-0000-0000-000000000100')$$,
  '42501', null,
  'a follower can''t add prerequisites'
);
update public.learner_plan_prerequisite_groups set enforcement = 'guidance' where id = '85000000-0000-0000-0000-000000000301';
update public.learner_plans set sequence = 'none' where id = '85000000-0000-0000-0000-000000000100';
reset role;
select is(
  (select enforcement from public.learner_plan_prerequisite_groups where id = '85000000-0000-0000-0000-000000000301')
    || '/' || (select sequence from public.learner_plans where id = '85000000-0000-0000-0000-000000000100'),
  'required/sections',
  'a follower can''t change prerequisites or the order'
);
set local role authenticated;

select results_eq(
  $$select (g ->> 'enforcement'), (o ->> 'name'), (o ->> 'met')::boolean
    from jsonb_array_elements(public.get_learner_plan_prerequisites('85000000-0000-0000-0000-000000000100')) g,
         jsonb_array_elements(g -> 'options') o
    order by (g ->> 'position')::int, o ->> 'kind' desc$$,
  $$values
    ('required'::text, 'Prerequisite test: Facilitation'::text, false),
    ('required'::text, 'Prerequisite test: Safety basics'::text, false),
    ('guidance'::text, 'Prerequisite test: Facilitation'::text, false)$$,
  'nothing is met yet, from the follower''s own records'
);
select throws_ok(
  $$insert into public.learner_plan_item_progress (item_id, user_id, completed_on)
    values ('85000000-0000-0000-0000-000000000121', '85000000-0000-0000-0000-00000000000b', current_date)$$,
  '23514', null,
  'nothing can be ticked off before the required prerequisites are met'
);

-- A skill from that library entry, but below the level asked for.
reset role;
insert into public.skills (id, user_id, name, category, level, knowledge_level, library_skill_id) values
  ('85000000-0000-0000-0000-0000000000b1', '85000000-0000-0000-0000-00000000000b', 'Facilitation', 'Test', 2, 4, '85000000-0000-0000-0000-0000000000f1');
set local role authenticated;
select results_eq(
  $$select (o ->> 'met')::boolean
    from jsonb_array_elements(public.get_learner_plan_prerequisites('85000000-0000-0000-0000-000000000100')) g,
         jsonb_array_elements(g -> 'options') o
    order by (g ->> 'position')::int, o ->> 'kind' desc$$,
  $$values (false), (false), (true)$$,
  'each level asked for is checked against the follower''s own skill'
);

-- An earlier version of the course, completed, meets it.
reset role;
insert into public.courses (user_id, name, catalogue_course_id, completed_date) values
  ('85000000-0000-0000-0000-00000000000b', 'Safety basics', '85000000-0000-0000-0000-0000000000c1', current_date - 30);
set local role authenticated;
select results_eq(
  $$select (o ->> 'met')::boolean
    from jsonb_array_elements(public.get_learner_plan_prerequisites('85000000-0000-0000-0000-000000000100')) g,
         jsonb_array_elements(g -> 'options') o
    order by (g ->> 'position')::int, o ->> 'kind' desc$$,
  $$values (false), (true), (true)$$,
  'completing any version of the catalogue course meets it'
);
select lives_ok(
  $$insert into public.learner_plan_item_progress (item_id, user_id, completed_on)
    values ('85000000-0000-0000-0000-000000000121', '85000000-0000-0000-0000-00000000000b', current_date)$$,
  'once one option of each required group is met, items can be ticked off'
);

-- The owner hasn't met them, and isn't let off either.
select set_config('request.jwt.claim.sub', '85000000-0000-0000-0000-00000000000a', true);
select throws_ok(
  $$insert into public.learner_plan_item_progress (item_id, user_id, completed_on)
    values ('85000000-0000-0000-0000-000000000121', '85000000-0000-0000-0000-00000000000a', current_date)$$,
  '23514', null,
  'required prerequisites apply to owners working through the plan too'
);
delete from public.learner_plan_prerequisite_groups where id = '85000000-0000-0000-0000-000000000301';
select lives_ok(
  $$insert into public.learner_plan_item_progress (item_id, user_id, completed_on)
    values ('85000000-0000-0000-0000-000000000121', '85000000-0000-0000-0000-00000000000a', current_date)$$,
  'guidance alone never blocks'
);

-- Someone not on the plan
select set_config('request.jwt.claim.sub', '85000000-0000-0000-0000-00000000000d', true);
select throws_ok(
  $$select public.get_learner_plan_prerequisites('85000000-0000-0000-0000-000000000100')$$,
  '42501', null,
  'someone not on the plan can''t read its prerequisites'
);

select * from finish();
rollback;
