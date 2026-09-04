\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email, email_confirmed_at)
values ('71000000-0000-0000-0000-000000000001', 'composite-admin@example.com', now());

insert into public.platform_admins (user_id)
values ('71000000-0000-0000-0000-000000000001');

insert into public.skill_library (id, name, created_by)
values
  ('71000000-0000-0000-0000-000000000010', 'Pizza making', '71000000-0000-0000-0000-000000000001'),
  ('71000000-0000-0000-0000-000000000011', 'Dough making', '71000000-0000-0000-0000-000000000001'),
  ('71000000-0000-0000-0000-000000000012', 'Pizza slicing', '71000000-0000-0000-0000-000000000001');

select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000001', true);
set local role authenticated;

create temporary table composite_test_ids (pizza_definition_id uuid, dough_definition_id uuid);

insert into composite_test_ids (pizza_definition_id)
values (public.create_skill_composite_draft('71000000-0000-0000-0000-000000000010'));

update composite_test_ids
set dough_definition_id = public.create_skill_composite_draft('71000000-0000-0000-0000-000000000011');

insert into public.skill_composite_components
  (definition_id, component_skill_id, is_required, target_level, created_by)
select pizza_definition_id, '71000000-0000-0000-0000-000000000011', true, 3,
  '71000000-0000-0000-0000-000000000001'
from composite_test_ids;

do $$
begin
  begin
    insert into public.skill_composite_components
      (definition_id, component_skill_id, created_by)
    select pizza_definition_id, '71000000-0000-0000-0000-000000000010',
      '71000000-0000-0000-0000-000000000001'
    from composite_test_ids;
    raise exception 'Self-link was accepted';
  exception
    when raise_exception then
      if sqlerrm not like '%cannot be its own component%' then raise; end if;
  end;

  begin
    insert into public.skill_composite_components
      (definition_id, component_skill_id, created_by)
    select dough_definition_id, '71000000-0000-0000-0000-000000000010',
      '71000000-0000-0000-0000-000000000001'
    from composite_test_ids;
    raise exception 'Circular relationship was accepted';
  exception
    when raise_exception then
      if sqlerrm not like '%circular skill relationship%' then raise; end if;
  end;
end
$$;

select public.publish_skill_composite(pizza_definition_id)
from composite_test_ids;

do $$
declare
  v_new_draft_id uuid;
  v_new_version integer;
  v_component_count integer;
begin
  v_new_draft_id := public.create_skill_composite_draft('71000000-0000-0000-0000-000000000010');

  select version into v_new_version
  from public.skill_composite_definitions
  where id = v_new_draft_id;

  select count(*) into v_component_count
  from public.skill_composite_components
  where definition_id = v_new_draft_id;

  if v_new_version <> 2 or v_component_count <> 1 then
    raise exception 'Published definition was not cloned into draft version 2';
  end if;
end
$$;

reset role;

do $$
declare
  v_component_id uuid;
begin
  select component.id into v_component_id
  from public.skill_composite_components component
  join composite_test_ids test_ids on test_ids.pizza_definition_id = component.definition_id;

  begin
    delete from public.skill_composite_components where id = v_component_id;
    raise exception 'Published component was deleted';
  exception
    when raise_exception then
      if sqlerrm not like '%Published composite definitions are immutable%' then raise; end if;
  end;
end
$$;

rollback;
