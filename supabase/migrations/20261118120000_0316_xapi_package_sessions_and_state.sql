-- xAPI packages, continued (0079, 0314). Owner's decisions, 2026-11-18:
--
-- 1. Each time a learner opens an xAPI package resource from a skill, that
--    session shows as ONE activity on the skill ("Worked on Fire drill · 14
--    min · completed · 2 stamps earned"), counting once towards activity and
--    practice-time goals. The package's own statements stay as they are,
--    tied to the resource (skill_resource_id), and are listed on the
--    resource rather than as separate activities. The LRS (api/xapi) writes
--    the session's activity as an ordinary xapi_statements row on the
--    launching learner's own skill, under an id kept on the launch session.
--
-- 2. Packages resume where the learner left off: the xAPI State API is
--    stored here (xapi_activity_state), and a learner's launches of the same
--    package share one registration, which packages use to find their saved
--    state.

-- 1. Launch sessions: the skill launched from, one registration per learner
-- and package, and where the session's activity is kept.
alter table public.xapi_launch_sessions
  add column skill_id uuid references public.skills(id) on delete set null,
  add column registration uuid not null default gen_random_uuid(),
  add column summary_statement_id uuid not null default gen_random_uuid(),
  -- Only a skill resource is launched from a skill.
  add constraint xapi_launch_sessions_skill_only_for_skill_resource
    check (skill_id is null or skill_resource_id is not null);

-- Existing sessions each keep the registration they were launched with (the
-- session's own id, see adlLaunch.js before this change), so statements
-- already recorded still match it.
update public.xapi_launch_sessions set registration = id;

-- Set by the database, never by the caller: a new launch reuses the
-- registration of the learner's latest launch of the same package, and gets
-- a fresh, private id for its activity.
create or replace function public.assign_xapi_launch_registration()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.summary_statement_id := gen_random_uuid();
  new.registration := coalesce(
    (
      select s.registration from public.xapi_launch_sessions s
      where s.user_id = new.user_id
        and s.resource_id is not distinct from new.resource_id
        and s.skill_resource_id is not distinct from new.skill_resource_id
      order by s.created_at desc
      limit 1
    ),
    gen_random_uuid()
  );
  return new;
end;
$$;

create trigger xapi_launch_sessions_assign_registration
  before insert on public.xapi_launch_sessions
  for each row execute function public.assign_xapi_launch_registration();

create index xapi_launch_sessions_user_resource_idx
  on public.xapi_launch_sessions (user_id, resource_id, skill_resource_id, created_at desc);

-- Otherwise unchanged from 0314: a skill resource launch may name the skill
-- it was launched from, which must be the caller's own.
drop policy "Users create their own xapi launch sessions" on public.xapi_launch_sessions;
create policy "Users create their own xapi launch sessions"
  on public.xapi_launch_sessions for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and (
      (
        resource_id is not null
        and exists (
          select 1 from content_resources cr
          where cr.id = xapi_launch_sessions.resource_id
            and (
              is_platform_admin(auth.uid())
              or is_org_member(cr.organisation_id, auth.uid())
              or exists (
                select 1 from course_content_links ccl
                join course_catalogue cc on cc.id = ccl.course_id
                where ccl.resource_id = cr.id
                  and (
                    cc.status = 'approved'
                    or exists (select 1 from courses c where c.catalogue_course_id = cc.id and c.user_id = auth.uid())
                  )
              )
            )
        )
        and (course_id is null or exists (select 1 from courses c where c.id = xapi_launch_sessions.course_id and c.user_id = auth.uid()))
      )
      or (
        skill_resource_id is not null
        and public.can_launch_skill_resource_package(skill_resource_id)
        and (
          skill_id is null
          or exists (select 1 from public.skills s where s.id = xapi_launch_sessions.skill_id and s.user_id = auth.uid())
        )
      )
    )
  );

-- 2. Which launch a statement came from, so a session's activity can be
-- built from its own statements. Cleared, not cascaded, if the session goes.
alter table public.xapi_statements
  add column launch_session_id uuid references public.xapi_launch_sessions(id) on delete set null;

create index xapi_statements_launch_session_idx on public.xapi_statements (launch_session_id)
  where launch_session_id is not null;

-- The learner's call: a session activity they delete isn't written again by
-- the package's later statements in the same session.
alter table public.xapi_launch_sessions
  add column summary_dismissed boolean not null default false;

-- SECURITY DEFINER: learners can't update their launch sessions (0080), but
-- deleting their own session activity must still be remembered. Only ever
-- marks the session the deleted row was that session's activity for.
create or replace function public.dismiss_xapi_session_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.launch_session_id is not null then
    update public.xapi_launch_sessions
    set summary_dismissed = true
    where id = old.launch_session_id
      and summary_statement_id = old.id
      and user_id = old.user_id;
  end if;
  return old;
end;
$$;

revoke all on function public.dismiss_xapi_session_activity() from public, anon, authenticated;

create trigger xapi_statements_dismiss_session_activity
  after delete on public.xapi_statements
  for each row execute function public.dismiss_xapi_session_activity();

-- 3. The xAPI State API: documents a package saves for a learner (where they
-- were, what they'd earned) and reads back on its next launch. Keyed by the
-- learner (from the launch session, never from the package's own agent) and
-- the resource launched, so one package can't read another's state. Written
-- only by the LRS (service role); a learner can see and clear their own.
create table public.xapi_activity_state (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  resource_id uuid references public.content_resources(id) on delete cascade,
  skill_resource_id uuid references public.skill_resources(id) on delete cascade,
  activity_id text not null check (char_length(activity_id) between 1 and 2000),
  registration uuid,
  state_id text not null check (char_length(state_id) between 1 and 500),
  -- Bookmarks and progress, not files: 256KB is ample.
  document text not null check (octet_length(document) <= 262144),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(resource_id, skill_resource_id) = 1)
);

-- A package can't fill storage: at most 100 documents and 2MB in all per
-- learner and package, checked under a lock so simultaneous writes can't
-- both slip under the limit.
create or replace function public.limit_xapi_activity_state()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_count int;
  v_bytes bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text || coalesce(new.resource_id, new.skill_resource_id)::text, 0));
  select count(*), coalesce(sum(octet_length(document)), 0)
    into v_count, v_bytes
  from public.xapi_activity_state
  where user_id = new.user_id
    and coalesce(resource_id, skill_resource_id) = coalesce(new.resource_id, new.skill_resource_id)
    and id <> new.id;
  if v_count >= 100 or v_bytes + octet_length(new.document) > 2097152 then
    raise exception 'Saved package state is over its limit' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger xapi_activity_state_limit
  before insert or update on public.xapi_activity_state
  for each row execute function public.limit_xapi_activity_state();

create unique index xapi_activity_state_key on public.xapi_activity_state (
  user_id,
  coalesce(resource_id, skill_resource_id),
  activity_id,
  coalesce(registration, '00000000-0000-0000-0000-000000000000'::uuid),
  state_id
);

alter table public.xapi_activity_state enable row level security;

create policy "Learners see their own saved package state"
  on public.xapi_activity_state for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "Learners clear their own saved package state"
  on public.xapi_activity_state for delete
  to authenticated
  using (user_id = (select auth.uid()));

grant select, delete on table public.xapi_activity_state to authenticated;

-- Read-only impersonation (0305) covers every application table.
create trigger prevent_admin_impersonation_write
  before insert or update or delete on public.xapi_activity_state
  for each row execute function public.prevent_admin_impersonation_write();

create policy "Active impersonation sessions can read"
  on public.xapi_activity_state as restrictive for select
  to authenticated
  using ((select public.admin_impersonation_session_can_read()));
