-- Phase 1 of merging what managers do across the two management contexts:
-- independent manager teams (manager_team_*) and organisation reporting
-- lines (employer_management_relationships). The relationships stay separate
-- -- a consented team and a dated reporting line are different things -- but
-- the actions a manager takes on a learner's skill are the same in both, so
-- each gets one table that records which context it came from:
--
--   manager_skill_suggestions  <- manager_team_skill_suggestions,
--                                 employer_skill_suggestions
--   manager_skill_ratings      <- manager_team_skill_assessments,
--                                 employer_skill_confirmations
--   manager_skill_targets      <- employer_skill_development_targets,
--                                 skill_targets rows set by a team manager
--
-- Decisions this encodes:
--   * Targets set by someone else belong to that context, kept separate
--     from the learner's own targets (skill_targets stays learner-authored
--     once phase 3 moves the team-set rows out of it).
--   * When a team or organisation link ends, its suggestions, ratings and
--     targets stay with the learner as dated history: context references
--     are ON DELETE SET NULL with a name snapshot, unlike the old tables,
--     which cascade-delete with the membership.
--
-- This phase is additive. The old tables stay the source of truth and keep
-- being written by the existing functions; triggers mirror every insert and
-- update into the new tables so they're complete and current while readers
-- and writers move over in phase 2. Nothing is deleted here. Only the
-- learner can read their rows for now; manager-side read access arrives in
-- phase 2 together with the code that uses it.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.manager_skill_suggestions (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references auth.users(id) on delete cascade,
  context_type text not null check (context_type in ('team', 'organisation')),
  team_id uuid references public.manager_teams(id) on delete set null,
  employer_id uuid references public.organisations(id) on delete set null,
  context_name text not null,
  skill_library_id uuid not null references public.skill_library(id),
  skill_name text not null,
  suggested_target_level integer check (suggested_target_level between 1 and 5),
  target_date date,
  comments text,
  suggested_by uuid references auth.users(id) on delete set null,
  status text not null default 'suggested' check (status in ('suggested', 'adopted', 'dismissed')),
  created_at timestamptz not null default now(),
  legacy_source text,
  legacy_id uuid,
  unique (legacy_source, legacy_id)
);

create table public.manager_skill_ratings (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references auth.users(id) on delete cascade,
  context_type text not null check (context_type in ('team', 'organisation')),
  team_id uuid references public.manager_teams(id) on delete set null,
  employer_id uuid references public.organisations(id) on delete set null,
  context_name text not null,
  -- A team rating is of the learner's own skill row; an organisation
  -- confirmation is of a library skill. Either identifies the skill.
  skill_id uuid references public.skills(id) on delete cascade,
  skill_library_id uuid references public.skill_library(id),
  level integer not null check (level between 1 and 5),
  comments text,
  evidence_url text,
  evidence_paths text[],
  rated_by uuid references auth.users(id) on delete set null,
  rated_at timestamptz not null default now(),
  legacy_source text,
  legacy_id uuid,
  unique (legacy_source, legacy_id),
  check (skill_id is not null or skill_library_id is not null)
);

create table public.manager_skill_targets (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references auth.users(id) on delete cascade,
  context_type text not null check (context_type in ('team', 'organisation')),
  team_id uuid references public.manager_teams(id) on delete set null,
  employer_id uuid references public.organisations(id) on delete set null,
  context_name text not null,
  skill_id uuid references public.skills(id) on delete cascade,
  skill_library_id uuid references public.skill_library(id),
  target_level integer not null check (target_level between 1 and 5),
  target_date date not null,
  notes text,
  status text not null default 'active' check (status in ('active', 'completed', 'cancelled', 'superseded')),
  replaces_target_id uuid references public.manager_skill_targets(id) on delete set null,
  set_by uuid references auth.users(id) on delete set null,
  closed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  legacy_source text,
  legacy_id uuid,
  unique (legacy_source, legacy_id),
  check (skill_id is not null or skill_library_id is not null)
);

create index manager_skill_suggestions_learner_idx on public.manager_skill_suggestions (learner_id);
create index manager_skill_suggestions_team_idx on public.manager_skill_suggestions (team_id);
create index manager_skill_suggestions_employer_idx on public.manager_skill_suggestions (employer_id);
create index manager_skill_ratings_learner_idx on public.manager_skill_ratings (learner_id);
create index manager_skill_ratings_skill_idx on public.manager_skill_ratings (skill_id);
create index manager_skill_ratings_team_idx on public.manager_skill_ratings (team_id);
create index manager_skill_ratings_employer_idx on public.manager_skill_ratings (employer_id);
create index manager_skill_targets_learner_idx on public.manager_skill_targets (learner_id);
create index manager_skill_targets_skill_idx on public.manager_skill_targets (skill_id);
create index manager_skill_targets_team_idx on public.manager_skill_targets (team_id);
create index manager_skill_targets_employer_idx on public.manager_skill_targets (employer_id);

-- Learner-owned read access only. No insert/update/delete policies: rows are
-- written by the mirror triggers now and by SECURITY DEFINER functions later.
alter table public.manager_skill_suggestions enable row level security;
alter table public.manager_skill_ratings enable row level security;
alter table public.manager_skill_targets enable row level security;

create policy "Learners read suggestions made for them"
  on public.manager_skill_suggestions for select using ((select auth.uid()) = learner_id);
create policy "Learners read ratings of their skills"
  on public.manager_skill_ratings for select using ((select auth.uid()) = learner_id);
create policy "Learners read targets set for them"
  on public.manager_skill_targets for select using ((select auth.uid()) = learner_id);

revoke all on public.manager_skill_suggestions, public.manager_skill_ratings, public.manager_skill_targets from anon;
grant select on public.manager_skill_suggestions, public.manager_skill_ratings, public.manager_skill_targets to authenticated;

-- ---------------------------------------------------------------------------
-- Mirror functions: one per old table, upserting by (legacy_source, legacy_id).
-- Used for the backfill and by the triggers. Deletes are not mirrored -- the
-- old tables cascade-delete with a membership, and history should survive.
-- ---------------------------------------------------------------------------

create function private.mirror_team_skill_suggestion(p_id uuid)
returns void language sql security definer set search_path = public as $$
  insert into manager_skill_suggestions (learner_id, context_type, team_id, context_name, skill_library_id, skill_name,
    suggested_target_level, target_date, comments, suggested_by, status, created_at, legacy_source, legacy_id)
  select m.member_user_id, 'team', m.team_id, t.name, s.skill_library_id, s.skill_name,
    s.suggested_target_level, s.target_date, s.comments, s.suggested_by, s.status, s.created_at, 'manager_team_skill_suggestions', s.id
  from manager_team_skill_suggestions s
  join manager_team_memberships m on m.id = s.membership_id
  join manager_teams t on t.id = m.team_id
  where s.id = p_id
  on conflict (legacy_source, legacy_id) do update set
    skill_name = excluded.skill_name, suggested_target_level = excluded.suggested_target_level,
    target_date = excluded.target_date, comments = excluded.comments, status = excluded.status
$$;

create function private.mirror_employer_skill_suggestion(p_id uuid)
returns void language sql security definer set search_path = public as $$
  insert into manager_skill_suggestions (learner_id, context_type, employer_id, context_name, skill_library_id, skill_name,
    suggested_target_level, target_date, comments, suggested_by, status, created_at, legacy_source, legacy_id)
  select s.learner_id, 'organisation', s.employer_id, o.name, s.skill_library_id, s.skill_name,
    s.suggested_target_level, s.target_date, s.comments, s.assigned_by, s.status, s.created_at, 'employer_skill_suggestions', s.id
  from employer_skill_suggestions s
  join organisations o on o.id = s.employer_id
  where s.id = p_id
  on conflict (legacy_source, legacy_id) do update set
    skill_name = excluded.skill_name, suggested_target_level = excluded.suggested_target_level,
    target_date = excluded.target_date, comments = excluded.comments, status = excluded.status
$$;

create function private.mirror_team_skill_assessment(p_id uuid)
returns void language sql security definer set search_path = public as $$
  insert into manager_skill_ratings (learner_id, context_type, team_id, context_name, skill_id, skill_library_id,
    level, comments, evidence_url, evidence_paths, rated_by, rated_at, legacy_source, legacy_id)
  select m.member_user_id, 'team', m.team_id, t.name, a.skill_id, sk.library_skill_id,
    a.level, a.comments, a.evidence_url, a.evidence_paths, a.assessed_by, a.assessed_at, 'manager_team_skill_assessments', a.id
  from manager_team_skill_assessments a
  join manager_team_memberships m on m.id = a.membership_id
  join manager_teams t on t.id = m.team_id
  left join skills sk on sk.id = a.skill_id
  where a.id = p_id
  on conflict (legacy_source, legacy_id) do update set
    level = excluded.level, comments = excluded.comments,
    evidence_url = excluded.evidence_url, evidence_paths = excluded.evidence_paths
$$;

create function private.mirror_employer_skill_confirmation(p_id uuid)
returns void language sql security definer set search_path = public as $$
  insert into manager_skill_ratings (learner_id, context_type, employer_id, context_name, skill_library_id,
    level, rated_by, rated_at, legacy_source, legacy_id)
  select c.user_id, 'organisation', c.employer_id, o.name, c.library_skill_id,
    c.confirmed_level, c.confirmed_by, c.created_at, 'employer_skill_confirmations', c.id
  from employer_skill_confirmations c
  join organisations o on o.id = c.employer_id
  where c.id = p_id
  on conflict (legacy_source, legacy_id) do update set level = excluded.level
$$;

create function private.mirror_employer_development_target(p_id uuid)
returns void language sql security definer set search_path = public as $$
  insert into manager_skill_targets (learner_id, context_type, employer_id, context_name, skill_library_id,
    target_level, target_date, notes, status, replaces_target_id, set_by, closed_by, created_at, closed_at, legacy_source, legacy_id)
  select em.user_id, 'organisation', d.employer_id, o.name, d.skill_library_id,
    d.target_level, d.target_date, d.notes, d.status,
    (select r.id from manager_skill_targets r
      where r.legacy_source = 'employer_skill_development_targets' and r.legacy_id = d.replaces_target_id),
    d.created_by, d.closed_by, d.created_at, d.closed_at, 'employer_skill_development_targets', d.id
  from employer_skill_development_targets d
  join employer_members em on em.id = d.employer_member_id
  join organisations o on o.id = d.employer_id
  where d.id = p_id
  on conflict (legacy_source, legacy_id) do update set
    target_level = excluded.target_level, target_date = excluded.target_date, notes = excluded.notes,
    status = excluded.status, replaces_target_id = excluded.replaces_target_id,
    closed_by = excluded.closed_by, closed_at = excluded.closed_at
$$;

-- skill_targets doesn't record which team a manager-set target came from;
-- it's the team (if any) where the setter manages the learner, most recently
-- joined first. The newest manager-set target per skill is active; earlier
-- ones are marked superseded.
create function private.mirror_team_set_skill_target(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_target skill_targets;
  v_team record;
  v_new_id uuid;
begin
  select * into v_target from skill_targets where id = p_id and set_by_manager is not null;
  if not found then return; end if;

  select t.id, t.name into v_team
  from manager_team_memberships learner_m
  join manager_team_memberships leader_m
    on leader_m.team_id = learner_m.team_id and leader_m.member_user_id = v_target.set_by_manager and leader_m.role = 'manager'
  join manager_teams t on t.id = learner_m.team_id
  where learner_m.member_user_id = v_target.user_id
  order by learner_m.invited_at desc
  limit 1;

  insert into manager_skill_targets (learner_id, context_type, team_id, context_name, skill_id, skill_library_id,
    target_level, target_date, notes, status, set_by, created_at, legacy_source, legacy_id)
  select v_target.user_id, 'team', v_team.id, coalesce(v_team.name, 'Manager team'), v_target.skill_id, s.library_skill_id,
    v_target.target_level, v_target.target_date, v_target.comments, 'active', v_target.set_by_manager, v_target.created_at,
    'skill_targets', v_target.id
  from skills s where s.id = v_target.skill_id
  on conflict (legacy_source, legacy_id) do update set
    target_level = excluded.target_level, target_date = excluded.target_date, notes = excluded.notes
  returning id into v_new_id;

  update manager_skill_targets older
  set status = 'superseded', closed_at = v_target.created_at, closed_by = v_target.set_by_manager
  where older.learner_id = v_target.user_id and older.skill_id = v_target.skill_id
    and older.context_type = 'team' and older.status = 'active'
    and older.id <> v_new_id and older.created_at <= v_target.created_at;
end
$$;

revoke all on function private.mirror_team_skill_suggestion(uuid), private.mirror_employer_skill_suggestion(uuid),
  private.mirror_team_skill_assessment(uuid), private.mirror_employer_skill_confirmation(uuid),
  private.mirror_employer_development_target(uuid), private.mirror_team_set_skill_target(uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Triggers on the old tables
-- ---------------------------------------------------------------------------

create function private.mirror_manager_action_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  case tg_table_name
    when 'manager_team_skill_suggestions' then perform private.mirror_team_skill_suggestion(new.id);
    when 'employer_skill_suggestions' then perform private.mirror_employer_skill_suggestion(new.id);
    when 'manager_team_skill_assessments' then perform private.mirror_team_skill_assessment(new.id);
    when 'employer_skill_confirmations' then perform private.mirror_employer_skill_confirmation(new.id);
    when 'employer_skill_development_targets' then perform private.mirror_employer_development_target(new.id);
    when 'skill_targets' then perform private.mirror_team_set_skill_target(new.id);
  end case;
  return new;
end
$$;

revoke all on function private.mirror_manager_action_trigger() from public, anon, authenticated;

create trigger mirror_to_manager_skill_suggestions after insert or update on public.manager_team_skill_suggestions
  for each row execute function private.mirror_manager_action_trigger();
create trigger mirror_to_manager_skill_suggestions after insert or update on public.employer_skill_suggestions
  for each row execute function private.mirror_manager_action_trigger();
create trigger mirror_to_manager_skill_ratings after insert or update on public.manager_team_skill_assessments
  for each row execute function private.mirror_manager_action_trigger();
create trigger mirror_to_manager_skill_ratings after insert or update on public.employer_skill_confirmations
  for each row execute function private.mirror_manager_action_trigger();
create trigger mirror_to_manager_skill_targets after insert or update on public.employer_skill_development_targets
  for each row execute function private.mirror_manager_action_trigger();
create trigger mirror_to_manager_skill_targets after insert or update on public.skill_targets
  for each row when (new.set_by_manager is not null) execute function private.mirror_manager_action_trigger();

-- ---------------------------------------------------------------------------
-- Backfill everything that already exists (oldest first, so replaced-target
-- links and superseded statuses resolve in order).
-- ---------------------------------------------------------------------------

select private.mirror_team_skill_suggestion(id) from public.manager_team_skill_suggestions order by created_at;
select private.mirror_employer_skill_suggestion(id) from public.employer_skill_suggestions order by created_at;
select private.mirror_team_skill_assessment(id) from public.manager_team_skill_assessments order by assessed_at;
select private.mirror_employer_skill_confirmation(id) from public.employer_skill_confirmations order by created_at;
select private.mirror_employer_development_target(id) from public.employer_skill_development_targets order by created_at;
select private.mirror_team_set_skill_target(id) from public.skill_targets where set_by_manager is not null order by created_at;
