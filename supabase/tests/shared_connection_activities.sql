\set ON_ERROR_STOP on

-- Activities logged with or about a connection (0322): who can tag whom, who
-- sees them, and that nothing reaches the other person's record unless they
-- add it themselves.

begin;

insert into auth.users (id, email, email_confirmed_at)
values
  ('a1000000-0000-0000-0000-000000000001', 'ana@example.com', now()),
  ('b2000000-0000-0000-0000-000000000002', 'ben@example.com', now()),
  ('c3000000-0000-0000-0000-000000000003', 'cat@example.com', now());

update public.profiles set first_name = 'Ana' where id = 'a1000000-0000-0000-0000-000000000001';

-- Ana and Ben are connected; Cat is connected to neither.
insert into public.connections (user_a_id, user_b_id, source)
values ('a1000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000002', 'request');

insert into public.skills (id, user_id, name) values
  ('a1110000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'SQL'),
  ('b2220000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000002', 'SQL');

-- Staging grants these to authenticated by default; the local stack doesn't.
grant all on table public.xapi_statements, public.xapi_statement_skills, public.connections,
  public.skills, public.profiles to authenticated;

set local role authenticated;
set local search_path = public, extensions;

-- Ana logs something she and Ben did together: it starts as a suggestion.
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', true);
insert into public.xapi_statements (id, user_id, statement, recorded_at, with_user_id, with_kind, with_status)
values ('a1aa0000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001',
  '{"object":{"definition":{"name":{"en-US":"Paired on SQL"}}},"actor":{"mbox":"mailto:ana@example.com"}}',
  now(), 'b2000000-0000-0000-0000-000000000002', 'joint', 'added');

do $$
begin
  if (select with_status from public.xapi_statements where id = 'a1aa0000-0000-0000-0000-000000000001') <> 'suggested' then
    raise exception 'a new shared activity did not start as a suggestion';
  end if;
end
$$;

-- She can't tag someone she isn't connected to.
do $$
begin
  insert into public.xapi_statements (user_id, statement, recorded_at, with_user_id, with_kind)
  values ('a1000000-0000-0000-0000-000000000001', '{}', now(), 'c3000000-0000-0000-0000-000000000003', 'observed');
  raise exception 'tagging a non-connection unexpectedly succeeded';
exception
  when others then
    if sqlerrm not like '%one of your connections%' then raise; end if;
end
$$;

-- Nor mark Ben's answer for him, re-point the row, or fake a copy.
do $$
begin
  update public.xapi_statements set with_status = 'added' where id = 'a1aa0000-0000-0000-0000-000000000001';
  raise exception 'changing the suggestion status directly unexpectedly succeeded';
exception
  when others then
    if sqlerrm not like '%can''t be changed%' then raise; end if;
end
$$;

do $$
begin
  insert into public.xapi_statements (user_id, statement, recorded_at, source_statement_id)
  values ('a1000000-0000-0000-0000-000000000001', '{}', now(), 'a1aa0000-0000-0000-0000-000000000001');
  raise exception 'inserting a copy directly unexpectedly succeeded';
exception
  when others then
    if sqlerrm not like '%only be added from the suggestion%' then raise; end if;
end
$$;

-- A "rated" tag is only for a rating, and is never a suggestion.
do $$
begin
  insert into public.xapi_statements (user_id, statement, recorded_at, with_user_id, with_kind)
  values ('a1000000-0000-0000-0000-000000000001', '{}', now(), 'b2000000-0000-0000-0000-000000000002', 'rated');
  raise exception 'tagging a non-rating as rated unexpectedly succeeded';
exception
  when others then
    if sqlerrm not like '%Only a rating%' then raise; end if;
end
$$;

insert into public.xapi_statements (id, user_id, statement, recorded_at, with_user_id, with_kind)
values ('a1cc0000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001',
  '{"result":{"extensions":{"https://learnscope.app/xapi/extensions/peer-rating":{"level":4}}}}',
  now(), 'b2000000-0000-0000-0000-000000000002', 'rated');

-- And something she saw Ben do.
insert into public.xapi_statements (id, user_id, statement, recorded_at, with_user_id, with_kind)
values ('a1bb0000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001',
  '{"object":{"definition":{"name":{"en-US":"Board presentation"}}}}', now(), 'b2000000-0000-0000-0000-000000000002', 'observed');

do $$
begin
  if (select with_status from public.xapi_statements where id = 'a1cc0000-0000-0000-0000-000000000003') is not null then
    raise exception 'a tagged rating was offered as a suggestion';
  end if;
end
$$;

-- Cat sees nothing between them, and can't answer for Ben.
select set_config('request.jwt.claim.sub', 'c3000000-0000-0000-0000-000000000003', true);
do $$
begin
  if (select count(*) from public.list_shared_activities('a1000000-0000-0000-0000-000000000001')) <> 0 then
    raise exception 'a non-connection could see shared activities';
  end if;
  perform public.respond_to_shared_activity('a1aa0000-0000-0000-0000-000000000001', false);
  raise exception 'a non-connection answered a suggestion';
exception
  when others then
    if sqlerrm not like '%isn''t shared with you%' then raise; end if;
end
$$;

-- Ben sees all three on Ana's page, without her email, and two suggestions.
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-000000000002', true);
do $$
begin
  if (select count(*) from public.list_shared_activities('a1000000-0000-0000-0000-000000000001')) <> 3 then
    raise exception 'Ben did not see the activities Ana shared with him';
  end if;
  if (select count(*) from public.list_shared_activity_suggestions()) <> 2 then
    raise exception 'Ben did not get exactly the two suggestions';
  end if;
  if (select logged_by_name from public.list_shared_activity_suggestions() limit 1) <> 'Ana' then
    raise exception 'the suggestion did not name who logged it';
  end if;
end
$$;

-- A rating can't be "added": it's already on his record.
do $$
begin
  perform public.respond_to_shared_activity('a1cc0000-0000-0000-0000-000000000003', false);
  raise exception 'answering a tagged rating unexpectedly succeeded';
exception
  when others then
    if sqlerrm not like '%already answered%' then raise; end if;
end
$$;

-- Adding can't smuggle in a rating or name a skill that isn't Ben's.
do $$
begin
  perform public.respond_to_shared_activity(
    'a1aa0000-0000-0000-0000-000000000001', true,
    '{"result":{"extensions":{"https://learnscope.app/xapi/extensions/peer-rating":{"level":5}}}}',
    array['b2220000-0000-0000-0000-000000000002']::uuid[]);
  raise exception 'adding a forged rating unexpectedly succeeded';
exception
  when others then
    if sqlerrm not like '%can''t be added as an activity%' then raise; end if;
end
$$;

do $$
begin
  perform public.respond_to_shared_activity(
    'a1aa0000-0000-0000-0000-000000000001', true,
    '{"context":{"extensions":{"https://learnscope.app/xapi/extensions/skill":[{"id":"a1110000-0000-0000-0000-000000000001","name":"SQL"}]}}}',
    array['b2220000-0000-0000-0000-000000000002']::uuid[]);
  raise exception 'naming someone else''s skill unexpectedly succeeded';
exception
  when others then
    if sqlerrm not like '%only name your own skills%' then raise; end if;
end
$$;

-- Ben adds the joint one: his own copy, linked only to his own skill (Ana's
-- skill id is ignored), pointing back at hers.
create temporary table shared_copy as
select public.respond_to_shared_activity(
  'a1aa0000-0000-0000-0000-000000000001', true,
  '{"object":{"definition":{"name":{"en-US":"Paired on SQL"}}}}',
  array['a1110000-0000-0000-0000-000000000001', 'b2220000-0000-0000-0000-000000000002']::uuid[]
) as id;

do $$
declare v_copy public.xapi_statements%rowtype;
begin
  select * into v_copy from public.xapi_statements where id = (select id from shared_copy);
  if v_copy.user_id <> 'b2000000-0000-0000-0000-000000000002'
     or v_copy.source_statement_id <> 'a1aa0000-0000-0000-0000-000000000001'
     or v_copy.with_user_id <> 'a1000000-0000-0000-0000-000000000001'
     or v_copy.skill_id <> 'b2220000-0000-0000-0000-000000000002' then
    raise exception 'the added copy was not Ben''s own, linked to his skill and back to Ana''s';
  end if;
  if (select array_agg(skill_id) from public.xapi_statement_skills where statement_id = v_copy.id)
     <> array['b2220000-0000-0000-0000-000000000002']::uuid[] then
    raise exception 'the copy was linked to a skill that is not Ben''s';
  end if;
  if (select with_status from public.xapi_statements where id = 'a1aa0000-0000-0000-0000-000000000001') <> 'added' then
    raise exception 'the suggestion was not marked added';
  end if;
  -- The copy doesn't show twice on the shared page.
  if (select count(*) from public.list_shared_activities('a1000000-0000-0000-0000-000000000001')) <> 3 then
    raise exception 'the copy was listed alongside the original';
  end if;
end
$$;

do $$
begin
  perform public.respond_to_shared_activity('a1aa0000-0000-0000-0000-000000000001', true, '{}');
  raise exception 'answering twice unexpectedly succeeded';
exception
  when others then
    if sqlerrm not like '%already answered%' then raise; end if;
end
$$;

-- He dismisses the observation: nothing is added to his record.
select public.respond_to_shared_activity('a1bb0000-0000-0000-0000-000000000002', false);
do $$
begin
  if (select with_status from public.xapi_statements where id = 'a1bb0000-0000-0000-0000-000000000002') <> 'dismissed' then
    raise exception 'the observation was not marked dismissed';
  end if;
  if (select count(*) from public.list_shared_activity_suggestions()) <> 0 then
    raise exception 'answered suggestions were still waiting';
  end if;
end
$$;

-- A malformed rating level from Ana can't break the list for either of them.
reset role;
insert into public.xapi_statements (user_id, statement, recorded_at, with_user_id, with_kind)
values ('a1000000-0000-0000-0000-000000000001',
  '{"result":{"extensions":{"https://learnscope.app/xapi/extensions/peer-rating":{"level":3.5}}},"context":{"extensions":{"https://learnscope.app/xapi/extensions/shared-with":{"skills":"oops"}}}}',
  now(), 'b2000000-0000-0000-0000-000000000002', 'rated');
set local role authenticated;
do $$
begin
  if exists (select 1 from public.list_shared_activities('a1000000-0000-0000-0000-000000000001') where level is not null and level not between 1 and 5) then
    raise exception 'a malformed level came through';
  end if;
  if exists (select 1 from public.list_shared_activities('a1000000-0000-0000-0000-000000000001') where jsonb_typeof(skills) <> 'array') then
    raise exception 'malformed skills came through';
  end if;
end
$$;

-- Once they disconnect, neither sees the other's entries any more.
reset role;
delete from public.connections where user_a_id = 'a1000000-0000-0000-0000-000000000001';
set local role authenticated;
do $$
begin
  if (select count(*) from public.list_shared_activities('a1000000-0000-0000-0000-000000000001')) <> 0 then
    raise exception 'shared activities stayed visible after disconnecting';
  end if;
end
$$;

rollback;
