\set ON_ERROR_STOP on

begin;
select plan(8);

insert into auth.users (id, email, email_confirmed_at) values
  ('84000000-0000-0000-0000-000000000001', 'notifications-a@example.com', now()),
  ('84000000-0000-0000-0000-000000000002', 'notifications-b@example.com', now());

insert into public.notification_dismissals (user_id, notification_id) values
  ('84000000-0000-0000-0000-000000000002', 'course-assignment:other');

select ok(
  not has_table_privilege('anon', 'public.notification_dismissals', 'select,insert,update,delete'),
  'anonymous users have no notification dismissal privileges'
);
select ok(
  has_table_privilege('authenticated', 'public.notification_dismissals', 'select,insert,delete')
  and not has_table_privilege('authenticated', 'public.notification_dismissals', 'update'),
  'authenticated users receive only the required grants'
);

select set_config('request.jwt.claim.sub', '84000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$insert into public.notification_dismissals (user_id, notification_id)
    values ('84000000-0000-0000-0000-000000000001', 'self-assessment-reminder:skill:date')$$,
  'a learner can dismiss their own notification'
);
select throws_ok(
  $$insert into public.notification_dismissals (user_id, notification_id)
    values ('84000000-0000-0000-0000-000000000002', 'self-assessment-reminder:forged')$$,
  '42501', null,
  'a learner cannot create a dismissal for someone else'
);
select results_eq(
  $$select notification_id from public.notification_dismissals order by notification_id$$,
  array['self-assessment-reminder:skill:date'::text],
  'a learner sees their own dismissal'
);
select is(
  (select count(*) from public.notification_dismissals where user_id = '84000000-0000-0000-0000-000000000002'),
  0::bigint,
  'another learner dismissal is hidden'
);
select lives_ok(
  $$delete from public.notification_dismissals
    where user_id = '84000000-0000-0000-0000-000000000002'$$,
  'deleting another learner dismissal affects no visible rows'
);
select results_eq(
  $$delete from public.notification_dismissals
    where notification_id = 'self-assessment-reminder:skill:date'
    returning 1$$,
  array[1],
  'a learner can restore their own notification'
);

select * from finish();
rollback;
