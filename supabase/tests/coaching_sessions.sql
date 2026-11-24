\set ON_ERROR_STOP on

-- Coaching sessions (0336): proposing, answering, moving, cancelling and
-- marking done -- who may do each, and that done needs a real joint activity.

begin;

insert into auth.users (id, email, email_confirmed_at) values
  ('d0000000-0000-0000-0000-000000000001', 'session-learner@example.com', now()),
  ('d0000000-0000-0000-0000-000000000002', 'session-coach@example.com', now()),
  ('d0000000-0000-0000-0000-000000000003', 'session-outsider@example.com', now());

insert into public.skill_library (id, name, status)
values ('d0000000-0000-0000-0000-0000000000a1', 'Coaching sessions test skill', 'active');

insert into public.skills (id, user_id, name, level, lifecycle_stage, library_skill_id) values
  ('d0000000-0000-0000-0000-000000000011', 'd0000000-0000-0000-0000-000000000001', 'Facilitation', 1, 'identified', 'd0000000-0000-0000-0000-0000000000a1'),
  ('d0000000-0000-0000-0000-000000000012', 'd0000000-0000-0000-0000-000000000002', 'Facilitation', 4, 'validated', 'd0000000-0000-0000-0000-0000000000a1');

insert into public.connections (user_a_id, user_b_id, source)
values ('d0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', 'request');

insert into public.coaching_relationships (id, learner_id, coach_id, learner_skill_id, coach_skill_id, library_skill_id, skill_name, status, started_at)
values ('d0000000-0000-0000-0000-0000000000c1', 'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002',
  'd0000000-0000-0000-0000-000000000011', 'd0000000-0000-0000-0000-000000000012', 'd0000000-0000-0000-0000-0000000000a1',
  'Coaching sessions test skill', 'active', now());

-- Staging grants these to authenticated by default; the local stack doesn't.
grant all on table public.xapi_statements, public.xapi_statement_skills, public.connections,
  public.skills, public.profiles to authenticated;

set local role authenticated;
set local search_path = public, extensions;

-- The learner proposes; they can't answer their own proposal.
select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-000000000001', true);
select public.propose_coaching_session('d0000000-0000-0000-0000-0000000000c1', now() + interval '2 days', 60, ' Video call ', '  Plan my workshop ');
do $$
begin
  if (select location from public.coaching_sessions) <> 'Video call' or (select agenda from public.coaching_sessions) <> 'Plan my workshop' then
    raise exception 'the session details were not kept, trimmed';
  end if;
  perform public.respond_to_coaching_session((select id from public.coaching_sessions), true);
  raise exception 'the proposer confirmed their own session';
exception
  when others then
    if sqlerrm not like '%other person answers%' then raise; end if;
end
$$;

-- Not in the past, not too long.
do $$
begin
  perform public.propose_coaching_session('d0000000-0000-0000-0000-0000000000c1', now() - interval '2 days', 60);
  raise exception 'a session in the past was planned';
exception
  when others then
    if sqlerrm not like '%from now up to a year%' then raise; end if;
end
$$;
do $$
begin
  perform public.propose_coaching_session('d0000000-0000-0000-0000-0000000000c1', now() + interval '1 day', 600);
  raise exception 'a ten-hour session was planned';
exception
  when others then
    if sqlerrm not like '%between 5 minutes and 8 hours%' then raise; end if;
end
$$;

-- An outsider can't see, propose in or answer it.
select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-000000000003', true);
do $$
begin
  if exists (select 1 from public.coaching_sessions) or exists (select 1 from public.list_my_coaching_sessions()) then
    raise exception 'an outsider can see coaching sessions';
  end if;
  begin
    perform public.propose_coaching_session('d0000000-0000-0000-0000-0000000000c1', now() + interval '1 day', 30);
    raise exception 'an outsider proposed a session';
  exception
    when others then
      if sqlerrm not like '%Coaching not found%' then raise; end if;
  end;
end
$$;
do $$
begin
  perform public.cancel_coaching_session((select id from public.coaching_sessions));
  raise exception 'an outsider cancelled a session';
exception
  when others then
    if sqlerrm not like '%not found%' then raise; end if;
end
$$;

-- The coach suggests another time: the first is replaced by their proposal,
-- which the learner confirms.
select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-000000000002', true);
select public.reschedule_coaching_session(
  (select id from public.list_my_coaching_sessions() where status = 'proposed'),
  now() + interval '3 days', 45, 'Room 2', null);
select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-000000000001', true);
do $$
begin
  if (select count(*) from public.list_my_coaching_sessions() where status = 'rescheduled') <> 1
     or (select proposed_by_me from public.list_my_coaching_sessions() where status = 'proposed') then
    raise exception 'moving a session did not replace it with the other person''s proposal';
  end if;
end
$$;
select public.respond_to_coaching_session((select id from public.coaching_sessions where status = 'proposed'), true);

-- It can't be marked done before it starts.
do $$
begin
  perform public.complete_coaching_session((select id from public.coaching_sessions where status = 'confirmed'), null);
  raise exception 'a session was marked done before it started';
exception
  when others then
    if sqlerrm not like '%hasn''t started yet%' then raise; end if;
end
$$;

-- Once it has happened, only with a joint activity with the coach, and only
-- by the learner.
reset role;
update public.coaching_sessions set starts_at = now() - interval '1 hour' where status = 'confirmed';
set local role authenticated;
insert into public.xapi_statements (id, user_id, statement, recorded_at)
values ('d0000000-0000-0000-0000-0000000000e1', 'd0000000-0000-0000-0000-000000000001', '{"actor":{"mbox":"mailto:session-learner@example.com"}}', now());
do $$
begin
  perform public.complete_coaching_session((select id from public.coaching_sessions where status = 'confirmed'), 'd0000000-0000-0000-0000-0000000000e1');
  raise exception 'a session was marked done with an activity not done with the coach';
exception
  when others then
    if sqlerrm not like '%together with your coach%' then raise; end if;
end
$$;
insert into public.xapi_statements (id, user_id, statement, recorded_at, with_user_id, with_kind)
values ('d0000000-0000-0000-0000-0000000000e2', 'd0000000-0000-0000-0000-000000000001',
  '{"actor":{"mbox":"mailto:session-learner@example.com"},"object":{"definition":{"name":{"en-US":"Coaching session"}}}}',
  now(), 'd0000000-0000-0000-0000-000000000002', 'joint');

select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-000000000002', true);
do $$
begin
  perform public.complete_coaching_session((select id from public.coaching_sessions where status = 'confirmed'), 'd0000000-0000-0000-0000-0000000000e2');
  raise exception 'the coach marked the session done';
exception
  when others then
    if sqlerrm not like '%not found%' then raise; end if;
end
$$;

-- Nor, once it has started, call it off or move it.
do $$
begin
  perform public.cancel_coaching_session((select id from public.coaching_sessions where status = 'confirmed'));
  raise exception 'the coach cancelled a session that had started';
exception
  when others then
    if sqlerrm not like '%not found%' then raise; end if;
end
$$;
do $$
begin
  perform public.reschedule_coaching_session((select id from public.coaching_sessions where status = 'confirmed'), now() + interval '1 day', 30);
  raise exception 'a session that had started was moved';
exception
  when others then
    if sqlerrm not like '%already started%' then raise; end if;
end
$$;

select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-000000000001', true);
select public.complete_coaching_session((select id from public.coaching_sessions where status = 'confirmed'), 'd0000000-0000-0000-0000-0000000000e2');
do $$
begin
  if (select activity_statement_id from public.list_my_coaching_sessions() where status = 'done') <> 'd0000000-0000-0000-0000-0000000000e2' then
    raise exception 'the done session does not point at its activity';
  end if;
end
$$;

-- The coach sees it done, but not the learner's activity id.
select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-000000000002', true);
do $$
begin
  if (select activity_statement_id from public.list_my_coaching_sessions() where status = 'done') is not null then
    raise exception 'the coach sees the learner''s activity id';
  end if;
end
$$;
-- Not even by reading the table itself.
do $$
begin
  perform (select activity_statement_id from public.coaching_sessions limit 1);
  raise exception 'the learner''s activity id can be read from the table';
exception
  when insufficient_privilege then null;
end
$$;

-- One activity stands for one session.
select public.propose_coaching_session('d0000000-0000-0000-0000-0000000000c1', now() + interval '1 day', 30);
select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-000000000001', true);
select public.respond_to_coaching_session((select id from public.coaching_sessions where status = 'proposed'), true);
reset role;
update public.coaching_sessions set starts_at = now() - interval '1 hour' where status = 'confirmed';
set local role authenticated;
do $$
begin
  perform public.complete_coaching_session((select id from public.coaching_sessions where status = 'confirmed'), 'd0000000-0000-0000-0000-0000000000e2');
  raise exception 'one activity was tied to two sessions';
exception
  when unique_violation then null;
end
$$;
select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-000000000002', true);

-- Nobody changes a session directly.
do $$
begin
  begin
    update public.coaching_sessions set status = 'proposed';
  exception
    when insufficient_privilege then null;
  end;
  if exists (select 1 from public.coaching_sessions where status = 'proposed') then
    raise exception 'a session was changed directly';
  end if;
end
$$;

-- A planned session can be cancelled; none can be planned once coaching ends.
select public.propose_coaching_session('d0000000-0000-0000-0000-0000000000c1', now() + interval '5 days', 30);
select public.cancel_coaching_session((select id from public.coaching_sessions where status = 'proposed'));
select public.end_coaching('d0000000-0000-0000-0000-0000000000c1');
do $$
begin
  perform public.propose_coaching_session('d0000000-0000-0000-0000-0000000000c1', now() + interval '6 days', 30);
  raise exception 'a session was planned after coaching ended';
exception
  when others then
    if sqlerrm not like '%while coaching is going on%' then raise; end if;
end
$$;

rollback;
