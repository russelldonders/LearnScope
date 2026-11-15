\set ON_ERROR_STOP on

begin;

select plan(22);

-- A shares; B is A's connection; D tracks the same skill; M is a platform admin.
insert into auth.users (id, email, email_confirmed_at) values
  ('7e000000-0000-0000-0000-00000000000a', 'mod-a@example.com', now()),
  ('7e000000-0000-0000-0000-00000000000b', 'mod-b@example.com', now()),
  ('7e000000-0000-0000-0000-00000000000d', 'mod-d@example.com', now()),
  ('7e000000-0000-0000-0000-00000000000f', 'mod-m@example.com', now());

insert into public.platform_admins (user_id) values ('7e000000-0000-0000-0000-00000000000f');

insert into public.skill_library (id, name, status)
values ('7e000000-0000-0000-0000-000000000100', 'Moderated sharing', 'active');

insert into public.skills (id, user_id, name, category, level, library_skill_id) values
  ('7e000000-0000-0000-0000-0000000000a1', '7e000000-0000-0000-0000-00000000000a', 'Moderated sharing', 'Test', 1, '7e000000-0000-0000-0000-000000000100'),
  ('7e000000-0000-0000-0000-0000000000b1', '7e000000-0000-0000-0000-00000000000b', 'Moderated sharing', 'Test', 1, '7e000000-0000-0000-0000-000000000100'),
  ('7e000000-0000-0000-0000-0000000000d1', '7e000000-0000-0000-0000-00000000000d', 'Moderated sharing', 'Test', 1, '7e000000-0000-0000-0000-000000000100');

insert into public.connections (user_a_id, user_b_id, source) values
  (least('7e000000-0000-0000-0000-00000000000a'::uuid, '7e000000-0000-0000-0000-00000000000b'::uuid),
   greatest('7e000000-0000-0000-0000-00000000000a'::uuid, '7e000000-0000-0000-0000-00000000000b'::uuid), 'request');

insert into public.skill_resources (id, user_id, skill_id, kind, title, url, audience) values
  ('7e000000-0000-0000-0000-000000000201', '7e000000-0000-0000-0000-00000000000a', '7e000000-0000-0000-0000-0000000000a1', 'link', 'Public link', 'https://example.com/1', 'skill_public'),
  ('7e000000-0000-0000-0000-000000000202', '7e000000-0000-0000-0000-00000000000a', '7e000000-0000-0000-0000-0000000000a1', 'link', 'For B', 'https://example.com/2', 'selected');
insert into public.skill_resources (id, user_id, skill_id, kind, title, file_path, file_name, audience) values
  ('7e000000-0000-0000-0000-000000000203', '7e000000-0000-0000-0000-00000000000a', '7e000000-0000-0000-0000-0000000000a1', 'file', 'Notes', '7e000000-0000-0000-0000-00000000000a/n.pdf', 'n.pdf', 'connections');
insert into public.skill_resource_recipients (resource_id, recipient_id)
values ('7e000000-0000-0000-0000-000000000202', '7e000000-0000-0000-0000-00000000000b');

grant all on table public.skill_resources, public.skill_resource_recipients, public.skill_resource_hides,
  public.skills, public.connections, public.profiles to authenticated;

create function pg_temp.shared_titles(p_skill uuid) returns text[] language sql as $$
  select coalesce(array_agg(title order by title), '{}') from public.list_shared_skill_resources(p_skill)
$$;

-- B hides the selected link, then reports the public one.
select set_config('request.jwt.claim.sub', '7e000000-0000-0000-0000-00000000000b', true);
set local role authenticated;

insert into public.skill_resource_hides (user_id, resource_id)
values ('7e000000-0000-0000-0000-00000000000b', '7e000000-0000-0000-0000-000000000202');
select is(pg_temp.shared_titles('7e000000-0000-0000-0000-0000000000b1'), array['Notes', 'Public link'], 'a hidden resource leaves the viewer''s list');

select lives_ok(
  $$select public.report_skill_resource('7e000000-0000-0000-0000-000000000201', 'spam', 'Advert for a course')$$,
  'a viewer can report a shared resource'
);
select is(pg_temp.shared_titles('7e000000-0000-0000-0000-0000000000b1'), array['Notes'], 'reporting hides it for them too');

select throws_ok(
  $$select public.report_skill_resource('7e000000-0000-0000-0000-000000000201', 'nonsense', null)$$,
  'P0001', 'Choose a reason for the report', 'a report needs a known reason'
);
select throws_ok(
  $$select public.admin_list_skill_resource_reports()$$,
  '42501', null, 'learners cannot see the report queue'
);

reset role;
select set_config('request.jwt.claim.sub', '7e000000-0000-0000-0000-00000000000a', true);
set local role authenticated;

select throws_ok(
  $$select public.report_skill_resource('7e000000-0000-0000-0000-000000000201', 'spam', null)$$,
  'P0001', 'Resource not found', 'an owner cannot report their own resource'
);

reset role;
select set_config('request.jwt.claim.sub', '7e000000-0000-0000-0000-00000000000d', true);
set local role authenticated;

select throws_ok(
  $$select public.report_skill_resource('7e000000-0000-0000-0000-000000000203', 'spam', null)$$,
  'P0001', 'Resource not found', 'nobody can report a resource not shared with them'
);
select public.report_skill_resource('7e000000-0000-0000-0000-000000000201', 'misleading', null);

-- The admin reviews.
reset role;
select set_config('request.jwt.claim.sub', '7e000000-0000-0000-0000-00000000000f', true);
set local role authenticated;

select results_eq(
  $$select title, report_count, reasons from public.admin_list_skill_resource_reports()$$,
  $$values ('Public link'::text, 2::bigint, array['misleading', 'spam']::text[])$$,
  'the admin sees the resource with both reports'
);

select lives_ok(
  $$select public.admin_resolve_skill_resource_reports('7e000000-0000-0000-0000-000000000201', 'remove')$$,
  'the admin removes it from sharing'
);
select is((select count(*)::int from public.admin_list_skill_resource_reports()), 0, 'and the queue is empty');

reset role;

select ok(
  exists (select 1 from public.admin_activity_log where action = 'skill_resource.removed' and entity_id = '7e000000-0000-0000-0000-000000000201'),
  'the removal is in the audit log'
);
select ok(
  not private.can_view_skill_resource('7e000000-0000-0000-0000-000000000201', '7e000000-0000-0000-0000-00000000000d'),
  'a removed resource is no longer shared'
);

-- The owner keeps it, privately, and can't share it again or undo removal.
select set_config('request.jwt.claim.sub', '7e000000-0000-0000-0000-00000000000a', true);
set local role authenticated;

update public.skill_resources
set audience = 'connections', moderation_removed_at = null
where id = '7e000000-0000-0000-0000-000000000201';
select results_eq(
  $$select audience, moderation_removed_at is not null from public.skill_resources where id = '7e000000-0000-0000-0000-000000000201'$$,
  $$values ('private'::text, true)$$,
  'the owner still has it, private and marked removed'
);

select throws_ok(
  $$insert into public.skill_resources (user_id, skill_id, kind, title, url, audience)
    values ('7e000000-0000-0000-0000-00000000000a', '7e000000-0000-0000-0000-0000000000a1', 'link', 'Again', 'https://example.com/1', 'skill_public')$$,
  '23514', null, 'the same link added again cannot be shared'
);

insert into public.skill_resources (id, user_id, skill_id, kind, title, url, audience, moderation_removed_at, moderation_removed_by)
values ('7e000000-0000-0000-0000-000000000204', '7e000000-0000-0000-0000-00000000000a', '7e000000-0000-0000-0000-0000000000a1', 'link', 'Fresh', 'https://example.com/fresh', 'private', now(), '7e000000-0000-0000-0000-00000000000f');
select is(
  (select moderation_removed_by from public.skill_resources where id = '7e000000-0000-0000-0000-000000000204'),
  null, 'a new resource cannot claim a moderation removal'
);

reset role;

-- A dismissed report isn't reopened by reporting again; the reporter's
-- report survives the owner deleting the resource.
select set_config('request.jwt.claim.sub', '7e000000-0000-0000-0000-00000000000b', true);
set local role authenticated;
insert into public.skill_resources (id, user_id, skill_id, kind, title, url, audience)
values ('7e000000-0000-0000-0000-000000000211', '7e000000-0000-0000-0000-00000000000b', '7e000000-0000-0000-0000-0000000000b1', 'link', 'B public', 'https://example.com/b', 'skill_public');
reset role;
select set_config('request.jwt.claim.sub', '7e000000-0000-0000-0000-00000000000d', true);
set local role authenticated;
select public.report_skill_resource('7e000000-0000-0000-0000-000000000211', 'spam', null);
reset role;
select set_config('request.jwt.claim.sub', '7e000000-0000-0000-0000-00000000000f', true);
set local role authenticated;
select throws_ok(
  $$select public.admin_resolve_skill_resource_reports('7e000000-0000-0000-0000-000000000211', null)$$,
  'P0001', 'Unknown action', 'a missing action is refused, not taken as dismiss'
);
select public.admin_resolve_skill_resource_reports('7e000000-0000-0000-0000-000000000211', 'dismiss');
reset role;
select set_config('request.jwt.claim.sub', '7e000000-0000-0000-0000-00000000000d', true);
set local role authenticated;
delete from public.skill_resource_hides where resource_id = '7e000000-0000-0000-0000-000000000211';
select public.report_skill_resource('7e000000-0000-0000-0000-000000000211', 'inappropriate', null);
reset role;
select is(
  (select status from public.skill_resource_reports where resource_id = '7e000000-0000-0000-0000-000000000211'),
  'dismissed', 'reporting again does not reopen a dismissed report'
);
delete from public.skill_resources where id = '7e000000-0000-0000-0000-000000000211';
select results_eq(
  $$select resource_id is null, resource_title from public.skill_resource_reports where resource_title = 'B public'$$,
  $$values (true, 'B public'::text)$$,
  'a report outlives the resource it was about'
);

-- An admin can open the file of a reported resource, but not otherwise.
select set_config('request.jwt.claim.sub', '7e000000-0000-0000-0000-00000000000f', true);
set local role authenticated;
select ok(not public.can_read_skill_resource_file('7e000000-0000-0000-0000-00000000000a/n.pdf'), 'an admin cannot open files that were not reported');
reset role;
insert into public.skill_resource_reports (resource_id, reporter_id, reason)
values ('7e000000-0000-0000-0000-000000000203', '7e000000-0000-0000-0000-00000000000b', 'inappropriate');
set local role authenticated;
select ok(public.can_read_skill_resource_file('7e000000-0000-0000-0000-00000000000a/n.pdf'), 'but can open the file of one with an open report');
reset role;

-- Disconnecting drops B from A's chosen contacts for good.
delete from public.connections
where user_a_id = least('7e000000-0000-0000-0000-00000000000a'::uuid, '7e000000-0000-0000-0000-00000000000b'::uuid)
  and user_b_id = greatest('7e000000-0000-0000-0000-00000000000a'::uuid, '7e000000-0000-0000-0000-00000000000b'::uuid);
select is(
  (select count(*)::int from public.skill_resource_recipients where resource_id = '7e000000-0000-0000-0000-000000000202'),
  0, 'disconnecting removes the person from chosen contacts'
);
insert into public.connections (user_a_id, user_b_id, source) values
  (least('7e000000-0000-0000-0000-00000000000a'::uuid, '7e000000-0000-0000-0000-00000000000b'::uuid),
   greatest('7e000000-0000-0000-0000-00000000000a'::uuid, '7e000000-0000-0000-0000-00000000000b'::uuid), 'request');
select ok(
  not private.can_view_skill_resource('7e000000-0000-0000-0000-000000000202', '7e000000-0000-0000-0000-00000000000b'),
  'so reconnecting does not share it again'
);

select * from finish();

rollback;
