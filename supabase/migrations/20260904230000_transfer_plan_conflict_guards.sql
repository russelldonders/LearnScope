-- Enforces Decision 2 of docs/profile-transfer-execution-rules.md: a
-- conflict item cannot resolve to keep_durable or use_source if the losing
-- side (source for keep_durable, durable for use_source) has any exclusive
-- dependent -- content that only exists because that root record exists,
-- and would otherwise be silently discarded when the root is retired. The
-- only legal resolution for such an item is `move` (with the source's name
-- already de-duplicated by the caller, unchanged from today's behavior).
--
-- These helpers are read-only, SECURITY DEFINER (the caller may not have
-- direct SELECT on every dependent table's rows for a skill/course/
-- experience they don't own -- e.g. manager_team_shared_skills,
-- employer_data_access_shared_skills), and used both by
-- resolve_profile_transfer_plan_item (this migration, catches it at
-- resolution time so the learner sees a clear error immediately) and by
-- the executor being added next (re-checked at execution time regardless,
-- since a guarded executor must never trust that upstream validation
-- wasn't bypassed or changed between resolution and execution).

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
$$;

create or replace function private.course_has_exclusive_dependents(p_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (select 1 from public.skill_course_links where course_id = p_course_id)
    or exists (select 1 from public.course_experience_links where course_id = p_course_id)
$$;

create or replace function private.experience_has_exclusive_dependents(p_experience_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (select 1 from public.skill_experience_links where experience_id = p_experience_id)
    or exists (select 1 from public.course_experience_links where experience_id = p_experience_id)
    or exists (select 1 from public.experience where parent_experience_id = p_experience_id)
$$;

revoke all on function private.skill_has_exclusive_dependents(uuid),
  private.course_has_exclusive_dependents(uuid),
  private.experience_has_exclusive_dependents(uuid)
from public, anon, authenticated;

-- private.can_view_learning_profile-style callers only ever invoke these
-- from inside another SECURITY DEFINER function's body
-- (resolve_profile_transfer_plan_item and the executor being added next),
-- never directly from a policy or from client code, so no
-- `grant execute ... to authenticated` is needed -- matching private.
-- personal_workspace_owner_account's own grant shape, not private.
-- employer_member_user_id's (which is called directly from a policy).

create or replace function public.resolve_profile_transfer_plan_item(
  p_plan_id uuid, p_item_id uuid, p_action text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_plan public.profile_transfer_plans;
  v_item public.profile_transfer_plan_items;
  v_losing_record_id uuid;
  v_has_dependents boolean;
begin
  select * into v_plan from public.profile_transfer_plans where id = p_plan_id for update;
  if v_plan.id is null or v_plan.status <> 'draft' or v_plan.expires_at <= now()
     or private.current_link_account(v_plan.verified_account_link_id) is null then
    raise exception 'Editable transfer plan not found';
  end if;
  if p_action not in ('keep_durable', 'use_source') then raise exception 'Invalid conflict resolution'; end if;

  select * into v_item from public.profile_transfer_plan_items
  where id = p_item_id and plan_id = p_plan_id and durable_record_id is not null;
  if v_item.id is null then raise exception 'Conflict item not found'; end if;

  -- keep_durable retires the source root; use_source retires the durable
  -- root. Either way, the retired side is the one that must not carry any
  -- exclusive dependent, per Decision 2 of
  -- docs/profile-transfer-execution-rules.md.
  v_losing_record_id := case when p_action = 'keep_durable' then v_item.source_record_id else v_item.durable_record_id end;
  v_has_dependents := case v_item.domain
    when 'skills' then private.skill_has_exclusive_dependents(v_losing_record_id)
    when 'courses' then private.course_has_exclusive_dependents(v_losing_record_id)
    when 'experience' then private.experience_has_exclusive_dependents(v_losing_record_id)
    else false
  end;
  if v_has_dependents then
    raise exception 'This record has evidence, links, or history attached and cannot be discarded -- choose Move instead so nothing is lost';
  end if;

  update public.profile_transfer_plan_items
  set action = p_action
  where id = p_item_id and plan_id = p_plan_id and durable_record_id is not null;
  insert into public.profile_transfer_plan_events (plan_id, actor_auth_account_id, event_type, details)
  values (p_plan_id, private.current_link_account(v_plan.verified_account_link_id), 'conflict_resolved',
    jsonb_build_object('itemId', p_item_id, 'action', p_action));
end
$$;
