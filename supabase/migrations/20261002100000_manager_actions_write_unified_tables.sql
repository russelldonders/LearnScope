-- Phase 2d of merging what managers do across the two management contexts
-- (see 20261001110000, 20261002090000 and docs/architecture/manager-teams.md):
-- every suggestion, rating and target a manager or organisation admin makes
-- is now written to the unified manager_skill_* tables, and a learner's
-- response to a suggestion goes there too. The per-context tables
-- (manager_team_skill_suggestions, employer_skill_suggestions,
-- manager_team_skill_assessments, employer_skill_confirmations,
-- employer_skill_development_targets, and team-set skill_targets rows) are
-- no longer written. They keep their data until phase 3, which needs
-- explicit approval.
--
-- What changes:
--   * The mirror triggers and functions from phase 1 are dropped -- nothing
--     writes the old tables any more.
--   * A target a team manager sets goes to manager_skill_targets with its
--     team recorded, not into the learner's own skill_targets. An earlier
--     active target from the same team for that skill is superseded.
--   * Readers return the unified ids, which the writers now take.
--   * "One suggestion per skill per team/organisation" and "one active
--     target per skill per team/organisation" are enforced in the functions
--     under an advisory lock, as the old development-target function did.
--     No unique index is added: history kept from earlier memberships could
--     already break one on an existing database.
--   * The unified tables still have no insert/update/delete policies; only
--     these SECURITY DEFINER functions write them, so a suggestion or target
--     can't be deleted behind the learner's back through the API.
--
-- Signatures are unchanged except two return types:
-- suggest_manager_team_skill and suggest_skill_to_employer_members return
-- manager_skill_suggestions rows (callers use only learner_id).

-- ---------------------------------------------------------------------------
-- Stop mirroring
-- ---------------------------------------------------------------------------

drop trigger mirror_to_manager_skill_suggestions on public.manager_team_skill_suggestions;
drop trigger mirror_to_manager_skill_suggestions on public.employer_skill_suggestions;
drop trigger mirror_to_manager_skill_ratings on public.manager_team_skill_assessments;
drop trigger mirror_to_manager_skill_ratings on public.employer_skill_confirmations;
drop trigger mirror_to_manager_skill_targets on public.employer_skill_development_targets;
drop trigger mirror_to_manager_skill_targets on public.skill_targets;

drop function private.mirror_manager_action_trigger();
drop function private.mirror_team_skill_suggestion(uuid);
drop function private.mirror_employer_skill_suggestion(uuid);
drop function private.mirror_team_skill_assessment(uuid);
drop function private.mirror_employer_skill_confirmation(uuid);
drop function private.mirror_employer_development_target(uuid);
drop function private.mirror_team_set_skill_target(uuid);

-- The old tables become read-only for app users (their data stays until
-- phase 3). Without this, a learner's status change or an admin's delete
-- through the old suggestion tables' grants would quietly go nowhere.
-- skill_targets is untouched: it's the learner's own targets table.
revoke insert, update, delete on public.manager_team_skill_suggestions, public.employer_skill_suggestions,
  public.manager_team_skill_assessments, public.employer_skill_confirmations,
  public.employer_skill_development_targets
  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Shared: record a suggestion, at most one per skill per context. A
-- dismissed one is reset to a fresh suggestion; one that's pending or
-- adopted is left alone and null is returned. Callers check permissions.
-- ---------------------------------------------------------------------------

create function private.record_manager_skill_suggestion(
  p_learner_id uuid, p_context_type text, p_team_id uuid, p_employer_id uuid, p_context_name text,
  p_skill_library_id uuid, p_skill_name text, p_target_level int, p_target_date date, p_comments text
)
returns public.manager_skill_suggestions
language plpgsql security definer set search_path = '' as $$
declare
  v_existing public.manager_skill_suggestions;
  v_result public.manager_skill_suggestions;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'manager_skill_suggestion:' || p_context_type || ':' || coalesce(p_team_id, p_employer_id)::text
      || ':' || p_learner_id::text || ':' || p_skill_library_id::text, 0));

  select s.* into v_existing
  from public.manager_skill_suggestions s
  where s.context_type = p_context_type
    and s.team_id is not distinct from p_team_id
    and s.employer_id is not distinct from p_employer_id
    and s.learner_id = p_learner_id
    and s.skill_library_id = p_skill_library_id
  order by (s.status <> 'dismissed') desc, s.created_at desc
  limit 1
  for update;

  if v_existing.id is not null and v_existing.status <> 'dismissed' then
    return null;
  end if;

  if v_existing.id is not null then
    update public.manager_skill_suggestions
    set status = 'suggested', context_name = p_context_name, skill_name = p_skill_name,
      suggested_target_level = p_target_level, target_date = p_target_date, comments = p_comments,
      suggested_by = auth.uid(), created_at = now()
    where id = v_existing.id
    returning * into v_result;
  else
    insert into public.manager_skill_suggestions (learner_id, context_type, team_id, employer_id, context_name,
      skill_library_id, skill_name, suggested_target_level, target_date, comments, suggested_by)
    values (p_learner_id, p_context_type, p_team_id, p_employer_id, p_context_name,
      p_skill_library_id, p_skill_name, p_target_level, p_target_date, p_comments, auth.uid())
    returning * into v_result;
  end if;
  return v_result;
end
$$;

revoke all on function private.record_manager_skill_suggestion(uuid, text, uuid, uuid, text, uuid, text, int, date, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Learner: adopt or dismiss a suggestion made to them.
-- ---------------------------------------------------------------------------

create function public.respond_to_manager_skill_suggestion(p_suggestion_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('adopted', 'dismissed') then
    raise exception 'Choose to add or dismiss the suggestion';
  end if;
  update public.manager_skill_suggestions
  set status = p_status
  where id = p_suggestion_id and learner_id = auth.uid() and status = 'suggested';
  if not found then raise exception 'This suggestion can no longer be updated.'; end if;
end
$$;

revoke all on function public.respond_to_manager_skill_suggestion(uuid, text) from public, anon;
grant execute on function public.respond_to_manager_skill_suggestion(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Manager teams
-- ---------------------------------------------------------------------------

create or replace function public.create_manager_team_skill_assessment(
  p_membership_id uuid, p_skill_id uuid, p_level int, p_comments text default null, p_evidence_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_membership public.manager_team_memberships; v_team public.manager_teams; v_id uuid;
begin
  select m.* into v_membership
  from public.manager_team_memberships m
  where m.id = p_membership_id and m.role = 'member' and m.status = 'active';
  if v_membership.id is null then raise exception 'Active team member not found'; end if;
  if not private.can_manage_manager_team(v_membership.team_id, auth.uid()) then raise exception 'Not authorised'; end if;
  select t.* into v_team from public.manager_teams t where t.id = v_membership.team_id;
  if v_team.status <> 'active' then
    raise exception 'This team has been archived and can no longer be changed';
  end if;
  if not exists (
    select 1 from public.manager_team_shared_skills ss
    where ss.membership_id = p_membership_id and ss.skill_id = p_skill_id
  ) then raise exception 'This skill has not been shared with your team'; end if;
  if p_level is null or p_level not between 1 and 5 then raise exception 'Choose a level'; end if;

  insert into public.manager_skill_ratings
    (learner_id, context_type, team_id, context_name, skill_id, skill_library_id, level, comments, evidence_url, rated_by)
  select v_membership.member_user_id, 'team', v_team.id, v_team.name, s.id, s.library_skill_id,
    p_level, nullif(trim(p_comments), ''), nullif(trim(p_evidence_url), ''), auth.uid()
  from public.skills s where s.id = p_skill_id
  returning id into v_id;
  return v_id;
end
$$;

create or replace function public.set_manager_team_skill_assessment_evidence(p_assessment_id uuid, p_evidence_paths text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.manager_skill_ratings r
  set evidence_paths = p_evidence_paths
  where r.id = p_assessment_id and r.context_type = 'team' and r.rated_by = auth.uid()
    and exists (select 1 from public.manager_teams t where t.id = r.team_id and t.status = 'active');
  if not found then raise exception 'Assessment not found'; end if;
end
$$;

-- Returns the new target shaped like the skill_targets row it used to be
-- (the manager screen prepends it to the list get_manager_team_skill_detail
-- returns).
create or replace function public.set_manager_team_skill_target(
  p_membership_id uuid, p_skill_id uuid, p_target_level int, p_target_date date, p_comments text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_learner uuid; v_team_id uuid; v_team_name text; v_library_id uuid;
  v_previous_id uuid; v_target public.manager_skill_targets;
begin
  if auth.uid() is null then raise exception 'Not authorised'; end if;
  if p_target_level is null or p_target_level not between 1 and 5 then raise exception 'Choose a target level'; end if;
  if p_target_date is null then raise exception 'Choose a target date'; end if;
  select m.member_user_id, t.id, t.name, s.library_skill_id into v_learner, v_team_id, v_team_name, v_library_id
  from public.manager_team_memberships m
  join public.manager_team_shared_skills ss on ss.membership_id = m.id
  join public.skills s on s.id = ss.skill_id and s.user_id = m.member_user_id
  join public.manager_teams t on t.id = m.team_id
  where m.id = p_membership_id and s.id = p_skill_id and m.role = 'member' and m.status = 'active'
    and t.status = 'active' and private.can_manage_manager_team(m.team_id, auth.uid())
  for share of m, ss;
  if v_learner is null then raise exception 'This skill is no longer shared with your team'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'manager_skill_target:team:' || v_team_id::text || ':' || v_learner::text || ':' || p_skill_id::text, 0));

  select target.id into v_previous_id
  from public.manager_skill_targets target
  where target.context_type = 'team' and target.team_id = v_team_id and target.learner_id = v_learner
    and target.skill_id = p_skill_id and target.status = 'active'
  order by target.created_at desc
  limit 1;

  update public.manager_skill_targets
  set status = 'superseded', closed_by = auth.uid(), closed_at = now()
  where context_type = 'team' and team_id = v_team_id and learner_id = v_learner
    and skill_id = p_skill_id and status = 'active';

  insert into public.manager_skill_targets (learner_id, context_type, team_id, context_name, skill_id, skill_library_id,
    target_level, target_date, notes, replaces_target_id, set_by)
  values (v_learner, 'team', v_team_id, v_team_name, p_skill_id, v_library_id,
    p_target_level, p_target_date, nullif(trim(p_comments), ''), v_previous_id, auth.uid())
  returning * into v_target;

  update public.skills set lifecycle_stage = 'target_set' where id = p_skill_id and lifecycle_stage = 'baseline_assessed';

  return jsonb_build_object(
    'id', v_target.id, 'skill_id', v_target.skill_id, 'user_id', v_target.learner_id,
    'target_level', v_target.target_level, 'target_date', v_target.target_date, 'comments', v_target.notes,
    'set_by_manager', v_target.set_by, 'status', v_target.status, 'created_at', v_target.created_at
  );
end;
$$;

drop function public.suggest_manager_team_skill(uuid, uuid, text, int, date, text);

create function public.suggest_manager_team_skill(
  p_membership_id uuid, p_skill_library_id uuid, p_skill_name text,
  p_target_level int default null, p_target_date date default null, p_comments text default null
)
returns public.manager_skill_suggestions
language plpgsql security definer set search_path = '' as $$
declare v_membership public.manager_team_memberships; v_team public.manager_teams; v_result public.manager_skill_suggestions;
begin
  select m.* into v_membership from public.manager_team_memberships m
  where m.id = p_membership_id and m.role = 'member' and m.status = 'active';
  if v_membership.id is null then raise exception 'Active team member not found'; end if;
  if not private.can_manage_manager_team(v_membership.team_id, auth.uid()) then raise exception 'Not authorised'; end if;
  select t.* into v_team from public.manager_teams t where t.id = v_membership.team_id;
  if v_team.status <> 'active' then
    raise exception 'This team has been archived and can no longer be changed';
  end if;
  if p_target_level is not null and (p_target_level < 1 or p_target_level > 5) then
    raise exception 'Target level must be between 1 and 5';
  end if;

  v_result := private.record_manager_skill_suggestion(
    v_membership.member_user_id, 'team', v_team.id, null, v_team.name,
    p_skill_library_id, trim(p_skill_name), p_target_level, p_target_date, nullif(trim(p_comments), ''));

  if v_result.id is null then raise exception 'This skill has already been suggested to them'; end if;
  return v_result;
end;
$$;

revoke all on function public.suggest_manager_team_skill(uuid, uuid, text, int, date, text) from public, anon;
grant execute on function public.suggest_manager_team_skill(uuid, uuid, text, int, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Organisations: admins
-- ---------------------------------------------------------------------------

drop function public.suggest_skill_to_employer_members(uuid, uuid, text, uuid[], int, date, text);

-- Returns only the suggestions actually created or reset; callers compare
-- against the requested ids to report anyone skipped (not an active member,
-- or already suggested/adopted).
create function public.suggest_skill_to_employer_members(
  p_employer_id uuid,
  p_skill_library_id uuid,
  p_skill_name text,
  p_user_ids uuid[],
  p_target_level int default null,
  p_target_date date default null,
  p_comments text default null
)
returns setof public.manager_skill_suggestions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_name text;
  v_user_id uuid;
  v_result public.manager_skill_suggestions;
begin
  if v_caller is null or not public.is_employer_admin(p_employer_id, v_caller) then
    raise exception 'Not authorized';
  end if;

  if p_target_level is not null and (p_target_level < 1 or p_target_level > 5) then
    raise exception 'Target level must be between 1 and 5';
  end if;

  select o.name into v_name from public.organisations o where o.id = p_employer_id;

  for v_user_id in
    select distinct uid.user_id from unnest(p_user_ids) as uid(user_id)
    where exists (
      select 1 from public.employer_members member
      where member.employer_id = p_employer_id and member.user_id = uid.user_id and member.status = 'active'
    )
  loop
    v_result := private.record_manager_skill_suggestion(
      v_user_id, 'organisation', null, p_employer_id, v_name,
      p_skill_library_id, p_skill_name, p_target_level, p_target_date, p_comments);
    if v_result.id is not null then return next v_result; end if;
  end loop;
end;
$$;

revoke all on function public.suggest_skill_to_employer_members(uuid, uuid, text, uuid[], int, date, text) from public, anon, authenticated;
grant execute on function public.suggest_skill_to_employer_members(uuid, uuid, text, uuid[], int, date, text) to authenticated;

create or replace function public.confirm_employer_skill_level(
  p_employer_id uuid,
  p_user_id uuid,
  p_library_skill_id uuid,
  p_level smallint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_employer_admin(p_employer_id, auth.uid()) then
    raise exception 'Not authorised';
  end if;

  if not exists (
    select 1 from public.employer_members
    where employer_id = p_employer_id and user_id = p_user_id and status = 'active'
  ) then
    raise exception 'Not an active member of this employer';
  end if;

  if p_level is null or p_level < 1 or p_level > 5 then
    raise exception 'Confirmed level must be between 1 and 5';
  end if;

  insert into public.manager_skill_ratings (learner_id, context_type, employer_id, context_name, skill_library_id, level, rated_by)
  select p_user_id, 'organisation', o.id, o.name, p_library_skill_id, p_level, auth.uid()
  from public.organisations o where o.id = p_employer_id;
end
$$;

-- ---------------------------------------------------------------------------
-- Organisations: managers through a reporting line
-- ---------------------------------------------------------------------------

create or replace function public.suggest_skill_to_managed_employer_member(p_employer_id uuid, p_employee_member_id uuid, p_skill_library_id uuid, p_target_level integer DEFAULT NULL::integer, p_target_date date DEFAULT NULL::date, p_comments text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_employee_user_id uuid;
  v_skill_name text;
  v_result public.manager_skill_suggestions;
begin
  select member.user_id into v_employee_user_id
  from public.employer_members member
  where member.id = p_employee_member_id
    and member.employer_id = p_employer_id
    and member.status = 'active';

  if v_employee_user_id is null or not private.can_manage_employer_member(
    auth.uid(), p_employee_member_id, 'skill_management', true
  ) then
    raise exception 'Not authorised';
  end if;

  if p_target_level is not null and (p_target_level < 1 or p_target_level > 5) then
    raise exception 'Target level must be between 1 and 5';
  end if;

  select library_skill.name into v_skill_name
  from public.organisations employer
  join public.organisation_offered_skills offered_skill
    on offered_skill.organisation_id = employer.id
  join public.skill_library library_skill
    on library_skill.id = offered_skill.skill_library_id
  where employer.id = p_employer_id
    and library_skill.id = p_skill_library_id;

  if v_skill_name is null then
    raise exception 'This skill is not offered by this employer';
  end if;

  v_result := private.record_manager_skill_suggestion(
    v_employee_user_id, 'organisation', null, p_employer_id,
    (select o.name from public.organisations o where o.id = p_employer_id),
    p_skill_library_id, v_skill_name, p_target_level, p_target_date, nullif(trim(p_comments), ''));

  if v_result.id is null then
    raise exception 'This skill is already suggested or adopted';
  end if;

  return v_result.id;
end
$function$;

create or replace function public.confirm_managed_employer_skill_level(p_employer_id uuid, p_employee_member_id uuid, p_skill_library_id uuid, p_level smallint)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_employee_user_id uuid;
  v_rating_id uuid;
begin
  select member.user_id into v_employee_user_id
  from public.employer_members member
  where member.id = p_employee_member_id
    and member.employer_id = p_employer_id
    and member.status = 'active';

  if v_employee_user_id is null or not private.can_manage_employer_member(
    auth.uid(), p_employee_member_id, 'skill_management', true
  ) then
    raise exception 'Not authorised';
  end if;

  if p_level < 1 or p_level > 5 then
    raise exception 'Confirmed level must be between 1 and 5';
  end if;

  if not exists (
    select 1
    from public.organisations employer
    join public.organisation_offered_skills offered_skill
      on offered_skill.organisation_id = employer.id
    where employer.id = p_employer_id
      and offered_skill.skill_library_id = p_skill_library_id
  ) then
    raise exception 'This skill is not offered by this employer';
  end if;

  insert into public.manager_skill_ratings (learner_id, context_type, employer_id, context_name, skill_library_id, level, rated_by)
  select v_employee_user_id, 'organisation', o.id, o.name, p_skill_library_id, p_level, auth.uid()
  from public.organisations o where o.id = p_employer_id
  returning id into v_rating_id;

  return v_rating_id;
end
$function$;

create or replace function public.set_managed_employer_skill_development_target(p_employer_id uuid, p_employee_member_id uuid, p_skill_library_id uuid, p_target_level integer, p_target_date date, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_employee_user_id uuid;
  v_previous_id uuid;
  v_target_id uuid;
begin
  select member.user_id into v_employee_user_id
  from public.employer_members member
  where member.id = p_employee_member_id
    and member.employer_id = p_employer_id
    and member.status = 'active';

  if v_employee_user_id is null or not private.can_manage_employer_member(
    auth.uid(), p_employee_member_id, 'skill_management', true
  ) then
    raise exception 'Not authorised';
  end if;

  if p_target_level is null or p_target_level < 1 or p_target_level > 5 then
    raise exception 'Target level must be between 1 and 5';
  end if;

  if p_target_date is null or p_target_date < current_date then
    raise exception 'Target date cannot be in the past';
  end if;

  if not exists (
    select 1
    from public.organisations employer
    join public.organisation_offered_skills offered_skill
      on offered_skill.organisation_id = employer.id
    where employer.id = p_employer_id
      and offered_skill.skill_library_id = p_skill_library_id
  ) then
    raise exception 'This skill is not offered by this employer';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'manager_skill_target:organisation:' || p_employer_id::text || ':' || v_employee_user_id::text
      || ':' || p_skill_library_id::text, 0));

  select target.id into v_previous_id
  from public.manager_skill_targets target
  where target.context_type = 'organisation' and target.employer_id = p_employer_id
    and target.learner_id = v_employee_user_id and target.skill_library_id = p_skill_library_id
    and target.status = 'active'
  order by target.created_at desc
  limit 1;

  update public.manager_skill_targets
  set status = 'superseded', closed_by = auth.uid(), closed_at = now()
  where context_type = 'organisation' and employer_id = p_employer_id
    and learner_id = v_employee_user_id and skill_library_id = p_skill_library_id and status = 'active';

  insert into public.manager_skill_targets (learner_id, context_type, employer_id, context_name, skill_library_id,
    target_level, target_date, notes, replaces_target_id, set_by)
  select v_employee_user_id, 'organisation', o.id, o.name, p_skill_library_id,
    p_target_level, p_target_date, nullif(trim(p_notes), ''), v_previous_id, auth.uid()
  from public.organisations o where o.id = p_employer_id
  returning id into v_target_id;

  return v_target_id;
end
$function$;

-- The manager must still manage the learner's current membership of the
-- organisation, and the target must date from it (matching
-- list_managed_employer_skill_development_targets).
create or replace function public.close_managed_employer_skill_development_target(
  p_target_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.manager_skill_targets;
  v_member public.employer_members;
begin
  if p_status not in ('completed', 'cancelled') then
    raise exception 'Target status must be completed or cancelled';
  end if;

  select target.* into v_target
  from public.manager_skill_targets target
  where target.id = p_target_id and target.context_type = 'organisation'
  for update;

  select member.* into v_member
  from public.employer_members member
  where member.employer_id = v_target.employer_id
    and member.user_id = v_target.learner_id
    and member.status = 'active';

  if v_target.id is null
     or v_target.status <> 'active'
     or v_member.id is null
     or v_target.created_at < v_member.created_at
     or not private.can_manage_employer_member(
       auth.uid(), v_member.id, 'skill_management', true
     ) then
    raise exception 'Not authorised';
  end if;

  update public.manager_skill_targets
  set status = p_status, closed_by = auth.uid(), closed_at = now()
  where id = p_target_id;
end
$$;

-- ---------------------------------------------------------------------------
-- Readers from 20261002090000, now returning the unified ids the writers
-- above take.
-- ---------------------------------------------------------------------------

create or replace function list_manager_team_member_summaries(p_team_id uuid)
returns table (
  id uuid, name text, avatar_url text, team_since timestamptz,
  shared_skills jsonb, collaborative_learning_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.id,
    coalesce(nullif(trim(p.full_name), ''), 'Team member'),
    p.avatar_url,
    coalesce(m.decided_at, m.invited_at),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'level', s.level,
        'sharedAt', ss.shared_at,
        'evidenceCount', coalesce((
          select sum(coalesce(cardinality(sa.evidence_paths), 0))
          from public.skill_assessments sa where sa.skill_id = s.id
        ), 0),
        'managerRating', (
          select jsonb_build_object('level', r.level, 'assessedAt', r.rated_at)
          from public.manager_skill_ratings r
          where r.context_type = 'team' and r.team_id = m.team_id and r.learner_id = m.member_user_id
            and r.skill_id = s.id and r.rated_by = auth.uid()
          order by r.rated_at desc limit 1
        )
      ) order by s.name)
      from public.manager_team_shared_skills ss
      join public.skills s on s.id = ss.skill_id and s.user_id = m.member_user_id
      where ss.membership_id = m.id
    ), '[]'::jsonb),
    (select count(*) from public.manager_team_activity_participants ap where ap.membership_id = m.id)
  from public.manager_team_memberships m
  join public.profiles p on p.id = m.member_user_id
  where m.team_id = p_team_id and m.role = 'member' and m.status = 'active'
    and private.can_manage_manager_team(p_team_id, auth.uid())
  order by p.full_name nulls last, m.invited_at
$$;

create or replace function list_manager_team_skill_assessments(p_membership_id uuid)
returns table (
  id uuid, skill_id uuid, level int, comments text, evidence_url text, evidence_paths text[],
  assessed_by_name text, assessed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.skill_id, r.level, r.comments, r.evidence_url, r.evidence_paths,
    coalesce(nullif(trim(p.full_name), ''), 'Manager'), r.rated_at
  from public.manager_team_memberships m
  join public.manager_skill_ratings r
    on r.context_type = 'team' and r.team_id = m.team_id and r.learner_id = m.member_user_id
  left join public.profiles p on p.id = r.rated_by
  where m.id = p_membership_id and r.skill_id is not null
    and (m.member_user_id = auth.uid() or private.can_manage_manager_team(m.team_id, auth.uid()))
  order by r.rated_at desc
$$;

-- Targets on a shared skill: the learner's own (skill_targets rows nobody
-- else set) plus the ones this team set. Targets other teams set no longer
-- appear here -- they belong to those teams.
create or replace function public.get_manager_team_skill_detail(p_membership_id uuid, p_skill_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Not authorised'; end if;
  select jsonb_build_object(
    'level', s.level, 'knowledge_level', s.knowledge_level,
    'assessments', coalesce((select jsonb_agg(jsonb_build_object(
      'id', a.id, 'level', a.level, 'comments', a.comments, 'assessed_at', a.assessed_at
    ) order by a.assessed_at desc) from public.skill_assessments a where a.skill_id = s.id), '[]'::jsonb),
    'targets', coalesce((select jsonb_agg(t.target order by t.created_at desc) from (
      select to_jsonb(own) as target, own.created_at
      from public.skill_targets own
      where own.skill_id = s.id and own.set_by_manager is null
      union all
      select jsonb_build_object(
        'id', team_target.id, 'skill_id', team_target.skill_id,
        'user_id', team_target.learner_id, 'target_level', team_target.target_level,
        'target_date', team_target.target_date, 'comments', team_target.notes,
        'set_by_manager', team_target.set_by, 'status', team_target.status,
        'created_at', team_target.created_at
      ), team_target.created_at
      from public.manager_skill_targets team_target
      where team_target.context_type = 'team' and team_target.team_id = m.team_id
        and team_target.learner_id = m.member_user_id and team_target.skill_id = s.id
        and team_target.status <> 'cancelled'
    ) t), '[]'::jsonb)
  ) into v_result
  from public.manager_team_memberships m
  join public.manager_team_shared_skills ss on ss.membership_id = m.id
  join public.skills s on s.id = ss.skill_id and s.user_id = m.member_user_id
  where m.id = p_membership_id and s.id = p_skill_id and m.role = 'member' and m.status = 'active'
    and private.can_manage_manager_team(m.team_id, auth.uid());
  if v_result is null then raise exception 'This skill is no longer shared with your team'; end if;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Organisation reporting lines
-- ---------------------------------------------------------------------------

create or replace function public.list_managed_employer_skill_development_targets(
  p_employer_id uuid,
  p_employee_member_id uuid
)
returns table (
  id uuid,
  skill_library_id uuid,
  skill_name text,
  target_level smallint,
  target_date date,
  notes text,
  status text,
  created_at timestamptz,
  closed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_member public.employer_members;
begin
  select member.* into v_member
  from public.employer_members member
  where member.id = p_employee_member_id
    and member.employer_id = p_employer_id
    and member.status = 'active';

  if not found or not private.can_manage_employer_member(
    auth.uid(), p_employee_member_id, 'skill_management', true
  ) then
    raise exception 'Not authorised';
  end if;

  return query
  select target.id, target.skill_library_id, library_skill.name,
    target.target_level::smallint, target.target_date, target.notes, target.status,
    target.created_at, target.closed_at
  from public.manager_skill_targets target
  join public.skill_library library_skill on library_skill.id = target.skill_library_id
  where target.context_type = 'organisation'
    and target.employer_id = p_employer_id
    and target.learner_id = v_member.user_id
    and target.created_at >= v_member.created_at
  order by (target.status = 'active') desc, target.created_at desc, target.id;
end
$$;

create or replace function public.get_my_employer_team_member_snapshot(
  p_employer_id uuid,
  p_employee_member_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_report record;
  v_employee_user_id uuid;
  v_scope text[];
  v_result jsonb;
begin
  select report.*
    into v_report
  from public.list_my_employer_team(p_employer_id) report
  where report.employee_member_id = p_employee_member_id;

  if not found then
    raise exception 'Team member not found';
  end if;

  v_employee_user_id := v_report.employee_user_id;
  v_scope := v_report.access_scope;

  v_result := jsonb_build_object(
    'employeeMemberId', v_report.employee_member_id,
    'employeeUserId', v_employee_user_id,
    'fullName', v_report.full_name,
    'avatarUrl', v_report.avatar_url,
    'reportDepth', v_report.report_depth,
    'accessScope', to_jsonb(v_scope),
    'relationshipTypes', to_jsonb(v_report.relationship_types),
    'isPrimary', v_report.is_primary,
    'employmentFields',
      case when 'employment' = any(v_scope) then coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', definition.id,
          'key', definition.key,
          'label', definition.label,
          'fieldType', definition.field_type,
          'value', field_value.value,
          'updatedAt', field_value.updated_at
        ) order by definition.sort_order, definition.label)
        from public.employer_field_definitions definition
        left join public.employer_member_field_values field_value
          on field_value.field_definition_id = definition.id
         and field_value.employer_member_id = p_employee_member_id
        where definition.employer_id is null
           or definition.employer_id = p_employer_id
      ), '[]'::jsonb) else '[]'::jsonb end,
    'roleAssignments',
      case when 'role_assignments' = any(v_scope) then coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', assignment.id,
          'status', assignment.status,
          'proposedAt', assignment.proposed_at,
          'decidedAt', assignment.decided_at,
          'roleProfileId', role_profile.id,
          'roleName', role_profile.name,
          'roleDescription', role_profile.description
        ) order by assignment.proposed_at desc)
        from public.employer_role_assignments assignment
        join public.employer_role_profiles role_profile
          on role_profile.id = assignment.role_profile_id
         and role_profile.employer_id = p_employer_id
        where assignment.employer_member_id = p_employee_member_id
      ), '[]'::jsonb) else '[]'::jsonb end,
    'trainingAssignments',
      case when 'training_assignments' = any(v_scope) then coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', assignment.id,
          'catalogueCourseId', course.id,
          'name', course.name,
          'provider', course.provider,
          'courseType', course.course_type,
          'duration', course.duration,
          'status', assignment.status,
          'assignedAt', assignment.created_at
        ) order by assignment.created_at desc)
        from public.course_assignments assignment
        join public.course_catalogue course
          on course.id = assignment.catalogue_course_id
        where assignment.employer_id = p_employer_id
          and assignment.assigned_to = v_employee_user_id
      ), '[]'::jsonb) else '[]'::jsonb end,
    'skillSuggestions',
      case when 'skill_management' = any(v_scope) then coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', suggestion.id,
          'skillLibraryId', suggestion.skill_library_id,
          'skillName', suggestion.skill_name,
          'suggestedTargetLevel', suggestion.suggested_target_level,
          'targetDate', suggestion.target_date,
          'comments', suggestion.comments,
          'status', suggestion.status,
          'createdAt', suggestion.created_at
        ) order by suggestion.created_at desc)
        from public.manager_skill_suggestions suggestion
        where suggestion.context_type = 'organisation'
          and suggestion.employer_id = p_employer_id
          and suggestion.learner_id = v_employee_user_id
      ), '[]'::jsonb) else '[]'::jsonb end,
    'skillConfirmations',
      case when 'skill_management' = any(v_scope) then coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', confirmation.id,
          'skillLibraryId', confirmation.skill_library_id,
          'skillName', confirmation.skill_name,
          'confirmedLevel', confirmation.level,
          'confirmedAt', confirmation.rated_at
        ) order by confirmation.rated_at desc)
        from (
          select distinct on (rating.skill_library_id)
            rating.id as id,
            rating.skill_library_id,
            library_skill.name as skill_name,
            rating.level,
            rating.rated_at
          from public.manager_skill_ratings rating
          join public.skill_library library_skill
            on library_skill.id = rating.skill_library_id
          where rating.context_type = 'organisation'
            and rating.employer_id = p_employer_id
            and rating.learner_id = v_employee_user_id
          order by rating.skill_library_id, rating.rated_at desc, rating.id desc
        ) confirmation
      ), '[]'::jsonb) else '[]'::jsonb end,
    'sharedSkills',
      case when 'shared_skills' = any(v_scope) then coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', skill.id,
          'librarySkillId', skill.library_skill_id,
          'name', skill.name,
          'category', skill.category,
          'level', skill.level,
          'evidenceVisible', 'shared_skill_evidence' = any(v_scope),
          'evidenceCount', case
            when 'shared_skill_evidence' = any(v_scope) then (
              select coalesce(sum(coalesce(cardinality(assessment.evidence_paths), 0)), 0)
              from public.skill_assessments assessment
              where assessment.skill_id = skill.id
                and assessment.user_id = v_employee_user_id
            )
            else null
          end
        ) order by skill.name, skill.id)
        from public.employer_data_access_requests access_request
        join public.employer_data_access_shared_skills shared_skill
          on shared_skill.request_id = access_request.id
        join public.skills skill
          on skill.id = shared_skill.skill_id
         and skill.user_id = v_employee_user_id
        where access_request.employer_id = p_employer_id
          and access_request.learner_id = v_employee_user_id
          and access_request.status = 'approved'
          and 'skills' = any(access_request.approved_data)
      ), '[]'::jsonb) else '[]'::jsonb end
  );

  return v_result;
end
$$;
