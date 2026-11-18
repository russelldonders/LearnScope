\set ON_ERROR_STOP on

begin;

select plan(18);

-- A owns the packages; B is A's connection; D tracks the same library skill
-- but isn't connected; E tracks nothing.
insert into auth.users (id, email, email_confirmed_at) values
  ('7d000000-0000-0000-0000-00000000000a', 'pkg-a@example.com', now()),
  ('7d000000-0000-0000-0000-00000000000b', 'pkg-b@example.com', now()),
  ('7d000000-0000-0000-0000-00000000000d', 'pkg-d@example.com', now()),
  ('7d000000-0000-0000-0000-00000000000e', 'pkg-e@example.com', now());

insert into public.skill_library (id, name, status)
values ('7d000000-0000-0000-0000-000000000100', 'Package sharing', 'active');

insert into public.skills (id, user_id, name, category, level, library_skill_id) values
  ('7d000000-0000-0000-0000-0000000000a1', '7d000000-0000-0000-0000-00000000000a', 'Package sharing', 'Test', 1, '7d000000-0000-0000-0000-000000000100'),
  ('7d000000-0000-0000-0000-0000000000b1', '7d000000-0000-0000-0000-00000000000b', 'Package sharing', 'Test', 1, '7d000000-0000-0000-0000-000000000100'),
  ('7d000000-0000-0000-0000-0000000000d1', '7d000000-0000-0000-0000-00000000000d', 'Package sharing', 'Test', 1, '7d000000-0000-0000-0000-000000000100');

insert into public.connections (user_a_id, user_b_id, source) values
  (least('7d000000-0000-0000-0000-00000000000a'::uuid, '7d000000-0000-0000-0000-00000000000b'::uuid),
   greatest('7d000000-0000-0000-0000-00000000000a'::uuid, '7d000000-0000-0000-0000-00000000000b'::uuid), 'request');

-- The local stack lacks Staging's default table grants.
grant all on table public.skill_resources, public.skill_resource_recipients, public.skills, public.connections,
  public.profiles, public.xapi_launch_sessions to authenticated;

select set_config('request.jwt.claim.sub', '7d000000-0000-0000-0000-00000000000a', true);
set local role authenticated;

insert into public.skill_resources (id, user_id, skill_id, kind, title, package_path, launch_path, file_name, audience) values
  ('7d000000-0000-0000-0000-000000000201', '7d000000-0000-0000-0000-00000000000a', '7d000000-0000-0000-0000-0000000000a1',
   'xapi', 'Connections xAPI', 'learners/7d000000-0000-0000-0000-00000000000a/7d000000-0000-0000-0000-000000000201', 'story.html', 'story.zip', 'connections'),
  ('7d000000-0000-0000-0000-000000000202', '7d000000-0000-0000-0000-00000000000a', '7d000000-0000-0000-0000-0000000000a1',
   'scorm', 'Public SCORM', 'learners/7d000000-0000-0000-0000-00000000000a/7d000000-0000-0000-0000-000000000202', 'index.html', 'course.zip', 'skill_public');

select pass('a learner adds SCORM and xAPI packages to their skill, a package shareable with everyone tracking it');

select throws_ok(
  $$insert into public.skill_resources (id, user_id, skill_id, kind, title, package_path, launch_path)
    values ('7d000000-0000-0000-0000-000000000203', '7d000000-0000-0000-0000-00000000000a', '7d000000-0000-0000-0000-0000000000a1',
      'scorm', 'Elsewhere', 'learners/7d000000-0000-0000-0000-00000000000b/7d000000-0000-0000-0000-000000000203', 'index.html')$$,
  '23514', null, 'a package lives only in its owner''s folder, named after the resource'
);

select throws_ok(
  $$insert into public.skill_resources (id, user_id, skill_id, kind, title, package_path, launch_path)
    values ('7d000000-0000-0000-0000-000000000204', '7d000000-0000-0000-0000-00000000000a', '7d000000-0000-0000-0000-0000000000a1',
      'scorm', 'Escape', 'learners/7d000000-0000-0000-0000-00000000000a/7d000000-0000-0000-0000-000000000204', '../other/index.html')$$,
  '23514', null, 'a launch page can''t climb out of the package folder'
);

select throws_ok(
  $$insert into public.skill_resources (id, user_id, skill_id, kind, title, url, launch_path)
    values ('7d000000-0000-0000-0000-000000000205', '7d000000-0000-0000-0000-00000000000a', '7d000000-0000-0000-0000-0000000000a1',
      'xapi', 'No folder', 'https://example.com', 'index.html')$$,
  '23514', null, 'a package has a folder, not a URL'
);

update public.skill_resources
set title = 'Renamed', package_path = 'learners/x/y', launch_path = 'other.html'
where id = '7d000000-0000-0000-0000-000000000202';

select is(
  (select package_path || ' ' || launch_path || ' ' || title from public.skill_resources where id = '7d000000-0000-0000-0000-000000000202'),
  'learners/7d000000-0000-0000-0000-00000000000a/7d000000-0000-0000-0000-000000000202 index.html Renamed',
  'editing a package changes its title, never where it is'
);

select throws_ok(
  $$insert into public.skill_resources (id, user_id, skill_id, kind, title, package_path, launch_path)
    values ('7d000000-0000-0000-0000-000000000206', '7d000000-0000-0000-0000-00000000000a', '7d000000-0000-0000-0000-0000000000a1',
      'scorm', 'Encoded', 'learners/7d000000-0000-0000-0000-00000000000a/7d000000-0000-0000-0000-000000000206', '%2E%2e/other/index.html')$$,
  '23514', null, 'nor with an encoded dot'
);

-- Package files go only into the folder of a package resource of their own.
insert into storage.objects (bucket_id, name, owner)
values ('course-content', 'learners/7d000000-0000-0000-0000-00000000000a/7d000000-0000-0000-0000-000000000202/index.html', '7d000000-0000-0000-0000-00000000000a');
select pass('a learner uploads into their own package resource''s folder');

select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner)
    values ('course-content', 'learners/7d000000-0000-0000-0000-00000000000a/7d000000-0000-0000-0000-0000000009ff/page.html', '7d000000-0000-0000-0000-00000000000a')$$,
  '42501', null, 'nothing goes into a folder no package resource of theirs names'
);

select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner)
    values ('course-content', 'learners/7d000000-0000-0000-0000-00000000000b/7d000000-0000-0000-0000-000000000202/x.html', '7d000000-0000-0000-0000-00000000000a')$$,
  '42501', null, 'nor into another learner''s folder'
);

-- The owner launches their own xAPI package.
insert into public.xapi_launch_sessions (skill_resource_id, user_id)
values ('7d000000-0000-0000-0000-000000000201', '7d000000-0000-0000-0000-00000000000a');
select pass('the owner can launch their xAPI package');

select throws_ok(
  $$insert into public.xapi_launch_sessions (skill_resource_id, user_id)
    values ('7d000000-0000-0000-0000-000000000202', '7d000000-0000-0000-0000-00000000000a')$$,
  '42501', null, 'only an xAPI package gets a launch session'
);

-- B: a connection, so sees the connections package.
select set_config('request.jwt.claim.sub', '7d000000-0000-0000-0000-00000000000b', true);

select is(
  (select array_agg(title || ' ' || package_path || ' ' || launch_path order by title)
   from public.list_shared_skill_resources('7d000000-0000-0000-0000-0000000000b1')),
  array[
    'Connections xAPI learners/7d000000-0000-0000-0000-00000000000a/7d000000-0000-0000-0000-000000000201 story.html',
    'Renamed learners/7d000000-0000-0000-0000-00000000000a/7d000000-0000-0000-0000-000000000202 index.html'
  ],
  'packages shared with a learner come with where to open them'
);

insert into public.xapi_launch_sessions (skill_resource_id, user_id)
values ('7d000000-0000-0000-0000-000000000201', '7d000000-0000-0000-0000-00000000000b');
select pass('a connection can launch a package shared with them, recording to their own record');

select throws_ok(
  $$insert into public.xapi_launch_sessions (skill_resource_id, user_id)
    values ('7d000000-0000-0000-0000-000000000201', '7d000000-0000-0000-0000-00000000000a')$$,
  '42501', null, 'nobody launches a session as someone else'
);

-- D: tracks the skill but isn't connected, so sees the public SCORM only.
select set_config('request.jwt.claim.sub', '7d000000-0000-0000-0000-00000000000d', true);

select is(
  (select array_agg(title) from public.list_shared_skill_resources('7d000000-0000-0000-0000-0000000000d1')),
  array['Renamed'],
  'a package shared with everyone tracking the skill reaches them; one for connections doesn''t'
);

select throws_ok(
  $$insert into public.xapi_launch_sessions (skill_resource_id, user_id)
    values ('7d000000-0000-0000-0000-000000000201', '7d000000-0000-0000-0000-00000000000d')$$,
  '42501', null, 'a package not shared with someone can''t be launched by them'
);

-- E: nobody to them.
select set_config('request.jwt.claim.sub', '7d000000-0000-0000-0000-00000000000e', true);
select is(public.can_launch_skill_resource_package('7d000000-0000-0000-0000-000000000201'), false,
  'a stranger can''t launch the package');

-- Below RLS, the table itself still insists on exactly one resource.
reset role;
select throws_ok(
  $$insert into public.xapi_launch_sessions (skill_resource_id, user_id) values (null, '7d000000-0000-0000-0000-00000000000d')$$,
  '23514', null, 'a launch session names a resource'
);

select * from finish();
rollback;
