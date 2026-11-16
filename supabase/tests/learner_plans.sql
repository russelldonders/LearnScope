\set ON_ERROR_STOP on

begin;

select plan(16);

insert into auth.users (id, email, email_confirmed_at) values
  ('80000000-0000-0000-0000-00000000000a', 'plan-a@example.com', now()),
  ('80000000-0000-0000-0000-00000000000b', 'plan-b@example.com', now());

insert into public.skills (id, user_id, name, category, level) values
  ('80000000-0000-0000-0000-0000000000a1', '80000000-0000-0000-0000-00000000000a', 'Planning', 'Test', 2),
  ('80000000-0000-0000-0000-0000000000b1', '80000000-0000-0000-0000-00000000000b', 'Not yours', 'Test', 2);

insert into public.courses (id, user_id, name) values
  ('80000000-0000-0000-0000-0000000000c1', '80000000-0000-0000-0000-00000000000a', 'My course'),
  ('80000000-0000-0000-0000-0000000000c2', '80000000-0000-0000-0000-00000000000b', 'B''s course');

insert into public.skill_resources (id, user_id, skill_id, kind, title, url) values
  ('80000000-0000-0000-0000-0000000000d1', '80000000-0000-0000-0000-00000000000a', '80000000-0000-0000-0000-0000000000a1', 'link', 'Guide', 'https://example.com');

grant all on table public.learner_plans, public.learner_plan_sections, public.learner_plan_items,
  public.skills, public.courses, public.skill_resources to authenticated;

select set_config('request.jwt.claim.sub', '80000000-0000-0000-0000-00000000000a', true);
set local role authenticated;

insert into public.learner_plans (id, user_id, title, starts_on, target_on)
values ('80000000-0000-0000-0000-000000000100', '80000000-0000-0000-0000-00000000000a', 'Become a planner', '2026-11-01', '2027-03-31');
insert into public.learner_plan_sections (id, plan_id, title, position)
values ('80000000-0000-0000-0000-000000000110', '80000000-0000-0000-0000-000000000100', 'Foundations', 0);

insert into public.learner_plan_items (id, plan_id, section_id, position, item_type, course_id) values
  ('80000000-0000-0000-0000-000000000121', '80000000-0000-0000-0000-000000000100', '80000000-0000-0000-0000-000000000110', 0, 'course', '80000000-0000-0000-0000-0000000000c1');
insert into public.learner_plan_items (id, plan_id, section_id, position, item_type, skill_id) values
  ('80000000-0000-0000-0000-000000000122', '80000000-0000-0000-0000-000000000100', '80000000-0000-0000-0000-000000000110', 1, 'skill', '80000000-0000-0000-0000-0000000000a1');
insert into public.learner_plan_items (id, plan_id, position, item_type, skill_resource_id) values
  ('80000000-0000-0000-0000-000000000123', '80000000-0000-0000-0000-000000000100', 2, 'skill_resource', '80000000-0000-0000-0000-0000000000d1');
insert into public.learner_plan_items (id, plan_id, position, item_type, step_title) values
  ('80000000-0000-0000-0000-000000000124', '80000000-0000-0000-0000-000000000100', 3, 'step', 'Shadow a senior planner');

select is((select count(*)::int from public.learner_plan_items), 4, 'a learner builds a plan from their own records and a step');

select throws_ok(
  $$insert into public.learner_plan_items (plan_id, item_type, course_id)
    values ('80000000-0000-0000-0000-000000000100', 'course', '80000000-0000-0000-0000-0000000000c2')$$,
  '23514', 'You can only add your own courses to a plan', 'someone else''s course cannot be added'
);
select throws_ok(
  $$insert into public.learner_plan_items (plan_id, item_type, skill_id)
    values ('80000000-0000-0000-0000-000000000100', 'skill', '80000000-0000-0000-0000-0000000000b1')$$,
  '23514', 'You can only add your own skills to a plan', 'someone else''s skill cannot be added'
);
select throws_ok(
  $$insert into public.learner_plan_items (plan_id, item_type, course_id, skill_id)
    values ('80000000-0000-0000-0000-000000000100', 'course', '80000000-0000-0000-0000-0000000000c1', '80000000-0000-0000-0000-0000000000a1')$$,
  '23514', null, 'an item points at one record of its own type'
);
select throws_ok(
  $$update public.learner_plan_items set completed_on = current_date where id = '80000000-0000-0000-0000-000000000121'$$,
  '23514', null, 'a course is never ticked off on the plan: its own completion counts'
);

update public.learner_plan_items set completed_on = current_date where id = '80000000-0000-0000-0000-000000000124';
select isnt((select completed_on from public.learner_plan_items where id = '80000000-0000-0000-0000-000000000124'), null, 'a step can be ticked off');

select throws_ok(
  $$update public.learner_plans set status = 'completed' where id = '80000000-0000-0000-0000-000000000100'$$,
  '23514', null, 'a completed plan records when it was completed'
);
select throws_ok(
  $$insert into public.learner_plans (user_id, title, starts_on, target_on)
    values ('80000000-0000-0000-0000-00000000000a', 'Backwards', '2027-01-01', '2026-01-01')$$,
  '23514', null, 'a plan cannot end before it starts'
);

reset role;

-- B's own plan and section, to try pointing A's item at.
insert into public.learner_plans (id, user_id, title)
values ('80000000-0000-0000-0000-000000000200', '80000000-0000-0000-0000-00000000000b', 'B''s plan');
insert into public.learner_plan_sections (id, plan_id, title)
values ('80000000-0000-0000-0000-000000000210', '80000000-0000-0000-0000-000000000200', 'B''s section');

select set_config('request.jwt.claim.sub', '80000000-0000-0000-0000-00000000000a', true);
set local role authenticated;

-- Sending B's plan along with B's course doesn't make the check look at B.
select throws_ok(
  $$update public.learner_plan_items
    set plan_id = '80000000-0000-0000-0000-000000000200',
        course_id = '80000000-0000-0000-0000-0000000000c2',
        section_id = '80000000-0000-0000-0000-000000000210'
    where id = '80000000-0000-0000-0000-000000000121'$$,
  '23514', null, 'an item cannot be pointed at someone else''s course by naming their plan'
);
select throws_ok(
  $$update public.learner_plan_items
    set section_id = '80000000-0000-0000-0000-000000000210'
    where id = '80000000-0000-0000-0000-000000000121'$$,
  '23514', 'That section is not part of this plan', 'nor moved into someone else''s section'
);

-- Removing an item leaves its record alone.
delete from public.learner_plan_items where id = '80000000-0000-0000-0000-000000000123';
select is((select count(*)::int from public.skill_resources where id = '80000000-0000-0000-0000-0000000000d1'), 1, 'removing an item keeps the resource');

reset role;

-- Another learner sees and changes nothing.
select set_config('request.jwt.claim.sub', '80000000-0000-0000-0000-00000000000b', true);
set local role authenticated;
select is((select count(*)::int from public.learner_plans where user_id = '80000000-0000-0000-0000-00000000000a'), 0, 'plans are private to their owner');
select is((select count(*)::int from public.learner_plan_items), 0, 'and so are their items');
select throws_ok(
  $$insert into public.learner_plan_items (plan_id, item_type, step_title)
    values ('80000000-0000-0000-0000-000000000100', 'step', 'Sneaky')$$,
  '42501', null, 'nobody can add to someone else''s plan'
);
reset role;

-- Deleting a record keeps the item, with its reference cleared.
delete from public.courses where id = '80000000-0000-0000-0000-0000000000c1';
select results_eq(
  $$select item_type, course_id is null from public.learner_plan_items where id = '80000000-0000-0000-0000-000000000121'$$,
  $$values ('course'::text, true)$$,
  'deleting a course leaves its item, shown as removed'
);

-- Deleting the plan removes its items but none of the records.
delete from public.learner_plans where id = '80000000-0000-0000-0000-000000000100';
select is((select count(*)::int from public.skills where id = '80000000-0000-0000-0000-0000000000a1'), 1, 'deleting a plan keeps its skills');

select * from finish();

rollback;
