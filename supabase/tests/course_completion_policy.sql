\set ON_ERROR_STOP on

begin;

select plan(8);

insert into auth.users (id, email, email_confirmed_at) values
  ('83000000-0000-0000-0000-000000000001', 'completion-a@example.com', now()),
  ('83000000-0000-0000-0000-000000000002', 'completion-b@example.com', now());

insert into public.course_catalogue (
  id, name, organisation_id, status, is_current_published, completion_policy
)
select fixture.id, fixture.name, organisation.id, 'approved', true, fixture.policy
from (
  values
    ('83000000-0000-0000-0000-000000000010'::uuid, 'All content', 'all_content'),
    ('83000000-0000-0000-0000-000000000011'::uuid, 'Manual', 'manual'),
    ('83000000-0000-0000-0000-000000000012'::uuid, 'Empty', 'all_content')
) fixture(id, name, policy)
cross join lateral (select id from public.organisations where is_system limit 1) organisation;

insert into public.content_resources (
  id, organisation_id, type, title, page_content, created_by, status, is_current_published
)
select fixture.id, organisation.id, 'page', fixture.title,
  '{"version":"1","blocks":[]}'::jsonb,
  '83000000-0000-0000-0000-000000000001', 'published', true
from (
  values
    ('83000000-0000-0000-0000-000000000020'::uuid, 'First page'),
    ('83000000-0000-0000-0000-000000000021'::uuid, 'Second page')
) fixture(id, title)
cross join lateral (select id from public.organisations where is_system limit 1) organisation;

insert into public.course_content_links (course_id, resource_id, position) values
  ('83000000-0000-0000-0000-000000000010', '83000000-0000-0000-0000-000000000020', 0),
  ('83000000-0000-0000-0000-000000000010', '83000000-0000-0000-0000-000000000021', 1);

insert into public.courses (id, user_id, name, catalogue_course_id) values
  ('83000000-0000-0000-0000-000000000030', '83000000-0000-0000-0000-000000000001', 'All content', '83000000-0000-0000-0000-000000000010'),
  ('83000000-0000-0000-0000-000000000031', '83000000-0000-0000-0000-000000000001', 'Manual', '83000000-0000-0000-0000-000000000011'),
  ('83000000-0000-0000-0000-000000000032', '83000000-0000-0000-0000-000000000001', 'Empty', '83000000-0000-0000-0000-000000000012'),
  ('83000000-0000-0000-0000-000000000033', '83000000-0000-0000-0000-000000000002', 'Someone else', '83000000-0000-0000-0000-000000000011');

select set_config('request.jwt.claim.sub', '83000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok(
  $$select public.complete_my_course('83000000-0000-0000-0000-000000000030')$$,
  'P0001', 'Complete every course item before finishing this course',
  'all-content courses cannot complete before any content is done'
);

reset role;
insert into public.course_content_progress (content_item_id, user_id, status) values
  ('83000000-0000-0000-0000-000000000020', '83000000-0000-0000-0000-000000000001', 'completed');
set local role authenticated;

select throws_ok(
  $$select public.complete_my_course('83000000-0000-0000-0000-000000000030')$$,
  'P0001', 'Complete every course item before finishing this course',
  'all-content courses cannot complete with one page remaining'
);

reset role;
insert into public.course_content_progress (content_item_id, user_id, status) values
  ('83000000-0000-0000-0000-000000000021', '83000000-0000-0000-0000-000000000001', 'failed');
set local role authenticated;

select is(
  public.complete_my_course('83000000-0000-0000-0000-000000000030'),
  current_date,
  'completed and marked-failed tests both satisfy all-content completion'
);
select is(
  (select completed_date from public.courses where id = '83000000-0000-0000-0000-000000000030'),
  current_date,
  'all-content completion is stored on the learner course'
);
select is(
  public.complete_my_course('83000000-0000-0000-0000-000000000031'),
  current_date,
  'manual completion needs no item progress'
);
select throws_ok(
  $$select public.complete_my_course('83000000-0000-0000-0000-000000000032')$$,
  'P0001', 'Complete every course item before finishing this course',
  'an empty all-content course does not auto-complete'
);
select throws_ok(
  $$select public.complete_my_course('83000000-0000-0000-0000-000000000033')$$,
  'P0001', 'Course not found or not enrolled',
  'a learner cannot complete someone else''s course'
);
select is(
  (select completion_policy from public.course_catalogue where id = '83000000-0000-0000-0000-000000000012'),
  'all_content',
  'all-content is the stored default-compatible policy'
);

select * from finish();
rollback;
