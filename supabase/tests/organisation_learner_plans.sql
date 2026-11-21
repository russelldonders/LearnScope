\set ON_ERROR_STOP on

begin;

select plan(29);

-- a: admin of Org One   m: member who is assigned   n: member, not assigned
-- o: outsider           x: admin of Org Two
insert into auth.users (id, email, email_confirmed_at) values
  ('83000000-0000-0000-0000-00000000000a', 'org-plan-admin@example.com', now()),
  ('83000000-0000-0000-0000-00000000000b', 'org-plan-member@example.com', now()),
  ('83000000-0000-0000-0000-00000000000c', 'org-plan-other@example.com', now()),
  ('83000000-0000-0000-0000-00000000000d', 'org-plan-outsider@example.com', now()),
  ('83000000-0000-0000-0000-00000000000e', 'org-plan-other-admin@example.com', now());

insert into public.organisations (id, name) values
  ('83000000-0000-0000-0000-000000000010', 'Org One'),
  ('83000000-0000-0000-0000-000000000020', 'Org Two');

insert into public.employer_members (employer_id, user_id, role, status) values
  ('83000000-0000-0000-0000-000000000010', '83000000-0000-0000-0000-00000000000a', 'admin', 'active'),
  ('83000000-0000-0000-0000-000000000010', '83000000-0000-0000-0000-00000000000b', 'member', 'active'),
  ('83000000-0000-0000-0000-000000000010', '83000000-0000-0000-0000-00000000000c', 'member', 'active'),
  ('83000000-0000-0000-0000-000000000020', '83000000-0000-0000-0000-00000000000e', 'admin', 'active');

insert into public.course_catalogue (id, name, organisation_id, version_group_id) values
  ('83000000-0000-0000-0000-0000000000c1', 'Coaching basics', '83000000-0000-0000-0000-000000000010', '83000000-0000-0000-0000-0000000000c9'),
  ('83000000-0000-0000-0000-0000000000c2', 'Someone else''s course', '83000000-0000-0000-0000-000000000020', '83000000-0000-0000-0000-0000000000c8');

insert into public.skill_library (id, name, status, organisation_id) values
  ('83000000-0000-0000-0000-0000000000f1', 'Giving feedback', 'active', '83000000-0000-0000-0000-000000000010'),
  ('83000000-0000-0000-0000-0000000000f2', 'Org Two skill', 'active', '83000000-0000-0000-0000-000000000020');

-- The admin's own course, which mustn't go on an organisation plan.
insert into public.courses (id, user_id, name) values
  ('83000000-0000-0000-0000-0000000000d1', '83000000-0000-0000-0000-00000000000a', 'Admin''s own course');

grant all on table public.learner_plans, public.learner_plan_sections, public.learner_plan_items,
  public.learner_plan_item_progress, public.learner_plan_members, public.skills, public.courses to authenticated;
grant select on public.learner_plan_assignments, public.learner_plan_item_links to authenticated;

-- A plain member can't make a plan for the organisation.
select set_config('request.jwt.claim.sub', '83000000-0000-0000-0000-00000000000b', true);
set local role authenticated;
select throws_ok(
  $$insert into public.learner_plans (id, user_id, organisation_id, title)
    values ('83000000-0000-0000-0000-0000000000e0', '83000000-0000-0000-0000-00000000000b', '83000000-0000-0000-0000-000000000010', 'Not allowed')$$,
  '42501', null, 'a member cannot create an organisation plan'
);
reset role;

-- The admin makes one, and isn't put on it as a person.
select set_config('request.jwt.claim.sub', '83000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
insert into public.learner_plans (id, user_id, organisation_id, title, description)
values ('83000000-0000-0000-0000-0000000000e1', '83000000-0000-0000-0000-00000000000a', '83000000-0000-0000-0000-000000000010', 'New manager plan', 'Your first 90 days');
select is((select count(*)::integer from public.learner_plan_members where plan_id = '83000000-0000-0000-0000-0000000000e1'), 0,
  'the creating admin is not a member of the organisation plan');
select is((select count(*)::integer from public.learner_plans where id = '83000000-0000-0000-0000-0000000000e1'), 1,
  'the admin can see the organisation plan');
select is(jsonb_array_length(public.get_my_learner_plans('83000000-0000-0000-0000-0000000000e1')), 0,
  'it is not in the admin''s own plans');

insert into public.learner_plan_items (id, plan_id, item_type, catalogue_course_id, position)
values ('83000000-0000-0000-0000-0000000000a1', '83000000-0000-0000-0000-0000000000e1', 'course', '83000000-0000-0000-0000-0000000000c1', 0);
insert into public.learner_plan_items (id, plan_id, item_type, library_skill_id, plan_practical_level, position)
values ('83000000-0000-0000-0000-0000000000a2', '83000000-0000-0000-0000-0000000000e1', 'skill', '83000000-0000-0000-0000-0000000000f1', 3, 1);
insert into public.learner_plan_items (id, plan_id, item_type, step_title, position)
values ('83000000-0000-0000-0000-0000000000a3', '83000000-0000-0000-0000-0000000000e1', 'step', 'Meet your team', 2);
select is((select count(*)::integer from public.learner_plan_items where plan_id = '83000000-0000-0000-0000-0000000000e1'), 3,
  'the admin adds a catalogue course, a library skill and a step');

select throws_ok(
  $$insert into public.learner_plan_items (plan_id, item_type, course_id) values ('83000000-0000-0000-0000-0000000000e1', 'course', '83000000-0000-0000-0000-0000000000d1')$$,
  '23514', null, 'an admin''s own course cannot go on an organisation plan'
);
select throws_ok(
  $$insert into public.learner_plan_items (plan_id, item_type, catalogue_course_id) values ('83000000-0000-0000-0000-0000000000e1', 'course', '83000000-0000-0000-0000-0000000000c2')$$,
  '23514', null, 'a course the organisation can''t use is refused'
);
select throws_ok(
  $$insert into public.learner_plan_items (plan_id, item_type, library_skill_id) values ('83000000-0000-0000-0000-0000000000e1', 'skill', '83000000-0000-0000-0000-0000000000f2')$$,
  '23514', null, 'another organisation''s library skill is refused'
);
select throws_ok(
  $$select public.get_learner_plan_share_link('83000000-0000-0000-0000-0000000000e1')$$,
  '23514', null, 'an organisation plan cannot be shared by link'
);
reset role;

-- Before it's assigned, members and other organisations don't see it.
select set_config('request.jwt.claim.sub', '83000000-0000-0000-0000-00000000000b', true);
set local role authenticated;
select is((select count(*)::integer from public.learner_plans where id = '83000000-0000-0000-0000-0000000000e1'), 0,
  'a member does not see an unassigned organisation plan');
select is((select count(*)::integer from public.list_my_learner_plan_assignments()), 0, 'nothing is assigned yet');
select throws_ok(
  $$select public.assign_learner_plan('83000000-0000-0000-0000-0000000000e1', array['83000000-0000-0000-0000-00000000000c'::uuid])$$,
  '42501', null, 'a member cannot assign'
);
reset role;

select set_config('request.jwt.claim.sub', '83000000-0000-0000-0000-00000000000e', true);
set local role authenticated;
select is((select count(*)::integer from public.learner_plans where id = '83000000-0000-0000-0000-0000000000e1'), 0,
  'another organisation''s admin does not see it');
update public.learner_plans set title = 'Hijacked' where id = '83000000-0000-0000-0000-0000000000e1';
reset role;
select is((select title from public.learner_plans where id = '83000000-0000-0000-0000-0000000000e1'), 'New manager plan',
  'another organisation''s admin cannot change it');
set local role authenticated;
reset role;

-- The admin assigns it to a member; outsiders are skipped.
select set_config('request.jwt.claim.sub', '83000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
select is(public.assign_learner_plan('83000000-0000-0000-0000-0000000000e1',
  array['83000000-0000-0000-0000-00000000000b'::uuid, '83000000-0000-0000-0000-00000000000d'::uuid]), 1,
  'only active members are assigned');
select is(public.assign_learner_plan('83000000-0000-0000-0000-0000000000e1', array['83000000-0000-0000-0000-00000000000b'::uuid]), 0,
  'assigning again changes nothing');
reset role;

-- Assigning added nothing to the member's record.
select is((select count(*)::integer from public.courses where user_id = '83000000-0000-0000-0000-00000000000b'), 0,
  'assigning creates no course for the member');

-- Someone else can't answer the member's assignment.
select set_config('request.jwt.claim.sub', '83000000-0000-0000-0000-00000000000c', true);
set local role authenticated;
select throws_ok(
  format('select public.respond_to_learner_plan_assignment(%L, true)',
    (select id from public.learner_plan_assignments where assigned_to = '83000000-0000-0000-0000-00000000000b')),
  '42501', null, 'another member cannot start someone''s assignment'
);
reset role;

-- The member sees it and starts it.
select set_config('request.jwt.claim.sub', '83000000-0000-0000-0000-00000000000b', true);
set local role authenticated;
select is((select title from public.list_my_learner_plan_assignments('83000000-0000-0000-0000-000000000010')), 'New manager plan',
  'the member sees the assigned plan');
select is(public.respond_to_learner_plan_assignment(
  (select id from public.list_my_learner_plan_assignments()), true), '83000000-0000-0000-0000-0000000000e1'::uuid,
  'starting returns the plan');
select is((select role from public.learner_plan_members where plan_id = '83000000-0000-0000-0000-0000000000e1' and user_id = '83000000-0000-0000-0000-00000000000b'),
  'follower', 'starting joins the member as a follower');
reset role;

select is((select status from public.courses where user_id = '83000000-0000-0000-0000-00000000000b' and catalogue_course_id = '83000000-0000-0000-0000-0000000000c1'),
  'planned', 'the member gets their own planned course for the catalogue course');
select is((select count(*)::integer from public.skills where user_id = '83000000-0000-0000-0000-00000000000b' and library_skill_id = '83000000-0000-0000-0000-0000000000f1'),
  1, 'and their own skill for the library skill');

select set_config('request.jwt.claim.sub', '83000000-0000-0000-0000-00000000000b', true);
set local role authenticated;
select is((public.get_my_learner_plans('83000000-0000-0000-0000-0000000000e1') -> 0 -> 'organisation' ->> 'name'), 'Org One',
  'the member''s plan says which organisation it is from');
select public.record_learner_plan_progress(jsonb_build_array(jsonb_build_object(
  'plan_id', '83000000-0000-0000-0000-0000000000e1', 'done', 1, 'total', 3,
  'items', jsonb_build_array(
    jsonb_build_object('item_id', '83000000-0000-0000-0000-0000000000a3', 'status', 'done'),
    jsonb_build_object('item_id', '83000000-0000-0000-0000-0000000000a1', 'status', 'not_started'),
    jsonb_build_object('item_id', '83000000-0000-0000-0000-0000000000a2', 'status', 'nonsense')
  )
)));
reset role;

-- The admin sees the member's full progress.
select set_config('request.jwt.claim.sub', '83000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
select is((select progress_done from public.list_organisation_learner_plan_progress('83000000-0000-0000-0000-0000000000e1')
  where user_id = '83000000-0000-0000-0000-00000000000b'), 1, 'the admin sees how much the member has done');
select is((select jsonb_array_length(progress_items) from public.list_organisation_learner_plan_progress('83000000-0000-0000-0000-0000000000e1')
  where user_id = '83000000-0000-0000-0000-00000000000b'), 2, 'and each step''s status, ignoring unknown statuses');
reset role;

-- Once the member leaves the organisation, their progress is no longer shown.
delete from public.employer_members
where employer_id = '83000000-0000-0000-0000-000000000010' and user_id = '83000000-0000-0000-0000-00000000000b';
select set_config('request.jwt.claim.sub', '83000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
select is((select progress_done from public.list_organisation_learner_plan_progress('83000000-0000-0000-0000-0000000000e1')
  where user_id = '83000000-0000-0000-0000-00000000000b'), null::integer, 'a former member''s progress is hidden');
reset role;

-- Personal plans still work as before.
select set_config('request.jwt.claim.sub', '83000000-0000-0000-0000-00000000000c', true);
set local role authenticated;
insert into public.learner_plans (id, user_id, title) values ('83000000-0000-0000-0000-0000000000e2', '83000000-0000-0000-0000-00000000000c', 'My own plan');
select is((select role from public.learner_plan_members where plan_id = '83000000-0000-0000-0000-0000000000e2' and user_id = '83000000-0000-0000-0000-00000000000c'),
  'owner', 'a personal plan''s creator still owns it');
select throws_ok(
  $$insert into public.learner_plan_items (plan_id, item_type, catalogue_course_id) values ('83000000-0000-0000-0000-0000000000e2', 'course', '83000000-0000-0000-0000-0000000000c1')$$,
  '23514', null, 'a personal plan cannot point at the catalogue directly'
);
reset role;

select * from finish();
rollback;
