\set ON_ERROR_STOP on

begin;

select plan(15);

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
  ('81000000-0000-0000-0000-000000000100', '81000000-0000-0000-0000-00000000000a', 'Lead better meetings', 'A private source plan', '2026-11-01', '2027-02-01', 'active');
insert into public.learner_plan_sections (id, plan_id, title, position) values
  ('81000000-0000-0000-0000-000000000110', '81000000-0000-0000-0000-000000000100', 'Practice', 0);
insert into public.learner_plan_items (plan_id, section_id, position, item_type, course_id, completed_on) values
  ('81000000-0000-0000-0000-000000000100', '81000000-0000-0000-0000-000000000110', 0, 'course', '81000000-0000-0000-0000-0000000000c1', null);
insert into public.learner_plan_items (plan_id, position, item_type, skill_id, plan_knowledge_level, plan_practical_level) values
  ('81000000-0000-0000-0000-000000000100', 1, 'skill', '81000000-0000-0000-0000-0000000000a1', 3, 5);
insert into public.learner_plan_items (plan_id, section_id, position, item_type, skill_resource_id) values
  ('81000000-0000-0000-0000-000000000100', '81000000-0000-0000-0000-000000000110', 2, 'skill_resource', '81000000-0000-0000-0000-0000000000d1');
insert into public.learner_plan_items (plan_id, section_id, position, item_type, step_title, completed_on) values
  ('81000000-0000-0000-0000-000000000100', '81000000-0000-0000-0000-000000000110', 3, 'step', 'Run a retrospective', current_date);

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
  'a plan cannot be invited to someone who is not connected'
);

reset role;
select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-00000000000b', true);
set local role authenticated;

select results_eq(
  $$select plan_title, inviter_name from public.list_incoming_learner_plan_invitations()$$,
  $$values ('Lead better meetings'::text, 'Alex Inviter'::text)$$,
  'the recipient sees the safe invitation preview'
);
select is(
  (select count(*)::int from public.learner_plans where id = '81000000-0000-0000-0000-000000000100'),
  0,
  'the invitation does not expose the private source plan'
);

create temporary table accepted_copy as
select public.respond_to_learner_plan_invitation(
  (select id from public.learner_plan_invitations where recipient_id = '81000000-0000-0000-0000-00000000000b'),
  true
) as copied_plan_id;

select results_eq(
  $$select user_id, title, status from public.learner_plans where id = (select copied_plan_id from accepted_copy)$$,
  $$values ('81000000-0000-0000-0000-00000000000b'::uuid, 'Lead better meetings'::text, 'planning'::text)$$,
  'accepting creates a private planning copy owned by the recipient'
);
select is((select count(*)::int from public.learner_plan_sections where plan_id = (select copied_plan_id from accepted_copy)), 1, 'sections are copied');
select is((select count(*)::int from public.learner_plan_items where plan_id = (select copied_plan_id from accepted_copy)), 4, 'all supported plan items are copied');
select results_eq(
  $$select plan_knowledge_level, plan_practical_level
    from public.learner_plan_items
    where plan_id = (select copied_plan_id from accepted_copy) and item_type = 'skill'$$,
  $$values (3::smallint, 5::smallint)$$,
  'plan-specific skill levels are copied'
);
select is(
  (select count(*)::int from public.learner_plan_items where plan_id = (select copied_plan_id from accepted_copy) and completed_on is not null),
  0,
  'the inviter progress is not copied'
);
select is(
  (select count(*)::int from public.skills where user_id = '81000000-0000-0000-0000-00000000000b' and name = 'Facilitation'),
  1,
  'a missing plan skill is created privately for the recipient'
);
select results_eq(
  $$select status, copied_plan_id from public.learner_plan_invitations
    where recipient_id = '81000000-0000-0000-0000-00000000000b'$$,
  $$select 'accepted'::text, copied_plan_id from accepted_copy$$,
  'the accepted invitation records its independent copy'
);
select is((select count(*)::int from public.list_incoming_learner_plan_invitations()), 0, 'an accepted invitation leaves the pending list');
select throws_ok(
  $$select public.respond_to_learner_plan_invitation(
    (select id from public.learner_plan_invitations where recipient_id = '81000000-0000-0000-0000-00000000000b'), false
  )$$,
  '23514', 'Invitation has already been decided',
  'an invitation cannot be decided twice'
);

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
