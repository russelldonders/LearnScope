\set ON_ERROR_STOP on

begin;

select plan(8);

insert into auth.users (id, email, email_confirmed_at) values
  ('81000000-0000-0000-0000-00000000000a', 'act-a@example.com', now()),
  ('81000000-0000-0000-0000-00000000000b', 'act-b@example.com', now());

insert into public.skills (id, user_id, name, category, level) values
  ('81000000-0000-0000-0000-0000000000a1', '81000000-0000-0000-0000-00000000000a', 'Mine', 'Test', 2),
  ('81000000-0000-0000-0000-0000000000a2', '81000000-0000-0000-0000-00000000000a', 'Also mine', 'Test', 2),
  ('81000000-0000-0000-0000-0000000000b1', '81000000-0000-0000-0000-00000000000b', 'Theirs', 'Test', 2);

-- The local stack lacks Staging's default table grants.
grant all on table public.xapi_statements, public.xapi_statement_skills, public.skills to authenticated;

select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-00000000000a', true);
set local role authenticated;

select lives_ok(
  $$insert into public.xapi_statements (id, user_id, statement, recorded_at, skill_id)
    values ('81000000-0000-0000-0000-000000000101', '81000000-0000-0000-0000-00000000000a', '{}'::jsonb, now(), '81000000-0000-0000-0000-0000000000a1')$$,
  'an activity can be linked to your own skill'
);
select throws_ok(
  $$insert into public.xapi_statements (user_id, statement, recorded_at, skill_id)
    values ('81000000-0000-0000-0000-00000000000a', '{}'::jsonb, now(), '81000000-0000-0000-0000-0000000000b1')$$,
  '42501', 'An activity can only be linked to your own skills.',
  'but not to someone else''s'
);
select throws_ok(
  $$update public.xapi_statements set skill_id = '81000000-0000-0000-0000-0000000000b1'
    where id = '81000000-0000-0000-0000-000000000101'$$,
  '42501', 'An activity can only be linked to your own skills.',
  'nor moved onto someone else''s afterwards'
);
select lives_ok(
  $$insert into public.xapi_statement_skills (statement_id, skill_id, user_id)
    values ('81000000-0000-0000-0000-000000000101', '81000000-0000-0000-0000-0000000000a2', '81000000-0000-0000-0000-00000000000a')$$,
  'a further skill link to your own skill is fine'
);
select throws_ok(
  $$insert into public.xapi_statement_skills (statement_id, skill_id, user_id)
    values ('81000000-0000-0000-0000-000000000101', '81000000-0000-0000-0000-0000000000b1', '81000000-0000-0000-0000-00000000000a')$$,
  '42501', 'An activity can only be linked to your own skills.',
  'a further skill link to someone else''s skill is refused'
);
select lives_ok(
  $$update public.xapi_statements set statement = '{"edited": true}'::jsonb
    where id = '81000000-0000-0000-0000-000000000101'$$,
  'editing an activity without touching its skill is unaffected'
);

reset role;

select is(
  (select count(*)::int from public.xapi_statements where skill_id = '81000000-0000-0000-0000-0000000000b1'),
  0, 'nothing was linked to the other person''s skill'
);

-- Writes made by the database itself (as the table owner) are left to the
-- functions that make them, as with the other activity guards.
insert into public.xapi_statements (user_id, statement, recorded_at, skill_id)
values ('81000000-0000-0000-0000-00000000000b', '{}'::jsonb, now(), '81000000-0000-0000-0000-0000000000b1');
select is(
  (select count(*)::int from public.xapi_statements where skill_id = '81000000-0000-0000-0000-0000000000b1'),
  1, 'a database function can still record an activity on the skill owner''s own skill'
);

select * from finish();

rollback;
