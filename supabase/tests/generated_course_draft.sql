\set ON_ERROR_STOP on

begin;

select plan(3);

insert into auth.users (id, email, email_confirmed_at) values
  ('79000000-0000-0000-0000-000000000001', 'course-author@example.com', now()),
  ('79000000-0000-0000-0000-000000000002', 'course-outsider@example.com', now());

insert into public.organisations (id, name, org_code)
values ('79000000-0000-0000-0000-000000000010', 'Generated Course Test', 'GCT79');

insert into public.organisation_members (organisation_id, user_id, role)
values ('79000000-0000-0000-0000-000000000010', '79000000-0000-0000-0000-000000000001', 'trainer');

create temporary table generated_course_fixture (course_id uuid) on commit drop;
grant select, insert on generated_course_fixture to authenticated;

select set_config('request.jwt.claim.sub', '79000000-0000-0000-0000-000000000001', true);
set local role authenticated;

insert into generated_course_fixture (course_id)
select public.create_generated_course_draft(
  '79000000-0000-0000-0000-000000000010',
  $json$
  {
    "name": "Manual handling essentials",
    "synopsis": "A practical introduction to safer lifting.",
    "courseType": "Online",
    "durationValue": 2,
    "durationUnit": "hours",
    "sections": [
      {
        "title": "Prepare",
        "instructions": "Complete both pages in order.",
        "pages": [
          {
            "title": "Assess the lift",
            "pageContent": {
              "version": 1,
              "blocks": [
                { "id": "79000000-0000-0000-0000-000000000101", "type": "heading", "level": 1, "content": "Assess the lift", "align": "left" },
                { "id": "79000000-0000-0000-0000-000000000102", "type": "text", "content": "Check the load before moving it.", "align": "left" }
              ]
            }
          },
          {
            "title": "Plan the route",
            "pageContent": {
              "version": 1,
              "blocks": [
                { "id": "79000000-0000-0000-0000-000000000103", "type": "heading", "level": 1, "content": "Plan the route", "align": "left" },
                { "id": "79000000-0000-0000-0000-000000000104", "type": "callout", "content": "Remove hazards first.", "align": "left", "variant": "warning" }
              ]
            }
          }
        ]
      }
    ]
  }
  $json$::jsonb
);

reset role;

do $$
declare
  v_course_id uuid := (select course_id from generated_course_fixture);
begin
  if not exists (
    select 1 from public.course_catalogue
    where id = v_course_id
      and status = 'draft'
      and organisation_id = '79000000-0000-0000-0000-000000000010'
      and created_by = '79000000-0000-0000-0000-000000000001'
      and duration = '2 hours'
  ) then
    raise exception 'generated course metadata was not created correctly';
  end if;
  if (select count(*) from public.course_sections where course_id = v_course_id) <> 1
     or (select count(*) from public.course_content_links where course_id = v_course_id) <> 2
     or (select count(*) from public.content_resources cr join public.course_content_links ccl on ccl.resource_id = cr.id where ccl.course_id = v_course_id and cr.type = 'page') <> 2 then
    raise exception 'generated course structure was not created completely';
  end if;
end
$$;
select pass('generated course metadata and structure are created atomically');

select set_config('request.jwt.claim.sub', '79000000-0000-0000-0000-000000000002', true);
set local role authenticated;

do $$
begin
  perform public.create_generated_course_draft(
    '79000000-0000-0000-0000-000000000010',
    '{"name":"Denied","synopsis":"Denied","courseType":"Online","durationValue":1,"durationUnit":"hours","sections":[]}'::jsonb
  );
  raise exception 'outsider created a generated course';
exception
  when raise_exception then
    if sqlerrm not like '%cannot create training for this organisation%' then raise; end if;
end
$$;
select pass('an authenticated outsider cannot create training for the organisation');

reset role;

do $$
begin
  if has_function_privilege('anon', 'public.create_generated_course_draft(uuid,jsonb)', 'execute') then
    raise exception 'anonymous role can execute generated course creation';
  end if;
  if not has_function_privilege('authenticated', 'public.create_generated_course_draft(uuid,jsonb)', 'execute') then
    raise exception 'authenticated role cannot execute generated course creation';
  end if;
end
$$;

select pass('generated course creation has explicit authenticated-only execute access');
select * from finish();

rollback;
