\set ON_ERROR_STOP on

-- Server-marked knowledge checks (0324): a learner can't record a confirmed
-- knowledge level or diagnostic evidence themselves, can't read the answer-
-- bearing attempt or interview records, and ordinary records still work.

begin;

insert into auth.users (id, email, email_confirmed_at)
values ('1e000000-0000-0000-0000-000000000011', 'checker@example.com', now());

insert into public.skills (id, user_id, name)
values ('5e000000-0000-0000-0000-000000000011', '1e000000-0000-0000-0000-000000000011', 'SQL');

-- The server (service role, here the migration owner) can record one.
insert into public.skill_assessments (id, skill_id, user_id, level, axis, source)
values ('a5000000-0000-0000-0000-000000000011', '5e000000-0000-0000-0000-000000000011',
  '1e000000-0000-0000-0000-000000000011', 3, 'knowledge', 'diagnostic_confirmed');

-- The server records an answer once: a second recording of the same
-- question, or one after the round closes, changes nothing.
insert into public.skill_quiz_attempts (id, user_id, skill_id, run_id, level, questions)
values ('a7000000-0000-0000-0000-000000000011', '1e000000-0000-0000-0000-000000000011',
  '5e000000-0000-0000-0000-000000000011', gen_random_uuid(), 3, '[]');
do $$
begin
  if not public.record_skill_quiz_answer('a7000000-0000-0000-0000-000000000011', 'q1', '"a"', false) then
    raise exception 'the first answer was not recorded';
  end if;
  if public.record_skill_quiz_answer('a7000000-0000-0000-0000-000000000011', 'q1', '"b"', true) then
    raise exception 'an answer was recorded twice';
  end if;
  if (select results->'q1'->>'correct' from public.skill_quiz_attempts where id = 'a7000000-0000-0000-0000-000000000011') <> 'false' then
    raise exception 'a recorded marking was overwritten';
  end if;
  update public.skill_quiz_attempts set status = 'completed' where id = 'a7000000-0000-0000-0000-000000000011';
  if public.record_skill_quiz_answer('a7000000-0000-0000-0000-000000000011', 'q2', '"a"', true) then
    raise exception 'an answer was recorded after the round finished';
  end if;
end
$$;

-- A few runs per skill a day, however they arrive: the attempt above is run
-- one, four more fit, a sixth is refused; later rounds of a run don't count.
insert into public.skill_quiz_attempts (user_id, skill_id, run_id, level, questions)
select '1e000000-0000-0000-0000-000000000011', '5e000000-0000-0000-0000-000000000011', gen_random_uuid(), 3, '[]'
from generate_series(1, 4);
insert into public.skill_quiz_attempts (user_id, skill_id, run_id, round, level, questions)
values ('1e000000-0000-0000-0000-000000000011', '5e000000-0000-0000-0000-000000000011', gen_random_uuid(), 2, 4, '[]');
do $$
begin
  insert into public.skill_quiz_attempts (user_id, skill_id, run_id, level, questions)
  values ('1e000000-0000-0000-0000-000000000011', '5e000000-0000-0000-0000-000000000011', gen_random_uuid(), 3, '[]');
  raise exception 'a sixth knowledge check run was allowed in a day';
exception
  when program_limit_exceeded then null;
end
$$;

insert into public.skill_interview_sessions (user_id, skill_id, level, plan)
select '1e000000-0000-0000-0000-000000000011', '5e000000-0000-0000-0000-000000000011', 3, '{}'
from generate_series(1, 5);
do $$
begin
  insert into public.skill_interview_sessions (user_id, skill_id, level, plan)
  values ('1e000000-0000-0000-0000-000000000011', '5e000000-0000-0000-0000-000000000011', 3, '{}');
  raise exception 'a sixth interview was allowed in a day';
exception
  when program_limit_exceeded then null;
end
$$;

-- Staging grants these to authenticated by default; the local stack doesn't.
grant all on table public.skills, public.skill_assessments, public.xapi_statements to authenticated;

set local role authenticated;
set local search_path = public, extensions;
select set_config('request.jwt.claim.sub', '1e000000-0000-0000-0000-000000000011', true);

-- A self-assessment still works...
insert into public.skill_assessments (skill_id, user_id, level, axis, source)
values ('5e000000-0000-0000-0000-000000000011', '1e000000-0000-0000-0000-000000000011', 4, 'knowledge', 'self');

-- ...but a confirmed level can't be written directly...
do $$
begin
  insert into public.skill_assessments (skill_id, user_id, level, axis, source)
  values ('5e000000-0000-0000-0000-000000000011', '1e000000-0000-0000-0000-000000000011', 5, 'knowledge', 'diagnostic_confirmed');
  raise exception 'a learner could record a confirmed level';
exception
  when insufficient_privilege then null;
end
$$;

-- ...nor a self-assessment turned into one...
do $$
begin
  update public.skill_assessments set source = 'diagnostic_confirmed'
  where user_id = '1e000000-0000-0000-0000-000000000011' and source = 'self';
  raise exception 'a learner could turn a self-assessment into a confirmed level';
exception
  when insufficient_privilege then null;
end
$$;

-- ...nor a confirmed one raised.
do $$
begin
  update public.skill_assessments set level = 5 where id = 'a5000000-0000-0000-0000-000000000011';
  raise exception 'a learner could change a confirmed level';
exception
  when insufficient_privilege then null;
end
$$;

-- Nor can they write diagnostic evidence...
do $$
begin
  insert into public.xapi_statements (user_id, statement, recorded_at)
  values ('1e000000-0000-0000-0000-000000000011',
    '{"result":{"extensions":{"https://learnscope.app/xapi/extensions/diagnostic":{"confirmedLevel":5}}}}', now());
  raise exception 'a learner could write a diagnostic statement';
exception
  when insufficient_privilege then null;
end
$$;

-- ...while ordinary activity still records.
insert into public.xapi_statements (user_id, statement, recorded_at)
values ('1e000000-0000-0000-0000-000000000011', '{"object":{"definition":{"name":{"en-US":"Practised joins"}}}}', now());

-- Nor set the skill's confirmed knowledge level...
do $$
begin
  update public.skills set knowledge_level = 5 where id = '5e000000-0000-0000-0000-000000000011';
  raise exception 'a learner could set their confirmed knowledge level';
exception
  when insufficient_privilege then null;
end
$$;

-- ...though other edits to the skill still work.
update public.skills set name = 'SQL basics' where id = '5e000000-0000-0000-0000-000000000011';

-- Nor call the server's answer recorder.
do $$
begin
  perform public.record_skill_quiz_answer('a7000000-0000-0000-0000-000000000011', 'q3', '"a"', true);
  raise exception 'a learner could record a quiz answer';
exception
  when insufficient_privilege then null;
end
$$;

-- Old cached quizzes and interview rubrics are server-only too.
do $$
begin
  perform 1 from public.skill_diagnostic_content;
  raise exception 'a learner could read cached quiz answers';
exception
  when insufficient_privilege then null;
end
$$;

-- And the answer-bearing records are server-only.
do $$
begin
  perform 1 from public.skill_quiz_attempts;
  raise exception 'a learner could read quiz attempts';
exception
  when insufficient_privilege then null;
end
$$;

do $$
begin
  perform 1 from public.skill_interview_sessions;
  raise exception 'a learner could read interview sessions';
exception
  when insufficient_privilege then null;
end
$$;

rollback;
