-- Ticking off a step or a resource in a plan now records it as an activity
-- in the learner's activity log (an xapi_statements row, saved through the
-- same path as every other activity). The item remembers which activity it
-- recorded, so unticking can take that one activity away again.
--
-- A step can also name a skill it develops (step_skill_id), so its activity
-- is linked to that skill and counts for it, including activity-based goals.
--
--   step_skill_id            -- optional, steps only
--   completion_statement_id  -- the activity recorded when it was ticked;
--                               cleared if that activity is deleted
alter table public.learner_plan_items
  add column step_skill_id uuid references public.skills(id) on delete set null,
  add column completion_statement_id uuid references public.xapi_statements(id) on delete set null,
  add constraint learner_plan_items_step_skill_check
    check (step_skill_id is null or item_type = 'step'),
  add constraint learner_plan_items_completion_statement_check
    check (completion_statement_id is null or item_type in ('skill_resource', 'step'));

create index learner_plan_items_step_skill_idx on public.learner_plan_items (step_skill_id) where step_skill_id is not null;
create index learner_plan_items_completion_statement_idx on public.learner_plan_items (completion_statement_id) where completion_statement_id is not null;

-- As in 0295, plus: a step's skill and a recorded activity must be the
-- plan owner's own too.
create or replace function public.check_learner_plan_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  -- An item never moves plan. Pinned here too, before anything is checked:
  -- this trigger fires before learner_plan_items_touch, and checking against
  -- a plan_id the caller sent would check the wrong owner.
  if tg_op = 'UPDATE' then
    new.plan_id := old.plan_id;
  end if;
  select user_id into v_owner from public.learner_plans where id = new.plan_id;

  -- Only a section being set or changed is checked, so clearing a reference
  -- when its record is deleted can never be held up here.
  if new.section_id is not null
     and (tg_op = 'INSERT' or new.section_id is distinct from old.section_id)
     and not exists (
    select 1 from public.learner_plan_sections where id = new.section_id and plan_id = new.plan_id
  ) then
    raise exception 'That section is not part of this plan' using errcode = 'check_violation';
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
  if new.completion_statement_id is not null
     and (tg_op = 'INSERT' or new.completion_statement_id is distinct from old.completion_statement_id)
     and not exists (select 1 from public.xapi_statements where id = new.completion_statement_id and user_id = v_owner) then
    raise exception 'You can only link your own activities to a plan' using errcode = 'check_violation';
  end if;
  -- A reference can be cleared (by its record's deletion) but never pointed
  -- at something of a different type.
  if tg_op = 'UPDATE' then
    new.item_type := old.item_type;
  end if;
  return new;
end;
$$;

revoke all on function public.check_learner_plan_item() from public, anon, authenticated;
