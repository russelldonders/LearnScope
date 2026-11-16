\set ON_ERROR_STOP on

begin;

select plan(28);

-- A owns the plan; B and C follow it; D is not on it.
insert into auth.users (id, email, email_confirmed_at) values
  ('82000000-0000-0000-0000-00000000000a', 'share-a@example.com', now()),
  ('82000000-0000-0000-0000-00000000000b', 'share-b@example.com', now()),
  ('82000000-0000-0000-0000-00000000000c', 'share-c@example.com', now()),
  ('82000000-0000-0000-0000-00000000000d', 'share-d@example.com', now());

update public.profiles set first_name = 'Bo', last_name = 'Follower'
where id = '82000000-0000-0000-0000-00000000000b';
update public.profiles set first_name = 'Cy', last_name = 'Helper'
where id = '82000000-0000-0000-0000-00000000000c';

insert into public.connections (user_a_id, user_b_id, source) values
  ('82000000-0000-0000-0000-00000000000a', '82000000-0000-0000-0000-00000000000b', 'request'),
  ('82000000-0000-0000-0000-00000000000a', '82000000-0000-0000-0000-00000000000c', 'request');

insert into public.learner_plans (id, user_id, title, status) values
  ('82000000-0000-0000-0000-000000000100', '82000000-0000-0000-0000-00000000000a', 'Shared plan', 'active'),
  ('82000000-0000-0000-0000-000000000200', '82000000-0000-0000-0000-00000000000b', 'Bo''s own plan', 'active');
insert into public.learner_plan_items (id, plan_id, position, item_type, step_title) values
  ('82000000-0000-0000-0000-000000000121', '82000000-0000-0000-0000-000000000100', 0, 'step', 'Do the thing');

select set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
select * from public.invite_connections_to_learner_plan(
  '82000000-0000-0000-0000-000000000100',
  array['82000000-0000-0000-0000-00000000000b', '82000000-0000-0000-0000-00000000000c']::uuid[]
);

reset role;
select set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-00000000000b', true);
set local role authenticated;
select public.respond_to_learner_plan_invitation(
  (select id from public.learner_plan_invitations where recipient_id = '82000000-0000-0000-0000-00000000000b'), true
);
reset role;
select set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-00000000000c', true);
set local role authenticated;
select public.respond_to_learner_plan_invitation(
  (select id from public.learner_plan_invitations where recipient_id = '82000000-0000-0000-0000-00000000000c'), true
);

-- Progress
reset role;
select set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-00000000000b', true);
set local role authenticated;
select results_eq(
  $$select * from public.record_learner_plan_progress('[{"plan_id": "82000000-0000-0000-0000-000000000100", "done": 1, "total": 4}, {"plan_id": "82000000-0000-0000-0000-000000000200", "done": 0, "total": 2}]'::jsonb)$$,
  $$values ('82000000-0000-0000-0000-000000000100'::uuid)$$,
  'a follower''s progress is shared; their own plan''s is not reported as shared'
);
select throws_ok(
  $$select * from public.record_learner_plan_progress('[{"plan_id": "82000000-0000-0000-0000-000000000100", "done": 5, "total": 4}]'::jsonb)$$,
  '23514', 'Invalid plan progress',
  'progress cannot be more than the total'
);
select throws_ok(
  $$select * from public.record_learner_plan_progress((select jsonb_agg(jsonb_build_object('plan_id', gen_random_uuid(), 'done', 0, 'total', 0)) from generate_series(1, 501)))$$,
  '23514', 'Too many plans at once',
  'progress for too many plans at once is refused'
);
select throws_ok(
  $$select * from public.list_learner_plan_members('82000000-0000-0000-0000-000000000100')$$,
  '42501', 'Plan not found or not owned by you',
  'a follower cannot list the people on the plan'
);
select is(
  (select count(*)::int from public.learner_plan_members where plan_id = '82000000-0000-0000-0000-000000000100'),
  1,
  'a follower sees only themselves among the members'
);

reset role;
select set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-00000000000d', true);
set local role authenticated;
select is(
  (select count(*)::int from public.record_learner_plan_progress('[{"plan_id": "82000000-0000-0000-0000-000000000100", "done": 4, "total": 4}]'::jsonb)),
  0,
  'someone not on the plan records nothing'
);
select is(
  (select count(*)::int from public.learner_plans where id = '82000000-0000-0000-0000-000000000100'),
  0,
  'someone not on the plan cannot see it'
);
select is(
  public.get_my_learner_plans('82000000-0000-0000-0000-000000000100'),
  '[]'::jsonb,
  'someone not on the plan gets nothing of it back'
);

reset role;
select set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
select results_eq(
  $$select name, role, is_creator, status, progress_done, progress_total
    from public.list_learner_plan_members('82000000-0000-0000-0000-000000000100')
    order by is_creator desc, name$$,
  $$values
    ('A LearnScope user'::text, 'owner'::text, true, 'member'::text, null::integer, null::integer),
    ('Bo Follower'::text, 'follower'::text, false, 'member'::text, 1, 4),
    ('Cy Helper'::text, 'follower'::text, false, 'member'::text, null::integer, null::integer)$$,
  'the owner sees everyone on the plan, with their role and progress'
);

-- Unchanged progress doesn't move the time on.
reset role;
update public.learner_plan_members set progress_updated_at = '2026-01-01T00:00:00Z'
where plan_id = '82000000-0000-0000-0000-000000000100' and user_id = '82000000-0000-0000-0000-00000000000b';
select set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-00000000000b', true);
set local role authenticated;
select * from public.record_learner_plan_progress('[{"plan_id": "82000000-0000-0000-0000-000000000100", "done": 1, "total": 4}]'::jsonb);
reset role;
select is(
  (select progress_updated_at from public.learner_plan_members where plan_id = '82000000-0000-0000-0000-000000000100' and user_id = '82000000-0000-0000-0000-00000000000b'),
  '2026-01-01T00:00:00Z'::timestamptz,
  'unchanged progress does not move the updated time on'
);

-- Co-owners
select set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-00000000000b', true);
set local role authenticated;
select throws_ok(
  $$select public.set_learner_plan_member_role('82000000-0000-0000-0000-000000000100', '82000000-0000-0000-0000-00000000000b', 'owner')$$,
  '42501', 'Plan not found or not owned by you',
  'a follower cannot make themselves an owner'
);
reset role;
select set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
select lives_ok(
  $$select public.set_learner_plan_member_role('82000000-0000-0000-0000-000000000100', '82000000-0000-0000-0000-00000000000c', 'owner')$$,
  'an owner makes a follower a co-owner'
);
select throws_ok(
  $$select public.set_learner_plan_member_role('82000000-0000-0000-0000-000000000100', '82000000-0000-0000-0000-00000000000d', 'owner')$$,
  '23514', 'They are not on this plan',
  'only someone on the plan can be made an owner'
);

reset role;
select set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-00000000000c', true);
set local role authenticated;
insert into public.learner_plan_items (plan_id, position, item_type, step_title)
values ('82000000-0000-0000-0000-000000000100', 1, 'step', 'Added by a co-owner');
select is(
  (select count(*)::int from public.learner_plan_items where plan_id = '82000000-0000-0000-0000-000000000100'),
  2,
  'a co-owner edits the plan'
);
select is(
  (select count(*)::int from public.list_learner_plan_members('82000000-0000-0000-0000-000000000100')),
  3,
  'a co-owner sees everyone on the plan'
);
select throws_ok(
  $$select public.set_learner_plan_member_role('82000000-0000-0000-0000-000000000100', '82000000-0000-0000-0000-00000000000a', 'follower')$$,
  '23514', 'The person who created the plan is always an owner',
  'nobody can take the creator''s ownership away'
);
delete from public.learner_plans where id = '82000000-0000-0000-0000-000000000100';
reset role;
select is(
  (select count(*)::int from public.learner_plans where id = '82000000-0000-0000-0000-000000000100'),
  1,
  'only the creator can delete the plan'
);
insert into public.skills (id, user_id, name, category, level) values
  ('82000000-0000-0000-0000-0000000000c1', '82000000-0000-0000-0000-00000000000c', 'Cy''s skill', 'Test', 2);
set local role authenticated;
select throws_ok(
  $$update public.learner_plan_items set step_skill_id = '82000000-0000-0000-0000-0000000000c1' where step_title = 'Do the thing'$$,
  '23514', 'Only the person who added this item can change what it points to',
  'a co-owner cannot point someone else''s item at their own records'
);
reset role;

-- Leaving
select set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-00000000000b', true);
set local role authenticated;
insert into public.learner_plan_item_progress (item_id, user_id, completed_on)
values ('82000000-0000-0000-0000-000000000121', '82000000-0000-0000-0000-00000000000b', current_date);
select lives_ok(
  $$select public.leave_learner_plan('82000000-0000-0000-0000-000000000100')$$,
  'a follower can leave the plan'
);
select is(
  (select count(*)::int from public.learner_plans where id = '82000000-0000-0000-0000-000000000100'),
  0,
  'after leaving, the plan is no longer theirs to see'
);
reset role;
select is(
  (select count(*)::int from public.learner_plan_item_progress where user_id = '82000000-0000-0000-0000-00000000000b'),
  0,
  'leaving clears their ticks on the plan'
);
select set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
select results_eq(
  $$select status from public.list_learner_plan_members('82000000-0000-0000-0000-000000000100') where name = 'Bo Follower'$$,
  $$values ('left'::text)$$,
  'the owners see that they left'
);
select throws_ok(
  $$select public.leave_learner_plan('82000000-0000-0000-0000-000000000100')$$,
  '23514', 'You created this plan, so you can delete it but not leave it',
  'the creator cannot leave'
);

-- Co-owner C adds an item of theirs and invites someone; then is made a
-- follower (their waiting invitation is withdrawn) and removed (their item
-- stops pointing at their records).
reset role;
select set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-00000000000c', true);
set local role authenticated;
insert into public.learner_plan_items (id, plan_id, position, item_type, skill_id)
values ('82000000-0000-0000-0000-000000000129', '82000000-0000-0000-0000-000000000100', 2, 'skill', '82000000-0000-0000-0000-0000000000c1');
select * from public.invite_emails_to_learner_plan('82000000-0000-0000-0000-000000000100', array['friend-of-cy@example.com']);

reset role;
select set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
select public.set_learner_plan_member_role('82000000-0000-0000-0000-000000000100', '82000000-0000-0000-0000-00000000000c', 'follower');
reset role;
select is(
  (select status from public.learner_plan_invitations where invitee_email = 'friend-of-cy@example.com'),
  'revoked',
  'making a co-owner a follower withdraws the invitations they sent'
);
select set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
select lives_ok(
  $$select public.remove_learner_plan_member('82000000-0000-0000-0000-000000000100', '82000000-0000-0000-0000-00000000000c')$$,
  'an owner can take someone off the plan'
);
select throws_ok(
  $$select public.remove_learner_plan_member('82000000-0000-0000-0000-000000000100', '82000000-0000-0000-0000-00000000000a')$$,
  '23514', 'To take yourself off the plan, leave it',
  'an owner does not remove themselves'
);
reset role;
select results_eq(
  $$select skill_id is null, (select count(*)::int from public.learner_plan_members where plan_id = '82000000-0000-0000-0000-000000000100' and user_id = '82000000-0000-0000-0000-00000000000c')
    from public.learner_plan_items where id = '82000000-0000-0000-0000-000000000129'$$,
  $$values (true, 0)$$,
  'someone taken off the plan is no longer on it, and their item no longer shows their records'
);
select is(
  (select count(*)::int from public.skills where id = '82000000-0000-0000-0000-0000000000c1'),
  1,
  'their own records stay theirs'
);


select * from finish();
rollback;
