\set ON_ERROR_STOP on

begin;

select plan(9);

insert into auth.users (id, email, email_confirmed_at) values
  ('7d000000-0000-0000-0000-000000000001', 'job-save-admin@example.com', now()),
  ('7d000000-0000-0000-0000-000000000002', 'job-save-other-admin@example.com', now()),
  ('7d000000-0000-0000-0000-000000000003', 'job-save-learner@example.com', now());

insert into public.platform_admins (user_id) values
  ('7d000000-0000-0000-0000-000000000001'),
  ('7d000000-0000-0000-0000-000000000002');

insert into public.skill_library (id, name, status)
values ('7d000000-0000-0000-0000-000000000010', 'Saving course jobs', 'active');

-- Two finished jobs for the first admin: one to save, one aborted first.
insert into public.skill_course_generation_jobs (
  id, requested_by, organisation_id, skill_library_id, knowledge_level, status, draft, completed_at
)
select v.id, '7d000000-0000-0000-0000-000000000001', o.id, '7d000000-0000-0000-0000-000000000010', 2, 'completed',
  $json${
    "name":"Saving course jobs — Aware",
    "synopsis":"Knowledge level two.",
    "courseType":"Online",
    "durationValue":60,
    "durationUnit":"mins",
    "sections":[{"title":"Understand","instructions":null,"pages":[{"title":"Core ideas","pageContent":{"version":1,"blocks":[{"id":"7d000000-0000-0000-0000-000000000101","type":"heading","level":1,"content":"Core ideas","align":"left"},{"id":"7d000000-0000-0000-0000-000000000102","type":"text","content":"Build awareness.","align":"left"}]}}]}]
  }$json$::jsonb,
  now()
from (values ('7d000000-0000-0000-0000-000000000020'::uuid), ('7d000000-0000-0000-0000-000000000021'::uuid), ('7d000000-0000-0000-0000-000000000022'::uuid)) v(id)
cross join (select id from public.organisations where is_system limit 1) o;

-- What an abort does to a finished job (see skillCourseGenerationJobHandler).
update public.skill_course_generation_jobs
set status = 'cancelled', draft = null, updated_at = now()
where id = '7d000000-0000-0000-0000-000000000021';

-- And one left past its expiry.
update public.skill_course_generation_jobs
set expires_at = now() - interval '1 minute'
where id = '7d000000-0000-0000-0000-000000000022';

grant all on table public.course_catalogue, public.course_sections, public.content_resources, public.course_content_links to authenticated;

select set_config('request.jwt.claim.sub', '7d000000-0000-0000-0000-000000000003', true);
set local role authenticated;

select throws_ok(
  $$select public.save_generated_skill_course_job('7d000000-0000-0000-0000-000000000020', false)$$,
  '42501', null,
  'someone who is not a platform admin cannot save a job'
);

reset role;
set local role anon;
select throws_ok(
  $$select public.save_generated_skill_course_job('7d000000-0000-0000-0000-000000000020', false)$$,
  '42501', null,
  'nor can anyone signed out'
);

reset role;
select set_config('request.jwt.claim.sub', '7d000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select throws_ok(
  $$select public.save_generated_skill_course_job('7d000000-0000-0000-0000-000000000020', false)$$,
  'P0001', 'Generation job not found or expired',
  'another admin cannot save someone else''s job'
);

reset role;
select set_config('request.jwt.claim.sub', '7d000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok(
  $$select public.save_generated_skill_course_job('7d000000-0000-0000-0000-000000000021', false)$$,
  'P0001', 'Course build was aborted',
  'an aborted job is never saved'
);

select throws_ok(
  $$select public.save_generated_skill_course_job('7d000000-0000-0000-0000-000000000022', false)$$,
  'P0001', 'Generation job not found or expired',
  'an expired job is not saved'
);

create temporary table saved_course (course_id uuid) on commit drop;
insert into saved_course select public.save_generated_skill_course_job('7d000000-0000-0000-0000-000000000020', false);

select isnt((select course_id from saved_course), null, 'a finished job is saved as a course');
select is(
  public.save_generated_skill_course_job('7d000000-0000-0000-0000-000000000020', false),
  (select course_id from saved_course),
  'saving again returns the same course rather than a second one'
);

reset role;

select results_eq(
  $$select status, draft is null, course_id = (select course_id from saved_course)
    from public.skill_course_generation_jobs where id = '7d000000-0000-0000-0000-000000000020'$$,
  $$values ('saved'::text, true, true)$$,
  'the job records the saved course and drops its draft'
);

-- An abort arriving after the save finds nothing left to cancel.
update public.skill_course_generation_jobs
set status = 'cancelled', draft = null, updated_at = now()
where id = '7d000000-0000-0000-0000-000000000020' and status in ('queued', 'running', 'completed');
select is(
  (select status from public.skill_course_generation_jobs where id = '7d000000-0000-0000-0000-000000000020'),
  'saved', 'a late abort leaves a saved course alone'
);

select * from finish();

rollback;
