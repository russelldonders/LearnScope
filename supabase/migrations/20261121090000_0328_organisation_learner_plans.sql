-- Organisation plans: learner plans that belong to an organisation, built by
-- its admins from its catalogue courses and skill library, and assigned to
-- its members.
--
--   learner_plans.organisation_id   set for an organisation's plan. Its admins
--                                   own it (edit, assign, see progress) while
--                                   they are admins; the admin who made it is
--                                   kept as user_id, as who created it, but is
--                                   not put on it as a person.
--   learner_plan_items              an organisation plan's course and skill
--                                   steps point at catalogue_course_id and
--                                   library_skill_id instead of anyone's own
--                                   records; plain steps work as before.
--   learner_plan_assignments        an organisation assigning a plan to a
--                                   member, as course_assignments does for
--                                   courses. Assigning adds nothing to the
--                                   member's record: only their Start joins
--                                   them as a follower, which is when their own
--                                   matching (planned) course and skill are
--                                   found or made. Dismiss declines it.
--   learner_plan_members.progress_items
--                                   on an organisation plan, each follower's
--                                   status for each step, recorded by their own
--                                   browser with their done/total, so the
--                                   organisation sees their full progress. The
--                                   member is told this before they start, and
--                                   it's only shown while they're still an
--                                   active member of the organisation.
--
-- Personal plans are unchanged: nothing here applies when organisation_id is
-- null. Organisation plans can't be shared by invitation or link; they're
-- assigned.
--
-- Data: additive only. No existing rows change.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.learner_plans
  add column organisation_id uuid references public.organisations(id) on delete cascade;

create index learner_plans_organisation_idx on public.learner_plans (organisation_id)
  where organisation_id is not null;

alter table public.learner_plan_items
  add column catalogue_course_id uuid references public.course_catalogue(id) on delete set null,
  add column library_skill_id uuid references public.skill_library(id) on delete set null,
  add constraint learner_plan_items_catalogue_course_check
    check (catalogue_course_id is null or (item_type = 'course' and course_id is null)),
  add constraint learner_plan_items_library_skill_check
    check (library_skill_id is null or (item_type = 'skill' and skill_id is null));

alter table public.learner_plan_members
  add column progress_items jsonb,
  add constraint learner_plan_members_progress_items_check
    check (progress_items is null or jsonb_typeof(progress_items) = 'array');

-- An organisation plan never moves to another organisation or becomes
-- personal (or the other way round).
create or replace function private.pin_learner_plan_organisation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.organisation_id := old.organisation_id;
  return new;
end;
$$;

revoke all on function private.pin_learner_plan_organisation() from public, anon, authenticated;

create trigger learner_plans_pin_organisation
  before update on public.learner_plans
  for each row execute function private.pin_learner_plan_organisation();

-- ---------------------------------------------------------------------------
-- Who owns a plan
-- ---------------------------------------------------------------------------

create or replace function private.is_learner_plan_org_admin(p_organisation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_organisation_id is not null
    and (select auth.uid()) is not null
    and (
      public.is_employer_admin(p_organisation_id, (select auth.uid()))
      or public.is_org_admin(p_organisation_id, (select auth.uid()))
    );
$$;

revoke all on function private.is_learner_plan_org_admin(uuid) from public, anon;
grant execute on function private.is_learner_plan_org_admin(uuid) to authenticated;

-- The organisation plans the caller administers.
create or replace function private.my_organisation_learner_plan_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select plan.id
  from public.learner_plans plan
  where plan.organisation_id in (
    select distinct organisation_id from public.learner_plans
    where organisation_id is not null and private.is_learner_plan_org_admin(organisation_id)
  );
$$;

revoke all on function private.my_organisation_learner_plan_ids() from public, anon;
grant execute on function private.my_organisation_learner_plan_ids() to authenticated;

-- As 0303, plus the organisation plans the caller administers.
create or replace function private.my_owned_learner_plan_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select plan_id from public.learner_plan_members
  where user_id = (select auth.uid()) and role = 'owner'
  union
  select private.my_organisation_learner_plan_ids();
$$;

create or replace function private.my_learner_plan_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select plan_id from public.learner_plan_members where user_id = (select auth.uid())
  union
  select private.my_organisation_learner_plan_ids();
$$;

-- As 0303, plus the admins of an organisation plan's organisation.
-- (private.learner_plan_role still means the caller's own place on the plan,
-- so joining, leaving and linking records still need them to be on it.)
create or replace function private.assert_plan_owner(p_plan_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if not exists (
    select 1 from public.learner_plan_members
    where plan_id = p_plan_id and user_id = v_caller and role = 'owner'
  ) and not exists (
    select 1 from public.learner_plans
    where id = p_plan_id and private.is_learner_plan_org_admin(organisation_id)
  ) then
    raise exception 'Plan not found or not owned by you' using errcode = 'insufficient_privilege';
  end if;
  return v_caller;
end;
$$;

-- Whoever creates a personal plan owns it. An organisation's plan belongs to
-- the organisation, so its creator isn't put on it.
create or replace function private.add_learner_plan_creator()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.organisation_id is null then
    insert into public.learner_plan_members (plan_id, user_id, role, joined_at)
    values (new.id, new.user_id, 'owner', new.created_at)
    on conflict do nothing;
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
    or id in (select private.my_learner_plan_ids())
  );

drop policy "Learners create their own plans" on public.learner_plans;
create policy "Learners create their own plans"
  on public.learner_plans for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and (organisation_id is null or private.is_learner_plan_org_admin(organisation_id))
  );

drop policy "Only the creator deletes a plan" on public.learner_plans;
create policy "Only the creator deletes a plan"
  on public.learner_plans for delete
  to authenticated
  using (
    (organisation_id is null and user_id = (select auth.uid()))
    or (organisation_id is not null and private.is_learner_plan_org_admin(organisation_id))
  );

-- Organisation plans are assigned, not shared by invitation or link.
create or replace function private.refuse_organisation_plan_sharing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.learner_plans
    where id = (to_jsonb(new) ->> case when tg_table_name = 'learner_plan_invitations' then 'source_plan_id' else 'plan_id' end)::uuid
      and organisation_id is not null
  ) then
    raise exception 'An organisation plan is assigned to its members rather than shared'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function private.refuse_organisation_plan_sharing() from public, anon, authenticated;

create trigger learner_plan_invitations_refuse_organisation_plans
  before insert on public.learner_plan_invitations
  for each row execute function private.refuse_organisation_plan_sharing();

create trigger learner_plan_share_links_refuse_organisation_plans
  before insert on public.learner_plan_share_links
  for each row execute function private.refuse_organisation_plan_sharing();

-- ---------------------------------------------------------------------------
-- What an item may point at
-- ---------------------------------------------------------------------------

-- As 0303, plus: an organisation plan's steps point only at courses in the
-- organisation's catalogues and skills in its or the shared skill library,
-- never at anyone's own records, and any of its admins may change them; a
-- personal plan's never point at the catalogue or library directly.
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
    new.added_by := old.added_by;
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

-- As 0303, plus the catalogue course and library skill.
create or replace function private.unlink_repointed_learner_plan_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.course_id is not null and new.course_id is distinct from old.course_id)
     or (new.skill_id is not null and new.skill_id is distinct from old.skill_id)
     or (new.skill_goal_id is not null and new.skill_goal_id is distinct from old.skill_goal_id)
     or (new.skill_resource_id is not null and new.skill_resource_id is distinct from old.skill_resource_id)
     or (new.step_skill_id is not null and new.step_skill_id is distinct from old.step_skill_id)
     or (new.catalogue_course_id is not null and new.catalogue_course_id is distinct from old.catalogue_course_id)
     or (new.library_skill_id is not null and new.library_skill_id is distinct from old.library_skill_id) then
    delete from public.learner_plan_item_links where item_id = new.id;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- A member's own records for an organisation plan's steps
-- ---------------------------------------------------------------------------

-- The member's skill for a library skill: theirs linked to it, else theirs of
-- the same name, else a new private one (as resolve_invited_plan_skill).
create or replace function private.resolve_library_plan_skill(p_library_skill_id uuid, p_user uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_library public.skill_library%rowtype;
  v_skill_id uuid;
begin
  select * into v_library from public.skill_library where id = p_library_skill_id;
  if not found then
    return null;
  end if;
  select id into v_skill_id
  from public.skills
  where user_id = p_user and library_skill_id = v_library.id
  order by date_added
  limit 1;
  if v_skill_id is null then
    select id into v_skill_id
    from public.skills
    where user_id = p_user and lower(name) = lower(v_library.name)
    limit 1;
  end if;
  if v_skill_id is null then
    insert into public.skills (
      user_id, name, category, library_skill_id, source, lifecycle_stage, visible_on_profile
    ) values (
      p_user, v_library.name, coalesce(v_library.category, 'Other'), v_library.id, 'manual', 'identified', false
    )
    returning id into v_skill_id;
  end if;
  return v_skill_id;
end;
$$;

revoke all on function private.resolve_library_plan_skill(uuid, uuid) from public, anon, authenticated;

-- As 0303, plus catalogue courses (their course on it, else a planned one)
-- and library skills.
create or replace function private.link_learner_plan_item(p_item_id uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.learner_plan_items%rowtype;
  v_course public.courses%rowtype;
  v_catalogue public.course_catalogue%rowtype;
  v_goal public.skill_goals%rowtype;
  v_course_id uuid;
  v_skill_id uuid;
  v_goal_id uuid;
begin
  select * into v_item from public.learner_plan_items where id = p_item_id;
  if not found or v_item.added_by = p_user then
    return;
  end if;
  if exists (select 1 from public.learner_plan_item_links where item_id = p_item_id and user_id = p_user) then
    return;
  end if;
  if v_item.item_type = 'course' and v_item.course_id is not null then
    select * into v_course from public.courses where id = v_item.course_id;
    if found then
      if v_course.catalogue_course_id is not null then
        select id into v_course_id
        from public.courses
        where user_id = p_user and catalogue_course_id = v_course.catalogue_course_id
        order by created_at desc
        limit 1;
      end if;
      if v_course_id is null then
        insert into public.courses (
          user_id, name, provider, duration, course_type, catalogue_course_id, status, planned_at
        ) values (
          p_user, v_course.name, v_course.provider, v_course.duration, v_course.course_type,
          v_course.catalogue_course_id, 'planned', now()
        )
        returning id into v_course_id;
      end if;
    end if;
  elsif v_item.item_type = 'course' and v_item.catalogue_course_id is not null then
    select * into v_catalogue from public.course_catalogue where id = v_item.catalogue_course_id;
    if found then
      select id into v_course_id
      from public.courses
      where user_id = p_user and catalogue_course_id = v_catalogue.id
      order by created_at desc
      limit 1;
      if v_course_id is null then
        insert into public.courses (
          user_id, name, provider, duration, course_type, catalogue_course_id, status, planned_at
        ) values (
          p_user, v_catalogue.name, v_catalogue.provider, v_catalogue.duration, v_catalogue.course_type,
          v_catalogue.id, 'planned', now()
        )
        returning id into v_course_id;
      end if;
    end if;
  elsif v_item.item_type = 'skill' and v_item.library_skill_id is not null then
    v_skill_id := private.resolve_library_plan_skill(v_item.library_skill_id, p_user);
  elsif v_item.item_type = 'skill' then
    v_skill_id := private.resolve_invited_plan_skill(v_item.skill_id, p_user);
  elsif v_item.item_type = 'skill_goal' and v_item.skill_goal_id is not null then
    select * into v_goal from public.skill_goals where id = v_item.skill_goal_id;
    if found then
      v_skill_id := private.resolve_invited_plan_skill(v_goal.skill_id, p_user);
      if v_skill_id is not null then
        select id into v_goal_id
        from public.skill_goals
        where skill_id = v_skill_id and status = 'active' and lower(title) = lower(v_goal.title)
        order by created_at desc
        limit 1;
        if v_goal_id is null then
          insert into public.skill_goals (
            skill_id, original_text, title, metric, measure_kind, unit,
            direction, aggregation, period, target_value, target_date,
            started_on, tracker_question, log_every_days
          ) values (
            v_skill_id, v_goal.original_text, v_goal.title, v_goal.metric, v_goal.measure_kind, v_goal.unit,
            v_goal.direction, v_goal.aggregation, v_goal.period, v_goal.target_value, v_goal.target_date,
            current_date, v_goal.tracker_question, v_goal.log_every_days
          )
          returning id into v_goal_id;
        end if;
      end if;
      v_skill_id := null;
    end if;
  elsif v_item.item_type = 'skill_resource' and v_item.skill_resource_id is not null then
    v_skill_id := private.resolve_invited_plan_skill(
      (select skill_id from public.skill_resources where id = v_item.skill_resource_id), p_user
    );
  elsif v_item.item_type = 'step' then
    v_skill_id := private.resolve_invited_plan_skill(v_item.step_skill_id, p_user);
  end if;
  insert into public.learner_plan_item_links (item_id, user_id, course_id, skill_id, skill_goal_id)
  values (p_item_id, p_user, v_course_id, v_skill_id, v_goal_id)
  on conflict do nothing;
end;
$$;

revoke all on function private.link_learner_plan_item(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reading plans
-- ---------------------------------------------------------------------------

-- As 0304, plus each item's catalogue course / library skill (and their
-- names as source_title until linked), and the plan's organisation.
create or replace function public.get_my_learner_plans(p_plan_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with my_plans as (
    select plan.*, member.role as my_role
    from public.learner_plans plan
    join public.learner_plan_members member
      on member.plan_id = plan.id and member.user_id = (select auth.uid())
    where p_plan_id is null or plan.id = p_plan_id
  ),
  resolved as (
    select
      item.*,
      item.added_by is not distinct from (select auth.uid()) as is_author,
      private.learner_plan_item_needs_link(item, (select auth.uid())) as needs_link,
      link.course_id as link_course_id,
      link.skill_id as link_skill_id,
      link.skill_goal_id as link_goal_id,
      progress.completed_on as my_completed_on,
      progress.completion_statement_id as my_statement_id
    from public.learner_plan_items item
    join my_plans on my_plans.id = item.plan_id
    left join public.learner_plan_item_links link
      on link.item_id = item.id and link.user_id = (select auth.uid())
    left join public.learner_plan_item_progress progress
      on progress.item_id = item.id and progress.user_id = (select auth.uid())
    -- Only the items the caller may see (0304).
    where (item.visibility = 'members' or item.added_by is not distinct from (select auth.uid()) or (item.visibility = 'owners' and my_plans.my_role = 'owner'))
  ),
  refs as (
    select
      r.*,
      case when r.is_author then r.course_id else r.link_course_id end as r_course_id,
      case when r.is_author then r.skill_id when r.item_type = 'skill' then r.link_skill_id end as r_skill_id,
      case when r.is_author then r.skill_goal_id else r.link_goal_id end as r_goal_id,
      case when r.is_author then r.step_skill_id when r.item_type = 'step' then r.link_skill_id end as r_step_skill_id,
      case when r.item_type = 'skill_resource' and not r.is_author then r.link_skill_id end as r_resource_skill_id
    from resolved r
  ),
  items as (
    select
      refs.plan_id,
      refs.position,
      refs.created_at,
      jsonb_build_object(
        'id', refs.id,
        'plan_id', refs.plan_id,
        'section_id', refs.section_id,
        'position', refs.position,
        'item_type', refs.item_type,
        'course_id', refs.r_course_id,
        'skill_id', refs.r_skill_id,
        'skill_goal_id', refs.r_goal_id,
        'skill_resource_id', refs.skill_resource_id,
        'catalogue_course_id', refs.catalogue_course_id,
        'library_skill_id', refs.library_skill_id,
        'step_title', refs.step_title,
        'step_skill_id', refs.r_step_skill_id,
        'completion_statement_id', refs.my_statement_id,
        'note', refs.note,
        'target_on', refs.target_on,
        'completed_on', refs.my_completed_on,
        'plan_knowledge_level', refs.plan_knowledge_level,
        'plan_practical_level', refs.plan_practical_level,
        'visibility', refs.visibility,
        'created_at', refs.created_at,
        'is_author', refs.is_author,
        'needs_link', refs.needs_link,
        'source_title', case when not refs.needs_link then null else case refs.item_type
          when 'course' then coalesce(
            (select c.name from public.courses c where c.id = refs.course_id),
            (select cc.name from public.course_catalogue cc where cc.id = refs.catalogue_course_id)
          )
          when 'skill' then coalesce(
            (select s.name from public.skills s where s.id = refs.skill_id),
            (select sl.name from public.skill_library sl where sl.id = refs.library_skill_id)
          )
          when 'skill_goal' then (select g.title from public.skill_goals g where g.id = refs.skill_goal_id)
        end end,
        'courses', (
          select jsonb_build_object(
            'id', c.id, 'name', c.name, 'provider', c.provider, 'completed_date', c.completed_date,
            'status', c.status, 'cancelled_at', c.cancelled_at, 'catalogue_course_id', c.catalogue_course_id
          )
          from public.courses c where c.id = refs.r_course_id
        ),
        'skills', (
          select jsonb_build_object(
            'id', s.id, 'name', s.name, 'level', s.level, 'knowledge_level', s.knowledge_level,
            'lifecycle_stage', s.lifecycle_stage, 'library_skill_id', s.library_skill_id,
            'practical_level_guide', s.practical_level_guide
          )
          from public.skills s where s.id = refs.r_skill_id
        ),
        'step_skill', (
          select jsonb_build_object('id', s.id, 'name', s.name)
          from public.skills s where s.id = refs.r_step_skill_id
        ),
        'skill_goals', (
          select jsonb_build_object('id', g.id, 'title', g.title, 'status', g.status, 'skill_id', g.skill_id)
          from public.skill_goals g where g.id = refs.r_goal_id
        ),
        'skill_resources', (
          select jsonb_build_object(
            'id', sr.id, 'title', sr.title, 'kind', sr.kind, 'url', sr.url,
            'file_path', case when refs.is_author then sr.file_path end,
            'skill_id', case when refs.is_author then sr.skill_id else refs.r_resource_skill_id end,
            'skills', (
              select jsonb_build_object('id', k.id, 'name', k.name)
              from public.skills k
              where k.id = case when refs.is_author then sr.skill_id else refs.r_resource_skill_id end
            )
          )
          from public.skill_resources sr where sr.id = refs.skill_resource_id
        )
      ) as item_json
    from refs
  )
  select coalesce(jsonb_agg(plan_json order by created_at desc), '[]'::jsonb)
  from (
    select
      p.created_at,
      (to_jsonb(p) - 'my_role') || jsonb_build_object(
        'my_role', p.my_role,
        'is_creator', p.organisation_id is null and p.user_id = (select auth.uid()),
        'organisation', (
          select jsonb_build_object('id', o.id, 'name', o.name)
          from public.organisations o where o.id = p.organisation_id
        ),
        'sections', coalesce((
          select jsonb_agg(to_jsonb(s) order by s.position, s.created_at)
          from public.learner_plan_sections s where s.plan_id = p.id
        ), '[]'::jsonb),
        'items', coalesce((
          select jsonb_agg(i.item_json order by i.position, i.created_at)
          from items i where i.plan_id = p.id
        ), '[]'::jsonb)
      ) as plan_json
    from my_plans p
  ) plans;
$$;

-- As 0303, plus, on an organisation plan, the status of each step
-- (`items`: [{ item_id, status }]) for its admins to see.
create or replace function public.record_learner_plan_progress(p_progress jsonb)
returns setof uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_entry jsonb;
  v_plan_id uuid;
  v_done integer;
  v_total integer;
  v_role text;
  v_organisation_id uuid;
  v_items jsonb;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(p_progress) <> 'array' then
    raise exception 'Progress must be a list' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p_progress) > 500 then
    raise exception 'Too many plans at once' using errcode = 'check_violation';
  end if;

  for v_entry in select value from jsonb_array_elements(p_progress)
  loop
    v_plan_id := (v_entry ->> 'plan_id')::uuid;
    v_done := (v_entry ->> 'done')::integer;
    v_total := (v_entry ->> 'total')::integer;
    if v_plan_id is null or v_done is null or v_total is null
      or v_total < 0 or v_done < 0 or v_done > v_total then
      raise exception 'Invalid plan progress' using errcode = 'check_violation';
    end if;

    v_role := null;
    select role into v_role
    from public.learner_plan_members
    where plan_id = v_plan_id and user_id = v_caller;
    if v_role is not null then
      select organisation_id into v_organisation_id from public.learner_plans where id = v_plan_id;
      v_items := null;
      if v_organisation_id is not null and jsonb_typeof(v_entry -> 'items') = 'array' then
        if jsonb_array_length(v_entry -> 'items') > 200 then
          raise exception 'Too many plan steps at once' using errcode = 'check_violation';
        end if;
        select coalesce(jsonb_agg(jsonb_build_object('item_id', item.id, 'status', entry ->> 'status') order by item.position, item.created_at), '[]'::jsonb)
        into v_items
        from jsonb_array_elements(v_entry -> 'items') entry
        join public.learner_plan_items item
          on item.id = (entry ->> 'item_id')::uuid and item.plan_id = v_plan_id
        where entry ->> 'status' in ('not_started', 'in_progress', 'done', 'stopped', 'removed', 'needs_target');
      end if;
      update public.learner_plan_members
      set progress_done = v_done,
          progress_total = v_total,
          progress_items = v_items,
          progress_updated_at = now()
      where plan_id = v_plan_id and user_id = v_caller
        and (progress_done, progress_total, progress_items) is distinct from (v_done, v_total, v_items);
      if v_role = 'follower' then
        return next v_plan_id;
      end if;
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Assigning
-- ---------------------------------------------------------------------------

create table public.learner_plan_assignments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  plan_id uuid not null references public.learner_plans(id) on delete cascade,
  assigned_to uuid not null references auth.users(id) on delete cascade,
  assigned_by uuid references auth.users(id) on delete set null,
  status text not null default 'assigned' check (status in ('assigned', 'started', 'dismissed')),
  created_at timestamptz not null default now(),
  -- When the member started or dismissed it.
  responded_at timestamptz,
  unique (plan_id, assigned_to),
  check ((status = 'assigned') = (responded_at is null))
);

create index learner_plan_assignments_assigned_to_idx on public.learner_plan_assignments (assigned_to);
create index learner_plan_assignments_organisation_idx on public.learner_plan_assignments (organisation_id);

alter table public.learner_plan_assignments enable row level security;

-- The member sees their own; the organisation's admins see all of its.
-- Writes only through the functions below.
create policy "Members and organisation admins view plan assignments"
  on public.learner_plan_assignments for select
  to authenticated
  using (
    assigned_to = (select auth.uid())
    or private.is_learner_plan_org_admin(organisation_id)
  );

grant select on public.learner_plan_assignments to authenticated;

create trigger prevent_admin_impersonation_write
  before insert or update or delete on public.learner_plan_assignments
  for each row execute function public.prevent_admin_impersonation_write();

create policy "Active impersonation sessions can read"
  on public.learner_plan_assignments as restrictive for select
  to authenticated
  using ((select public.admin_impersonation_session_can_read()));

-- An admin assigns an organisation plan to active members of the
-- organisation. Someone already on it, or already assigned it, is left as
-- they are; a dismissed assignment is assigned again. Returns how many were
-- assigned.
create or replace function public.assign_learner_plan(p_plan_id uuid, p_user_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_plan public.learner_plans%rowtype;
  v_count integer;
begin
  select * into v_plan from public.learner_plans where id = p_plan_id;
  if v_caller is null or not found or not private.is_learner_plan_org_admin(v_plan.organisation_id) then
    raise exception 'Plan not found' using errcode = 'insufficient_privilege';
  end if;
  if v_plan.status = 'archived' then
    raise exception 'An archived plan can''t be assigned' using errcode = 'check_violation';
  end if;
  if coalesce(array_length(p_user_ids, 1), 0) > 500 then
    raise exception 'Too many people at once' using errcode = 'check_violation';
  end if;

  with assigned as (
    insert into public.learner_plan_assignments (organisation_id, plan_id, assigned_to, assigned_by)
    select distinct v_plan.organisation_id, v_plan.id, person.user_id, v_caller
    from unnest(p_user_ids) as person(user_id)
    where exists (
        select 1 from public.employer_members member
        where member.employer_id = v_plan.organisation_id and member.user_id = person.user_id and member.status = 'active'
      )
      and not exists (
        select 1 from public.learner_plan_members on_plan
        where on_plan.plan_id = v_plan.id and on_plan.user_id = person.user_id
      )
    on conflict (plan_id, assigned_to) do update
      set status = 'assigned', responded_at = null, assigned_by = excluded.assigned_by, created_at = now()
      where public.learner_plan_assignments.status = 'dismissed'
    returning 1
  )
  select count(*) into v_count from assigned;
  return v_count;
end;
$$;

revoke all on function public.assign_learner_plan(uuid, uuid[]) from public, anon;
grant execute on function public.assign_learner_plan(uuid, uuid[]) to authenticated;

-- An admin withdraws an assignment the member hasn't responded to yet.
create or replace function public.withdraw_learner_plan_assignment(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment public.learner_plan_assignments%rowtype;
begin
  select * into v_assignment from public.learner_plan_assignments where id = p_assignment_id;
  if not found or not private.is_learner_plan_org_admin(v_assignment.organisation_id) then
    raise exception 'Assignment not found' using errcode = 'insufficient_privilege';
  end if;
  if v_assignment.status <> 'assigned' then
    raise exception 'Only an assignment that hasn''t been started can be withdrawn' using errcode = 'check_violation';
  end if;
  delete from public.learner_plan_assignments where id = p_assignment_id;
end;
$$;

revoke all on function public.withdraw_learner_plan_assignment(uuid) from public, anon;
grant execute on function public.withdraw_learner_plan_assignment(uuid) to authenticated;

-- The member starts (joining as a follower, so their own matching courses
-- and skills are found or made, and the organisation sees their progress)
-- or dismisses an assignment. Returns the plan.
create or replace function public.respond_to_learner_plan_assignment(p_assignment_id uuid, p_start boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_assignment public.learner_plan_assignments%rowtype;
begin
  select * into v_assignment from public.learner_plan_assignments where id = p_assignment_id;
  if v_caller is null or not found or v_assignment.assigned_to <> v_caller then
    raise exception 'Assignment not found' using errcode = 'insufficient_privilege';
  end if;
  if v_assignment.status <> 'assigned' then
    raise exception 'You''ve already responded to this' using errcode = 'check_violation';
  end if;
  if p_start then
    if not public.is_employer_member(v_assignment.organisation_id, v_caller) then
      raise exception 'You''re no longer a member of this organisation' using errcode = 'insufficient_privilege';
    end if;
    perform private.join_learner_plan(v_assignment.plan_id, v_caller, null);
  end if;
  update public.learner_plan_assignments
  set status = case when p_start then 'started' else 'dismissed' end, responded_at = now()
  where id = p_assignment_id;
  return v_assignment.plan_id;
end;
$$;

revoke all on function public.respond_to_learner_plan_assignment(uuid, boolean) from public, anon;
grant execute on function public.respond_to_learner_plan_assignment(uuid, boolean) to authenticated;

-- The caller's assigned or started organisation plans (optionally for one
-- organisation), with enough of each plan to decide whether to start it.
create or replace function public.list_my_learner_plan_assignments(p_organisation_id uuid default null)
returns table (
  id uuid,
  organisation_id uuid,
  organisation_name text,
  plan_id uuid,
  title text,
  description text,
  target_on date,
  step_count integer,
  status text,
  assigned_at timestamptz,
  responded_at timestamptz,
  progress_done integer,
  progress_total integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    assignment.id,
    assignment.organisation_id,
    organisation.name,
    plan.id,
    plan.title,
    plan.description,
    plan.target_on,
    (select count(*)::integer from public.learner_plan_items item where item.plan_id = plan.id and item.visibility = 'members'),
    assignment.status,
    assignment.created_at,
    assignment.responded_at,
    member.progress_done,
    member.progress_total
  from public.learner_plan_assignments assignment
  join public.learner_plans plan on plan.id = assignment.plan_id
  join public.organisations organisation on organisation.id = assignment.organisation_id
  left join public.learner_plan_members member
    on member.plan_id = plan.id and member.user_id = assignment.assigned_to
  where assignment.assigned_to = (select auth.uid())
    and assignment.status in ('assigned', 'started')
    and plan.status <> 'archived'
    and (p_organisation_id is null or assignment.organisation_id = p_organisation_id)
  order by assignment.status, assignment.created_at desc;
$$;

revoke all on function public.list_my_learner_plan_assignments(uuid) from public, anon;
grant execute on function public.list_my_learner_plan_assignments(uuid) to authenticated;

-- For an organisation plan's admins: everyone it's assigned to or who is on
-- it, with their full progress. Progress is shown only for people who are
-- still active members of the organisation.
create or replace function public.list_organisation_learner_plan_progress(p_plan_id uuid)
returns table (
  user_id uuid,
  name text,
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
  order by 2;
end;
$$;

revoke all on function public.list_organisation_learner_plan_progress(uuid) from public, anon;
grant execute on function public.list_organisation_learner_plan_progress(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Also: the learner workspace settings (0325) missed the impersonation
-- write guard and read boundary every application table has.
-- ---------------------------------------------------------------------------

create trigger prevent_admin_impersonation_write
  before insert or update or delete on public.organisation_learner_workspace_settings
  for each row execute function public.prevent_admin_impersonation_write();

create policy "Active impersonation sessions can read"
  on public.organisation_learner_workspace_settings as restrictive for select
  to authenticated
  using ((select public.admin_impersonation_session_can_read()));
