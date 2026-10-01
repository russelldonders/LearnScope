\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email, email_confirmed_at) values
  ('76000000-0000-0000-0000-000000000001', 'team-leader@example.com', now()),
  ('76000000-0000-0000-0000-000000000002', 'learner@example.com', now()),
  ('76000000-0000-0000-0000-000000000003', 'line-manager@example.com', now()),
  ('76000000-0000-0000-0000-000000000004', 'someone-else@example.com', now());

insert into public.skill_library (id, name, created_by)
values ('76000000-0000-0000-0000-000000000010', 'Mentoring', '76000000-0000-0000-0000-000000000001');

insert into public.skills (id, user_id, name, level, library_skill_id)
values ('76000000-0000-0000-0000-000000000020', '76000000-0000-0000-0000-000000000002', 'Mentoring', 2, '76000000-0000-0000-0000-000000000010');

-- An independent team the learner belongs to, created the way the app does.
select set_config('request.jwt.claim.sub', '76000000-0000-0000-0000-000000000001', true);
set local role authenticated;
create temporary table fixture on commit drop as
  select public.create_manager_team(public.create_manager_workspace('Leader workspace'), 'Study circle', null) as team_id;
reset role;
insert into public.manager_team_memberships (id, team_id, member_user_id, role, status)
select '76000000-0000-0000-0000-000000000033', team_id, '76000000-0000-0000-0000-000000000002', 'member', 'active' from fixture;

-- An organisation the learner works for.
insert into public.organisations (id, name, org_code) values ('76000000-0000-0000-0000-000000000040', 'Acme Ltd', 'ACME76');
insert into public.employer_members (id, employer_id, user_id, role, status)
values ('76000000-0000-0000-0000-000000000041', '76000000-0000-0000-0000-000000000040', '76000000-0000-0000-0000-000000000002', 'member', 'active');

-- One of each manager action, written to the old tables as today's functions do.
insert into public.manager_team_skill_suggestions (membership_id, skill_library_id, skill_name, suggested_by)
values ('76000000-0000-0000-0000-000000000033', '76000000-0000-0000-0000-000000000010', 'Mentoring', '76000000-0000-0000-0000-000000000001');
insert into public.employer_skill_suggestions (employer_id, learner_id, skill_library_id, skill_name, assigned_by)
values ('76000000-0000-0000-0000-000000000040', '76000000-0000-0000-0000-000000000002', '76000000-0000-0000-0000-000000000010', 'Mentoring', '76000000-0000-0000-0000-000000000003');
insert into public.manager_team_skill_assessments (membership_id, skill_id, level, comments, assessed_by)
values ('76000000-0000-0000-0000-000000000033', '76000000-0000-0000-0000-000000000020', 3, 'Good progress', '76000000-0000-0000-0000-000000000001');
insert into public.employer_skill_confirmations (employer_id, user_id, library_skill_id, confirmed_level, confirmed_by)
values ('76000000-0000-0000-0000-000000000040', '76000000-0000-0000-0000-000000000002', '76000000-0000-0000-0000-000000000010', 4, '76000000-0000-0000-0000-000000000003');
insert into public.employer_skill_development_targets (id, employer_id, employer_member_id, skill_library_id, target_level, target_date, created_by)
values ('76000000-0000-0000-0000-000000000050', '76000000-0000-0000-0000-000000000040', '76000000-0000-0000-0000-000000000041', '76000000-0000-0000-0000-000000000010', 4, '2026-12-31', '76000000-0000-0000-0000-000000000003');
insert into public.skill_targets (skill_id, user_id, target_level, target_date, set_by_manager, created_at)
values
  ('76000000-0000-0000-0000-000000000020', '76000000-0000-0000-0000-000000000002', 3, '2026-11-30', '76000000-0000-0000-0000-000000000001', now() - interval '1 day'),
  ('76000000-0000-0000-0000-000000000020', '76000000-0000-0000-0000-000000000002', 4, '2027-01-31', '76000000-0000-0000-0000-000000000001', now());
-- The learner's own target stays theirs and isn't copied.
insert into public.skill_targets (skill_id, user_id, target_level, target_date)
values ('76000000-0000-0000-0000-000000000020', '76000000-0000-0000-0000-000000000002', 5, '2027-06-30');

-- A status change is mirrored too.
update public.employer_skill_suggestions set status = 'adopted'
where learner_id = '76000000-0000-0000-0000-000000000002';

do $$
declare learner constant uuid := '76000000-0000-0000-0000-000000000002';
begin
  if (select count(*) from public.manager_skill_suggestions where learner_id = learner) <> 2
     or not exists (select 1 from public.manager_skill_suggestions where learner_id = learner and context_type = 'team' and context_name = 'Study circle')
     or not exists (select 1 from public.manager_skill_suggestions where learner_id = learner and context_type = 'organisation' and context_name = 'Acme Ltd' and status = 'adopted') then
    raise exception 'suggestions were not mirrored with their context and status';
  end if;

  if not exists (select 1 from public.manager_skill_ratings where learner_id = learner and context_type = 'team' and level = 3
                   and skill_id = '76000000-0000-0000-0000-000000000020' and skill_library_id = '76000000-0000-0000-0000-000000000010')
     or not exists (select 1 from public.manager_skill_ratings where learner_id = learner and context_type = 'organisation' and level = 4) then
    raise exception 'ratings were not mirrored';
  end if;

  if not exists (select 1 from public.manager_skill_targets where learner_id = learner and context_type = 'organisation' and status = 'active')
     or (select count(*) from public.manager_skill_targets where learner_id = learner and context_type = 'team') <> 2
     or (select target_level from public.manager_skill_targets where learner_id = learner and context_type = 'team' and status = 'active') <> 4
     or (select team_id from public.manager_skill_targets where learner_id = learner and context_type = 'team' and status = 'active')
          is distinct from (select team_id from fixture)
     or exists (select 1 from public.manager_skill_targets where learner_id = learner and target_level = 5) then
    raise exception 'targets were not mirrored correctly (context, supersession, or the learner''s own target leaked in)';
  end if;
end
$$;

-- History survives the team going away (the old tables cascade-delete).
delete from public.manager_teams where id = (select team_id from fixture);
do $$
begin
  if (select count(*) from public.manager_skill_suggestions where context_type = 'team' and context_name = 'Study circle' and team_id is null) <> 1
     or (select count(*) from public.manager_skill_targets where context_type = 'team' and context_name = 'Study circle' and team_id is null) <> 2 then
    raise exception 'team history was lost when the team was deleted';
  end if;
end
$$;

-- Only the learner can read their rows.
select set_config('request.jwt.claim.sub', '76000000-0000-0000-0000-000000000004', true);
set local role authenticated;
do $$
begin
  if exists (select 1 from public.manager_skill_suggestions)
     or exists (select 1 from public.manager_skill_ratings)
     or exists (select 1 from public.manager_skill_targets) then
    raise exception 'another user can read a learner''s manager actions';
  end if;
end
$$;
reset role;

select set_config('request.jwt.claim.sub', '76000000-0000-0000-0000-000000000002', true);
set local role authenticated;
do $$
begin
  if (select count(*) from public.manager_skill_suggestions) <> 2 then
    raise exception 'the learner cannot read their own suggestions';
  end if;
end
$$;
reset role;

rollback;
