\set ON_ERROR_STOP on

begin;

create or replace function pg_temp.assert_count_as(
  p_user_id uuid,
  p_query text,
  p_expected integer,
  p_label text
)
returns void language plpgsql as $$
declare v_actual integer;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  execute format('select count(*)::integer from (%s) checked_rows', p_query) into v_actual;
  reset role;
  if v_actual is distinct from p_expected then
    raise exception '%: expected %, got %', p_label, p_expected, v_actual;
  end if;
end
$$;

create or replace function pg_temp.assert_raises_as(
  p_user_id uuid,
  p_query text,
  p_pattern text,
  p_label text
)
returns void language plpgsql as $$
begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', p_user_id::text, true);
    execute p_query;
  exception when others then
    reset role;
    if sqlerrm ~ p_pattern then return; end if;
    raise exception '%: unexpected error: %', p_label, sqlerrm;
  end;
  reset role;
  raise exception '%: expected an error matching %', p_label, p_pattern;
end
$$;

insert into auth.users (id, email, email_confirmed_at) values
  ('d1000000-0000-0000-0000-000000000001', 'target-manager-a@example.com', now()),
  ('d2000000-0000-0000-0000-000000000002', 'target-learner@example.com', now()),
  ('d3000000-0000-0000-0000-000000000003', 'target-manager-b@example.com', now());

insert into public.organisations (id, name, type) values
  ('d4000000-0000-0000-0000-000000000004', 'Target provider A', 'provider'),
  ('d5000000-0000-0000-0000-000000000005', 'Target provider B', 'provider');

insert into public.employers (id, name, provider_organisation_id) values
  ('d6000000-0000-0000-0000-000000000006', 'Target employer A', 'd4000000-0000-0000-0000-000000000004'),
  ('d7000000-0000-0000-0000-000000000007', 'Target employer B', 'd5000000-0000-0000-0000-000000000005');

insert into public.employer_members (id, employer_id, user_id, role, status) values
  ('d1100000-0000-0000-0000-000000000001', 'd6000000-0000-0000-0000-000000000006', 'd1000000-0000-0000-0000-000000000001', 'member', 'active'),
  ('d2200000-0000-0000-0000-000000000002', 'd6000000-0000-0000-0000-000000000006', 'd2000000-0000-0000-0000-000000000002', 'member', 'active'),
  ('d3300000-0000-0000-0000-000000000003', 'd7000000-0000-0000-0000-000000000007', 'd3000000-0000-0000-0000-000000000003', 'member', 'active'),
  ('d4400000-0000-0000-0000-000000000004', 'd7000000-0000-0000-0000-000000000007', 'd2000000-0000-0000-0000-000000000002', 'member', 'active');

insert into public.skill_library (id, name) values
  ('d8000000-0000-0000-0000-000000000008', 'Target coaching');

insert into public.organisation_offered_skills (organisation_id, skill_library_id, created_by) values
  ('d4000000-0000-0000-0000-000000000004', 'd8000000-0000-0000-0000-000000000008', 'd1000000-0000-0000-0000-000000000001'),
  ('d5000000-0000-0000-0000-000000000005', 'd8000000-0000-0000-0000-000000000008', 'd3000000-0000-0000-0000-000000000003');

insert into public.employer_management_relationships (
  id, employer_id, manager_member_id, employee_member_id, relationship_type,
  access_scope, created_by
) values
  ('d9000000-0000-0000-0000-000000000009', 'd6000000-0000-0000-0000-000000000006', 'd1100000-0000-0000-0000-000000000001', 'd2200000-0000-0000-0000-000000000002', 'primary', array['skill_management'], 'd1000000-0000-0000-0000-000000000001'),
  ('da000000-0000-0000-0000-00000000000a', 'd7000000-0000-0000-0000-000000000007', 'd3300000-0000-0000-0000-000000000003', 'd4400000-0000-0000-0000-000000000004', 'functional', array['employment'], 'd3000000-0000-0000-0000-000000000003');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-0000-0000-000000000001', true);
select public.set_managed_employer_skill_development_target(
  'd6000000-0000-0000-0000-000000000006',
  'd2200000-0000-0000-0000-000000000002',
  'd8000000-0000-0000-0000-000000000008',
  4, current_date + 30, 'Lead a coaching session'
);
reset role;

select pg_temp.assert_count_as(
  'd1000000-0000-0000-0000-000000000001',
  $$select * from public.list_managed_employer_skill_development_targets(
      'd6000000-0000-0000-0000-000000000006',
      'd2200000-0000-0000-0000-000000000002') where status = 'active'$$,
  1,
  'a direct manager with skill scope can list employer targets'
);

select pg_temp.assert_count_as(
  'd1000000-0000-0000-0000-000000000001',
  $$select * from public.employer_skill_development_targets$$,
  0,
  'manager direct-table reads remain blocked'
);

select pg_temp.assert_count_as(
  'd2000000-0000-0000-0000-000000000002',
  $$select * from public.list_my_employer_skill_development_targets() where employer_id = 'd6000000-0000-0000-0000-000000000006'$$,
  1,
  'learner can read their own employer-context target'
);

select pg_temp.assert_raises_as(
  'd3000000-0000-0000-0000-000000000003',
  $$select public.set_managed_employer_skill_development_target(
      'd7000000-0000-0000-0000-000000000007',
      'd4400000-0000-0000-0000-000000000004',
      'd8000000-0000-0000-0000-000000000008', 3, current_date + 20, null)$$,
  'Not authorised',
  'functional manager without skill scope cannot set a target'
);

select pg_temp.assert_raises_as(
  'd1000000-0000-0000-0000-000000000001',
  $$select public.set_managed_employer_skill_development_target(
      'd7000000-0000-0000-0000-000000000007',
      'd4400000-0000-0000-0000-000000000004',
      'd8000000-0000-0000-0000-000000000008', 3, current_date + 20, null)$$,
  'Not authorised',
  'manager cannot cross the employer boundary by changing ids'
);

-- A replacement preserves history and leaves exactly one active target.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-0000-0000-000000000001', true);
select public.set_managed_employer_skill_development_target(
  'd6000000-0000-0000-0000-000000000006',
  'd2200000-0000-0000-0000-000000000002',
  'd8000000-0000-0000-0000-000000000008',
  5, current_date + 60, 'Own the coaching programme'
);
reset role;

do $$
begin
  if (select count(*) from public.employer_skill_development_targets where status = 'active') <> 1
     or (select count(*) from public.employer_skill_development_targets where status = 'superseded') <> 1 then
    raise exception 'setting a replacement target must preserve history with one active row';
  end if;
  if exists (select 1 from public.skill_targets where user_id = 'd2000000-0000-0000-0000-000000000002') then
    raise exception 'employer target must not create a learner-owned skill target';
  end if;
end
$$;

update public.employer_management_relationships
set valid_until = current_date
where id = 'd9000000-0000-0000-0000-000000000009';

select pg_temp.assert_raises_as(
  'd1000000-0000-0000-0000-000000000001',
  $$select public.set_managed_employer_skill_development_target(
      'd6000000-0000-0000-0000-000000000006',
      'd2200000-0000-0000-0000-000000000002',
      'd8000000-0000-0000-0000-000000000008', 3, current_date + 90, null)$$,
  'Not authorised',
  'ending the management relationship removes target mutation access'
);

update public.employer_management_relationships
set valid_until = null
where id = 'd9000000-0000-0000-0000-000000000009';

update public.employer_members
set status = 'inactive'
where id = 'd2200000-0000-0000-0000-000000000002';

select pg_temp.assert_raises_as(
  'd1000000-0000-0000-0000-000000000001',
  $$select public.set_managed_employer_skill_development_target(
      'd6000000-0000-0000-0000-000000000006',
      'd2200000-0000-0000-0000-000000000002',
      'd8000000-0000-0000-0000-000000000008', 3, current_date + 90, null)$$,
  'Not authorised',
  'inactive employee membership removes target mutation access'
);

rollback;
