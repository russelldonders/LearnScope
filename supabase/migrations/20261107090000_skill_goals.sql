-- Learner-authored measurable goals on a skill ("40 push-ups in one set",
-- "5:00 per km by June"). Deliberately distinct from skill_targets, which is
-- a 1-5 proficiency level with a required date: a goal is a target on
-- something the learner measures, and reaching one never changes their level.
--
-- The measured values themselves are NOT stored here. They live in
-- xapi_statements (statement.result.extensions, see MEASUREMENT_EXTENSION_IRI
-- in src/lib/xapiStatement.js), so the activity log stays the one record of
-- what happened and when. A goal finds its values by skill + metric, which
-- lets a new goal continue the same history as the goal it replaced.
--
-- No user_id column: ownership is always derived from the skill. That keeps a
-- goal with its skill through a profile transfer (which reassigns
-- skills.user_id) with nothing to keep in sync.
create table public.skill_goals (
  id uuid primary key default gen_random_uuid(),
  skill_id uuid not null references public.skills(id) on delete cascade,
  -- What the learner originally wrote, when AI drafted the goal from it.
  original_text text check (original_text is null or char_length(original_text) <= 1000),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  metric text not null check (metric ~ '^[a-z0-9_]{1,60}$'),
  -- count/number: a typed value. duration: seconds. pace: seconds per distance
  -- unit. activities/practice_time: derived from the activities logged on the
  -- skill, so existing activities count without re-entering anything.
  measure_kind text not null
    check (measure_kind in ('count', 'number', 'duration', 'pace', 'activities', 'practice_time')),
  unit text not null check (char_length(btrim(unit)) between 1 and 40),
  direction text not null check (direction in ('higher', 'lower')),
  aggregation text not null check (aggregation in ('best', 'total')),
  period text check (period is null or period in ('day', 'week', 'month', 'year')),
  -- Optional: a goal with no target is simply "keep track of this".
  target_value numeric check (target_value is null or target_value >= 0),
  target_date date,
  -- When the goal began, which may be backdated. Separate from created_at.
  started_on date not null default current_date,
  tracker_question text not null check (char_length(btrim(tracker_question)) between 1 and 300),
  log_every_days integer check (log_every_days is null or log_every_days between 1 and 365),
  status text not null default 'active'
    check (status in ('active', 'achieved', 'stopped', 'replaced')),
  closed_on date,
  replaces_goal_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint skill_goals_id_skill_unique unique (id, skill_id),
  -- A goal can only replace another goal on the same skill. Deleting the old
  -- goal clears only the link, never skill_id.
  constraint skill_goals_replaces_same_skill
    foreign key (replaces_goal_id, skill_id)
    references public.skill_goals (id, skill_id)
    on delete set null (replaces_goal_id),
  constraint skill_goals_closed_state check (
    (status = 'active' and closed_on is null) or (status <> 'active' and closed_on is not null)
  ),
  constraint skill_goals_total_is_higher check (aggregation = 'best' or direction = 'higher'),
  constraint skill_goals_period_needs_total check (period is null or aggregation = 'total'),
  constraint skill_goals_derived_kinds_are_totals check (
    measure_kind not in ('activities', 'practice_time') or aggregation = 'total'
  ),
  constraint skill_goals_pace_is_lower_best check (
    measure_kind <> 'pace' or (aggregation = 'best' and direction = 'lower' and unit in ('min/km', 'min/mi'))
  )
);

create index skill_goals_skill_status_idx on public.skill_goals (skill_id, status);
create index skill_goals_replaces_idx on public.skill_goals (replaces_goal_id);

create or replace function private.set_skill_goal_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.set_skill_goal_updated_at() from public;

create trigger skill_goals_set_updated_at
before update on public.skill_goals
for each row execute function private.set_skill_goal_updated_at();

alter table public.skill_goals enable row level security;

-- Owner only: no employer, manager, connection, validator or linked-account
-- access. Any sharing has to be added as its own explicit permission path.
-- The check goes straight to skills.user_id rather than relying on what the
-- caller can read, since other roles can legitimately read someone's skills.
create policy "Learners manage goals on their own skills"
  on public.skill_goals for all
  to authenticated
  using (
    exists (
      select 1 from public.skills s
      where s.id = skill_id and s.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.skills s
      where s.id = skill_id and s.user_id = (select auth.uid())
    )
  );

revoke all on table public.skill_goals from public, anon, authenticated;
grant select, insert, update, delete on table public.skill_goals to authenticated;

-- A transfer conflict must not retire a skill that holds goals: skill_goals
-- cascades from skills, so they would be silently discarded. Same exclusive-
-- dependent rule as every other table listed here (see
-- 20260904230000_transfer_plan_conflict_guards.sql).
create or replace function private.skill_has_exclusive_dependents(p_skill_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (select 1 from public.skill_assessments where skill_id = p_skill_id)
    or exists (select 1 from public.skill_baseline_quizzes where skill_id = p_skill_id)
    or exists (select 1 from public.skill_tags where skill_id = p_skill_id)
    or exists (select 1 from public.skill_targets where skill_id = p_skill_id)
    or exists (select 1 from public.skill_course_links where skill_id = p_skill_id)
    or exists (select 1 from public.skill_experience_links where skill_id = p_skill_id)
    or exists (select 1 from public.xapi_statement_skills where skill_id = p_skill_id)
    or exists (select 1 from public.skill_peer_ratings where skill_id = p_skill_id)
    or exists (select 1 from public.skill_validation_requests where skill_id = p_skill_id)
    or exists (select 1 from public.manager_team_shared_skills where skill_id = p_skill_id)
    or exists (select 1 from public.employer_data_access_shared_skills where skill_id = p_skill_id)
    or exists (select 1 from public.connection_invites where skill_id = p_skill_id)
    or exists (select 1 from public.profile_share_link_skills where skill_id = p_skill_id)
    or exists (select 1 from public.skill_goals where skill_id = p_skill_id)
$$;
