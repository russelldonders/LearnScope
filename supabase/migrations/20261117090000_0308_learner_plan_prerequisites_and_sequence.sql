-- Plan prerequisites and sequencing (two settings an owner reaches from a
-- plan's settings in edit mode), and a timeframe given as a period from
-- when each person starts.
--
-- Sequence: whether a plan's activities are worked through in order --
--   none     -- any order (every existing plan)
--   plan     -- in order across the whole plan, section after section
--   sections -- in order within each section; sections run side by side
-- Locking follows from each item's state, which the app works out from the
-- records items point at (planProgress.js), so it's applied there: a course,
-- skill or goal is finished on its own record, never refused here.
--
-- Prerequisites: what someone should have before starting the plan. Groups
-- all have to be met (AND); a group is met by any one of its options (OR).
-- An option is a skill from the skill library at a minimum level, or a
-- course from the catalogue (any version of it). Each group is guidance
-- (shown, met or not) or required (until met, the plan's items stay locked
-- and nothing on it can be ticked off). Whether one is met is worked out for
-- each person from their own records only, and only they see it.

alter table public.learner_plans
  add column sequence text not null default 'none'
  check (sequence in ('none', 'plan', 'sections'));

-- Timeframe as a period from when each person starts (e.g. 30 days, 6
-- months), as an alternative to a fixed end date. Each person's own end
-- date is worked out in the app from the later of the plan's start and the
-- day they joined it (learner_plan_members.joined_at); nothing per person
-- is stored. A plan has one or the other, never both.
alter table public.learner_plans
  add column duration_amount smallint check (duration_amount between 1 and 999),
  add column duration_unit text check (duration_unit in ('days', 'weeks', 'months')),
  add constraint learner_plans_duration_check check ((duration_amount is null) = (duration_unit is null)),
  add constraint learner_plans_duration_or_target_check check (duration_amount is null or target_on is null);

create table public.learner_plan_prerequisite_groups (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.learner_plans(id) on delete cascade,
  position integer not null default 0,
  enforcement text not null default 'guidance' check (enforcement in ('guidance', 'required')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index learner_plan_prerequisite_groups_plan_idx
  on public.learner_plan_prerequisite_groups (plan_id, position);

create table public.learner_plan_prerequisites (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.learner_plans(id) on delete cascade,
  group_id uuid not null references public.learner_plan_prerequisite_groups(id) on delete cascade,
  kind text not null check (kind in ('skill', 'course')),
  -- A library entry or catalogue course that goes away takes the option
  -- with it, rather than leaving one nobody can meet.
  library_skill_id uuid references public.skill_library(id) on delete cascade,
  min_practical_level smallint check (min_practical_level between 1 and 5),
  min_knowledge_level smallint check (min_knowledge_level between 1 and 5),
  catalogue_course_id uuid references public.course_catalogue(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (kind = 'skill' and library_skill_id is not null and catalogue_course_id is null
      and (min_practical_level is not null or min_knowledge_level is not null))
    or (kind = 'course' and catalogue_course_id is not null and library_skill_id is null
      and min_practical_level is null and min_knowledge_level is null)
  )
);

create index learner_plan_prerequisites_group_idx on public.learner_plan_prerequisites (group_id, created_at);
create index learner_plan_prerequisites_plan_idx on public.learner_plan_prerequisites (plan_id);
create index learner_plan_prerequisites_skill_idx on public.learner_plan_prerequisites (library_skill_id) where library_skill_id is not null;
create index learner_plan_prerequisites_course_idx on public.learner_plan_prerequisites (catalogue_course_id) where catalogue_course_id is not null;
create unique index learner_plan_prerequisites_group_skill_idx
  on public.learner_plan_prerequisites (group_id, library_skill_id) where library_skill_id is not null;
create unique index learner_plan_prerequisites_group_course_idx
  on public.learner_plan_prerequisites (group_id, catalogue_course_id) where catalogue_course_id is not null;

-- updated_at, created_at kept, and nothing moves to another plan.
create trigger learner_plan_prerequisite_groups_touch before update on public.learner_plan_prerequisite_groups
  for each row execute function public.touch_learner_plan();
create trigger learner_plan_prerequisites_touch before update on public.learner_plan_prerequisites
  for each row execute function public.touch_learner_plan();

-- An option belongs to a group on the same plan, never changes kind, and
-- names a library skill or catalogue course the owner adding it can see.
-- Security invoker on purpose: those lookups go through the caller's own
-- access to the library and catalogue.
create or replace function private.check_learner_plan_prerequisite()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.plan_id := old.plan_id;
    new.kind := old.kind;
  end if;
  if (tg_op = 'INSERT' or new.group_id is distinct from old.group_id)
     and not exists (
       select 1 from public.learner_plan_prerequisite_groups g
       where g.id = new.group_id and g.plan_id = new.plan_id
     ) then
    raise exception 'That prerequisite group is not part of this plan' using errcode = 'check_violation';
  end if;
  if new.library_skill_id is not null
     and (tg_op = 'INSERT' or new.library_skill_id is distinct from old.library_skill_id)
     and not exists (select 1 from public.skill_library where id = new.library_skill_id) then
    raise exception 'Choose a skill from the skill library' using errcode = 'check_violation';
  end if;
  if new.catalogue_course_id is not null
     and (tg_op = 'INSERT' or new.catalogue_course_id is distinct from old.catalogue_course_id)
     and not exists (select 1 from public.course_catalogue where id = new.catalogue_course_id) then
    raise exception 'Choose a course from the catalogue' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function private.check_learner_plan_prerequisite() from public, anon, authenticated;

create trigger learner_plan_prerequisites_check before insert or update on public.learner_plan_prerequisites
  for each row execute function private.check_learner_plan_prerequisite();

-- Whether p_user meets one option, from their own records: a skill of theirs
-- from that library entry (not archived) at or above each level asked for,
-- or a completed, not cancelled, course of theirs from any version of that
-- catalogue course.
create or replace function private.learner_plan_prerequisite_met(p public.learner_plan_prerequisites, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p.kind
    when 'skill' then exists (
      select 1 from public.skills s
      where s.user_id = p_user
        and s.library_skill_id = p.library_skill_id
        and (s.lifecycle_stage is null or s.lifecycle_stage <> 'archived')
        and (p.min_practical_level is null or coalesce(s.level, 0) >= p.min_practical_level)
        and (p.min_knowledge_level is null or coalesce(s.knowledge_level, 0) >= p.min_knowledge_level)
    )
    when 'course' then exists (
      select 1
      from public.courses c
      join public.course_catalogue mine on mine.id = c.catalogue_course_id
      join public.course_catalogue wanted on wanted.id = p.catalogue_course_id
      where c.user_id = p_user
        and mine.version_group_id = wanted.version_group_id
        and c.completed_date is not null
        and c.status is distinct from 'cancelled'
    )
    else false
  end;
$$;

revoke all on function private.learner_plan_prerequisite_met(public.learner_plan_prerequisites, uuid) from public, anon, authenticated;

-- Whether a required group (with at least one option) has none p_user meets.
create or replace function private.learner_plan_blocked_for(p_plan_id uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.learner_plan_prerequisite_groups g
    where g.plan_id = p_plan_id
      and g.enforcement = 'required'
      and exists (select 1 from public.learner_plan_prerequisites p where p.group_id = g.id)
      and not exists (
        select 1 from public.learner_plan_prerequisites p
        where p.group_id = g.id and private.learner_plan_prerequisite_met(p, p_user)
      )
  );
$$;

revoke all on function private.learner_plan_blocked_for(uuid, uuid) from public, anon, authenticated;

-- Nothing on a plan is ticked off by someone who hasn't met its required
-- prerequisites. Unticking is always allowed, and ticks made before a
-- prerequisite was added stay.
create or replace function private.guard_learner_plan_item_progress_prerequisites()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan_id uuid;
begin
  select plan_id into v_plan_id from public.learner_plan_items where id = new.item_id;
  if v_plan_id is not null and private.learner_plan_blocked_for(v_plan_id, new.user_id) then
    raise exception 'This plan''s required prerequisites need to be met first' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_learner_plan_item_progress_prerequisites() from public, anon, authenticated;

create trigger learner_plan_item_progress_prerequisites before insert on public.learner_plan_item_progress
  for each row execute function private.guard_learner_plan_item_progress_prerequisites();

-- Everyone on a plan sees its prerequisites; its owners change them.
alter table public.learner_plan_prerequisite_groups enable row level security;
alter table public.learner_plan_prerequisites enable row level security;

create policy "Members see their plans' prerequisite groups"
  on public.learner_plan_prerequisite_groups for select
  to authenticated
  using (plan_id in (select private.my_learner_plan_ids()));
create policy "Owners add prerequisite groups"
  on public.learner_plan_prerequisite_groups for insert
  to authenticated
  with check (plan_id in (select private.my_owned_learner_plan_ids()));
create policy "Owners change prerequisite groups"
  on public.learner_plan_prerequisite_groups for update
  to authenticated
  using (plan_id in (select private.my_owned_learner_plan_ids()))
  with check (plan_id in (select private.my_owned_learner_plan_ids()));
create policy "Owners remove prerequisite groups"
  on public.learner_plan_prerequisite_groups for delete
  to authenticated
  using (plan_id in (select private.my_owned_learner_plan_ids()));

create policy "Members see their plans' prerequisites"
  on public.learner_plan_prerequisites for select
  to authenticated
  using (plan_id in (select private.my_learner_plan_ids()));
create policy "Owners add prerequisites"
  on public.learner_plan_prerequisites for insert
  to authenticated
  with check (plan_id in (select private.my_owned_learner_plan_ids()));
create policy "Owners change prerequisites"
  on public.learner_plan_prerequisites for update
  to authenticated
  using (plan_id in (select private.my_owned_learner_plan_ids()))
  with check (plan_id in (select private.my_owned_learner_plan_ids()));
create policy "Owners remove prerequisites"
  on public.learner_plan_prerequisites for delete
  to authenticated
  using (plan_id in (select private.my_owned_learner_plan_ids()));

grant select, insert, update, delete on table
  public.learner_plan_prerequisite_groups, public.learner_plan_prerequisites
  to authenticated;

-- A plan's prerequisites as the caller sees them: each group with its
-- options, each option named (whether or not the caller could look up that
-- library skill or catalogue course themselves) and marked met or not from
-- the caller's own records. For anyone on the plan.
create or replace function public.get_learner_plan_prerequisites(p_plan_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null or private.learner_plan_role(p_plan_id) is null then
    raise exception 'Plan not found' using errcode = 'insufficient_privilege';
  end if;
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', g.id,
        'position', g.position,
        'enforcement', g.enforcement,
        'options', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', p.id,
              'kind', p.kind,
              'library_skill_id', p.library_skill_id,
              'catalogue_course_id', p.catalogue_course_id,
              'min_practical_level', p.min_practical_level,
              'min_knowledge_level', p.min_knowledge_level,
              'name', case p.kind
                when 'skill' then (select l.name from public.skill_library l where l.id = p.library_skill_id)
                else (select c.name from public.course_catalogue c where c.id = p.catalogue_course_id)
              end,
              'met', private.learner_plan_prerequisite_met(p, v_user)
            )
            order by p.created_at
          )
          from public.learner_plan_prerequisites p
          where p.group_id = g.id
        ), '[]'::jsonb)
      )
      order by g.position, g.created_at
    )
    from public.learner_plan_prerequisite_groups g
    where g.plan_id = p_plan_id
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_learner_plan_prerequisites(uuid) from public, anon;
grant execute on function public.get_learner_plan_prerequisites(uuid) to authenticated;
