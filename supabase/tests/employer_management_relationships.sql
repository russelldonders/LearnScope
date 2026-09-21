\set ON_ERROR_STOP on

begin;

create or replace function pg_temp.assert_count_as(
  p_user_id uuid,
  p_query text,
  p_expected integer,
  p_label text
)
returns void
language plpgsql
as $$
declare v_actual integer;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  execute format('select count(*)::integer from (%s) checked_rows', p_query)
    into v_actual;
  reset role;

  if v_actual is distinct from p_expected then
    raise exception '%: expected %, got %', p_label, p_expected, v_actual;
  end if;
end
$$;

create or replace function pg_temp.assert_boolean_as(
  p_user_id uuid,
  p_query text,
  p_expected boolean,
  p_label text
)
returns void
language plpgsql
as $$
declare v_actual boolean;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  execute p_query into v_actual;
  reset role;

  if v_actual is distinct from p_expected then
    raise exception '%: expected %, got %', p_label, p_expected, v_actual;
  end if;
end
$$;

create or replace function pg_temp.assert_raises(p_query text, p_pattern text, p_label text)
returns void
language plpgsql
as $$
begin
  begin
    execute p_query;
  exception when others then
    if sqlerrm ~ p_pattern then
      return;
    end if;
    raise exception '%: unexpected error: %', p_label, sqlerrm;
  end;
  raise exception '%: expected an error matching %', p_label, p_pattern;
end
$$;

create or replace function pg_temp.assert_raises_as(
  p_user_id uuid,
  p_query text,
  p_pattern text,
  p_label text
)
returns void
language plpgsql
as $$
begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', p_user_id::text, true);
    execute p_query;
  exception when others then
    reset role;
    if sqlerrm ~ p_pattern then
      return;
    end if;
    raise exception '%: unexpected error: %', p_label, sqlerrm;
  end;
  reset role;
  raise exception '%: expected an error matching %', p_label, p_pattern;
end
$$;

-- Users: employer A admin, line manager, team lead, worker, functional
-- manager, project manager, unrelated user, and employer B admin.
insert into auth.users (id, email, email_confirmed_at) values
  ('10000000-0000-0000-0000-000000000001', 'admin-a@example.com', now()),
  ('20000000-0000-0000-0000-000000000002', 'line-manager@example.com', now()),
  ('30000000-0000-0000-0000-000000000003', 'team-lead@example.com', now()),
  ('40000000-0000-0000-0000-000000000004', 'worker@example.com', now()),
  ('50000000-0000-0000-0000-000000000005', 'functional-manager@example.com', now()),
  ('60000000-0000-0000-0000-000000000006', 'project-manager@example.com', now()),
  ('70000000-0000-0000-0000-000000000007', 'unrelated@example.com', now()),
  ('80000000-0000-0000-0000-000000000008', 'admin-b@example.com', now());

insert into public.organisations (id, name, type) values
  ('a0000000-0000-0000-0000-000000000001', 'Employer A provider', 'provider'),
  ('b0000000-0000-0000-0000-000000000001', 'Employer B provider', 'provider');

insert into public.employers (id, name, provider_organisation_id) values
  ('a0000000-0000-0000-0000-000000000002', 'Employer A', 'a0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-000000000002', 'Employer B', 'b0000000-0000-0000-0000-000000000001');

insert into public.employer_members (id, employer_id, user_id, role, status) values
  ('a1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'admin', 'active'),
  ('a2000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'member', 'active'),
  ('a3000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000003', 'member', 'active'),
  ('a4000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000004', 'member', 'active'),
  ('a5000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000005', 'member', 'active'),
  ('a6000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000006', 'member', 'active'),
  ('b8000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-000000000002', '80000000-0000-0000-0000-000000000008', 'admin', 'active'),
  ('b2000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'member', 'active'),
  ('b4000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000004', 'member', 'active');

-- A line hierarchy, a functional/matrix manager with no subtree access, and
-- a project manager whose subtree access is explicitly enabled.
insert into public.employer_management_relationships (
  id, employer_id, manager_member_id, employee_member_id, relationship_type,
  is_primary, include_indirect_reports, access_scope, created_by
) values
  (
    'aa000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000002',
    'a2000000-0000-0000-0000-000000000002',
    'a3000000-0000-0000-0000-000000000003',
    'primary', true, true,
    array['employment','role_assignments','training_assignments','skill_management','shared_skills','shared_skill_evidence','shared_training','shared_experience'],
    '10000000-0000-0000-0000-000000000001'
  ),
  (
    'aa000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000002',
    'a3000000-0000-0000-0000-000000000003',
    'a4000000-0000-0000-0000-000000000004',
    'primary', true, true,
    array['employment'],
    '10000000-0000-0000-0000-000000000001'
  ),
  (
    'aa000000-0000-0000-0000-000000000003',
    'a0000000-0000-0000-0000-000000000002',
    'a5000000-0000-0000-0000-000000000005',
    'a3000000-0000-0000-0000-000000000003',
    'functional', false, false,
    array['employment'],
    '10000000-0000-0000-0000-000000000001'
  ),
  (
    'aa000000-0000-0000-0000-000000000004',
    'a0000000-0000-0000-0000-000000000002',
    'a6000000-0000-0000-0000-000000000006',
    'a3000000-0000-0000-0000-000000000003',
    'project', false, true,
    array['shared_skills','shared_skill_evidence'],
    '10000000-0000-0000-0000-000000000001'
  );

select pg_temp.assert_raises(
  $$insert into public.employer_management_relationships
      (employer_id, manager_member_id, employee_member_id, relationship_type, access_scope, created_by)
    values
      ('a0000000-0000-0000-0000-000000000002',
       'a2000000-0000-0000-0000-000000000002',
       'a2000000-0000-0000-0000-000000000002',
       'delegate', array['employment'],
       '10000000-0000-0000-0000-000000000001')$$,
  'distinct_members',
  'self-management is rejected'
);

select pg_temp.assert_raises(
  $$insert into public.employer_management_relationships
      (employer_id, manager_member_id, employee_member_id, relationship_type, access_scope, created_by)
    values
      ('a0000000-0000-0000-0000-000000000002',
       'a4000000-0000-0000-0000-000000000004',
       'a2000000-0000-0000-0000-000000000002',
       'primary', array['employment'],
       '10000000-0000-0000-0000-000000000001')$$,
  'cycle',
  'primary hierarchy cycles are rejected'
);

select pg_temp.assert_raises(
  $$insert into public.employer_management_relationships
      (employer_id, manager_member_id, employee_member_id, relationship_type, access_scope, created_by)
    values
      ('a0000000-0000-0000-0000-000000000002',
       'a2000000-0000-0000-0000-000000000002',
       'b4000000-0000-0000-0000-000000000004',
       'delegate', array['employment'],
       '10000000-0000-0000-0000-000000000001')$$,
  'same employer',
  'cross-employer relationships are rejected'
);

select pg_temp.assert_raises(
  $$insert into public.employer_management_relationships
      (employer_id, manager_member_id, employee_member_id, relationship_type, access_scope, created_by)
    values
      ('a0000000-0000-0000-0000-000000000002',
       'a2000000-0000-0000-0000-000000000002',
       'a3000000-0000-0000-0000-000000000003',
       'primary', array['employment'],
       '10000000-0000-0000-0000-000000000001')$$,
  'overlapping relationship',
  'overlapping duplicate relationship is rejected'
);

select pg_temp.assert_raises_as(
  '50000000-0000-0000-0000-000000000005',
  $$select public.create_employer_management_relationship(
      'a0000000-0000-0000-0000-000000000002',
      'a5000000-0000-0000-0000-000000000005',
      'a4000000-0000-0000-0000-000000000004',
      'delegate', false, false, array['employment'], current_date, null
    )$$,
  'Not authorised',
  'a manager cannot administer management relationships'
);

-- Employer-owned and learner-owned fixtures.
insert into public.skill_library (id, name) values
  ('c0000000-0000-0000-0000-000000000001', 'Shared SQL'),
  ('c0000000-0000-0000-0000-000000000002', 'Private Writing');

insert into public.skills (id, user_id, name, library_skill_id) values
  ('c1000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000004', 'Shared SQL', 'c0000000-0000-0000-0000-000000000001'),
  ('c1000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000004', 'Private Writing', 'c0000000-0000-0000-0000-000000000002');

insert into public.skill_assessments (id, skill_id, user_id, level, comments, evidence_paths) values
  ('c2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000004', 4, 'Shared evidence', array['40000000-0000-0000-0000-000000000004/shared.txt']),
  ('c2000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000004', 3, 'Private evidence', array['40000000-0000-0000-0000-000000000004/private.txt']);

insert into public.courses (id, user_id, name) values
  ('c3000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000004', 'Shared personal training');
insert into public.experience (id, user_id, type, title, start_date) values
  ('c4000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000004', 'employment', 'Shared personal experience', current_date - 30);
insert into public.profile_searchable_skills (profile_id, skill_id) values
  ('40000000-0000-0000-0000-000000000004', 'c1000000-0000-0000-0000-000000000002');

insert into public.employer_data_access_requests (
  id, employer_id, learner_id, status, requested_data, approved_data, decided_at
) values
  (
    'd0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000002',
    '40000000-0000-0000-0000-000000000004',
    'approved', array['skills','training','experience'], array['skills','training','experience'], now()
  ),
  (
    'd0000000-0000-0000-0000-000000000002',
    'b0000000-0000-0000-0000-000000000002',
    '40000000-0000-0000-0000-000000000004',
    'approved', array['skills'], array['skills'], now()
  );

insert into public.employer_data_access_shared_skills (request_id, skill_id) values
  ('d0000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001'),
  ('d0000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001');

insert into public.course_catalogue (id, name, version_group_id) values
  ('e0000000-0000-0000-0000-000000000001', 'Employer course', 'e0000000-0000-0000-0000-000000000001');
insert into public.course_assignments (id, employer_id, catalogue_course_id, assigned_to, assigned_by) values
  ('e1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001'),
  ('e1000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000004', '80000000-0000-0000-0000-000000000008');

insert into public.employer_role_profiles (id, employer_id, name, created_by) values
  ('e2000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', 'Engineer', '10000000-0000-0000-0000-000000000001');
insert into public.employer_role_assignments (id, role_profile_id, employer_member_id, proposed_by) values
  ('e3000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001');

insert into public.employer_skill_suggestions (
  id, employer_id, learner_id, skill_library_id, skill_name, assigned_by
) values (
  'e4000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000002',
  '40000000-0000-0000-0000-000000000004',
  'c0000000-0000-0000-0000-000000000001',
  'Shared SQL',
  '10000000-0000-0000-0000-000000000001'
);

insert into public.employer_skill_confirmations (
  id, employer_id, user_id, library_skill_id, confirmed_level, confirmed_by
) values (
  'e5000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000002',
  '40000000-0000-0000-0000-000000000004',
  'c0000000-0000-0000-0000-000000000001',
  4,
  '10000000-0000-0000-0000-000000000001'
);

insert into public.employer_member_field_values (
  id, employer_member_id, field_definition_id, value, updated_by
)
select
  'e6000000-0000-0000-0000-000000000001',
  'a4000000-0000-0000-0000-000000000004',
  definition.id,
  'Engineer',
  '10000000-0000-0000-0000-000000000001'
from public.employer_field_definitions definition
where definition.employer_id is null and definition.key = 'job_title';

insert into public.employer_member_field_values (
  id, employer_member_id, field_definition_id, value, updated_by
)
select
  'e6000000-0000-0000-0000-000000000002',
  'a3000000-0000-0000-0000-000000000003',
  definition.id,
  'Team lead',
  '10000000-0000-0000-0000-000000000001'
from public.employer_field_definitions definition
where definition.employer_id is null and definition.key = 'job_title';

-- Direct and indirect hierarchy behavior.
select pg_temp.assert_count_as(
  '20000000-0000-0000-0000-000000000002',
  $$select * from public.list_employer_direct_reports('a0000000-0000-0000-0000-000000000002')$$,
  1,
  'line manager has one direct report'
);
select pg_temp.assert_count_as(
  '20000000-0000-0000-0000-000000000002',
  $$select * from public.list_employer_indirect_reports('a0000000-0000-0000-0000-000000000002') where employee_member_id = 'a4000000-0000-0000-0000-000000000004' and report_depth = 2$$,
  1,
  'line manager reaches worker through primary hierarchy'
);
select pg_temp.assert_boolean_as(
  '20000000-0000-0000-0000-000000000002',
  $$select public.can_manage_employer_member('a4000000-0000-0000-0000-000000000004', 'employment', true)$$,
  true,
  'line manager can manage indirect worker'
);
select pg_temp.assert_boolean_as(
  '50000000-0000-0000-0000-000000000005',
  $$select public.can_manage_employer_member('a4000000-0000-0000-0000-000000000004', 'employment', true)$$,
  false,
  'functional manager does not inherit an unrelated subtree'
);
select pg_temp.assert_boolean_as(
  '60000000-0000-0000-0000-000000000006',
  $$select public.can_manage_employer_member('a4000000-0000-0000-0000-000000000004', 'shared_skills', true)$$,
  true,
  'project manager gets subtree only when explicitly configured'
);
select pg_temp.assert_boolean_as(
  '20000000-0000-0000-0000-000000000002',
  $$select public.can_manage_employer_member('b4000000-0000-0000-0000-000000000004', null, true)$$,
  false,
  'same people remain isolated in a second employer'
);

-- Employer-owned rows are visible only within scope and employer.
select pg_temp.assert_count_as('20000000-0000-0000-0000-000000000002', $$select * from public.employer_member_field_values where id = 'e6000000-0000-0000-0000-000000000001'$$, 1, 'indirect manager sees employer roster data');
select pg_temp.assert_count_as('20000000-0000-0000-0000-000000000002', $$select * from public.employer_role_assignments where id = 'e3000000-0000-0000-0000-000000000001'$$, 1, 'indirect manager sees employer role assignment');
select pg_temp.assert_count_as('20000000-0000-0000-0000-000000000002', $$select * from public.course_assignments where id = 'e1000000-0000-0000-0000-000000000001'$$, 1, 'indirect manager sees employer training assignment');
select pg_temp.assert_count_as('20000000-0000-0000-0000-000000000002', $$select * from public.course_assignments where id = 'e1000000-0000-0000-0000-000000000002'$$, 0, 'manager cannot change ids to read another employer assignment');
select pg_temp.assert_count_as('20000000-0000-0000-0000-000000000002', $$select * from public.employer_skill_suggestions where id = 'e4000000-0000-0000-0000-000000000001'$$, 1, 'indirect manager sees employer skill suggestion');
select pg_temp.assert_count_as('20000000-0000-0000-0000-000000000002', $$select * from public.employer_skill_confirmations where id = 'e5000000-0000-0000-0000-000000000001'$$, 1, 'indirect manager sees employer skill confirmation');
select pg_temp.assert_count_as('50000000-0000-0000-0000-000000000005', $$select * from public.employer_member_field_values where id = 'e6000000-0000-0000-0000-000000000001'$$, 0, 'functional manager cannot see worker outside direct scope');
select pg_temp.assert_count_as('50000000-0000-0000-0000-000000000005', $$select * from public.employer_member_field_values where id = 'e6000000-0000-0000-0000-000000000002'$$, 1, 'functional manager sees intended direct-report employer data');
select pg_temp.assert_count_as('50000000-0000-0000-0000-000000000005', $$select * from public.employer_role_assignments where id = 'e3000000-0000-0000-0000-000000000001'$$, 0, 'functional manager gets no ungranted role scope');

-- Learner-owned rows require both a relationship scope and an explicit share.
select pg_temp.assert_count_as('20000000-0000-0000-0000-000000000002', $$select * from public.skills where id = 'c1000000-0000-0000-0000-000000000001'$$, 1, 'manager sees explicitly shared skill');
select pg_temp.assert_count_as('20000000-0000-0000-0000-000000000002', $$select * from public.skills where id = 'c1000000-0000-0000-0000-000000000002'$$, 0, 'manager cannot see private unshared skill');
select pg_temp.assert_count_as('20000000-0000-0000-0000-000000000002', $$select * from public.skill_assessments where id = 'c2000000-0000-0000-0000-000000000001'$$, 1, 'manager sees evidence only with evidence scope');
select pg_temp.assert_count_as('20000000-0000-0000-0000-000000000002', $$select * from public.skill_assessments where id = 'c2000000-0000-0000-0000-000000000002'$$, 0, 'manager cannot see private evidence');
select pg_temp.assert_count_as('20000000-0000-0000-0000-000000000002', $$select * from public.courses where id = 'c3000000-0000-0000-0000-000000000001'$$, 1, 'manager sees consented personal training');
select pg_temp.assert_count_as('20000000-0000-0000-0000-000000000002', $$select * from public.experience where id = 'c4000000-0000-0000-0000-000000000001'$$, 1, 'manager sees consented personal experience');
select pg_temp.assert_count_as('50000000-0000-0000-0000-000000000005', $$select * from public.skills where id = 'c1000000-0000-0000-0000-000000000001'$$, 0, 'functional manager cannot see shared skills without scope');
select pg_temp.assert_count_as('60000000-0000-0000-0000-000000000006', $$select * from public.skills where id = 'c1000000-0000-0000-0000-000000000001'$$, 1, 'explicit project subtree scope exposes only the shared skill');
select pg_temp.assert_count_as('60000000-0000-0000-0000-000000000006', $$select * from public.skill_assessments where id = 'c2000000-0000-0000-0000-000000000001'$$, 1, 'explicit project evidence scope exposes shared evidence');
select pg_temp.assert_count_as('60000000-0000-0000-0000-000000000006', $$select * from public.skills where id = 'c1000000-0000-0000-0000-000000000002'$$, 0, 'project scope does not expose private skills');
select pg_temp.assert_count_as('20000000-0000-0000-0000-000000000002', $$select * from public.profile_searchable_skills where profile_id = '40000000-0000-0000-0000-000000000004'$$, 0, 'search metadata does not leak private learner data');
select pg_temp.assert_count_as('10000000-0000-0000-0000-000000000001', $$select * from public.skills where id = 'c1000000-0000-0000-0000-000000000001'$$, 1, 'existing employer admin sharing behavior remains intact');

-- Revoking consent removes learner-owned access but not employer-owned data.
update public.employer_data_access_requests
set status = 'revoked', approved_data = array[]::text[], decided_at = now()
where id = 'd0000000-0000-0000-0000-000000000001';
delete from public.employer_data_access_shared_skills
where request_id = 'd0000000-0000-0000-0000-000000000001';

select pg_temp.assert_count_as('20000000-0000-0000-0000-000000000002', $$select * from public.skills where id = 'c1000000-0000-0000-0000-000000000001'$$, 0, 'revoking sharing removes manager skill access');
select pg_temp.assert_count_as('20000000-0000-0000-0000-000000000002', $$select * from public.courses where id = 'c3000000-0000-0000-0000-000000000001'$$, 0, 'revoking sharing removes manager training access');
select pg_temp.assert_count_as('20000000-0000-0000-0000-000000000002', $$select * from public.course_assignments where id = 'e1000000-0000-0000-0000-000000000001'$$, 1, 'revoking sharing does not erase employer-owned access');

-- Membership deactivation immediately removes management access.
update public.employer_members set status = 'inactive'
where id = 'a4000000-0000-0000-0000-000000000004';
select pg_temp.assert_boolean_as(
  '20000000-0000-0000-0000-000000000002',
  $$select public.can_manage_employer_member('a4000000-0000-0000-0000-000000000004', null, true)$$,
  false,
  'inactive employee membership removes access'
);
update public.employer_members set status = 'active'
where id = 'a4000000-0000-0000-0000-000000000004';

update public.employer_members set status = 'inactive'
where id = 'a2000000-0000-0000-0000-000000000002';
select pg_temp.assert_boolean_as(
  '20000000-0000-0000-0000-000000000002',
  $$select public.can_manage_employer_member('a3000000-0000-0000-0000-000000000003', null, true)$$,
  false,
  'inactive manager membership removes access'
);
update public.employer_members set status = 'active'
where id = 'a2000000-0000-0000-0000-000000000002';

-- Ending the originating relationship removes both direct and inherited access.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select public.end_employer_management_relationship(
  'aa000000-0000-0000-0000-000000000001',
  current_date
);
reset role;

select pg_temp.assert_boolean_as(
  '20000000-0000-0000-0000-000000000002',
  $$select public.can_manage_employer_member('a3000000-0000-0000-0000-000000000003', null, true)$$,
  false,
  'ended relationship removes direct access'
);
select pg_temp.assert_boolean_as(
  '20000000-0000-0000-0000-000000000002',
  $$select public.can_manage_employer_member('a4000000-0000-0000-0000-000000000004', null, true)$$,
  false,
  'ended relationship removes inherited access'
);

rollback;

\echo 'Employer management relationship security checks passed.'
