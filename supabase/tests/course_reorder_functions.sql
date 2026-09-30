\set ON_ERROR_STOP on

begin;

insert into public.organisations (id, name, org_code)
values ('73000000-0000-0000-0000-000000000001', 'Reorder Test Org', 'RTO73');

insert into public.course_catalogue (id, name, version_group_id)
values ('73000000-0000-0000-0000-000000000010', 'Reorder Test Course', '73000000-0000-0000-0000-000000000011');

insert into public.course_sections (id, course_id, title, position)
values
  ('73000000-0000-0000-0000-000000000020', '73000000-0000-0000-0000-000000000010', 'First', 0),
  ('73000000-0000-0000-0000-000000000021', '73000000-0000-0000-0000-000000000010', 'Second', 1),
  ('73000000-0000-0000-0000-000000000022', '73000000-0000-0000-0000-000000000010', 'Third', 5);

insert into public.content_resources (id, organisation_id, type, title, external_url, version_group_id)
select ('73000000-0000-0000-0000-00000000003' || n)::uuid, '73000000-0000-0000-0000-000000000001',
  'web_url', 'Resource ' || n, 'https://example.com/' || n, ('73000000-0000-0000-0000-00000000004' || n)::uuid
from generate_series(0, 2) n;

insert into public.course_content_links (id, course_id, resource_id, section_id, position)
values
  ('73000000-0000-0000-0000-000000000050', '73000000-0000-0000-0000-000000000010', '73000000-0000-0000-0000-000000000030', '73000000-0000-0000-0000-000000000020', 0),
  ('73000000-0000-0000-0000-000000000051', '73000000-0000-0000-0000-000000000010', '73000000-0000-0000-0000-000000000031', '73000000-0000-0000-0000-000000000020', 1),
  ('73000000-0000-0000-0000-000000000052', '73000000-0000-0000-0000-000000000010', '73000000-0000-0000-0000-000000000032', null, 9);

-- Sections: reversed and renumbered from 0, including the gap at 5.
select public.reorder_course_sections(array[
  '73000000-0000-0000-0000-000000000022',
  '73000000-0000-0000-0000-000000000021',
  '73000000-0000-0000-0000-000000000020'
]::uuid[]);

-- Links: move the second link into the Second section at position 0 (its
-- number is unchanged, but its section must still be saved), and renumber
-- the ungrouped one.
select public.reorder_course_content_links('73000000-0000-0000-0000-000000000021', array['73000000-0000-0000-0000-000000000051']::uuid[]);
select public.reorder_course_content_links(null, array['73000000-0000-0000-0000-000000000052']::uuid[]);

do $$
begin
  if (select string_agg(title, ',' order by position) from public.course_sections
      where course_id = '73000000-0000-0000-0000-000000000010') <> 'Third,Second,First'
     or (select max(position) from public.course_sections where course_id = '73000000-0000-0000-0000-000000000010') <> 2 then
    raise exception 'sections were not reordered and renumbered from 0';
  end if;

  if (select section_id from public.course_content_links where id = '73000000-0000-0000-0000-000000000051')
       is distinct from '73000000-0000-0000-0000-000000000021'
     or (select position from public.course_content_links where id = '73000000-0000-0000-0000-000000000051') <> 0 then
    raise exception 'a moved link kept its old section';
  end if;

  if (select section_id from public.course_content_links where id = '73000000-0000-0000-0000-000000000052') is not null
     or (select position from public.course_content_links where id = '73000000-0000-0000-0000-000000000052') <> 0 then
    raise exception 'an ungrouped link was not renumbered in place';
  end if;

  if (select position from public.course_content_links where id = '73000000-0000-0000-0000-000000000050') <> 0 then
    raise exception 'a link that was not in either list was changed';
  end if;
end
$$;

rollback;
