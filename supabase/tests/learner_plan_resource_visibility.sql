\set ON_ERROR_STOP on

begin;

select plan(17);

-- A created the plan; C is a co-owner; B follows it.
insert into auth.users (id, email, email_confirmed_at) values
  ('84000000-0000-0000-0000-00000000000a', 'vis-a@example.com', now()),
  ('84000000-0000-0000-0000-00000000000b', 'vis-b@example.com', now()),
  ('84000000-0000-0000-0000-00000000000c', 'vis-c@example.com', now());

insert into public.skills (id, user_id, name, category, level) values
  ('84000000-0000-0000-0000-0000000000a1', '84000000-0000-0000-0000-00000000000a', 'Presenting', 'Test', 3);
insert into public.skill_resources (id, user_id, skill_id, kind, title, url) values
  ('84000000-0000-0000-0000-0000000000d1', '84000000-0000-0000-0000-00000000000a', '84000000-0000-0000-0000-0000000000a1', 'link', 'For everyone', 'https://example.com/1'),
  ('84000000-0000-0000-0000-0000000000d2', '84000000-0000-0000-0000-00000000000a', '84000000-0000-0000-0000-0000000000a1', 'link', 'For owners', 'https://example.com/2'),
  ('84000000-0000-0000-0000-0000000000d3', '84000000-0000-0000-0000-00000000000a', '84000000-0000-0000-0000-0000000000a1', 'link', 'Just mine', 'https://example.com/3');

insert into public.learner_plans (id, user_id, title, status) values
  ('84000000-0000-0000-0000-000000000100', '84000000-0000-0000-0000-00000000000a', 'Present with confidence', 'active');

select set_config('request.jwt.claim.sub', '84000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
insert into public.learner_plan_items (id, plan_id, position, item_type, skill_resource_id, visibility) values
  ('84000000-0000-0000-0000-000000000121', '84000000-0000-0000-0000-000000000100', 0, 'skill_resource', '84000000-0000-0000-0000-0000000000d1', 'members'),
  ('84000000-0000-0000-0000-000000000122', '84000000-0000-0000-0000-000000000100', 1, 'skill_resource', '84000000-0000-0000-0000-0000000000d2', 'owners'),
  ('84000000-0000-0000-0000-000000000123', '84000000-0000-0000-0000-000000000100', 2, 'skill_resource', '84000000-0000-0000-0000-0000000000d3', 'private');
insert into public.learner_plan_items (id, plan_id, position, item_type, step_title) values
  ('84000000-0000-0000-0000-000000000124', '84000000-0000-0000-0000-000000000100', 3, 'step', 'Rehearse');
select throws_ok(
  $$insert into public.learner_plan_items (plan_id, item_type, step_title, visibility) values ('84000000-0000-0000-0000-000000000100', 'step', 'Hidden step', 'owners')$$,
  '23514', null,
  'only a resource can be kept from some of the plan'
);
create temporary table link_code as select public.get_learner_plan_share_link('84000000-0000-0000-0000-000000000100') as code;
select is(
  (select item_count from public.get_learner_plan_invite_preview((select code from link_code))),
  2,
  'the invitation counts only what everyone on the plan will see'
);
reset role;
grant select on link_code to authenticated;

insert into public.learner_plan_members (plan_id, user_id, role) values
  ('84000000-0000-0000-0000-000000000100', '84000000-0000-0000-0000-00000000000c', 'owner');
select set_config('request.jwt.claim.sub', '84000000-0000-0000-0000-00000000000b', true);
set local role authenticated;
select public.accept_learner_plan_invite((select code from link_code));

-- The follower
select results_eq(
  $$select id from public.learner_plan_items where item_type = 'skill_resource' order by position$$,
  $$values ('84000000-0000-0000-0000-000000000121'::uuid)$$,
  'a follower sees only resources for everyone on the plan'
);
reset role;
select results_eq(
  $$select title from public.learner_plan_items item
    join public.skill_resources resource on resource.id = item.skill_resource_id
    where item.plan_id = '84000000-0000-0000-0000-000000000100'
    order by item.position$$,
  $$values ('For everyone'::text), ('For owners'::text), ('Just mine'::text)$$,
  'all three resources are on the plan'
);
set local role authenticated;
select results_eq(
  $$select item ->> 'step_title', item -> 'skill_resources' ->> 'title'
    from jsonb_array_elements(public.get_my_learner_plans('84000000-0000-0000-0000-000000000100') -> 0 -> 'items') item
    order by (item ->> 'position')::int$$,
  $$values (null::text, 'For everyone'::text), ('Rehearse'::text, null::text)$$,
  'the follower''s plan leaves out what they may not see'
);
select is(
  (select count(*)::int from public.learner_plan_item_links where user_id = '84000000-0000-0000-0000-00000000000b'),
  1,
  'joining links only what the follower may see (the resource for everyone; the step has no skill)'
);
select throws_ok(
  $$insert into public.learner_plan_item_progress (item_id, user_id, completed_on)
    values ('84000000-0000-0000-0000-000000000122', '84000000-0000-0000-0000-00000000000b', current_date)$$,
  '23514', null,
  'a follower cannot tick off a resource kept for owners'
);
select lives_ok(
  $$insert into public.learner_plan_item_progress (item_id, user_id, completed_on)
    values ('84000000-0000-0000-0000-000000000121', '84000000-0000-0000-0000-00000000000b', current_date)$$,
  'a follower ticks off a resource for everyone'
);
select is(public.link_learner_plan_items_for_me('84000000-0000-0000-0000-000000000100'), 0, 'a follower has nothing hidden left to link');

-- The co-owner
reset role;
select set_config('request.jwt.claim.sub', '84000000-0000-0000-0000-00000000000c', true);
set local role authenticated;
select results_eq(
  $$select item -> 'skill_resources' ->> 'title', item ->> 'visibility'
    from jsonb_array_elements(public.get_my_learner_plans('84000000-0000-0000-0000-000000000100') -> 0 -> 'items') item
    where item ->> 'item_type' = 'skill_resource'
    order by (item ->> 'position')::int$$,
  $$values ('For everyone'::text, 'members'::text), ('For owners'::text, 'owners'::text)$$,
  'a co-owner sees resources for everyone and for owners, not someone''s private one'
);
select is(
  (select count(*)::int from public.learner_plan_items where id = '84000000-0000-0000-0000-000000000123'),
  0,
  'a co-owner cannot read someone else''s private resource item'
);

-- The creator sees everything they added, and can open a resource to everyone.
reset role;
select set_config('request.jwt.claim.sub', '84000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
select is(
  (select jsonb_array_length(public.get_my_learner_plans('84000000-0000-0000-0000-000000000100') -> 0 -> 'items')),
  4,
  'whoever added an item always sees it'
);
update public.learner_plan_items set visibility = 'members' where id = '84000000-0000-0000-0000-000000000123';
reset role;
select set_config('request.jwt.claim.sub', '84000000-0000-0000-0000-00000000000b', true);
set local role authenticated;
select is(
  (select count(*)::int from public.learner_plan_items where plan_id = '84000000-0000-0000-0000-000000000100'),
  3,
  'opening a resource to everyone shows it to followers'
);
select is(
  (select (item ->> 'needs_link')::boolean
    from jsonb_array_elements(public.get_my_learner_plans('84000000-0000-0000-0000-000000000100') -> 0 -> 'items') item
    where item -> 'skill_resources' ->> 'title' = 'Just mine'),
  true,
  'a resource newly opened to everyone waits for the follower to add it to their records'
);

-- Only whoever added a resource changes who sees it.
reset role;
select set_config('request.jwt.claim.sub', '84000000-0000-0000-0000-00000000000c', true);
set local role authenticated;
select throws_ok(
  $$update public.learner_plan_items set visibility = 'members' where id = '84000000-0000-0000-0000-000000000122'$$,
  '23514', 'Only the person who added this resource can change who sees it',
  'a co-owner cannot open someone else''s owners-only resource to everyone'
);

-- A co-owner's hidden resource goes with them when they're taken off.
reset role;
insert into public.skills (id, user_id, name, category, level) values
  ('84000000-0000-0000-0000-0000000000c1', '84000000-0000-0000-0000-00000000000c', 'Storytelling', 'Test', 2);
insert into public.skill_resources (id, user_id, skill_id, kind, title, url) values
  ('84000000-0000-0000-0000-0000000000c2', '84000000-0000-0000-0000-00000000000c', '84000000-0000-0000-0000-0000000000c1', 'link', 'Cy''s notes', 'https://example.com/c');
select set_config('request.jwt.claim.sub', '84000000-0000-0000-0000-00000000000c', true);
set local role authenticated;
insert into public.learner_plan_items (id, plan_id, position, item_type, skill_resource_id, visibility) values
  ('84000000-0000-0000-0000-000000000125', '84000000-0000-0000-0000-000000000100', 5, 'skill_resource', '84000000-0000-0000-0000-0000000000c2', 'owners');
reset role;
select set_config('request.jwt.claim.sub', '84000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
select public.remove_learner_plan_member('84000000-0000-0000-0000-000000000100', '84000000-0000-0000-0000-00000000000c');
reset role;
select is(
  (select count(*)::int from public.learner_plan_items where id = '84000000-0000-0000-0000-000000000125'),
  0,
  'a hidden resource leaves with whoever added it'
);
select is(
  (select count(*)::int from public.skill_resources where id = '84000000-0000-0000-0000-0000000000c2'),
  1,
  'their resource itself stays theirs'
);

select * from finish();
rollback;
