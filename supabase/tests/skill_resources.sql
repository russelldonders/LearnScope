\set ON_ERROR_STOP on

begin;

select plan(22);

-- A owns the resources. B and C are A's connections (B chosen, C not), D
-- tracks the same library skill without being connected, E tracks nothing.
insert into auth.users (id, email, email_confirmed_at) values
  ('7c000000-0000-0000-0000-00000000000a', 'res-a@example.com', now()),
  ('7c000000-0000-0000-0000-00000000000b', 'res-b@example.com', now()),
  ('7c000000-0000-0000-0000-00000000000c', 'res-c@example.com', now()),
  ('7c000000-0000-0000-0000-00000000000d', 'res-d@example.com', now()),
  ('7c000000-0000-0000-0000-00000000000e', 'res-e@example.com', now());

insert into public.skill_library (id, name, status)
values ('7c000000-0000-0000-0000-000000000100', 'Resource sharing', 'active');

insert into public.skills (id, user_id, name, category, level, library_skill_id) values
  ('7c000000-0000-0000-0000-0000000000a1', '7c000000-0000-0000-0000-00000000000a', 'Resource sharing', 'Test', 1, '7c000000-0000-0000-0000-000000000100'),
  ('7c000000-0000-0000-0000-0000000000b1', '7c000000-0000-0000-0000-00000000000b', 'Resource sharing', 'Test', 1, '7c000000-0000-0000-0000-000000000100'),
  ('7c000000-0000-0000-0000-0000000000c1', '7c000000-0000-0000-0000-00000000000c', 'Resource sharing', 'Test', 1, '7c000000-0000-0000-0000-000000000100'),
  ('7c000000-0000-0000-0000-0000000000d1', '7c000000-0000-0000-0000-00000000000d', 'Resource sharing', 'Test', 1, '7c000000-0000-0000-0000-000000000100'),
  ('7c000000-0000-0000-0000-0000000000e1', '7c000000-0000-0000-0000-00000000000e', 'Something else', 'Test', 1, null);

insert into public.connections (user_a_id, user_b_id, source) values
  (least('7c000000-0000-0000-0000-00000000000a'::uuid, '7c000000-0000-0000-0000-00000000000b'::uuid),
   greatest('7c000000-0000-0000-0000-00000000000a'::uuid, '7c000000-0000-0000-0000-00000000000b'::uuid), 'request'),
  (least('7c000000-0000-0000-0000-00000000000a'::uuid, '7c000000-0000-0000-0000-00000000000c'::uuid),
   greatest('7c000000-0000-0000-0000-00000000000a'::uuid, '7c000000-0000-0000-0000-00000000000c'::uuid), 'request');

-- The local stack lacks Staging's default table grants.
grant all on table public.skill_resources, public.skill_resource_recipients, public.skills, public.connections, public.profiles to authenticated;

create function pg_temp.shared_titles(p_skill uuid) returns text[] language sql as $$
  select coalesce(array_agg(title order by title), '{}') from public.list_shared_skill_resources(p_skill)
$$;

select set_config('request.jwt.claim.sub', '7c000000-0000-0000-0000-00000000000a', true);
set local role authenticated;

insert into public.skill_resources (id, user_id, skill_id, kind, title, url, audience) values
  ('7c000000-0000-0000-0000-000000000201', '7c000000-0000-0000-0000-00000000000a', '7c000000-0000-0000-0000-0000000000a1', 'link', 'Private link', 'https://example.com/1', 'private'),
  ('7c000000-0000-0000-0000-000000000202', '7c000000-0000-0000-0000-00000000000a', '7c000000-0000-0000-0000-0000000000a1', 'link', 'Selected link', 'https://example.com/2', 'selected'),
  ('7c000000-0000-0000-0000-000000000203', '7c000000-0000-0000-0000-00000000000a', '7c000000-0000-0000-0000-0000000000a1', 'video', 'Connections video', 'https://example.com/3', 'connections'),
  ('7c000000-0000-0000-0000-000000000204', '7c000000-0000-0000-0000-00000000000a', '7c000000-0000-0000-0000-0000000000a1', 'link', 'Public link', 'https://example.com/4', 'skill_public');

insert into public.skill_resources (id, user_id, skill_id, kind, title, file_path, file_name, audience) values
  ('7c000000-0000-0000-0000-000000000205', '7c000000-0000-0000-0000-00000000000a', '7c000000-0000-0000-0000-0000000000a1', 'file', 'Notes', '7c000000-0000-0000-0000-00000000000a/notes.pdf', 'notes.pdf', 'connections');

insert into public.skill_resource_recipients (resource_id, recipient_id)
values ('7c000000-0000-0000-0000-000000000202', '7c000000-0000-0000-0000-00000000000b');

select throws_ok(
  $$insert into public.skill_resource_recipients (resource_id, recipient_id)
    values ('7c000000-0000-0000-0000-000000000202', '7c000000-0000-0000-0000-00000000000d')$$,
  '42501', null, 'cannot share with someone who is not a connection'
);

select throws_ok(
  $$insert into public.skill_resources (user_id, skill_id, kind, title, file_path, audience)
    values ('7c000000-0000-0000-0000-00000000000a', '7c000000-0000-0000-0000-0000000000a1', 'file', 'Public file', '7c000000-0000-0000-0000-00000000000a/x.pdf', 'skill_public')$$,
  '23514', null, 'an uploaded file cannot be shared publicly'
);

select throws_ok(
  $$insert into public.skill_resources (user_id, skill_id, kind, title, url)
    values ('7c000000-0000-0000-0000-00000000000a', '7c000000-0000-0000-0000-0000000000b1', 'link', 'On B''s skill', 'https://example.com')$$,
  '42501', null, 'cannot add a resource to someone else''s skill'
);

select throws_ok(
  $$insert into public.skill_resources (user_id, skill_id, kind, title, file_path)
    values ('7c000000-0000-0000-0000-00000000000a', '7c000000-0000-0000-0000-0000000000a1', 'file', 'Theirs', '7c000000-0000-0000-0000-00000000000b/x.pdf')$$,
  '23514', null, 'a file must sit in the owner''s own folder'
);

select throws_ok(
  $$insert into public.skill_resources (user_id, skill_id, kind, title, url)
    values ('7c000000-0000-0000-0000-00000000000a', '7c000000-0000-0000-0000-0000000000a1', 'link', 'Script', 'javascript:alert(1)')$$,
  '23514', null, 'only http(s) links are stored'
);

-- Editing changes the title, note and sharing, never what the resource is.
update public.skill_resources
set title = 'Renamed notes', kind = 'link', url = 'https://example.com/x', file_path = null
where id = '7c000000-0000-0000-0000-000000000205';
select results_eq(
  $$select title, kind, file_path from public.skill_resources where id = '7c000000-0000-0000-0000-000000000205'$$,
  $$values ('Renamed notes'::text, 'file'::text, '7c000000-0000-0000-0000-00000000000a/notes.pdf'::text)$$,
  'a file stays a file when edited'
);

select is((select count(*)::int from public.skill_resources), 5, 'the owner sees all of their resources');

select throws_ok(
  $$select private.can_view_skill_resource('7c000000-0000-0000-0000-000000000202', '7c000000-0000-0000-0000-00000000000b')$$,
  '42501', null, 'learners cannot ask whether someone else can see a resource'
);

reset role;
select set_config('request.jwt.claim.sub', '7c000000-0000-0000-0000-00000000000b', true);
set local role authenticated;

select is((select count(*)::int from public.skill_resources), 0, 'others never read the resources table directly');
select is(
  pg_temp.shared_titles('7c000000-0000-0000-0000-0000000000b1'),
  array['Connections video', 'Public link', 'Renamed notes', 'Selected link'],
  'a chosen connection is shown selected, connections and public, not private'
);
select is(
  (select sharer_name from public.list_shared_skill_resources('7c000000-0000-0000-0000-0000000000b1') limit 1),
  'A LearnScope learner', 'with a name to show even without a profile name'
);
select is(
  (select count(*)::int from public.list_shared_skill_resources('7c000000-0000-0000-0000-0000000000a1')),
  0, 'nothing is listed for a skill that is not the caller''s'
);
select ok(public.can_read_skill_resource_file('7c000000-0000-0000-0000-00000000000a/notes.pdf'), 'they can open a file shared with them');

reset role;
select set_config('request.jwt.claim.sub', '7c000000-0000-0000-0000-00000000000c', true);
set local role authenticated;

select is(
  pg_temp.shared_titles('7c000000-0000-0000-0000-0000000000c1'),
  array['Connections video', 'Public link', 'Renamed notes'],
  'a connection who was not chosen is not shown the selected resource'
);

reset role;
select set_config('request.jwt.claim.sub', '7c000000-0000-0000-0000-00000000000d', true);
set local role authenticated;

select is(
  pg_temp.shared_titles('7c000000-0000-0000-0000-0000000000d1'),
  array['Public link'],
  'someone tracking the same skill is shown only the public link'
);
select ok(not public.can_read_skill_resource_file('7c000000-0000-0000-0000-00000000000a/notes.pdf'), 'and cannot open the file');

reset role;
select set_config('request.jwt.claim.sub', '7c000000-0000-0000-0000-00000000000e', true);
set local role authenticated;

select is(
  (select count(*)::int from public.list_shared_skill_resources('7c000000-0000-0000-0000-0000000000e1')),
  0, 'a skill not from the library is shown nothing'
);
select ok(not public.can_read_skill_resource_file('7c000000-0000-0000-0000-00000000000a/notes.pdf'), 'someone else cannot open the file');

reset role;

select ok(
  not private.can_view_skill_resource('7c000000-0000-0000-0000-000000000201', '7c000000-0000-0000-0000-00000000000b'),
  'a private resource stays private'
);

-- Disconnecting ends sharing with that connection.
delete from public.connections
where user_a_id = least('7c000000-0000-0000-0000-00000000000a'::uuid, '7c000000-0000-0000-0000-00000000000b'::uuid)
  and user_b_id = greatest('7c000000-0000-0000-0000-00000000000a'::uuid, '7c000000-0000-0000-0000-00000000000b'::uuid);

select ok(
  not private.can_view_skill_resource('7c000000-0000-0000-0000-000000000202', '7c000000-0000-0000-0000-00000000000b'),
  'a selected resource is no longer visible after disconnecting'
);
select ok(
  not private.can_view_skill_resource('7c000000-0000-0000-0000-000000000205', '7c000000-0000-0000-0000-00000000000b'),
  'nor a file shared with all contacts'
);
select ok(
  private.can_view_skill_resource('7c000000-0000-0000-0000-000000000204', '7c000000-0000-0000-0000-00000000000b'),
  'but a public link still is, while they track the skill'
);

select * from finish();

rollback;
