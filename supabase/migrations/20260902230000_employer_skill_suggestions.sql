-- Phase 4 of the employer domain concept (follows 20260902090000/150000/
-- 160000/170000, and Phase 3's 20260902180000/190000 course_assignments):
-- lets an employer admin push/suggest a skill (with an optional target
-- level/date) to specific employer_members, mirroring course assignment's
-- "push, don't force" shape exactly.
--
-- Same trust boundary as course_assignments: suggesting doesn't grant the
-- employer any access to the learner's data and doesn't touch their actual
-- record by itself, so an admin can create a suggestion without the
-- learner's prior consent -- that's the point of "push". What it must NOT
-- do is silently create or modify the learner's own skills/skill_targets
-- rows -- that stays an action only the learner takes (clicking "Add to my
-- skills" on /actions, via adoptSkillSuggestion ->
-- findOrCreatePersonalSkill, the same unmodified function every other
-- learner-initiated skill-add path already uses -- and a skill_targets
-- insert shaped exactly like SetTargetModal's own, editable before saving,
-- not a silent copy of the employer's suggested values). This table only
-- ever tracks the suggestion's own lifecycle (suggested/adopted/dismissed);
-- it is never itself the thing that shows up on a learner's skills profile.
create table employer_skill_suggestions (
  id uuid primary key default gen_random_uuid(),
  employer_id uuid not null references employers(id) on delete cascade,
  learner_id uuid not null references auth.users(id),
  skill_library_id uuid not null references skill_library(id),
  -- Denormalized copy of the library skill's name at suggestion time, so
  -- adoptSkillSuggestion can call findOrCreatePersonalSkill(userId,
  -- skill_name) directly without an extra join/lookup -- the same shape
  -- findOrCreatePersonalSkill already expects (name-based resolve-or-
  -- create), and consistent with course_assignments denormalizing nothing
  -- further than a foreign key only because course_catalogue rows aren't
  -- looked up by name anywhere.
  skill_name text not null,
  suggested_target_level int check (suggested_target_level between 1 and 5),
  target_date date,
  comments text,
  assigned_by uuid references auth.users(id),
  status text not null default 'suggested' check (status in ('suggested', 'adopted', 'dismissed')),
  created_at timestamptz not null default now(),
  unique (employer_id, learner_id, skill_library_id)
);

create index employer_skill_suggestions_learner_idx on employer_skill_suggestions (learner_id);
create index employer_skill_suggestions_employer_idx on employer_skill_suggestions (employer_id);

alter table employer_skill_suggestions enable row level security;

-- A learner sees their own suggestions (whatever their status); an employer
-- admin sees every suggestion they've made, for a roster/status view --
-- mirrors course_assignments' select policy exactly.
create policy "Learners and employer admins can view skill suggestions"
  on employer_skill_suggestions for select
  to authenticated
  using (
    learner_id = (select auth.uid())
    or is_employer_admin(employer_id, (select auth.uid()))
  );

-- No insert policy -- creation only happens through
-- suggest_skill_to_employer_members() below (security definer, validates
-- admin status server-side), same reasoning as course_assignments having
-- none either.

-- The learner transitions their own row's status: 'adopted' once they've
-- actually added the skill via the existing, unchanged
-- findOrCreatePersonalSkill flow (adoptSkillSuggestion,
-- src/lib/skillSuggestions.js), or 'dismissed' if they don't want it.
--
-- RLS alone can't restrict this to just the status column -- USING/WITH
-- CHECK only gate which rows are touched, not which columns change within
-- them. That exact bug class (an unrestricted `grant update` on a table
-- with a legitimate self-service column update, letting a learner rewrite
-- the row's other columns via direct PostgREST) was already found and
-- fixed twice in this domain: once on employers
-- (20260902150000_employers_drop_update_policy.sql, which had no
-- legitimate self-service update at all so the fix was to drop the policy
-- entirely) and once on course_assignments itself
-- (20260902190000_course_assignment_security_fixes.sql, which -- like this
-- table -- has a real self-service status flip, so the fix was narrowing
-- the grant to just that column). Applying that column-grain grant here
-- from the start rather than reintroducing the bug a third time.
create policy "Learners can update their own suggestion status"
  on employer_skill_suggestions for update
  to authenticated
  using (learner_id = (select auth.uid()))
  with check (learner_id = (select auth.uid()));

-- Lets an admin retract a suggestion (wrong skill/person).
create policy "Employer admins can delete skill suggestions"
  on employer_skill_suggestions for delete
  to authenticated
  using (is_employer_admin(employer_id, (select auth.uid())));

grant select, delete on table employer_skill_suggestions to authenticated;
-- Column-grain: only the learner-facing status transition is allowed via
-- direct table grant; employer_id/learner_id/skill_library_id/skill_name/
-- suggested_target_level/target_date/comments/assigned_by all stay
-- unwritable by a direct PostgREST update, no matter what the RLS USING/
-- WITH CHECK clause above would otherwise allow through.
grant update (status) on table employer_skill_suggestions to authenticated;

-- ----------------------------------------------------------------------------
-- suggest_skill_to_employer_members -- security definer, mirrors
-- assign_course_to_employer_members's (20260902180000) validated-insert-
-- with-on-conflict shape: check the caller's admin status server-side, then
-- do the insert. Grant execute to authenticated (same convention as every
-- other employer RPC) since the internal is_employer_admin check is what
-- actually enforces admin-only.
--
-- The insert/select/on-conflict is one statement doing double duty: it
-- filters p_user_ids down to actual active employer_members of this
-- employer (same shape as the course-assignment RPC -- both roles
-- assignable), and it dedupes against any existing suggestion via the
-- unique constraint. On conflict, only resets a previously-'dismissed'
-- row back to a fresh 'suggested' one (re-suggesting after a dismiss);
-- an already-'suggested' or already-'adopted' row is left completely
-- untouched -- don't silently reset something the learner already adopted,
-- and don't spam-reset an already-pending ask. Returns setof
-- employer_skill_suggestions so the caller can tell exactly which of the
-- requested users actually got a new/reset row, and report the rest as
-- skipped rather than claiming a uniform success (note: unlike the course-
-- assignment RPC's plain "do nothing", an already-'suggested' target here
-- still returns no row from `returning *` since the update is filtered out
-- by the `where` clause, so it's correctly reported as skipped too).
-- ----------------------------------------------------------------------------
create or replace function suggest_skill_to_employer_members(
  p_employer_id uuid,
  p_skill_library_id uuid,
  p_skill_name text,
  p_user_ids uuid[],
  p_target_level int default null,
  p_target_date date default null,
  p_comments text default null
)
returns setof employer_skill_suggestions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
begin
  if v_caller is null or not is_employer_admin(p_employer_id, v_caller) then
    raise exception 'Not authorized';
  end if;

  if p_target_level is not null and (p_target_level < 1 or p_target_level > 5) then
    raise exception 'Target level must be between 1 and 5';
  end if;

  return query
    insert into employer_skill_suggestions
      (employer_id, learner_id, skill_library_id, skill_name, suggested_target_level, target_date, comments, assigned_by)
    select p_employer_id, uid.user_id, p_skill_library_id, p_skill_name, p_target_level, p_target_date, p_comments, v_caller
    from unnest(p_user_ids) as uid(user_id)
    where exists (
      select 1 from employer_members
      where employer_id = p_employer_id
        and user_id = uid.user_id
        and status = 'active'
    )
    on conflict (employer_id, learner_id, skill_library_id) do update
      set status = 'suggested',
          suggested_target_level = excluded.suggested_target_level,
          target_date = excluded.target_date,
          comments = excluded.comments,
          assigned_by = excluded.assigned_by,
          created_at = now()
      where employer_skill_suggestions.status = 'dismissed'
    returning *;
end;
$$;

revoke all on function suggest_skill_to_employer_members(uuid, uuid, text, uuid[], int, date, text) from public, anon, authenticated;
grant execute on function suggest_skill_to_employer_members(uuid, uuid, text, uuid[], int, date, text) to authenticated;
