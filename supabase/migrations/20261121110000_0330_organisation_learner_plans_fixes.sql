-- Fixes to organisation plans (0328/0329):
--
--   * Deleting the account of the admin who made an organisation plan works
--     again: created_by may be cleared (its "on delete set null"), only never
--     changed to someone else. 0329 pinned it outright, which blocked the
--     deletion.
--   * An admin creating an organisation plan can read it back in the same
--     statement (insert ... returning): the plans' select policy checks the
--     row's organisation directly instead of only the set of plans worked out
--     before the insert.
--   * Likewise a plan step's added_by may be cleared when that account is
--     deleted (check_learner_plan_item pinned it since 0303, so deleting an
--     account that had added steps to a shared or organisation plan failed).
--   * The organisation's plan progress says who is still a member, so the
--     console can show people who've left as having left.
--
-- Data: none changed. (Staging had no organisation plans when this was
-- written, so no owner rows from between 0328 and 0329 needed clearing.)

create or replace function private.stamp_learner_plan_creator()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce((select auth.uid()), new.user_id, new.created_by);
  -- Cleared only by that account's deletion (on delete set null): by then
  -- its auth.users row is gone.
  elsif new.created_by is not null or exists (select 1 from auth.users where id = old.created_by) then
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;

drop policy "Members see their plans" on public.learner_plans;
create policy "Members see their plans"
  on public.learner_plans for select
  to authenticated
  using (
    (organisation_id is null and user_id = (select auth.uid()))
    or (organisation_id is not null and private.is_learner_plan_org_admin(organisation_id))
    or id in (select private.my_learner_plan_ids())
  );

drop function public.list_organisation_learner_plan_progress(uuid);

create function public.list_organisation_learner_plan_progress(p_plan_id uuid)
returns table (
  user_id uuid,
  name text,
  is_member boolean,
  assignment_id uuid,
  assignment_status text,
  assigned_at timestamptz,
  joined_at timestamptz,
  progress_done integer,
  progress_total integer,
  progress_items jsonb,
  progress_updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_organisation_id uuid;
begin
  select organisation_id into v_organisation_id from public.learner_plans where id = p_plan_id;
  if v_organisation_id is null or not private.is_learner_plan_org_admin(v_organisation_id) then
    raise exception 'Plan not found' using errcode = 'insufficient_privilege';
  end if;
  return query
  select
    person.user_id,
    coalesce(nullif(btrim(profile.full_name), ''), 'A LearnScope user'),
    membership.current_member,
    assignment.id,
    assignment.status,
    assignment.created_at,
    member.joined_at,
    case when membership.current_member then member.progress_done end,
    case when membership.current_member then member.progress_total end,
    case when membership.current_member then member.progress_items end,
    case when membership.current_member then member.progress_updated_at end
  from (
    select a.assigned_to as user_id from public.learner_plan_assignments a where a.plan_id = p_plan_id
    union
    select m.user_id from public.learner_plan_members m where m.plan_id = p_plan_id
  ) person
  left join public.learner_plan_assignments assignment
    on assignment.plan_id = p_plan_id and assignment.assigned_to = person.user_id
  left join public.learner_plan_members member
    on member.plan_id = p_plan_id and member.user_id = person.user_id
  left join public.profiles profile on profile.id = person.user_id
  cross join lateral (
    select public.is_employer_member(v_organisation_id, person.user_id) as current_member
  ) membership
  order by 3 desc, 2;
end;
$$;

revoke all on function public.list_organisation_learner_plan_progress(uuid) from public, anon;
grant execute on function public.list_organisation_learner_plan_progress(uuid) to authenticated;

-- As 0328, except that added_by may be cleared by its account's deletion.
create or replace function public.check_learner_plan_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
  v_owner uuid;
  v_organisation_id uuid;
begin
  select organisation_id into v_organisation_id from public.learner_plans
  where id = case when tg_op = 'INSERT' then new.plan_id else old.plan_id end;

  if tg_op = 'INSERT' then
    new.added_by := coalesce(v_caller, new.added_by, (select user_id from public.learner_plans where id = new.plan_id));
  else
    -- An item never moves plan, changes type or changes who added it.
    new.plan_id := old.plan_id;
    new.item_type := old.item_type;
    -- Cleared only by that account's deletion (on delete set null): by
    -- then its auth.users row is gone.
    if new.added_by is not null or exists (select 1 from auth.users where id = old.added_by) then
      new.added_by := old.added_by;
    end if;
    if v_caller is distinct from old.added_by
      and not (v_organisation_id is not null and private.is_learner_plan_org_admin(v_organisation_id))
      and (
        (new.course_id is not null and new.course_id is distinct from old.course_id)
        or (new.skill_id is not null and new.skill_id is distinct from old.skill_id)
        or (new.skill_goal_id is not null and new.skill_goal_id is distinct from old.skill_goal_id)
        or (new.skill_resource_id is not null and new.skill_resource_id is distinct from old.skill_resource_id)
        or (new.step_skill_id is not null and new.step_skill_id is distinct from old.step_skill_id)
        or (new.catalogue_course_id is not null and new.catalogue_course_id is distinct from old.catalogue_course_id)
        or (new.library_skill_id is not null and new.library_skill_id is distinct from old.library_skill_id)
      ) then
      raise exception 'Only the person who added this item can change what it points to' using errcode = 'check_violation';
    end if;
  end if;
  v_owner := new.added_by;

  -- Only a section being set or changed is checked, so clearing a reference
  -- when its record is deleted can never be held up here.
  if new.section_id is not null
     and (tg_op = 'INSERT' or new.section_id is distinct from old.section_id)
     and not exists (
    select 1 from public.learner_plan_sections where id = new.section_id and plan_id = new.plan_id
  ) then
    raise exception 'That section is not part of this plan' using errcode = 'check_violation';
  end if;

  if v_organisation_id is not null then
    if (new.course_id is not null and (tg_op = 'INSERT' or new.course_id is distinct from old.course_id))
       or (new.skill_id is not null and (tg_op = 'INSERT' or new.skill_id is distinct from old.skill_id))
       or (new.skill_goal_id is not null and (tg_op = 'INSERT' or new.skill_goal_id is distinct from old.skill_goal_id))
       or (new.skill_resource_id is not null and (tg_op = 'INSERT' or new.skill_resource_id is distinct from old.skill_resource_id))
       or (new.step_skill_id is not null and (tg_op = 'INSERT' or new.step_skill_id is distinct from old.step_skill_id)) then
      raise exception 'An organisation plan uses courses from its catalogues and skills from the skill library' using errcode = 'check_violation';
    end if;
    if new.item_type in ('skill_goal', 'skill_resource') then
      raise exception 'An organisation plan has courses, skills and steps only' using errcode = 'check_violation';
    end if;
    if tg_op = 'INSERT' and (
      (new.item_type = 'course' and new.catalogue_course_id is null)
      or (new.item_type = 'skill' and new.library_skill_id is null)
    ) then
      raise exception 'Choose a course from the catalogue or a skill from the skill library' using errcode = 'check_violation';
    end if;
    if new.catalogue_course_id is not null
       and (tg_op = 'INSERT' or new.catalogue_course_id is distinct from old.catalogue_course_id)
       and not public.employer_course_is_enabled(v_organisation_id, new.catalogue_course_id)
       and not exists (
         select 1 from public.course_catalogue
         where id = new.catalogue_course_id and organisation_id = v_organisation_id
       ) then
      raise exception 'That course isn''t available to this organisation' using errcode = 'check_violation';
    end if;
    if new.library_skill_id is not null
       and (tg_op = 'INSERT' or new.library_skill_id is distinct from old.library_skill_id)
       and not exists (
         select 1 from public.skill_library
         where id = new.library_skill_id and status = 'active'
           and (organisation_id = v_organisation_id or (organisation_id is null and not is_private))
       ) then
      raise exception 'That skill isn''t in this organisation''s skill library' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.catalogue_course_id is not null or new.library_skill_id is not null then
    raise exception 'Add your own course or skill to a personal plan' using errcode = 'check_violation';
  end if;

  -- Only a reference being set (or changed) is checked: one cleared by its
  -- record's deletion stays valid.
  if new.course_id is not null and (tg_op = 'INSERT' or new.course_id is distinct from old.course_id)
     and not exists (select 1 from public.courses where id = new.course_id and user_id = v_owner) then
    raise exception 'You can only add your own courses to a plan' using errcode = 'check_violation';
  end if;
  if new.skill_id is not null and (tg_op = 'INSERT' or new.skill_id is distinct from old.skill_id)
     and not exists (select 1 from public.skills where id = new.skill_id and user_id = v_owner) then
    raise exception 'You can only add your own skills to a plan' using errcode = 'check_violation';
  end if;
  if new.step_skill_id is not null and (tg_op = 'INSERT' or new.step_skill_id is distinct from old.step_skill_id)
     and not exists (select 1 from public.skills where id = new.step_skill_id and user_id = v_owner) then
    raise exception 'You can only add your own skills to a plan' using errcode = 'check_violation';
  end if;
  if new.skill_goal_id is not null and (tg_op = 'INSERT' or new.skill_goal_id is distinct from old.skill_goal_id)
     and not exists (
       select 1 from public.skill_goals g join public.skills s on s.id = g.skill_id
       where g.id = new.skill_goal_id and s.user_id = v_owner
     ) then
    raise exception 'You can only add your own goals to a plan' using errcode = 'check_violation';
  end if;
  if new.skill_resource_id is not null and (tg_op = 'INSERT' or new.skill_resource_id is distinct from old.skill_resource_id)
     and not exists (select 1 from public.skill_resources where id = new.skill_resource_id and user_id = v_owner) then
    raise exception 'You can only add your own resources to a plan' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

