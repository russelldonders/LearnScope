\set ON_ERROR_STOP on

-- Coaches approved by LearnScope (0339): only platform admins approve or
-- withdraw; an approval lets someone offer coaching without validating
-- their skill, shows as approved, and withdrawing it stops coaching unless
-- they also qualify through validation.

begin;

insert into auth.users (id, email, email_confirmed_at) values
  ('a9000000-0000-0000-0000-000000000001', 'pro-coach@example.com', now()),
  ('a9000000-0000-0000-0000-000000000002', 'approval-learner@example.com', now()),
  ('a9000000-0000-0000-0000-000000000003', 'approval-admin@example.com', now());

insert into public.platform_admins (user_id) values ('a9000000-0000-0000-0000-000000000003');

insert into public.skill_library (id, name, status) values
  ('a9000000-0000-0000-0000-0000000000a1', 'Coach approvals test skill', 'active'),
  ('a9000000-0000-0000-0000-0000000000a2', 'Coach approvals other skill', 'active');

-- The professional coach has the skill, not validated.
insert into public.skills (id, user_id, name, level, lifecycle_stage, library_skill_id) values
  ('a9000000-0000-0000-0000-000000000011', 'a9000000-0000-0000-0000-000000000001', 'Leadership', 3, 'developing', 'a9000000-0000-0000-0000-0000000000a1'),
  ('a9000000-0000-0000-0000-000000000012', 'a9000000-0000-0000-0000-000000000002', 'Leadership', 1, 'identified', 'a9000000-0000-0000-0000-0000000000a1');

grant all on table public.skills, public.profiles to authenticated;

set local role authenticated;
set local search_path = public, extensions;

-- Not yet approved: can't offer coaching.
select set_config('request.jwt.claim.sub', 'a9000000-0000-0000-0000-000000000001', true);
do $$
begin
  update public.skills set offer_coaching = true where id = 'a9000000-0000-0000-0000-000000000011';
  raise exception 'an unapproved, unvalidated skill offered coaching';
exception
  when check_violation then null;
end
$$;

-- Nobody but a platform admin approves, including themselves; nobody reads
-- approvals directly.
do $$
begin
  begin
    perform public.admin_approve_coach('a9000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-0000000000a1', null);
    raise exception 'a learner approved themselves as a coach';
  exception
    when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.coach_approvals;
    raise exception 'approvals can be read directly';
  exception
    when insufficient_privilege then null;
  end;
  begin
    perform public.admin_list_coach_approvals('a9000000-0000-0000-0000-000000000001');
    raise exception 'a learner listed approvals';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

-- The admin approves them, only for a skill they have, once.
select set_config('request.jwt.claim.sub', 'a9000000-0000-0000-0000-000000000003', true);
do $$
begin
  perform public.admin_approve_coach('a9000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-0000000000a2', null);
  raise exception 'someone was approved for a skill they do not have';
exception
  when others then
    if sqlerrm not like '%doesn''t have that skill%' then raise; end if;
end
$$;
select public.admin_approve_coach('a9000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-0000000000a1', '  ICF certified, checked by phone  ');
do $$
begin
  perform public.admin_approve_coach('a9000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-0000000000a1', null);
  raise exception 'someone was approved twice';
exception
  when others then
    if sqlerrm not like '%already approved%' then raise; end if;
end
$$;
do $$
begin
  if (select note from public.admin_list_coach_approvals('a9000000-0000-0000-0000-000000000001')) <> 'ICF certified, checked by phone' then
    raise exception 'the admin does not see the approval and its note';
  end if;
end
$$;

-- Now they can offer coaching; their skill stays as it was.
select set_config('request.jwt.claim.sub', 'a9000000-0000-0000-0000-000000000001', true);
update public.skills set offer_coaching = true where id = 'a9000000-0000-0000-0000-000000000011';
do $$
begin
  if not (select offer_coaching from public.skills where id = 'a9000000-0000-0000-0000-000000000011')
     or (select lifecycle_stage from public.skills where id = 'a9000000-0000-0000-0000-000000000011') <> 'developing' then
    raise exception 'approval did not allow coaching, or changed the skill';
  end if;
  if (select skill_id from public.list_my_coach_approvals()) <> 'a9000000-0000-0000-0000-000000000011' then
    raise exception 'the coach does not see their approval';
  end if;
end
$$;

-- Others find them as an approved coach.
select set_config('request.jwt.claim.sub', 'a9000000-0000-0000-0000-000000000002', true);
do $$
begin
  if not (select coach_approved from public.list_skill_matches('a9000000-0000-0000-0000-0000000000a1')
          where user_id = 'a9000000-0000-0000-0000-000000000001') then
    raise exception 'the coach is not shown as approved by LearnScope';
  end if;
end
$$;

-- The admin withdraws it: coaching stops, and both are logged.
select set_config('request.jwt.claim.sub', 'a9000000-0000-0000-0000-000000000003', true);
select public.admin_revoke_coach_approval((select id from public.admin_list_coach_approvals('a9000000-0000-0000-0000-000000000001')));
reset role;
do $$
begin
  if (select offer_coaching from public.skills where id = 'a9000000-0000-0000-0000-000000000011') then
    raise exception 'coaching did not stop when the approval was withdrawn';
  end if;
  if (select count(*) from public.admin_activity_log where action in ('coach_approval.granted', 'coach_approval.revoked')) <> 2 then
    raise exception 'approving and withdrawing were not both logged';
  end if;
  if (select revoked_at from public.coach_approvals) is null then
    raise exception 'the withdrawn approval was not kept';
  end if;
end
$$;

-- Approved again later: a new approval, the old one kept.
set local role authenticated;
select public.admin_approve_coach('a9000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-0000000000a1', null);
do $$
begin
  if (select count(*) from public.admin_list_coach_approvals('a9000000-0000-0000-0000-000000000001')) <> 2 then
    raise exception 'approving again did not keep the earlier approval';
  end if;
end
$$;

-- An admin can't approve themselves.
insert into public.skills (id, user_id, name, level, lifecycle_stage, library_skill_id)
values ('a9000000-0000-0000-0000-000000000013', 'a9000000-0000-0000-0000-000000000003', 'Leadership', 4, 'developing', 'a9000000-0000-0000-0000-0000000000a1');
do $$
begin
  perform public.admin_approve_coach('a9000000-0000-0000-0000-000000000003', 'a9000000-0000-0000-0000-0000000000a1', null);
  raise exception 'an admin approved themselves as a coach';
exception
  when insufficient_privilege then null;
end
$$;

-- Deleting and adding the skill again doesn't announce the coach afresh.
select set_config('request.jwt.claim.sub', 'a9000000-0000-0000-0000-000000000001', true);
update public.skills set offer_coaching = true where id = 'a9000000-0000-0000-0000-000000000011';
reset role;
update public.coach_approvals set last_offered_at = now() - interval '2 days' where revoked_at is null;
set local role authenticated;
delete from public.skills where id = 'a9000000-0000-0000-0000-000000000011';
insert into public.skills (id, user_id, name, level, lifecycle_stage, library_skill_id, offer_coaching)
values ('a9000000-0000-0000-0000-000000000014', 'a9000000-0000-0000-0000-000000000001', 'Leadership', 3, 'developing', 'a9000000-0000-0000-0000-0000000000a1', true);
do $$
begin
  if (select coaching_offered_at from public.skills where id = 'a9000000-0000-0000-0000-000000000014') > now() - interval '1 day' then
    raise exception 'adding the skill again announced the coach afresh';
  end if;
end
$$;

-- Validated as well as approved: withdrawing the approval leaves coaching on.
reset role;
insert into auth.users (id, email, email_confirmed_at)
values ('a9000000-0000-0000-0000-000000000004', 'approval-validator@example.com', now());
insert into public.skills (id, user_id, name, level, lifecycle_stage, library_skill_id)
values ('a9000000-0000-0000-0000-000000000015', 'a9000000-0000-0000-0000-000000000004', 'Leadership', 5, 'validated', 'a9000000-0000-0000-0000-0000000000a1');
insert into public.skill_validation_requests (skill_id, requester_id, validator_id, target_level, status)
values ('a9000000-0000-0000-0000-000000000014', 'a9000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000004', 4, 'confirmed');
update public.skills set lifecycle_stage = 'validated' where id = 'a9000000-0000-0000-0000-000000000014';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a9000000-0000-0000-0000-000000000003', true);
select public.admin_revoke_coach_approval(
  (select id from public.admin_list_coach_approvals('a9000000-0000-0000-0000-000000000001') where revoked_at is null));
reset role;
do $$
begin
  if not (select offer_coaching from public.skills where id = 'a9000000-0000-0000-0000-000000000014') then
    raise exception 'withdrawing the approval stopped coaching for someone also validated';
  end if;
end
$$;

-- Moving an approved coach's skill to another library skill stops coaching.
update public.skills set lifecycle_stage = 'developing' where id = 'a9000000-0000-0000-0000-000000000014';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a9000000-0000-0000-0000-000000000003', true);
select public.admin_approve_coach('a9000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-0000000000a1', null);
select set_config('request.jwt.claim.sub', 'a9000000-0000-0000-0000-000000000001', true);
update public.skills set offer_coaching = true where id = 'a9000000-0000-0000-0000-000000000014';
update public.skills set library_skill_id = 'a9000000-0000-0000-0000-0000000000a2' where id = 'a9000000-0000-0000-0000-000000000014';
do $$
begin
  if (select offer_coaching from public.skills where id = 'a9000000-0000-0000-0000-000000000014') then
    raise exception 'an approved coach moved to another library skill still offers coaching';
  end if;
end
$$;

rollback;
