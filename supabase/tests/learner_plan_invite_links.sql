\set ON_ERROR_STOP on

begin;

select plan(32);

-- A owns the plan; B, C, D and E are not connected to A at all.
insert into auth.users (id, email, email_confirmed_at) values
  ('83000000-0000-0000-0000-00000000000a', 'link-a@example.com', now()),
  ('83000000-0000-0000-0000-00000000000b', 'link-b@example.com', now()),
  ('83000000-0000-0000-0000-00000000000c', 'link-c@example.com', now()),
  ('83000000-0000-0000-0000-00000000000d', 'link-d@example.com', now()),
  ('83000000-0000-0000-0000-00000000000e', 'link-e@example.com', now());

update public.profiles set first_name = 'Ada', last_name = 'Owner' where id = '83000000-0000-0000-0000-00000000000a';
update public.profiles set first_name = 'Ben', last_name = 'Joiner' where id = '83000000-0000-0000-0000-00000000000b';
update public.profiles set first_name = 'Cat', last_name = 'Emailed' where id = '83000000-0000-0000-0000-00000000000c';

insert into public.learner_plans (id, user_id, title, description, status) values
  ('83000000-0000-0000-0000-000000000100', '83000000-0000-0000-0000-00000000000a', 'Learn to present', 'Six weeks', 'active');
insert into public.learner_plan_items (plan_id, position, item_type, step_title) values
  ('83000000-0000-0000-0000-000000000100', 0, 'step', 'Give a lightning talk'),
  ('83000000-0000-0000-0000-000000000100', 1, 'step', 'Record yourself');

create temporary table codes (name text primary key, code text);
grant all on codes to authenticated, anon;

-- The owner's link and email invitations.
select set_config('request.jwt.claim.sub', '83000000-0000-0000-0000-00000000000a', true);
set local role authenticated;

insert into codes values ('link', public.get_learner_plan_share_link('83000000-0000-0000-0000-000000000100'));
select is(
  public.get_learner_plan_share_link('83000000-0000-0000-0000-000000000100'),
  (select code from codes where name = 'link'),
  'the plan keeps one share link until it is replaced'
);
insert into codes
select 'email', share_code from public.invite_emails_to_learner_plan(
  '83000000-0000-0000-0000-000000000100', array['Cat@Example.com']
);
select results_eq(
  $$select email, created from public.invite_emails_to_learner_plan('83000000-0000-0000-0000-000000000100', array['cat@example.com'])$$,
  $$values ('cat@example.com'::text, false)$$,
  'inviting the same address again returns the invitation still waiting'
);
select throws_ok(
  $$select * from public.invite_emails_to_learner_plan('83000000-0000-0000-0000-000000000100', array['not an email'])$$,
  '23514', null,
  'an invalid address is refused'
);
select results_eq(
  $$select status, own from (select status, true as own from public.get_learner_plan_invite_preview((select code from codes where name = 'link'))) preview$$,
  $$values ('own_plan'::text, true)$$,
  'the owner is told the link is for their own plan'
);
select throws_ok(
  format($$select public.accept_learner_plan_invite(%L)$$, (select code from codes where name = 'link')),
  '23514', 'This is your own plan',
  'the owner cannot join their own plan'
);

-- Someone else cannot manage the owner's link or invitations.
reset role;
select set_config('request.jwt.claim.sub', '83000000-0000-0000-0000-00000000000b', true);
set local role authenticated;
select throws_ok(
  $$select public.get_learner_plan_share_link('83000000-0000-0000-0000-000000000100')$$,
  '42501', 'Plan not found or not owned by you',
  'only the owner can get the share link'
);
select throws_ok(
  $$select * from public.invite_emails_to_learner_plan('83000000-0000-0000-0000-000000000100', array['x@example.com'])$$,
  '42501', 'Plan not found or not owned by you',
  'only the owner can invite by email'
);
select is(
  (select count(*)::int from public.learner_plan_share_links),
  0,
  'share links are not visible to others'
);

-- Signed out: the link shows what it is for, and nothing about joining.
reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role anon;
select results_eq(
  format($$select kind, status, plan_title, item_count, inviter_name, joined_plan_id from public.get_learner_plan_invite_preview(%L)$$, (select code from codes where name = 'link')),
  $$values ('link'::text, 'open'::text, 'Learn to present'::text, 2, 'Ada Owner'::text, null::uuid)$$,
  'a signed-out visitor sees the plan the link is for'
);
select throws_ok(
  format($$select public.accept_learner_plan_invite(%L)$$, (select code from codes where name = 'link')),
  '42501', null,
  'a signed-out visitor cannot join'
);
select is(
  (select count(*)::int from public.get_learner_plan_invite_preview('no-such-code')),
  0,
  'an unknown code shows nothing'
);

-- B, not a connection, joins with the link.
reset role;
select set_config('request.jwt.claim.sub', '83000000-0000-0000-0000-00000000000b', true);
set local role authenticated;
insert into codes values ('b_copy', public.accept_learner_plan_invite((select code from codes where name = 'link'))::text);
select is(
  (select code from codes where name = 'b_copy'),
  '83000000-0000-0000-0000-000000000100',
  'joining with the link joins the plan itself, for someone who is not a connection'
);
select results_eq(
  $$select role from public.learner_plan_members where plan_id = '83000000-0000-0000-0000-000000000100' and user_id = '83000000-0000-0000-0000-00000000000b'$$,
  $$values ('follower'::text)$$,
  'they follow the plan'
);
select is(
  public.accept_learner_plan_invite((select code from codes where name = 'link'))::text,
  (select code from codes where name = 'b_copy'),
  'joining again changes nothing'
);
select results_eq(
  format($$select status, joined_plan_id::text from public.get_learner_plan_invite_preview(%L)$$, (select code from codes where name = 'link')),
  $$select 'joined'::text, code from codes where name = 'b_copy'$$,
  'the preview tells someone who joined where the plan is'
);
select is(
  (select count(*)::int from public.record_learner_plan_progress(
    jsonb_build_array(jsonb_build_object('plan_id', (select code from codes where name = 'b_copy'), 'done', 1, 'total', 2))
  )),
  1,
  'someone who joined with the link shares their progress'
);

-- C opens the emailed link, signed in with a different address, and joins.
reset role;
select set_config('request.jwt.claim.sub', '83000000-0000-0000-0000-00000000000c', true);
set local role authenticated;
select isnt(
  public.accept_learner_plan_invite((select code from codes where name = 'email')),
  null,
  'the emailed invitation can be accepted'
);

-- D tries the same emailed link: it has been used.
reset role;
select set_config('request.jwt.claim.sub', '83000000-0000-0000-0000-00000000000d', true);
set local role authenticated;
select throws_ok(
  format($$select public.accept_learner_plan_invite(%L)$$, (select code from codes where name = 'email')),
  '23514', 'This invitation has already been used',
  'an emailed invitation works once'
);
select is(
  (select status from public.get_learner_plan_invite_preview((select code from codes where name = 'email'))),
  'used',
  'the preview says the emailed invitation has been used'
);

-- The owner replaces the link: it stops working for new people.
reset role;
select set_config('request.jwt.claim.sub', '83000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
insert into codes values ('new_link', public.replace_learner_plan_share_link('83000000-0000-0000-0000-000000000100'));
select isnt(
  (select code from codes where name = 'new_link'),
  (select code from codes where name = 'link'),
  'replacing the link gives a new one'
);
select invite_emails_to_learner_plan('83000000-0000-0000-0000-000000000100', array['pending@example.com']);
select results_eq(
  $$select name, via, status, progress_done
    from public.list_learner_plan_members('83000000-0000-0000-0000-000000000100')
    order by name$$,
  $$values
    ('Ada Owner'::text, 'creator'::text, 'member'::text, null::integer),
    ('Ben Joiner'::text, 'link'::text, 'member'::text, 1),
    ('Cat Emailed'::text, 'email'::text, 'member'::text, null::integer),
    ('pending@example.com'::text, 'email'::text, 'pending'::text, null::integer)$$,
  'the owner sees everyone who joined, however they were invited'
);

reset role;
select set_config('request.jwt.claim.sub', '83000000-0000-0000-0000-00000000000e', true);
set local role authenticated;
select throws_ok(
  format($$select public.accept_learner_plan_invite(%L)$$, (select code from codes where name = 'link')),
  '23514', 'This link has been replaced and no longer works',
  'a replaced link no longer lets people join'
);
select isnt(
  public.accept_learner_plan_invite((select code from codes where name = 'new_link')),
  null,
  'the new link works'
);
reset role;
select set_config('request.jwt.claim.sub', '83000000-0000-0000-0000-00000000000d', true);
set local role authenticated;
select results_eq(
  format($$select status, plan_title, inviter_name from public.get_learner_plan_invite_preview(%L)$$, (select code from codes where name = 'link')),
  $$values ('revoked'::text, null::text, null::text)$$,
  'a replaced link no longer shows the plan to someone who has not joined'
);
reset role;
select is(
  (select count(*)::int from public.learner_plan_members
    where plan_id = '83000000-0000-0000-0000-000000000100' and user_id = '83000000-0000-0000-0000-00000000000b'),
  1,
  'people who joined with the old link stay on the plan'
);

-- C accepted an emailed invitation: C can read their own row, but not the
-- address it was sent to or its code.
select set_config('request.jwt.claim.sub', '83000000-0000-0000-0000-00000000000c', true);
set local role authenticated;
select is(
  (select status from public.learner_plan_invitations where recipient_id = '83000000-0000-0000-0000-00000000000c'),
  'accepted',
  'the recipient can read their own invitation'
);
select throws_ok(
  $$select invitee_email from public.learner_plan_invitations$$,
  '42501', null,
  'the address an invitation was emailed to is not readable directly'
);
select throws_ok(
  $$select share_code from public.learner_plan_invitations$$,
  '42501', null,
  'invitation codes are not readable directly'
);

-- Withdrawing an invitation still waiting.
reset role;
insert into codes
select 'pending_id', id::text from public.learner_plan_invitations where invitee_email = 'pending@example.com';
insert into codes
select 'pending_code', share_code from public.learner_plan_invitations where invitee_email = 'pending@example.com';

select set_config('request.jwt.claim.sub', '83000000-0000-0000-0000-00000000000c', true);
set local role authenticated;
select throws_ok(
  format($$select public.withdraw_learner_plan_invitation(%L)$$, (select code from codes where name = 'pending_id')),
  '42501', null,
  'only the owner can withdraw an invitation'
);

reset role;
select set_config('request.jwt.claim.sub', '83000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
select lives_ok(
  format($$select public.withdraw_learner_plan_invitation(%L)$$, (select code from codes where name = 'pending_id')),
  'the owner can withdraw an invitation still waiting'
);
select throws_ok(
  format($$select public.withdraw_learner_plan_invitation(%L)$$, (select code from codes where name = 'pending_id')),
  '23514', 'Only an invitation still waiting can be withdrawn',
  'an invitation can only be withdrawn once'
);

reset role;
select set_config('request.jwt.claim.sub', '83000000-0000-0000-0000-00000000000d', true);
set local role authenticated;
select throws_ok(
  format($$select public.accept_learner_plan_invite(%L)$$, (select code from codes where name = 'pending_code')),
  '23514', 'This invitation has already been used',
  'a withdrawn invitation cannot be accepted'
);
reset role;

select * from finish();
rollback;
