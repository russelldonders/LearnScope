\set ON_ERROR_STOP on

begin;

select plan(5);

insert into auth.users (id, email, email_confirmed_at) values
  ('7b000000-0000-0000-0000-000000000001', 'series-admin@example.com', now()),
  ('7b000000-0000-0000-0000-000000000002', 'series-user@example.com', now());

insert into public.platform_admins (user_id)
values ('7b000000-0000-0000-0000-000000000001');

insert into public.skill_library (id, name, status)
values ('7b000000-0000-0000-0000-000000000010', 'Series building', 'active');

create temporary table skill_series_fixture (
  course_id uuid,
  published boolean
) on commit drop;
grant select, insert on skill_series_fixture to authenticated;

select set_config('request.jwt.claim.sub', '7b000000-0000-0000-0000-000000000001', true);
set local role authenticated;

insert into skill_series_fixture (course_id, published)
select public.create_generated_skill_course(
  '7b000000-0000-0000-0000-000000000010',
  2,
  $json${
    "name":"Series building — Aware",
    "synopsis":"Knowledge level two.",
    "courseType":"Online",
    "durationValue":60,
    "durationUnit":"mins",
    "sections":[{"title":"Understand","instructions":null,"pages":[{"title":"Core ideas","pageContent":{"version":1,"blocks":[{"id":"7b000000-0000-0000-0000-000000000101","type":"heading","level":1,"content":"Core ideas","align":"left"},{"id":"7b000000-0000-0000-0000-000000000102","type":"text","content":"Build awareness.","align":"left"}]}}]}]
  }$json$::jsonb,
  false
), false;

insert into skill_series_fixture (course_id, published)
select public.create_generated_skill_course(
  '7b000000-0000-0000-0000-000000000010',
  4,
  $json${
    "name":"Series building — Knowledgeable",
    "synopsis":"Knowledge level four.",
    "courseType":"Online",
    "durationValue":60,
    "durationUnit":"mins",
    "sections":[{"title":"Understand","instructions":null,"pages":[{"title":"Advanced ideas","pageContent":{"version":1,"blocks":[{"id":"7b000000-0000-0000-0000-000000000103","type":"heading","level":1,"content":"Advanced ideas","align":"left"},{"id":"7b000000-0000-0000-0000-000000000104","type":"text","content":"Build a solid grasp.","align":"left"}]}}]}]
  }$json$::jsonb,
  true
), true;

reset role;

do $$
declare
  v_course_id uuid := (select course_id from skill_series_fixture where not published);
begin
  if not exists (
    select 1
    from public.course_catalogue course
    join public.organisations organisation on organisation.id = course.organisation_id
    join public.course_catalogue_skills course_skill on course_skill.course_catalogue_id = course.id
    where course.id = v_course_id
      and course.status = 'draft'
      and organisation.is_system
      and course_skill.skill_library_id = '7b000000-0000-0000-0000-000000000010'
      and course_skill.level = 2
  ) then
    raise exception 'draft level course was not created under the system provider';
  end if;
  if exists (select 1 from public.course_catalogue_publications where course_id = v_course_id) then
    raise exception 'draft level course was unexpectedly published';
  end if;
end
$$;
select pass('an admin can create an editable system-provider level course');

select set_config('request.jwt.claim.sub', '7b000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select public.publish_system_course_to_global(
  (select course_id from skill_series_fixture where not published)
);
reset role;

do $$
declare
  v_course_id uuid := (select course_id from skill_series_fixture where not published);
begin
  if not exists (
    select 1
    from public.course_catalogue course
    join public.course_catalogue_publications publication on publication.course_id = course.id
    join public.catalogues catalogue on catalogue.id = publication.catalogue_id
    where course.id = v_course_id
      and course.status = 'approved'
      and course.is_current_published
      and catalogue.is_global
      and publication.published_at is not null
  ) then
    raise exception 'draft system course was not published to Global';
  end if;
end
$$;
select pass('an admin can publish a reviewed system-provider draft to Global');

do $$
declare
  v_course_id uuid := (select course_id from skill_series_fixture where published);
begin
  if not exists (
    select 1
    from public.course_catalogue course
    join public.course_catalogue_publications publication on publication.course_id = course.id
    join public.catalogues catalogue on catalogue.id = publication.catalogue_id
    join public.course_catalogue_skills course_skill on course_skill.course_catalogue_id = course.id
    where course.id = v_course_id
      and course.status = 'approved'
      and course.is_current_published
      and catalogue.is_global
      and publication.published_at is not null
      and course_skill.level = 4
  ) then
    raise exception 'published level course is not live in the Global catalogue';
  end if;
end
$$;
select pass('an admin can publish a generated level course directly to Global');

select set_config('request.jwt.claim.sub', '7b000000-0000-0000-0000-000000000002', true);
set local role authenticated;
do $$
begin
  perform public.create_generated_skill_course(
    '7b000000-0000-0000-0000-000000000010', 1, '{}'::jsonb, false
  );
  raise exception 'non-admin generated a skill course';
exception
  when insufficient_privilege then null;
end
$$;
select pass('non-admin users cannot start a skill course series');
reset role;

do $$
begin
  if has_function_privilege('anon', 'public.create_generated_skill_course(uuid,integer,jsonb,boolean)', 'execute') then
    raise exception 'anonymous role can create a skill course';
  end if;
  if not has_function_privilege('authenticated', 'public.create_generated_skill_course(uuid,integer,jsonb,boolean)', 'execute') then
    raise exception 'authenticated role is missing skill-course function access';
  end if;
end
$$;
select pass('skill-course functions have explicit authenticated-only execution');

select * from finish();
rollback;
