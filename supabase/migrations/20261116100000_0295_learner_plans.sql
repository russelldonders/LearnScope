-- Learner plans (phase 1: private to the learner). A plan gathers the
-- learner's own records -- courses, skills, skill goals, resources -- plus
-- free-text steps, into ordered sections with a timeframe, so they can work
-- through it and see progress.
--
-- A plan item only points at its record; it never copies or changes it.
-- Progress is worked out from the records themselves (a course's
-- completed_date, a skill's level against its own skill_targets, a goal's
-- readings); only resources and free-text steps, which have no "done" state
-- of their own, are ticked on the item (completed_on). Removing an item, or
-- a whole plan, never deletes the record; deleting the record leaves the
-- item in place with its reference cleared, shown as removed.
--
-- Distinct from courses.status = 'planned' ("Add to plan" on a course),
-- which stays as it is; a plan can include such a course. Sharing and
-- publishing plans are later phases; this keeps them open (plans are owned
-- by user_id like skill_resources, whose audience model sharing can mirror)
-- without building them now.

create table public.learner_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (description is null or char_length(description) <= 2000),
  starts_on date,
  target_on date,
  status text not null default 'active' check (status in ('active', 'completed', 'archived')),
  -- When the learner marked it complete; its own date, not updated_at.
  completed_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (target_on is null or starts_on is null or target_on >= starts_on),
  check ((status = 'completed') = (completed_on is not null))
);

create index learner_plans_user_idx on public.learner_plans (user_id, created_at desc);

create table public.learner_plan_sections (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.learner_plans(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  position integer not null default 0,
  target_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index learner_plan_sections_plan_idx on public.learner_plan_sections (plan_id, position);

create table public.learner_plan_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.learner_plans(id) on delete cascade,
  -- An item outside any section sits at the top of the plan.
  section_id uuid references public.learner_plan_sections(id) on delete set null,
  position integer not null default 0,
  item_type text not null check (item_type in ('course', 'skill', 'skill_goal', 'skill_resource', 'step')),
  course_id uuid references public.courses(id) on delete set null,
  skill_id uuid references public.skills(id) on delete set null,
  skill_goal_id uuid references public.skill_goals(id) on delete set null,
  skill_resource_id uuid references public.skill_resources(id) on delete set null,
  step_title text check (step_title is null or char_length(btrim(step_title)) between 1 and 200),
  note text check (note is null or char_length(note) <= 1000),
  target_on date,
  -- Only for resources and steps: when the learner ticked it off.
  completed_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- At most the reference matching its type (it may be cleared when the
  -- record is deleted); a step always has a title and no reference.
  check (
    (item_type = 'course' and skill_id is null and skill_goal_id is null and skill_resource_id is null and step_title is null)
    or (item_type = 'skill' and course_id is null and skill_goal_id is null and skill_resource_id is null and step_title is null)
    or (item_type = 'skill_goal' and course_id is null and skill_id is null and skill_resource_id is null and step_title is null)
    or (item_type = 'skill_resource' and course_id is null and skill_id is null and skill_goal_id is null and step_title is null)
    or (item_type = 'step' and course_id is null and skill_id is null and skill_goal_id is null and skill_resource_id is null and step_title is not null)
  ),
  check (completed_on is null or item_type in ('skill_resource', 'step'))
);

create index learner_plan_items_plan_idx on public.learner_plan_items (plan_id, section_id, position);
create index learner_plan_items_course_idx on public.learner_plan_items (course_id) where course_id is not null;
create index learner_plan_items_skill_idx on public.learner_plan_items (skill_id) where skill_id is not null;
create index learner_plan_items_goal_idx on public.learner_plan_items (skill_goal_id) where skill_goal_id is not null;
create index learner_plan_items_resource_idx on public.learner_plan_items (skill_resource_id) where skill_resource_id is not null;

-- updated_at, and nothing moves to another owner or plan once created.
create or replace function public.touch_learner_plan()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  new.created_at := old.created_at;
  if tg_table_name = 'learner_plans' then
    new.user_id := old.user_id;
  else
    new.plan_id := old.plan_id;
  end if;
  return new;
end;
$$;

create trigger learner_plans_touch before update on public.learner_plans
  for each row execute function public.touch_learner_plan();
create trigger learner_plan_sections_touch before update on public.learner_plan_sections
  for each row execute function public.touch_learner_plan();
create trigger learner_plan_items_touch before update on public.learner_plan_items
  for each row execute function public.touch_learner_plan();

-- Every item's record, and its section, must belong to the plan's owner and
-- plan. Checked on insert and update, as the plan owner can see their own
-- records anyway; SECURITY DEFINER so the check doesn't depend on those
-- tables' policies (a goal's owner is its skill's).
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
  -- A reference can be cleared (by its record's deletion) but never pointed
  -- at something of a different type.
  if tg_op = 'UPDATE' then
    new.item_type := old.item_type;
  end if;
  return new;
end;
$$;

revoke all on function public.check_learner_plan_item() from public, anon, authenticated;

create trigger learner_plan_items_check before insert or update on public.learner_plan_items
  for each row execute function public.check_learner_plan_item();

-- Owner-only access. Sections and items go through their plan's owner.
alter table public.learner_plans enable row level security;
alter table public.learner_plan_sections enable row level security;
alter table public.learner_plan_items enable row level security;

create policy "Learners manage their own plans"
  on public.learner_plans for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Learners manage their own plan sections"
  on public.learner_plan_sections for all
  to authenticated
  using (exists (select 1 from public.learner_plans p where p.id = learner_plan_sections.plan_id and p.user_id = (select auth.uid())))
  with check (exists (select 1 from public.learner_plans p where p.id = learner_plan_sections.plan_id and p.user_id = (select auth.uid())));

create policy "Learners manage their own plan items"
  on public.learner_plan_items for all
  to authenticated
  using (exists (select 1 from public.learner_plans p where p.id = learner_plan_items.plan_id and p.user_id = (select auth.uid())))
  with check (exists (select 1 from public.learner_plans p where p.id = learner_plan_items.plan_id and p.user_id = (select auth.uid())));

grant select, insert, update, delete on table public.learner_plans, public.learner_plan_sections, public.learner_plan_items to authenticated;
