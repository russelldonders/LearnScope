\set ON_ERROR_STOP on

begin;

select plan(8);

-- A and B are connected, and so are B and C. A shared a resource with B.
insert into auth.users (id, email, email_confirmed_at) values
  ('7f000000-0000-0000-0000-00000000000a', 'dc-a@example.com', now()),
  ('7f000000-0000-0000-0000-00000000000b', 'dc-b@example.com', now()),
  ('7f000000-0000-0000-0000-00000000000c', 'dc-c@example.com', now());

insert into public.skills (id, user_id, name, category, level) values
  ('7f000000-0000-0000-0000-0000000000a1', '7f000000-0000-0000-0000-00000000000a', 'Disconnecting', 'Test', 1);

insert into public.connections (user_a_id, user_b_id, source) values
  (least('7f000000-0000-0000-0000-00000000000a'::uuid, '7f000000-0000-0000-0000-00000000000b'::uuid),
   greatest('7f000000-0000-0000-0000-00000000000a'::uuid, '7f000000-0000-0000-0000-00000000000b'::uuid), 'request'),
  (least('7f000000-0000-0000-0000-00000000000b'::uuid, '7f000000-0000-0000-0000-00000000000c'::uuid),
   greatest('7f000000-0000-0000-0000-00000000000b'::uuid, '7f000000-0000-0000-0000-00000000000c'::uuid), 'request');

insert into public.skill_resources (id, user_id, skill_id, kind, title, url, audience)
values ('7f000000-0000-0000-0000-000000000201', '7f000000-0000-0000-0000-00000000000a', '7f000000-0000-0000-0000-0000000000a1', 'link', 'For B', 'https://example.com', 'selected');
insert into public.skill_resource_recipients (resource_id, recipient_id)
values ('7f000000-0000-0000-0000-000000000201', '7f000000-0000-0000-0000-00000000000b');

grant all on table public.connections to authenticated;

-- A can't end a connection they aren't part of.
select set_config('request.jwt.claim.sub', '7f000000-0000-0000-0000-00000000000a', true);
set local role authenticated;

select throws_ok(
  $$select public.disconnect_connection('7f000000-0000-0000-0000-00000000000c')$$,
  'P0001', 'You are not connected to this person',
  'cannot disconnect from someone you are not connected to'
);
select throws_ok(
  $$select public.disconnect_connection('7f000000-0000-0000-0000-00000000000a')$$,
  'P0001', 'Choose a connection to disconnect from',
  'cannot disconnect from yourself'
);
-- No policy lets anyone delete connections directly: the attempt matches
-- nothing (even with Staging's default table grants, mirrored above).
delete from public.connections;

reset role;
select ok(public.is_connected('7f000000-0000-0000-0000-00000000000a', '7f000000-0000-0000-0000-00000000000b'), 'connections cannot be deleted directly');
select ok(public.is_connected('7f000000-0000-0000-0000-00000000000b', '7f000000-0000-0000-0000-00000000000c'), 'other people''s connections are untouched');

-- B ends the connection with A (either side may).
select set_config('request.jwt.claim.sub', '7f000000-0000-0000-0000-00000000000b', true);
set local role authenticated;
select lives_ok(
  $$select public.disconnect_connection('7f000000-0000-0000-0000-00000000000a')$$,
  'either person can end the connection'
);
reset role;

select ok(not public.is_connected('7f000000-0000-0000-0000-00000000000a', '7f000000-0000-0000-0000-00000000000b'), 'they are no longer connected');
select ok(public.is_connected('7f000000-0000-0000-0000-00000000000b', '7f000000-0000-0000-0000-00000000000c'), 'B''s other connections stay');
select is(
  (select count(*)::int from public.skill_resource_recipients where resource_id = '7f000000-0000-0000-0000-000000000201'),
  0, 'B is dropped from A''s chosen contacts'
);

select * from finish();

rollback;
