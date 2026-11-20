-- Knowledge checks and "Interview me" are now marked on the server, and only
-- the server can record a confirmed knowledge level.
--
-- Until now both ran in the browser: quiz questions arrived with their
-- answers and were marked client-side, the interview's transcript was held
-- (and resent) by the client, and the browser itself inserted the
-- `diagnostic_confirmed` skill assessment and its xAPI evidence. Any learner
-- could therefore write a "confirmed" level directly. This moves the state
-- server-side and closes that path:
--
-- 1. skill_quiz_attempts: one row per round of a knowledge check -- a
--    snapshot of the questions served (with answers, so later edits to the
--    pool don't change how an attempt is marked), the learner's answers and
--    the server's marking. Learners never read it directly: the questions in
--    it carry answers they haven't given yet.
-- 2. skill_interview_sessions: the interview's plan and full transcript,
--    kept by the server, so the AI's verdict is about a conversation the
--    server actually had.
-- 3. Signed-in users can no longer insert a `diagnostic_confirmed` skill
--    assessment, or edit one, or insert a diagnostic xAPI statement, or set
--    a skill's confirmed knowledge level (skills.knowledge_level); only
--    api/generate-diagnostic-quiz.js and api/interview.js (service role) can.
--    Learners can still delete their own records, as before.
-- 4. skill_diagnostic_content (0049) is no longer readable by learners: its
--    quiz rows hold answer keys (now also in the question pools, 0323) and
--    its interview plans hold the judging rubric. Only the server reads it.
--
-- Existing assessments and statements are untouched.

create table public.skill_quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  skill_id uuid not null references public.skills(id) on delete cascade,
  library_skill_id uuid references public.skill_library(id) on delete set null,
  level int not null check (level between 1 and 5),
  -- One run of a check is its rounds in order: a single round when
  -- confirming, up to three when calibrating from level 3.
  run_id uuid not null,
  calibrate boolean not null default false,
  round int not null default 1 check (round between 1 and 3),
  questions jsonb not null check (jsonb_typeof(questions) = 'array'),
  answers jsonb not null default '{}'::jsonb,
  results jsonb not null default '{}'::jsonb,
  status text not null default 'in_progress' check (status in ('in_progress', 'completed')),
  score int,
  total int,
  passed boolean,
  statement_id uuid references public.xapi_statements(id) on delete set null,
  assessment_id uuid references public.skill_assessments(id) on delete set null,
  settled boolean not null default false,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index skill_quiz_attempts_user_skill_idx on public.skill_quiz_attempts (user_id, skill_id, created_at desc);
create unique index skill_quiz_attempts_run_round_idx on public.skill_quiz_attempts (run_id, round);

alter table public.skill_quiz_attempts enable row level security;
revoke all on table public.skill_quiz_attempts from anon, authenticated;
grant all on table public.skill_quiz_attempts to service_role;

create table public.skill_interview_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  skill_id uuid not null references public.skills(id) on delete cascade,
  library_skill_id uuid references public.skill_library(id) on delete set null,
  diagnostic_content_id uuid references public.skill_diagnostic_content(id) on delete set null,
  level int check (level between 1 and 5),
  calibrate boolean not null default false,
  plan jsonb not null,
  transcript jsonb not null default '[]'::jsonb check (jsonb_typeof(transcript) = 'array'),
  status text not null default 'in_progress' check (status in ('in_progress', 'finished', 'saved')),
  confirmed_level int check (confirmed_level between 1 and 5),
  reasoning text,
  statement_id uuid references public.xapi_statements(id) on delete set null,
  assessment_id uuid references public.skill_assessments(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (calibrate or level is not null)
);

create index skill_interview_sessions_user_skill_idx on public.skill_interview_sessions (user_id, skill_id, created_at desc);

alter table public.skill_interview_sessions enable row level security;
revoke all on table public.skill_interview_sessions from anon, authenticated;
grant all on table public.skill_interview_sessions to service_role;

-- Same shape as guard_xapi_statement_writes (20261107100000): only direct
-- writes by a signed-in user are checked; the service role, security
-- definer functions and cascades run as another role.
create or replace function private.guard_confirmed_skill_assessments()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if new.source = 'diagnostic_confirmed'
     or (tg_op = 'UPDATE' and old.source = 'diagnostic_confirmed') then
    raise exception 'A confirmed knowledge level can only be recorded by a knowledge check or interview.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_confirmed_skill_assessments() from public;

create trigger guard_confirmed_skill_assessments
before insert or update on public.skill_assessments
for each row execute function private.guard_confirmed_skill_assessments();

create or replace function private.guard_diagnostic_statement_inserts()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if coalesce(new.statement -> 'result' -> 'extensions' ? 'https://learnscope.app/xapi/extensions/diagnostic', false) then
    raise exception 'Knowledge check results are recorded by the check itself.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_diagnostic_statement_inserts() from public;

create trigger guard_diagnostic_statement_inserts
before insert on public.xapi_statements
for each row execute function private.guard_diagnostic_statement_inserts();

-- skills.knowledge_level is the confirmed knowledge level (the trust badge,
-- plan targets, managers' view all read it as such). Same shape as
-- guard_verified_skill_stage (20260927120000): learners can't set it;
-- clearing it is fine.
create or replace function private.guard_confirmed_knowledge_level()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
     and new.knowledge_level is not null
     and (tg_op = 'INSERT' or old.knowledge_level is distinct from new.knowledge_level) then
    raise exception 'A confirmed knowledge level can only be set by a knowledge check or interview.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_confirmed_knowledge_level() from public;

create trigger skills_a_guard_confirmed_knowledge_level
  before insert or update of knowledge_level on public.skills
  for each row execute function private.guard_confirmed_knowledge_level();

-- Records one answer and its marking, only once per question and only while
-- the round is open -- atomically, so racing requests can't overwrite each
-- other's marking. Returns whether this call recorded it. Server only.
create or replace function public.record_skill_quiz_answer(
  p_attempt_id uuid,
  p_question_id text,
  p_answer jsonb,
  p_correct boolean
)
returns boolean
language sql
set search_path = ''
as $$
  with recorded as (
    update public.skill_quiz_attempts
    set answers = answers || jsonb_build_object(p_question_id, p_answer),
        results = results || jsonb_build_object(p_question_id, jsonb_build_object('correct', p_correct))
    where id = p_attempt_id
      and status = 'in_progress'
      and not (results ? p_question_id)
    returning 1
  )
  select exists (select 1 from recorded);
$$;

revoke all on function public.record_skill_quiz_answer(uuid, text, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.record_skill_quiz_answer(uuid, text, jsonb, boolean) to service_role;

drop policy "Authenticated users can view diagnostic content" on public.skill_diagnostic_content;
revoke all on table public.skill_diagnostic_content from anon, authenticated;
grant all on table public.skill_diagnostic_content to service_role;

-- Read-only admin impersonation (0305): the same permanent write guard and
-- active-session read boundary every application table carries, for these
-- tables and the two 0323 added.
create trigger prevent_admin_impersonation_write
  before insert or update or delete on public.skill_questions
  for each row execute function public.prevent_admin_impersonation_write();

create policy "Active impersonation sessions can read"
  on public.skill_questions as restrictive for select
  to authenticated
  using ((select public.admin_impersonation_session_can_read()));

create trigger prevent_admin_impersonation_write
  before insert or update or delete on public.skill_question_servings
  for each row execute function public.prevent_admin_impersonation_write();

create policy "Active impersonation sessions can read"
  on public.skill_question_servings as restrictive for select
  to authenticated
  using ((select public.admin_impersonation_session_can_read()));

create trigger prevent_admin_impersonation_write
  before insert or update or delete on public.skill_quiz_attempts
  for each row execute function public.prevent_admin_impersonation_write();

create policy "Active impersonation sessions can read"
  on public.skill_quiz_attempts as restrictive for select
  to authenticated
  using ((select public.admin_impersonation_session_can_read()));

create trigger prevent_admin_impersonation_write
  before insert or update or delete on public.skill_interview_sessions
  for each row execute function public.prevent_admin_impersonation_write();

create policy "Active impersonation sessions can read"
  on public.skill_interview_sessions as restrictive for select
  to authenticated
  using ((select public.admin_impersonation_session_can_read()));

-- A few knowledge-check runs and interviews per skill a day. Enforced here,
-- under a per-learner-and-skill lock, so parallel requests can't each see
-- room and all get through. The API reserves the run/session before any AI
-- work and reports this error (54000) as "try again tomorrow".
create or replace function private.limit_daily_knowledge_checks()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_count int;
begin
  perform pg_advisory_xact_lock(hashtext(tg_table_name || ':' || new.user_id::text || ':' || new.skill_id::text));
  if tg_table_name = 'skill_quiz_attempts' then
    if new.round <> 1 then
      return new;
    end if;
    select count(*) into v_count
    from public.skill_quiz_attempts
    where user_id = new.user_id and skill_id = new.skill_id and round = 1
      and created_at > now() - interval '24 hours';
  else
    select count(*) into v_count
    from public.skill_interview_sessions
    where user_id = new.user_id and skill_id = new.skill_id
      and created_at > now() - interval '24 hours';
  end if;
  if v_count >= 5 then
    raise exception 'Daily limit reached for this skill.' using errcode = '54000';
  end if;
  return new;
end;
$$;

revoke all on function private.limit_daily_knowledge_checks() from public;

create trigger limit_daily_knowledge_checks
  before insert on public.skill_quiz_attempts
  for each row execute function private.limit_daily_knowledge_checks();

create trigger limit_daily_knowledge_checks
  before insert on public.skill_interview_sessions
  for each row execute function private.limit_daily_knowledge_checks();
