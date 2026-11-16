\set ON_ERROR_STOP on

begin;

select plan(9);

insert into auth.users (id, email, email_confirmed_at) values
  ('7f000000-0000-0000-0000-000000000001', 'impersonation-admin@example.com', now()),
  ('7f000000-0000-0000-0000-000000000002', 'impersonation-target@example.com', now());

insert into public.platform_admins (user_id)
values ('7f000000-0000-0000-0000-000000000001');

insert into public.admin_impersonation_sessions (
  id, auth_session_id, actor_id, target_user_id, reason, expires_at
) values (
  '7f000000-0000-0000-0000-000000000010',
  '7f000000-0000-0000-0000-000000000011',
  '7f000000-0000-0000-0000-000000000001',
  '7f000000-0000-0000-0000-000000000002',
  'Investigating support ticket LS-1042',
  now() + interval '15 minutes'
);

select is(
  (
    select count(*)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p')
      and n.nspname = 'public'
      and c.relname <> 'admin_impersonation_sessions'
      and not exists (select 1 from pg_inherits i where i.inhrelid = c.oid)
      and not exists (
        select 1 from pg_trigger t
        where t.tgrelid = c.oid
          and t.tgname = 'prevent_admin_impersonation_write'
          and not t.tgisinternal
      )
  ),
  0::bigint,
  'every public application table has the impersonation write guard'
);

select ok(
  exists (
    select 1 from pg_trigger t
    where t.tgrelid = 'storage.objects'::regclass
      and t.tgname = 'prevent_admin_impersonation_storage_write'
      and not t.tgisinternal
  ),
  'storage objects have the impersonation write guard'
);

select is(
  (
    select count(*)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p')
      and n.nspname = 'public'
      and c.relname <> 'admin_impersonation_sessions'
      and c.relrowsecurity
      and not exists (select 1 from pg_inherits i where i.inhrelid = c.oid)
      and not exists (
        select 1 from pg_policy p
        where p.polrelid = c.oid
          and p.polname = 'Active impersonation sessions can read'
          and not p.polpermissive
      )
  ),
  0::bigint,
  'every RLS application table has the restrictive impersonation expiry policy'
);

select ok(
  exists (
    select 1 from pg_policy p
    where p.polrelid = 'storage.objects'::regclass
      and p.polname = 'Active impersonation sessions can read storage objects'
      and not p.polpermissive
  ),
  'storage reads have the restrictive impersonation expiry policy'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '7f000000-0000-0000-0000-000000000002',
    'role', 'authenticated',
    'session_id', '7f000000-0000-0000-0000-000000000011'
  )::text,
  true
);
set local role authenticated;

reset role;
select ok(public.is_admin_impersonation_session(), 'registered Auth session is recognised as impersonation');
set local role authenticated;

select is(
  (select count(*) from public.profiles where id = '7f000000-0000-0000-0000-000000000002'),
  1::bigint,
  'active impersonation can read exactly what the target RLS allows'
);

reset role;
update public.admin_impersonation_sessions
set ended_at = now()
where id = '7f000000-0000-0000-0000-000000000010';
set local role authenticated;

select is(
  (select count(*) from public.profiles where id = '7f000000-0000-0000-0000-000000000002'),
  0::bigint,
  'ended impersonation can no longer read through RLS'
);

do $$
begin
  insert into public.skills (user_id, name)
  values ('7f000000-0000-0000-0000-000000000002', 'A forbidden preview edit');
  raise exception 'impersonation write unexpectedly succeeded';
exception
  when insufficient_privilege then null;
end
$$;
select pass('direct table writes are blocked');

do $$
begin
  perform public.create_manager_workspace('A forbidden preview workspace');
  raise exception 'security-definer impersonation write unexpectedly succeeded';
exception
  when insufficient_privilege then null;
end
$$;
select pass('writes inside security-definer RPCs are blocked by table triggers');

reset role;
select * from finish();

rollback;

