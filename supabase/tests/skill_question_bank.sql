\set ON_ERROR_STOP on

-- Knowledge-check question pool (0323): only platform admins can read and
-- manage questions (answer keys never reach learners directly), nobody can
-- delete one, and learners' served-question history is server-only.

begin;

insert into auth.users (id, email, email_confirmed_at)
values
  ('ad000000-0000-0000-0000-000000000001', 'admin@example.com', now()),
  ('1e000000-0000-0000-0000-000000000002', 'learner@example.com', now());

insert into public.platform_admins (user_id) values ('ad000000-0000-0000-0000-000000000001');

insert into public.skill_library (id, name, created_by)
values ('5c000000-0000-0000-0000-000000000001', 'Question bank test skill', 'ad000000-0000-0000-0000-000000000001');

insert into public.skill_questions (id, library_skill_id, level, question_type, question, source)
values ('9e000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-000000000001', 3, 'single',
  '{"type":"test_question","title":"Seeded","layout":"single","items":[]}', 'ai');

-- Staging grants these to authenticated by default; the local stack doesn't.
grant all on table public.skill_library, public.platform_admins to authenticated;

set local role authenticated;
set local search_path = public, extensions;

-- A learner can't see the pool or its answers...
select set_config('request.jwt.claim.sub', '1e000000-0000-0000-0000-000000000002', true);
do $$
begin
  if (select count(*) from public.skill_questions) <> 0 then
    raise exception 'a learner could read the question pool';
  end if;
end
$$;

-- ...add to it...
do $$
begin
  insert into public.skill_questions (library_skill_id, level, question_type, question, source)
  values ('5c000000-0000-0000-0000-000000000001', 3, 'single', '{"type":"test_question"}', 'manual');
  raise exception 'a learner could add a question';
exception
  when insufficient_privilege then null;
end
$$;

-- ...or touch anyone's served-question history.
do $$
begin
  perform 1 from public.skill_question_servings;
  raise exception 'a learner could read served-question history';
exception
  when insufficient_privilege then null;
end
$$;

-- A platform admin can read, add, edit and deactivate...
select set_config('request.jwt.claim.sub', 'ad000000-0000-0000-0000-000000000001', true);
insert into public.skill_questions (library_skill_id, level, question_type, question, source, created_by)
values ('5c000000-0000-0000-0000-000000000001', 3, 'true_false',
  '{"type":"test_question","title":"Manual","layout":"true_false","items":[]}', 'manual',
  'ad000000-0000-0000-0000-000000000001');

update public.skill_questions set status = 'inactive' where id = '9e000000-0000-0000-0000-000000000001';

do $$
begin
  if (select count(*) from public.skill_questions where library_skill_id = '5c000000-0000-0000-0000-000000000001') <> 2 then
    raise exception 'a platform admin could not see the pool';
  end if;
  if (select status from public.skill_questions where id = '9e000000-0000-0000-0000-000000000001') <> 'inactive' then
    raise exception 'a platform admin could not deactivate a question';
  end if;
end
$$;

-- ...but not delete: questions are deactivated, never removed...
do $$
begin
  delete from public.skill_questions where id = '9e000000-0000-0000-0000-000000000001';
  raise exception 'a question could be deleted';
exception
  when insufficient_privilege then null;
end
$$;

-- ...nor move one to another skill or level.
do $$
begin
  update public.skill_questions set level = 4 where id = '9e000000-0000-0000-0000-000000000001';
  raise exception 'a question could be moved to another level';
exception
  when insufficient_privilege then null;
end
$$;

-- Only course-builder scored questions can be stored.
do $$
begin
  insert into public.skill_questions (library_skill_id, level, question_type, question, source)
  values ('5c000000-0000-0000-0000-000000000001', 3, 'single', '{"type":"knowledge_check"}', 'manual');
  raise exception 'a non-scored question was accepted';
exception
  when check_violation then null;
end
$$;

rollback;
