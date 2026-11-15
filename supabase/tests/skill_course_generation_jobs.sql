\set ON_ERROR_STOP on

begin;

select plan(4);

insert into auth.users (id, email, email_confirmed_at)
values ('7c000000-0000-0000-0000-000000000001', 'job-admin@example.com', now());

insert into public.skill_library (id, name, status)
values ('7c000000-0000-0000-0000-000000000010', 'Background course jobs', 'active');

do $$
begin
  if not has_table_privilege('service_role', 'public.skill_course_generation_jobs', 'select,insert,update,delete') then
    raise exception 'service role is missing generation job access';
  end if;
end
$$;
select pass('service role can manage generation jobs through the Data API');

do $$
begin
  if has_any_column_privilege('authenticated', 'public.skill_course_generation_jobs', 'select,insert,update')
     or has_any_column_privilege('anon', 'public.skill_course_generation_jobs', 'select,insert,update') then
    raise exception 'browser roles can access private generated drafts';
  end if;
end
$$;
select pass('browser roles cannot access generated drafts directly');

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.skill_course_generation_jobs'::regclass) then
    raise exception 'generation jobs table does not have RLS enabled';
  end if;
end
$$;
select pass('generation jobs have RLS enabled as defence in depth');

-- The local stack lacks Staging's default grants to service_role.
grant select on public.organisations to service_role;
set local role service_role;
insert into public.skill_course_generation_jobs (
  id, requested_by, organisation_id, skill_library_id, knowledge_level
)
select
  '7c000000-0000-0000-0000-000000000020',
  '7c000000-0000-0000-0000-000000000001',
  organisation.id,
  '7c000000-0000-0000-0000-000000000010',
  3
from public.organisations organisation
where organisation.is_system
limit 1;

update public.skill_course_generation_jobs
set status = 'running', updated_at = now()
where id = '7c000000-0000-0000-0000-000000000020';

update public.skill_course_generation_jobs
set status = 'completed', draft = '{"name":"Ready"}'::jsonb,
    completed_at = now(), updated_at = now()
where id = '7c000000-0000-0000-0000-000000000020';
reset role;

select is(
  (select status from public.skill_course_generation_jobs where id = '7c000000-0000-0000-0000-000000000020'),
  'completed'::text,
  'a queued job can progress to a completed draft'
);

select * from finish();

rollback;
