\set ON_ERROR_STOP on

begin;

select plan(20);

insert into auth.users (id, email, email_confirmed_at) values
  ('82000000-0000-0000-0000-00000000000a', 'share-a@example.com', now()),
  ('82000000-0000-0000-0000-00000000000b', 'share-b@example.com', now()),
  ('82000000-0000-0000-0000-00000000000c', 'share-c@example.com', now());

update public.profiles set first_name = 'Bo', last_name = 'Follower'
where id = '82000000-0000-0000-0000-00000000000b';

insert into public.connections (user_a_id, user_b_id, source) values
  ('82000000-0000-0000-0000-00000000000a', '82000000-0000-0000-0000-00000000000b', 'request'),
  ('82000000-0000-0000-0000-00000000000a', '82000000-0000-0000-0000-00000000000c', 'request');

insert into public.learner_plans (id, user_id, title, status) values
  ('82000000-0000-0000-0000-000000000100', '82000000-0000-0000-0000-00000000000a', 'Shared plan', 'active'),
  ('82000000-0000-0000-0000-000000000200', '82000000-0000-0000-0000-00000000000b', 'Bo''s own plan', 'active');
insert into public.learner_plan_items (plan_id, position, item_type, step_title) values
  ('82000000-0000-0000-0000-000000000100', 0, 'step', 'Do the thing');

-- The owner invites B and C; B accepts.
select set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
select * from public.invite_connections_to_learner_plan(
  '82000000-0000-0000-0000-000000000100',
  array['82000000-0000-0000-0000-00000000000b', '82000000-0000-0000-0000-00000000000c']::uuid[]
);

reset role;
select set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-00000000000b', true);
set local role authenticated;
create temporary table accepted_copy as
select public.respond_to_learner_plan_invitation(
  (select id from public.learner_plan_invitations where recipient_id = '82000000-0000-0000-0000-00000000000b'),
  true
) as copied_plan_id;
grant select on accepted_copy to authenticated;

select results_eq(
  format(
    $$select * from public.record_learner_plan_progress('[{"plan_id": "%s", "done": 1, "total": 4}, {"plan_id": "82000000-0000-0000-0000-000000000200", "done": 0, "total": 2}]'::jsonb)$$,
    (select copied_plan_id from accepted_copy)
  ),
  $$select copied_plan_id from accepted_copy$$,
  'the recipient records progress on their copy; a plan of their own is not shared'
);
select throws_ok(
  format(
    $$select * from public.record_learner_plan_progress('[{"plan_id": "%s", "done": 5, "total": 4}]'::jsonb)$$,
    (select copied_plan_id from accepted_copy)
  ),
  '23514', 'Invalid plan progress',
  'progress cannot be more than the total'
);
select throws_ok(
  $$select * from public.list_learner_plan_members('82000000-0000-0000-0000-000000000100')$$,
  '42501', 'Plan not found or not owned by you',
  'a recipient cannot list the people on the source plan'
);
select throws_ok(
  $$update public.learner_plan_invitations set progress_done = 4, progress_total = 4, progress_updated_at = now()$$,
  '42501', null,
  'progress cannot be written directly'
);

-- C cannot write progress onto B's invitation through the copied plan id.
reset role;
select set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-00000000000c', true);
set local role authenticated;
select is(
  (select count(*)::int from public.record_learner_plan_progress(
    jsonb_build_array(jsonb_build_object('plan_id', (select copied_plan_id from accepted_copy), 'done', 4, 'total', 4))
  )),
  0,
  'another learner cannot record progress on someone else''s copy'
);

reset role;
select set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
select results_eq(
  $$select recipient_name, status, plan_removed, progress_done, progress_total
    from public.list_learner_plan_members('82000000-0000-0000-0000-000000000100')
    order by recipient_name, status$$,
  $$values
    ('A LearnScope user'::text, 'pending'::text, false, null::integer, null::integer),
    ('Bo Follower'::text, 'accepted'::text, false, 1, 4)$$,
  'the owner sees everyone invited, with progress shared by those who accepted'
);
select ok(
  (select progress_updated_at is not null from public.list_learner_plan_members('82000000-0000-0000-0000-000000000100') where status = 'accepted'),
  'the owner sees when progress was last updated'
);

-- Opening the plan again with nothing changed doesn't move the time on.
reset role;
update public.learner_plan_invitations set progress_updated_at = '2026-01-01T00:00:00Z'
where recipient_id = '82000000-0000-0000-0000-00000000000b';
select set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-00000000000b', true);
set local role authenticated;
select results_eq(
  format(
    $$select * from public.record_learner_plan_progress('[{"plan_id": "%s", "done": 1, "total": 4}]'::jsonb)$$,
    (select copied_plan_id from accepted_copy)
  ),
  $$select copied_plan_id from accepted_copy$$,
  'unchanged progress is still reported as shared'
);
select is(
  (select progress_updated_at from public.learner_plan_invitations where recipient_id = '82000000-0000-0000-0000-00000000000b'),
  '2026-01-01T00:00:00Z'::timestamptz,
  'unchanged progress does not move the updated time on'
);
select throws_ok(
  $$select * from public.record_learner_plan_progress((select jsonb_agg(jsonb_build_object('plan_id', gen_random_uuid(), 'done', 0, 'total', 0)) from generate_series(1, 501)))$$,
  '23514', 'Too many plans at once',
  'progress for too many plans at once is refused'
);

-- B deletes their copy: allowed, the owner sees it was removed, and the last
-- shared figures go with it.
select lives_ok(
  $$delete from public.learner_plans where id = (select copied_plan_id from accepted_copy)$$,
  'a recipient can delete their copy of an accepted plan'
);
reset role;
select is(
  (select row(progress_done, progress_total, progress_updated_at)::text from public.learner_plan_invitations where recipient_id = '82000000-0000-0000-0000-00000000000b'),
  row(null::integer, null::integer, null::timestamptz)::text,
  'deleting the copy clears the progress it shared'
);

reset role;
select set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
select results_eq(
  $$select status, plan_removed from public.list_learner_plan_members('82000000-0000-0000-0000-000000000100') where recipient_name = 'Bo Follower'$$,
  $$values ('accepted'::text, true)$$,
  'the owner sees the recipient removed their copy'
);

reset role;
select set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-00000000000c', true);
set local role authenticated;
select throws_ok(
  $$select * from public.list_learner_plan_members('82000000-0000-0000-0000-000000000100')$$,
  '42501', 'Plan not found or not owned by you',
  'someone else cannot list a plan''s members'
);

reset role;
select throws_ok(
  $$update public.learner_plan_invitations set progress_done = 2, progress_total = 1, progress_updated_at = now()
    where recipient_id = '82000000-0000-0000-0000-00000000000c'$$,
  '23514', null,
  'stored progress stays within its total'
);

-- A second plan, accepted by C, then the owner and C disconnect.
insert into public.learner_plans (id, user_id, title, status) values
  ('82000000-0000-0000-0000-000000000300', '82000000-0000-0000-0000-00000000000a', 'Second plan', 'active');
select set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-00000000000c', true);
set local role authenticated;
create temporary table c_copy as
select public.respond_to_learner_plan_invitation(
  (select id from public.learner_plan_invitations where recipient_id = '82000000-0000-0000-0000-00000000000c' and status = 'pending'),
  true
) as copied_plan_id;
reset role;
grant select on c_copy to authenticated;
select set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
select * from public.invite_connections_to_learner_plan(
  '82000000-0000-0000-0000-000000000300', array['82000000-0000-0000-0000-00000000000c']::uuid[]
);
reset role;
select set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-00000000000c', true);
set local role authenticated;
select * from public.record_learner_plan_progress(
  jsonb_build_array(jsonb_build_object('plan_id', (select copied_plan_id from c_copy), 'done', 2, 'total', 3))
);
reset role;

delete from public.connections
where user_a_id = least('82000000-0000-0000-0000-00000000000a'::uuid, '82000000-0000-0000-0000-00000000000c'::uuid)
  and user_b_id = greatest('82000000-0000-0000-0000-00000000000a'::uuid, '82000000-0000-0000-0000-00000000000c'::uuid);

-- Plan sharing doesn't depend on being connected (0302): disconnecting
-- leaves shared progress and waiting invitations as they were.
select is(
  (select progress_done from public.learner_plan_invitations where copied_plan_id = (select copied_plan_id from c_copy)),
  2,
  'disconnecting leaves progress already shared'
);
select is(
  (select status from public.learner_plan_invitations where source_plan_id = '82000000-0000-0000-0000-000000000300'),
  'pending',
  'disconnecting leaves an invitation still waiting'
);

select set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-00000000000c', true);
set local role authenticated;
select is(
  (select count(*)::int from public.record_learner_plan_progress(
    jsonb_build_array(jsonb_build_object('plan_id', (select copied_plan_id from c_copy), 'done', 3, 'total', 3))
  )),
  1,
  'progress is still shared after disconnecting'
);
select isnt(
  public.respond_to_learner_plan_invitation(
    (select id from public.learner_plan_invitations where source_plan_id = '82000000-0000-0000-0000-000000000300'), true
  ),
  null,
  'an invitation can still be accepted after disconnecting'
);
reset role;
select set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
select results_eq(
  $$select status, progress_done from public.list_learner_plan_members('82000000-0000-0000-0000-000000000100')
    where recipient_id = '82000000-0000-0000-0000-00000000000c'$$,
  $$values ('accepted'::text, 3)$$,
  'the owner still sees a former connection''s progress'
);
reset role;

select * from finish();
rollback;
