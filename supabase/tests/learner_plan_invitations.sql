\set ON_ERROR_STOP on

begin;

select plan(26);

insert into auth.users (id, email, email_confirmed_at) values
  ('81000000-0000-0000-0000-00000000000a', 'invite-a@example.com', now()),
  ('81000000-0000-0000-0000-00000000000b', 'invite-b@example.com', now()),
  ('81000000-0000-0000-0000-00000000000c', 'invite-c@example.com', now());

update public.profiles set first_name = 'Alex', last_name = 'Inviter'
where id = '81000000-0000-0000-0000-00000000000a';

insert into public.connections (user_a_id, user_b_id, source)
values (
  '81000000-0000-0000-0000-00000000000a',
  '81000000-0000-0000-0000-00000000000b',
  'request'
);

insert into public.skills (id, user_id, name, category, level) values
  ('81000000-0000-0000-0000-0000000000a1', '81000000-0000-0000-0000-00000000000a', 'Facilitation', 'Test', 4);
insert into public.courses (id, user_id, name, provider) values
  ('81000000-0000-0000-0000-0000000000c1', '81000000-0000-0000-0000-00000000000a', 'Facilitation basics', 'Test provider');
insert into public.skill_resources (id, user_id, skill_id, kind, title, url) values
  ('81000000-0000-0000-0000-0000000000d1', '81000000-0000-0000-0000-00000000000a', '81000000-0000-0000-0000-0000000000a1', 'link', 'Facilitation guide', 'https://example.com/guide');

insert into public.learner_plans (id, user_id, title, description, starts_on, target_on, status) values
  ('81000000-0000-0000-0000-000000000100', '81000000-0000-0000-0000-00000000000a', 'Lead better meetings', 'A shared plan', '2026-11-01', '2027-02-01', 'active');
insert into public.learner_plan_sections (id, plan_id, title, position) values
  ('81000000-0000-0000-0000-000000000110', '81000000-0000-0000-0000-000000000100', 'Practice', 0);
insert into public.learner_plan_items (id, plan_id, section_id, position, item_type, course_id) values
  ('81000000-0000-0000-0000-000000000121', '81000000-0000-0000-0000-000000000100', '81000000-0000-0000-0000-000000000110', 0, 'course', '81000000-0000-0000-0000-0000000000c1');
insert into public.learner_plan_items (id, plan_id, position, item_type, skill_id, plan_knowledge_level, plan_practical_level) values
  ('81000000-0000-0000-0000-000000000122', '81000000-0000-0000-0000-000000000100', 1, 'skill', '81000000-0000-0000-0000-0000000000a1', 3, 5);
insert into public.learner_plan_items (id, plan_id, section_id, position, item_type, skill_resource_id) values
  ('81000000-0000-0000-0000-000000000123', '81000000-0000-0000-0000-000000000100', '81000000-0000-0000-0000-000000000110', 2, 'skill_resource', '81000000-0000-0000-0000-0000000000d1');
insert into public.learner_plan_items (id, plan_id, section_id, position, item_type, step_title) values
  ('81000000-0000-0000-0000-000000000124', '81000000-0000-0000-0000-000000000100', '81000000-0000-0000-0000-000000000110', 3, 'step', 'Run a retrospective');
-- The owner has ticked the step.
insert into public.learner_plan_item_progress (item_id, user_id, completed_on) values
  ('81000000-0000-0000-0000-000000000124', '81000000-0000-0000-0000-00000000000a', current_date);

select is(
  (select role from public.learner_plan_members where plan_id = '81000000-0000-0000-0000-000000000100' and user_id = '81000000-0000-0000-0000-00000000000a'),
  'owner',
  'whoever creates a plan owns it'
);

select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-00000000000a', true);
set local role authenticated;

select results_eq(
  $$select created from public.invite_connections_to_learner_plan(
    '81000000-0000-0000-0000-000000000100',
    array['81000000-0000-0000-0000-00000000000b'::uuid]
  )$$,
  $$values (true)$$,
  'an owner can invite a connection to a plan'
);
select results_eq(
  $$select created from public.invite_connections_to_learner_plan(
    '81000000-0000-0000-0000-000000000100',
    array['81000000-0000-0000-0000-00000000000b'::uuid]
  )$$,
  $$values (false)$$,
  'sending the same open invitation is idempotent'
);
select throws_ok(
  $$select * from public.invite_connections_to_learner_plan(
    '81000000-0000-0000-0000-000000000100',
    array['81000000-0000-0000-0000-00000000000c'::uuid]
  )$$,
  '42501', 'Plans can only be invited to your connections',
  'a connection invitation goes only to a connection'
);

reset role;
select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-00000000000b', true);
set local role authenticated;

select results_eq(
  $$select plan_title, inviter_name from public.list_incoming_learner_plan_invitations()$$,
  $$values ('Lead better meetings'::text, 'Alex Inviter'::text)$$,
  'the recipient sees the invitation preview'
);
select is(
  (select count(*)::int from public.learner_plans where id = '81000000-0000-0000-0000-000000000100'),
  0,
  'an invitation alone does not show the plan'
);

select is(
  public.respond_to_learner_plan_invitation(
    (select id from public.learner_plan_invitations where recipient_id = '81000000-0000-0000-0000-00000000000b'),
    true
  ),
  '81000000-0000-0000-0000-000000000100'::uuid,
  'accepting joins the plan itself'
);
select is(
  (select count(*)::int from public.learner_plans where user_id = '81000000-0000-0000-0000-00000000000b'),
  0,
  'no copy of the plan is made'
);
select is(
  (select role from public.learner_plan_members where plan_id = '81000000-0000-0000-0000-000000000100' and user_id = '81000000-0000-0000-0000-00000000000b'),
  'follower',
  'the recipient follows the plan'
);
select is(
  (select count(*)::int from public.learner_plan_items where plan_id = '81000000-0000-0000-0000-000000000100'),
  4,
  'a follower sees the plan''s items'
);

-- The follower's own records stand in for the owner's.
select results_eq(
  $$select item ->> 'item_type', (item -> 'skills' ->> 'name'), (item -> 'skills' ->> 'level') is null, (item ->> 'plan_practical_level')::int
    from jsonb_array_elements(public.get_my_learner_plans('81000000-0000-0000-0000-000000000100') -> 0 -> 'items') item
    where item ->> 'item_type' = 'skill'$$,
  $$values ('skill'::text, 'Facilitation'::text, true, 5)$$,
  'a follower''s skill item is their own new skill, with the plan''s target'
);
select is(
  (select count(*)::int from public.skills where user_id = '81000000-0000-0000-0000-00000000000b' and name = 'Facilitation'),
  1,
  'a missing plan skill is created privately for the follower'
);
select results_eq(
  $$select (item -> 'courses' ->> 'status'), (item -> 'courses' ->> 'id')::uuid <> '81000000-0000-0000-0000-0000000000c1'
    from jsonb_array_elements(public.get_my_learner_plans('81000000-0000-0000-0000-000000000100') -> 0 -> 'items') item
    where item ->> 'item_type' = 'course'$$,
  $$values ('planned'::text, true)$$,
  'a follower''s course item is their own planned course'
);
select results_eq(
  $$select (item -> 'skill_resources' ->> 'url'), (item -> 'skill_resources' -> 'skills' ->> 'name')
    from jsonb_array_elements(public.get_my_learner_plans('81000000-0000-0000-0000-000000000100') -> 0 -> 'items') item
    where item ->> 'item_type' = 'skill_resource'$$,
  $$values ('https://example.com/guide'::text, 'Facilitation'::text)$$,
  'a follower sees the resource, linked to their own skill'
);
select is(
  (select item ->> 'completed_on'
    from jsonb_array_elements(public.get_my_learner_plans('81000000-0000-0000-0000-000000000100') -> 0 -> 'items') item
    where item ->> 'item_type' = 'step'),
  null,
  'the owner''s ticks are not the follower''s'
);
select is(
  (select (public.get_my_learner_plans('81000000-0000-0000-0000-000000000100') -> 0 ->> 'my_role')),
  'follower',
  'the plan says the caller follows it'
);

-- A follower works through the plan but cannot change it.
insert into public.learner_plan_item_progress (item_id, user_id, completed_on) values
  ('81000000-0000-0000-0000-000000000124', '81000000-0000-0000-0000-00000000000b', current_date);
select is(
  (select count(*)::int from public.learner_plan_item_progress),
  1,
  'a follower ticks off a step for themselves, and sees only their own ticks'
);
update public.learner_plan_items set note = 'Changed' where id = '81000000-0000-0000-0000-000000000124';
update public.learner_plans set title = 'Changed' where id = '81000000-0000-0000-0000-000000000100';
update public.learner_plan_sections set title = 'Changed' where id = '81000000-0000-0000-0000-000000000110';
delete from public.learner_plan_items where id = '81000000-0000-0000-0000-000000000124';
reset role;
select results_eq(
  $$select (select title from public.learner_plans where id = '81000000-0000-0000-0000-000000000100'),
    (select title from public.learner_plan_sections where id = '81000000-0000-0000-0000-000000000110'),
    (select note from public.learner_plan_items where id = '81000000-0000-0000-0000-000000000124')$$,
  $$values ('Lead better meetings'::text, 'Practice'::text, null::text)$$,
  'a follower cannot change the plan, its sections or its items'
);
set local role authenticated;
select throws_ok(
  $$insert into public.learner_plan_items (plan_id, item_type, step_title) values ('81000000-0000-0000-0000-000000000100', 'step', 'Sneaky')$$,
  '42501', null,
  'a follower cannot add to the plan'
);
select throws_ok(
  $$select * from public.invite_connections_to_learner_plan('81000000-0000-0000-0000-000000000100', array['81000000-0000-0000-0000-00000000000a'::uuid])$$,
  '42501', 'Plan not found or not owned by you',
  'a follower cannot invite people'
);
select throws_ok(
  $$select public.respond_to_learner_plan_invitation(
    (select id from public.learner_plan_invitations where recipient_id = '81000000-0000-0000-0000-00000000000b'), false
  )$$,
  '23514', 'Invitation has already been decided',
  'an invitation cannot be decided twice'
);

-- Changes the owner makes reach the follower.
reset role;
select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
update public.learner_plan_items set plan_practical_level = 4 where id = '81000000-0000-0000-0000-000000000122';
insert into public.learner_plan_items (plan_id, position, item_type, step_title)
values ('81000000-0000-0000-0000-000000000100', 4, 'step', 'Facilitate a workshop');
reset role;
select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-00000000000b', true);
set local role authenticated;
select results_eq(
  $$select count(*)::int, max((item ->> 'plan_practical_level')::int)
    from jsonb_array_elements(public.get_my_learner_plans('81000000-0000-0000-0000-000000000100') -> 0 -> 'items') item$$,
  $$values (5, 4)$$,
  'a follower sees the owner''s new items and changed skill targets'
);

-- Items added after joining wait for the follower to ask for their records.
reset role;
select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
insert into public.skills (id, user_id, name, category, level) values
  ('81000000-0000-0000-0000-0000000000a2', '81000000-0000-0000-0000-00000000000a', 'Listening', 'Test', 3);
insert into public.learner_plan_items (plan_id, position, item_type, skill_id)
values ('81000000-0000-0000-0000-000000000100', 5, 'skill', '81000000-0000-0000-0000-0000000000a2');
reset role;
select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-00000000000b', true);
set local role authenticated;
select results_eq(
  $$select (item ->> 'needs_link')::boolean, item ->> 'source_title', item -> 'skills' = 'null'::jsonb
    from jsonb_array_elements(public.get_my_learner_plans('81000000-0000-0000-0000-000000000100') -> 0 -> 'items') item
    where item ->> 'source_title' = 'Listening'$$,
  $$values (true, 'Listening'::text, true)$$,
  'a new item shows what it is until the follower adds it to their records'
);
select is(
  (select count(*)::int from public.skills where user_id = '81000000-0000-0000-0000-00000000000b' and name = 'Listening'),
  0,
  'nothing is made in the follower''s records without them asking'
);
select is(public.link_learner_plan_items_for_me('81000000-0000-0000-0000-000000000100'), 1, 'the follower adds the new item to their records');

reset role;
select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-00000000000c', true);
set local role authenticated;
select throws_ok(
  $$select public.respond_to_learner_plan_invitation(
    (select id from public.learner_plan_invitations limit 1), true
  )$$,
  '42501', 'Invitation not found',
  'another learner cannot accept the invitation'
);

select * from finish();
rollback;
