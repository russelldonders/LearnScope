\set ON_ERROR_STOP on

begin;

select plan(7);

-- A shares two packages with B, a connection; M is a platform admin.
insert into auth.users (id, email, email_confirmed_at) values
  ('7f000000-0000-0000-0000-00000000000a', 'pkgmod-a@example.com', now()),
  ('7f000000-0000-0000-0000-00000000000b', 'pkgmod-b@example.com', now()),
  ('7f000000-0000-0000-0000-00000000000f', 'pkgmod-m@example.com', now());

insert into public.platform_admins (user_id) values ('7f000000-0000-0000-0000-00000000000f');

insert into public.skill_library (id, name, status)
values ('7f000000-0000-0000-0000-000000000100', 'Package moderation', 'active');

insert into public.skills (id, user_id, name, category, level, library_skill_id) values
  ('7f000000-0000-0000-0000-0000000000a1', '7f000000-0000-0000-0000-00000000000a', 'Package moderation', 'Test', 1, '7f000000-0000-0000-0000-000000000100'),
  ('7f000000-0000-0000-0000-0000000000b1', '7f000000-0000-0000-0000-00000000000b', 'Package moderation', 'Test', 1, '7f000000-0000-0000-0000-000000000100');

insert into public.connections (user_a_id, user_b_id, source) values
  (least('7f000000-0000-0000-0000-00000000000a'::uuid, '7f000000-0000-0000-0000-00000000000b'::uuid),
   greatest('7f000000-0000-0000-0000-00000000000a'::uuid, '7f000000-0000-0000-0000-00000000000b'::uuid), 'request');

insert into public.skill_resources (id, user_id, skill_id, kind, title, package_path, launch_path, audience) values
  ('7f000000-0000-0000-0000-000000000201', '7f000000-0000-0000-0000-00000000000a', '7f000000-0000-0000-0000-0000000000a1',
   'scorm', 'Reported', 'learners/7f000000-0000-0000-0000-00000000000a/7f000000-0000-0000-0000-000000000201', 'index.html', 'connections'),
  ('7f000000-0000-0000-0000-000000000202', '7f000000-0000-0000-0000-00000000000a', '7f000000-0000-0000-0000-0000000000a1',
   'xapi', 'Fine', 'learners/7f000000-0000-0000-0000-00000000000a/7f000000-0000-0000-0000-000000000202', 'index.html', 'connections');

insert into storage.objects (bucket_id, name, owner) values
  ('course-content', 'learners/7f000000-0000-0000-0000-00000000000a/7f000000-0000-0000-0000-000000000201/index.html', '7f000000-0000-0000-0000-00000000000a'),
  ('course-content', 'learners/7f000000-0000-0000-0000-00000000000a/7f000000-0000-0000-0000-000000000201/js/app.js', '7f000000-0000-0000-0000-00000000000a'),
  ('course-content', 'learners/7f000000-0000-0000-0000-00000000000a/7f000000-0000-0000-0000-000000000202/index.html', '7f000000-0000-0000-0000-00000000000a');

-- The local stack lacks Staging's default table grants.
grant all on table public.skill_resources, public.skill_resource_recipients, public.skill_resource_hides,
  public.skill_resource_reports, public.skills, public.connections, public.profiles, public.admin_activity_log to authenticated;

create function pg_temp.visible_package_files(p_resource text) returns bigint language sql as $$
  select count(*) from storage.objects
  where bucket_id = 'course-content' and name like 'learners/7f000000-0000-0000-0000-00000000000a/' || p_resource || '/%'
$$;

set local role authenticated;

-- B reports the first package.
select set_config('request.jwt.claim.sub', '7f000000-0000-0000-0000-00000000000b', true);
select public.report_skill_resource('7f000000-0000-0000-0000-000000000201', 'inappropriate', null);

-- Before removal, even an admin can't reach the package's files.
select set_config('request.jwt.claim.sub', '7f000000-0000-0000-0000-00000000000f', true);
select is(pg_temp.visible_package_files('7f000000-0000-0000-0000-000000000201'), 0::bigint,
  'an admin can''t list a package''s files before it''s removed');
select is(public.is_removed_skill_package_path('learners/7f000000-0000-0000-0000-00000000000a/7f000000-0000-0000-0000-000000000201/index.html'), false,
  'a package still shared isn''t a removed one');

select public.admin_resolve_skill_resource_reports('7f000000-0000-0000-0000-000000000201', 'remove');

select is(pg_temp.visible_package_files('7f000000-0000-0000-0000-000000000201'), 2::bigint,
  'once removed, the admin can list every file in its folder');
select is(pg_temp.visible_package_files('7f000000-0000-0000-0000-000000000202'), 0::bigint,
  'but not the files of a package that wasn''t removed');
-- B, no admin: nothing to see or delete, removed or not.
select set_config('request.jwt.claim.sub', '7f000000-0000-0000-0000-00000000000b', true);
select is(pg_temp.visible_package_files('7f000000-0000-0000-0000-000000000201'), 0::bigint,
  'someone who isn''t an admin can''t list a removed package''s files');

-- The owner keeps the record, marked removed and private.
reset role;
select is(
  (select audience || ' ' || (moderation_removed_at is not null)::text from public.skill_resources where id = '7f000000-0000-0000-0000-000000000201'),
  'private true',
  'the owner keeps the removed resource''s record, private'
);

-- Delete rights: the same rule as listing.
select is(
  (select count(*) from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname in ('Platform admins list removed skill resource packages', 'Platform admins delete removed skill resource packages')),
  2::bigint,
  'admins get matching list and delete rules for removed packages only'
);

select * from finish();
rollback;
