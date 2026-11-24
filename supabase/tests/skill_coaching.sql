\set ON_ERROR_STOP on

-- Coaching on a skill (0335): who can offer it, finding a coach, looking for
-- one, and asking, answering, withdrawing and ending coaching.

begin;

insert into auth.users (id, email, email_confirmed_at) values
  ('c0000000-0000-0000-0000-000000000001', 'learner@example.com', now()),
  ('c0000000-0000-0000-0000-000000000002', 'coach@example.com', now()),
  ('c0000000-0000-0000-0000-000000000003', 'unverified@example.com', now()),
  ('c0000000-0000-0000-0000-000000000004', 'validator@example.com', now()),
  ('c0000000-0000-0000-0000-000000000005', 'outsider@example.com', now());

update public.profiles set first_name = 'Coral', last_name = 'Coach' where id = 'c0000000-0000-0000-0000-000000000002';
update public.profiles set skill_search_visibility = 'hidden' where id = 'c0000000-0000-0000-0000-000000000002';

insert into public.skill_library (id, name, status) values
  ('c0000000-0000-0000-0000-0000000000a1', 'Coaching test skill', 'active'),
  ('c0000000-0000-0000-0000-0000000000a2', 'Coaching test other skill', 'active');

insert into public.skills (id, user_id, name, level, lifecycle_stage, library_skill_id) values
  ('c0000000-0000-0000-0000-000000000011', 'c0000000-0000-0000-0000-000000000001', 'Public speaking', 1, 'identified', 'c0000000-0000-0000-0000-0000000000a1'),
  ('c0000000-0000-0000-0000-000000000012', 'c0000000-0000-0000-0000-000000000002', 'Public speaking', 4, 'validated', 'c0000000-0000-0000-0000-0000000000a1'),
  ('c0000000-0000-0000-0000-000000000013', 'c0000000-0000-0000-0000-000000000003', 'Public speaking', 4, 'validated', 'c0000000-0000-0000-0000-0000000000a1'),
  ('c0000000-0000-0000-0000-000000000014', 'c0000000-0000-0000-0000-000000000004', 'Public speaking', 5, 'validated', 'c0000000-0000-0000-0000-0000000000a1'),
  -- Validated, but by someone who doesn't have the skill themselves.
  ('c0000000-0000-0000-0000-000000000016', 'c0000000-0000-0000-0000-000000000005', 'Other', 4, 'validated', 'c0000000-0000-0000-0000-0000000000a2');

-- Only the coach's skill was validated by another person with the skill.
insert into public.skill_validation_requests (skill_id, requester_id, validator_id, target_level, status) values
  ('c0000000-0000-0000-0000-000000000012', 'c0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000004', 4, 'confirmed'),
  ('c0000000-0000-0000-0000-000000000016', 'c0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000003', 4, 'confirmed');

-- Staging grants these to authenticated by default; the local stack doesn't.
grant all on table public.skills, public.profiles, public.connections to authenticated;

set local role authenticated;
set local search_path = public, extensions;

-- The learner registers interest before any coach exists.
select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000001', true);
insert into public.coach_interests (user_id, skill_id)
values ('c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000011');
do $$
begin
  if public.count_skill_coaches('c0000000-0000-0000-0000-0000000000a1') <> 0 then
    raise exception 'a coach was counted before anyone offered coaching';
  end if;
  if (select coach_available_at from public.list_my_coach_interests()) is not null then
    raise exception 'a coach was reported available before anyone offered coaching';
  end if;
end
$$;

-- Nobody can register interest on someone else's skill.
do $$
begin
  insert into public.coach_interests (user_id, skill_id)
  values ('c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000013');
  raise exception 'registering interest on another learner''s skill unexpectedly succeeded';
exception
  when insufficient_privilege then null;
end
$$;

-- A skill validated only without another person can't offer coaching.
select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000003', true);
do $$
begin
  update public.skills set offer_coaching = true where id = 'c0000000-0000-0000-0000-000000000013';
  raise exception 'an unverified skill unexpectedly offered coaching';
exception
  when check_violation then null;
end
$$;

-- A person-validated one can, and when it started is set by the server.
select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000002', true);
update public.skills set offer_coaching = true, coaching_offered_at = '2000-01-01'
where id = 'c0000000-0000-0000-0000-000000000012';
do $$
begin
  if (select coaching_offered_at from public.skills where id = 'c0000000-0000-0000-0000-000000000012') < now() - interval '1 minute' then
    raise exception 'the client chose when coaching was offered';
  end if;
end
$$;

-- The learner hears a coach is available and finds them, even though the
-- coach hides from skill search otherwise.
select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000001', true);
do $$
begin
  if (select coach_available_at from public.list_my_coach_interests()) is null then
    raise exception 'the learner was not told a coach became available';
  end if;
  if public.count_skill_coaches('c0000000-0000-0000-0000-0000000000a1') <> 1 then
    raise exception 'the coach was not counted';
  end if;
  if not exists (
    select 1 from public.list_skill_matches('c0000000-0000-0000-0000-0000000000a1')
    where user_id = 'c0000000-0000-0000-0000-000000000002' and is_coach
      and coach_skill_id = 'c0000000-0000-0000-0000-000000000012'
  ) then
    raise exception 'the coach is not listed as a coach';
  end if;
  if exists (select 1 from public.list_skill_matches('c0000000-0000-0000-0000-0000000000a1')
    where coach_skill_id = 'c0000000-0000-0000-0000-000000000013') then
    raise exception 'a skill not offering coaching is listed as a coach';
  end if;
end
$$;

-- Asking for coaching, once.
select public.request_coaching('c0000000-0000-0000-0000-000000000011', 'c0000000-0000-0000-0000-000000000012', '  Help me prepare a talk  ');
do $$
begin
  perform public.request_coaching('c0000000-0000-0000-0000-000000000011', 'c0000000-0000-0000-0000-000000000012', null);
  raise exception 'asking the same coach twice unexpectedly succeeded';
exception
  when others then
    if sqlerrm not like '%already asked%' then raise; end if;
end
$$;
do $$
begin
  if (select my_coaching_status from public.list_skill_matches('c0000000-0000-0000-0000-0000000000a1')
      where user_id = 'c0000000-0000-0000-0000-000000000002') <> 'requested' then
    raise exception 'the coach list does not show the request';
  end if;
  if (select message from public.list_my_coaching()) <> 'Help me prepare a talk' then
    raise exception 'the request message was not kept, trimmed';
  end if;
end
$$;

-- Nobody can ask using someone else's skill, or a skill not offering coaching.
do $$
begin
  perform public.request_coaching('c0000000-0000-0000-0000-000000000013', 'c0000000-0000-0000-0000-000000000012', null);
  raise exception 'asking with another learner''s skill unexpectedly succeeded';
exception
  when others then
    if sqlerrm not like '%your own skills%' then raise; end if;
end
$$;
do $$
begin
  perform public.request_coaching('c0000000-0000-0000-0000-000000000011', 'c0000000-0000-0000-0000-000000000013', null);
  raise exception 'asking someone not offering coaching unexpectedly succeeded';
exception
  when others then
    if sqlerrm not like '%isn''t offering coaching%' then raise; end if;
end
$$;

-- The learner can't answer their own request, nor change the row directly.
do $$
begin
  perform public.respond_to_coaching_request((select id from public.coaching_relationships), true);
  raise exception 'the learner answered their own request';
exception
  when others then
    if sqlerrm not like '%not found%' then raise; end if;
end
$$;
do $$
begin
  begin
    update public.coaching_relationships set status = 'active';
  exception
    when insufficient_privilege then null;
  end;
  if (select status from public.coaching_relationships) <> 'requested' then
    raise exception 'changing coaching directly unexpectedly succeeded';
  end if;
end
$$;

-- An outsider sees none of it.
select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000005', true);
do $$
begin
  if exists (select 1 from public.coaching_relationships) or exists (select 1 from public.list_my_coaching()) then
    raise exception 'an outsider can see someone else''s coaching';
  end if;
  if exists (select 1 from public.coach_interests) then
    raise exception 'an outsider can see who is looking for a coach';
  end if;
end
$$;

-- The coach accepts: they're connected and the search for a coach ends.
select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000002', true);
do $$
begin
  if (select role from public.list_my_coaching()) <> 'coach' then
    raise exception 'the coach does not see the request as coach';
  end if;
end
$$;
select public.respond_to_coaching_request((select id from public.coaching_relationships), true);
do $$
begin
  if (select status from public.coaching_relationships) <> 'active'
     or (select started_at from public.coaching_relationships) is null then
    raise exception 'accepting did not start coaching';
  end if;
  if not public.is_connected('c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002') then
    raise exception 'accepting did not connect learner and coach';
  end if;
end
$$;
reset role;
do $$
begin
  if exists (select 1 from public.coach_interests where skill_id = 'c0000000-0000-0000-0000-000000000011') then
    raise exception 'the learner is still looking for a coach after getting one';
  end if;
end
$$;
set local role authenticated;

-- The learner ends it; it stays as history.
select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000001', true);
select public.end_coaching((select id from public.coaching_relationships));
do $$
begin
  if (select status from public.coaching_relationships) <> 'ended'
     or not (select ended_by_me from public.list_my_coaching()) then
    raise exception 'ending coaching did not keep it as ended history';
  end if;
end
$$;

-- A new request can be withdrawn by the learner.
select public.request_coaching('c0000000-0000-0000-0000-000000000011', 'c0000000-0000-0000-0000-000000000012', null);
select public.withdraw_coaching_request((select id from public.coaching_relationships where status = 'requested'));
do $$
begin
  if exists (select 1 from public.coaching_relationships where status = 'requested') then
    raise exception 'withdrawing did not withdraw the request';
  end if;
end
$$;

-- Nobody can be asked over and over: not again the same day after
-- withdrawing, nor within 30 days of saying no.
do $$
begin
  perform public.request_coaching('c0000000-0000-0000-0000-000000000011', 'c0000000-0000-0000-0000-000000000012', null);
  raise exception 're-asking straight after withdrawing unexpectedly succeeded';
exception
  when others then
    if sqlerrm not like '%asked this person recently%' then raise; end if;
end
$$;
reset role;
update public.coaching_relationships set responded_at = now() - interval '2 days' where status = 'withdrawn';
set local role authenticated;
select public.request_coaching('c0000000-0000-0000-0000-000000000011', 'c0000000-0000-0000-0000-000000000012', null);
select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000002', true);
select public.respond_to_coaching_request((select id from public.coaching_relationships where status = 'requested'), false);
select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000001', true);
do $$
begin
  perform public.request_coaching('c0000000-0000-0000-0000-000000000011', 'c0000000-0000-0000-0000-000000000012', null);
  raise exception 're-asking a coach who just said no unexpectedly succeeded';
exception
  when others then
    if sqlerrm not like '%asked this person recently%' then raise; end if;
end
$$;

-- A coach who has stopped offering coaching can't accept a request still
-- waiting.
reset role;
update public.coaching_relationships set responded_at = now() - interval '31 days' where status = 'declined';
set local role authenticated;
select public.request_coaching('c0000000-0000-0000-0000-000000000011', 'c0000000-0000-0000-0000-000000000012', null);
select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000002', true);
update public.skills set offer_coaching = false where id = 'c0000000-0000-0000-0000-000000000012';
do $$
begin
  perform public.respond_to_coaching_request((select id from public.coaching_relationships where status = 'requested'), true);
  raise exception 'accepting after stopping offering coaching unexpectedly succeeded';
exception
  when others then
    if sqlerrm not like '%no longer offering%' then raise; end if;
end
$$;

-- Pointing a skill at a different library skill -- which its validation
-- didn't cover -- stops the offer, and can't be used to start one.
update public.skills set offer_coaching = true where id = 'c0000000-0000-0000-0000-000000000012';
update public.skills set library_skill_id = 'c0000000-0000-0000-0000-0000000000a2' where id = 'c0000000-0000-0000-0000-000000000012';
do $$
begin
  if (select offer_coaching from public.skills where id = 'c0000000-0000-0000-0000-000000000012') then
    raise exception 'a skill moved to another library skill still offers coaching';
  end if;
end
$$;

-- A skill validated by someone without the skill themselves can't offer it.
select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000005', true);
do $$
begin
  update public.skills set offer_coaching = true where id = 'c0000000-0000-0000-0000-000000000016';
  raise exception 'a skill validated by someone without it unexpectedly offered coaching';
exception
  when check_violation then null;
end
$$;

-- The learner deleting their skill leaves the coaching history for both.
select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000001', true);
delete from public.skills where id = 'c0000000-0000-0000-0000-000000000011';
reset role;
do $$
begin
  if (select count(*) from public.coaching_relationships) <> 4
     or exists (select 1 from public.coaching_relationships where learner_skill_id is not null)
     or exists (select 1 from public.coaching_relationships where skill_name <> 'Coaching test skill') then
    raise exception 'deleting the learner''s skill lost the coaching history';
  end if;
end
$$;

-- Losing verification stops the offer.
update public.skills set library_skill_id = 'c0000000-0000-0000-0000-0000000000a1', offer_coaching = false
where id = 'c0000000-0000-0000-0000-000000000012';
update public.skills set offer_coaching = true where id = 'c0000000-0000-0000-0000-000000000012';
update public.skills set lifecycle_stage = 'developing' where id = 'c0000000-0000-0000-0000-000000000012';
do $$
begin
  if (select offer_coaching from public.skills where id = 'c0000000-0000-0000-0000-000000000012') then
    raise exception 'a skill that stopped being verified still offers coaching';
  end if;
end
$$;

rollback;
