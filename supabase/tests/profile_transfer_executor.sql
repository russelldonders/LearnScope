-- Proves execute_profile_transfer_plan
-- (20260904240000_profile_transfer_executor.sql) and the Decision 1/2
-- guards added alongside it (20260904230000_transfer_plan_conflict_
-- guards.sql). Run against a local database only; the script rolls back
-- everything it does.
--
-- Scenario 1: a full, mixed plan (move, keep_durable, use_source, and a
-- keep_durable rejected for exclusive dependents then resolved via
-- use_source instead) executes successfully and every table ends up
-- exactly where docs/profile-transfer-execution-rules.md says it should.
-- Scenario 2: a parent/child experience pair resolved to different actions
-- reaches 'approved' (nothing today blocks that at resolution time) but
-- execute() refuses to run at all -- Decision 1, re-verified at execution.
-- Scenario 3: idempotent retry (same key returns the prior result) and a
-- second, different-key call against an already-executed plan is rejected.
-- Scenario 4: a source record changed after approval makes execute() abort
-- on the fingerprint staleness check rather than run against stale data.
--
-- Every ground-truth verification below runs with `reset role` (superuser,
-- bypassing RLS) rather than as either linked account: this transfer flow
-- never establishes a workspace_access grant between the two accounts (that
-- is the separate "grant controlled cross-account access" mechanism), so
-- checking e.g. account aa's view of a row still owned by account bb would
-- report "not found" purely from RLS, indistinguishable from the row
-- actually being gone -- a real trap this file's first draft fell into
-- (a verification block reported a row "deleted" that a follow-up,
-- role-isolated repro proved was never touched -- only invisible to the
-- checking role).

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email, email_confirmed_at)
values
  ('aa000000-0000-0000-0000-00000000aa01', 'durable@example.com', now()),
  ('bb000000-0000-0000-0000-00000000bb01', 'source@example.com', now());

-- The bootstrap_personal_context trigger gives each its own person,
-- learning_profile, workspace, and owner workspace_access row, all sharing
-- the same id as the auth.users row (see private.bootstrap_personal_
-- context -- every insert in it uses new.id explicitly).
insert into public.verified_account_links (auth_account_a_id, auth_account_b_id)
values (
  least('aa000000-0000-0000-0000-00000000aa01'::uuid, 'bb000000-0000-0000-0000-00000000bb01'::uuid),
  greatest('aa000000-0000-0000-0000-00000000aa01'::uuid, 'bb000000-0000-0000-0000-00000000bb01'::uuid)
);

-- ----------------------------------------------------------------------------
-- Scenario 1 fixtures
-- ----------------------------------------------------------------------------

-- Pure move: unique on the source side.
insert into public.skills (id, user_id, name, category, level)
values ('11110000-0000-0000-0000-000000000001', 'bb000000-0000-0000-0000-00000000bb01', 'SQL', 'Technical', 4);

-- Duplicate, no dependents either side: will resolve keep_durable.
insert into public.skills (id, user_id, name, category, level)
values
  ('11110000-0000-0000-0000-000000000002', 'bb000000-0000-0000-0000-00000000bb01', 'Leadership', 'Leadership', 3),
  ('11110000-0000-0000-0000-000000000003', 'aa000000-0000-0000-0000-00000000aa01', 'Leadership', 'Leadership', 5);

-- Duplicate, no dependents either side: will resolve use_source.
insert into public.skills (id, user_id, name, category, level)
values
  ('11110000-0000-0000-0000-000000000004', 'bb000000-0000-0000-0000-00000000bb01', 'Communication', 'Leadership', 4),
  ('11110000-0000-0000-0000-000000000005', 'aa000000-0000-0000-0000-00000000aa01', 'Communication', 'Leadership', 2);

-- Duplicate where the SOURCE side has an assessment attached: keep_durable
-- must be rejected (would discard the assessment); use_source must succeed
-- (retires the durable side, which has no dependents).
insert into public.skills (id, user_id, name, category, level)
values
  ('11110000-0000-0000-0000-000000000006', 'bb000000-0000-0000-0000-00000000bb01', 'Python', 'Technical', 4),
  ('11110000-0000-0000-0000-000000000007', 'aa000000-0000-0000-0000-00000000aa01', 'Python', 'Technical', 3);
insert into public.skill_assessments (skill_id, user_id, level, comments)
values ('11110000-0000-0000-0000-000000000006', 'bb000000-0000-0000-0000-00000000bb01', 4, 'Solid grasp');

-- A dependent on the pure-move skill, to prove the identity-based
-- reassignment pass actually runs.
insert into public.skill_targets (skill_id, user_id, target_level, target_date)
values ('11110000-0000-0000-0000-000000000001', 'bb000000-0000-0000-0000-00000000bb01', 5, '2027-01-01');

-- Pure move: course, unique on the source side.
insert into public.courses (id, user_id, name)
values ('22220000-0000-0000-0000-000000000001', 'bb000000-0000-0000-0000-00000000bb01', 'Advanced SQL');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'bb000000-0000-0000-0000-00000000bb01', true);
create temporary table exec_preview as
select public.request_profile_transfer_preview(
  (select id from public.verified_account_links limit 1)
) as preview_id;

-- request_profile_transfer_preview already records an implicit approval for
-- the requester (bb); only the other party needs to approve explicitly.
select set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000aa01', true);
select public.approve_profile_transfer_preview(preview_id) from exec_preview;
select set_config('request.jwt.claim.sub', 'bb000000-0000-0000-0000-00000000bb01', true);

create temporary table exec_plan as
select public.create_profile_transfer_plan(
  preview_id, 'aa000000-0000-0000-0000-00000000aa01'
) as plan_id from exec_preview;

-- Reject keep_durable on the Python conflict (source side has an
-- assessment) -- Decision 2 at resolution time.
do $$
begin
  perform public.resolve_profile_transfer_plan_item(
    (select plan_id from exec_plan),
    (select id from public.profile_transfer_plan_items
     where plan_id = (select plan_id from exec_plan) and source_record_id = '11110000-0000-0000-0000-000000000006'),
    'keep_durable'
  );
  raise exception 'keep_durable with source-side evidence unexpectedly succeeded';
exception
  when others then
    if sqlerrm not like '%evidence, links, or history%' then raise; end if;
end
$$;

select public.resolve_profile_transfer_plan_item(
  (select plan_id from exec_plan),
  (select id from public.profile_transfer_plan_items
   where plan_id = (select plan_id from exec_plan) and source_record_id = '11110000-0000-0000-0000-000000000006'),
  'use_source'
);
select public.resolve_profile_transfer_plan_item(
  (select plan_id from exec_plan),
  (select id from public.profile_transfer_plan_items
   where plan_id = (select plan_id from exec_plan) and source_record_id = '11110000-0000-0000-0000-000000000002'),
  'keep_durable'
);
select public.resolve_profile_transfer_plan_item(
  (select plan_id from exec_plan),
  (select id from public.profile_transfer_plan_items
   where plan_id = (select plan_id from exec_plan) and source_record_id = '11110000-0000-0000-0000-000000000004'),
  'use_source'
);

create temporary table exec_hash as
select public.submit_profile_transfer_plan(plan_id) as version_hash from exec_plan;
select public.approve_profile_transfer_plan(plan_id, version_hash) from exec_plan cross join exec_hash;
select set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000aa01', true);
select public.approve_profile_transfer_plan(plan_id, version_hash) from exec_plan cross join exec_hash;

create temporary table exec_key_1 as select gen_random_uuid() as k;
create temporary table exec_result_1 as
select public.execute_profile_transfer_plan(plan_id, (select k from exec_key_1)) as result from exec_plan;

reset role;

do $$
begin
  if not exists (select 1 from public.profile_transfer_plans where id = (select plan_id from exec_plan) and status = 'executed' and executed_at is not null) then
    raise exception 'plan was not marked executed';
  end if;
end
$$;

do $$
declare v_result jsonb;
begin
  select result into v_result from exec_result_1;
  if jsonb_array_length(v_result -> 'records') <> 5 then
    raise exception 'expected 5 execution records, got %', jsonb_array_length(v_result -> 'records');
  end if;
end
$$;

-- Move: skill and its dependent reassigned, id unchanged.
do $$
begin
  if not exists (select 1 from public.skills where id = '11110000-0000-0000-0000-000000000001' and user_id = 'aa000000-0000-0000-0000-00000000aa01') then
    raise exception 'moved skill was not reassigned to the durable login';
  end if;
  if not exists (select 1 from public.skill_targets where skill_id = '11110000-0000-0000-0000-000000000001' and user_id = 'aa000000-0000-0000-0000-00000000aa01') then
    raise exception 'moved skill''s dependent was not reassigned to the durable login';
  end if;
end
$$;

-- keep_durable: source Leadership gone, durable Leadership untouched (still level 5).
do $$
begin
  if exists (select 1 from public.skills where id = '11110000-0000-0000-0000-000000000002') then
    raise exception 'keep_durable did not retire the source skill';
  end if;
  if not exists (select 1 from public.skills where id = '11110000-0000-0000-0000-000000000003' and level = 5) then
    raise exception 'keep_durable unexpectedly changed the retained durable skill';
  end if;
end
$$;

-- use_source (Communication): durable Communication gone, source
-- Communication survives under the durable login with its own original level.
do $$
begin
  if exists (select 1 from public.skills where id = '11110000-0000-0000-0000-000000000005') then
    raise exception 'use_source did not retire the durable skill';
  end if;
  if not exists (select 1 from public.skills where id = '11110000-0000-0000-0000-000000000004' and user_id = 'aa000000-0000-0000-0000-00000000aa01' and level = 4) then
    raise exception 'use_source did not reassign the surviving source skill to the durable login';
  end if;
end
$$;

-- use_source (Python, forced after keep_durable was rejected): durable
-- Python gone, source Python survives under the durable login, and its
-- assessment moved with it.
do $$
begin
  if exists (select 1 from public.skills where id = '11110000-0000-0000-0000-000000000007') then
    raise exception 'use_source did not retire the durable Python skill';
  end if;
  if not exists (select 1 from public.skills where id = '11110000-0000-0000-0000-000000000006' and user_id = 'aa000000-0000-0000-0000-00000000aa01') then
    raise exception 'use_source did not reassign the surviving source Python skill';
  end if;
  if not exists (select 1 from public.skill_assessments where skill_id = '11110000-0000-0000-0000-000000000006' and user_id = 'aa000000-0000-0000-0000-00000000aa01') then
    raise exception 'the Python skill''s assessment was not reassigned to the durable login';
  end if;
end
$$;

-- Course moved.
do $$
begin
  if not exists (select 1 from public.courses where id = '22220000-0000-0000-0000-000000000001' and user_id = 'aa000000-0000-0000-0000-00000000aa01') then
    raise exception 'moved course was not reassigned to the durable login';
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- Scenario 3 (part 1): idempotent retry returns the prior result.
-- ----------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', 'bb000000-0000-0000-0000-00000000bb01', true);
create temporary table exec_result_1_retry as
select public.execute_profile_transfer_plan(plan_id, (select k from exec_key_1)) as result from exec_plan;

do $$
declare v_first jsonb; v_retry jsonb;
begin
  select result into v_first from exec_result_1;
  select result into v_retry from exec_result_1_retry;
  if v_first -> 'records' is distinct from v_retry -> 'records' then
    raise exception 'idempotent retry returned a different result than the original execution';
  end if;
end
$$;

-- A different idempotency key against the same already-executed plan is
-- rejected outright (no re-run, no silent success).
do $$
begin
  perform public.execute_profile_transfer_plan((select plan_id from exec_plan), gen_random_uuid());
  raise exception 'a different idempotency key against an already-executed plan unexpectedly succeeded';
exception
  when others then
    if sqlerrm not like '%already been executed%' then raise; end if;
end
$$;

-- ----------------------------------------------------------------------------
-- Scenario 2: parent/child experience divergence reaches 'approved' but
-- execute() refuses to run at all -- Decision 1, re-verified at execution.
-- ----------------------------------------------------------------------------

reset role;
insert into public.experience (id, user_id, type, title, organization, start_date)
values
  ('33330000-0000-0000-0000-000000000001', 'bb000000-0000-0000-0000-00000000bb01', 'employment', 'Engineer', 'Acme', '2020-01-01'),
  -- 'project' because a parent of type 'employment' only accepts
  -- project/course/other children (validate_experience_parent_type).
  ('33330000-0000-0000-0000-000000000002', 'bb000000-0000-0000-0000-00000000bb01', 'project', 'Backend Team', 'Acme', '2021-01-01'),
  ('33330000-0000-0000-0000-000000000003', 'aa000000-0000-0000-0000-00000000aa01', 'project', 'Backend Team', 'Acme', '2021-06-01');
update public.experience set parent_experience_id = '33330000-0000-0000-0000-000000000001'
where id = '33330000-0000-0000-0000-000000000002';

-- request_profile_transfer_preview returns the same, already-approved
-- preview from scenario 1 (still 'approved', not consumed by that plan
-- executing) rather than creating a new one -- no fresh approval needed.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'bb000000-0000-0000-0000-00000000bb01', true);
create temporary table exec_preview_2 as
select public.request_profile_transfer_preview(
  (select id from public.verified_account_links limit 1)
) as preview_id;

create temporary table exec_plan_2 as
select public.create_profile_transfer_plan(
  preview_id, 'aa000000-0000-0000-0000-00000000aa01'
) as plan_id from exec_preview_2;

-- The parent (Engineer, unique) auto-resolves to move. The child (Backend
-- Team, duplicate title+org) starts unresolved; resolve it to keep_durable
-- -- diverging from its parent's move.
select public.resolve_profile_transfer_plan_item(
  (select plan_id from exec_plan_2),
  (select id from public.profile_transfer_plan_items
   where plan_id = (select plan_id from exec_plan_2) and source_record_id = '33330000-0000-0000-0000-000000000002'),
  'keep_durable'
);

create temporary table exec_hash_2 as
select public.submit_profile_transfer_plan(plan_id) as version_hash from exec_plan_2;
select public.approve_profile_transfer_plan(plan_id, version_hash) from exec_plan_2 cross join exec_hash_2;
select set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000aa01', true);
select public.approve_profile_transfer_plan(plan_id, version_hash) from exec_plan_2 cross join exec_hash_2;

do $$
begin
  perform public.execute_profile_transfer_plan((select plan_id from exec_plan_2), gen_random_uuid());
  raise exception 'divergent parent/child experience plan unexpectedly executed';
exception
  when others then
    if sqlerrm not like '%must share the same resolution%' then raise; end if;
end
$$;

select public.cancel_profile_transfer_plan((select plan_id from exec_plan_2));

reset role;

do $$
begin
  if exists (select 1 from public.profile_transfer_plans where id = (select plan_id from exec_plan_2) and status = 'executed') then
    raise exception 'a plan that failed Decision 1 was still marked executed';
  end if;
  if not exists (select 1 from public.experience where id = '33330000-0000-0000-0000-000000000001' and user_id = 'bb000000-0000-0000-0000-00000000bb01') then
    raise exception 'a failed execution left partial changes behind (parent experience)';
  end if;
  if not exists (select 1 from public.experience where id = '33330000-0000-0000-0000-000000000002' and user_id = 'bb000000-0000-0000-0000-00000000bb01') then
    raise exception 'a failed execution left partial changes behind (child experience)';
  end if;
end
$$;

-- Scenario 2's cancelled plan left its experience fixtures in place (cancel
-- only changes the plan's own status). Remove them so scenario 4's plan
-- creation -- which unconditionally re-scans every domain, not just skills
-- -- doesn't pick up the still-unresolved Backend Team duplicate again.
delete from public.experience where id in (
  '33330000-0000-0000-0000-000000000001', '33330000-0000-0000-0000-000000000002', '33330000-0000-0000-0000-000000000003'
);

-- ----------------------------------------------------------------------------
-- Scenario 4: a source record that changed after approval makes execute()
-- abort on the fingerprint staleness check.
-- ----------------------------------------------------------------------------

insert into public.skills (id, user_id, name, category, level)
values ('44440000-0000-0000-0000-000000000001', 'bb000000-0000-0000-0000-00000000bb01', 'Rust', 'Technical', 3);

-- Same already-approved preview reused again (see scenario 2's note).
set local role authenticated;
select set_config('request.jwt.claim.sub', 'bb000000-0000-0000-0000-00000000bb01', true);
create temporary table exec_preview_3 as
select public.request_profile_transfer_preview(
  (select id from public.verified_account_links limit 1)
) as preview_id;

create temporary table exec_plan_3 as
select public.create_profile_transfer_plan(
  preview_id, 'aa000000-0000-0000-0000-00000000aa01'
) as plan_id from exec_preview_3;

create temporary table exec_hash_3 as
select public.submit_profile_transfer_plan(plan_id) as version_hash from exec_plan_3;
select public.approve_profile_transfer_plan(plan_id, version_hash) from exec_plan_3 cross join exec_hash_3;
select set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000aa01', true);
select public.approve_profile_transfer_plan(plan_id, version_hash) from exec_plan_3 cross join exec_hash_3;

reset role;
update public.skills set level = 4 where id = '44440000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'bb000000-0000-0000-0000-00000000bb01', true);
do $$
begin
  perform public.execute_profile_transfer_plan((select plan_id from exec_plan_3), gen_random_uuid());
  raise exception 'execution against a stale record unexpectedly succeeded';
exception
  when others then
    if sqlerrm not like '%has changed since this plan was approved%' then raise; end if;
end
$$;

reset role;

do $$
begin
  if not exists (select 1 from public.skills where id = '44440000-0000-0000-0000-000000000001' and user_id = 'bb000000-0000-0000-0000-00000000bb01' and level = 4) then
    raise exception 'a failed staleness-aborted execution left partial changes behind';
  end if;
  if exists (select 1 from public.profile_transfer_plans where id = (select plan_id from exec_plan_3) and status = 'executed') then
    raise exception 'a plan that failed the staleness check was still marked executed';
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- Scenario 5: a skill created *after* a plan is approved (during the up-to-
-- 7-day approval window) is correctly never captured in that plan, and
-- executing the plan must not sweep its dependents to the durable login
-- anyway. A security review of an earlier version of this migration found
-- the bulk identity-based reassignment pass did exactly that (matched by
-- `user_id = source` alone, with no join back to which skills the plan
-- actually covered) -- this proves the fix, not just that it compiles.
-- ----------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', 'bb000000-0000-0000-0000-00000000bb01', true);
select public.cancel_profile_transfer_plan((select plan_id from exec_plan_3));

reset role;
insert into public.skills (id, user_id, name, category, level)
values ('55550000-0000-0000-0000-000000000001', 'bb000000-0000-0000-0000-00000000bb01', 'Go', 'Technical', 3);

-- Same already-approved preview reused again (see scenario 2's note).
set local role authenticated;
select set_config('request.jwt.claim.sub', 'bb000000-0000-0000-0000-00000000bb01', true);
create temporary table exec_preview_4 as
select public.request_profile_transfer_preview(
  (select id from public.verified_account_links limit 1)
) as preview_id;

create temporary table exec_plan_4 as
select public.create_profile_transfer_plan(
  preview_id, 'aa000000-0000-0000-0000-00000000aa01'
) as plan_id from exec_preview_4;

create temporary table exec_hash_4 as
select public.submit_profile_transfer_plan(plan_id) as version_hash from exec_plan_4;
select public.approve_profile_transfer_plan(plan_id, version_hash) from exec_plan_4 cross join exec_hash_4;
select set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000aa01', true);
select public.approve_profile_transfer_plan(plan_id, version_hash) from exec_plan_4 cross join exec_hash_4;

-- Simulates a new skill the learner adds during the plan's pending window,
-- after this plan already captured its snapshot of what to move. Never
-- part of exec_plan_4's items -- correctly stays with bb.
reset role;
insert into public.skills (id, user_id, name, category, level)
values ('55550000-0000-0000-0000-000000000002', 'bb000000-0000-0000-0000-00000000bb01', 'Java', 'Technical', 2);
insert into public.skill_targets (skill_id, user_id, target_level, target_date)
values ('55550000-0000-0000-0000-000000000002', 'bb000000-0000-0000-0000-00000000bb01', 4, '2027-01-01');
insert into public.skill_tags (user_id, skill_id, tag_id)
select 'bb000000-0000-0000-0000-00000000bb01', '55550000-0000-0000-0000-000000000002', id from public.tags limit 1;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'bb000000-0000-0000-0000-00000000bb01', true);
select public.execute_profile_transfer_plan((select plan_id from exec_plan_4), gen_random_uuid());

reset role;

do $$
begin
  -- The planned skill (Go) moved.
  if not exists (select 1 from public.skills where id = '55550000-0000-0000-0000-000000000001' and user_id = 'aa000000-0000-0000-0000-00000000aa01') then
    raise exception 'the planned skill was not moved';
  end if;
  -- The drift skill (Java, created after approval) stayed with bb entirely
  -- -- root and dependent both.
  if not exists (select 1 from public.skills where id = '55550000-0000-0000-0000-000000000002' and user_id = 'bb000000-0000-0000-0000-00000000bb01') then
    raise exception 'a skill created after plan approval was unexpectedly moved';
  end if;
  if not exists (select 1 from public.skill_targets where skill_id = '55550000-0000-0000-0000-000000000002' and user_id = 'bb000000-0000-0000-0000-00000000bb01') then
    raise exception 'THE BUG: a dependent of a skill created after plan approval was swept to the durable login even though its own skill was not moved';
  end if;
  if not exists (select 1 from public.skill_tags where skill_id = '55550000-0000-0000-0000-000000000002' and user_id = 'bb000000-0000-0000-0000-00000000bb01') then
    raise exception 'THE BUG: skill_tags for a skill created after plan approval was swept to the durable login';
  end if;
end
$$;

rollback;
