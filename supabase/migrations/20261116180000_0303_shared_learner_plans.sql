-- Shared plans. A plan is no longer copied for each person who joins: they
-- follow the owner's one plan, so changes its owners make reach everyone.
--
--   learner_plan_members        who is on a plan, as owner or follower. The
--                               creator (learner_plans.user_id) is always an
--                               owner; owners can make others owners
--                               ("co-owners"). Owners edit the plan, invite
--                               people and see everyone's progress;
--                               followers work through it.
--   learner_plan_item_links     a member's own record for an item that points
--                               at someone else's course, skill or goal. An
--                               item points at the records of whoever added
--                               it (added_by); everyone else's progress comes
--                               from their own matching course, skill or goal,
--                               made or matched when they join, or, for items
--                               added later, when they ask for it.
--   learner_plan_item_progress  each member's own ticks on steps and
--                               resources, and the activity each recorded.
--
-- A plan's skill targets (plan_knowledge_level / plan_practical_level) belong
-- to the plan, so they are the same for everyone on it.
--
-- Data: when this was written Staging had one plan, with no ticked items and
-- no accepted invitations, and Production had no plans. Ticks are still
-- moved to learner_plan_item_progress before their old columns go, and
-- invitation progress columns (0301) are dropped only because they were
-- never filled.

-- ---------------------------------------------------------------------------
-- Members
-- ---------------------------------------------------------------------------

create table public.learner_plan_members (
  plan_id uuid not null references public.learner_plans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'follower')),
  joined_at timestamptz not null default now(),
  invitation_id uuid references public.learner_plan_invitations(id) on delete set null,
  -- The member's progress (items done out of items counted), recorded by
  -- their own browser where it's worked out, for the owners to see.
  progress_done integer,
  progress_total integer,
  progress_updated_at timestamptz,
  primary key (plan_id, user_id),
  check (
    (progress_done is null and progress_total is null and progress_updated_at is null)
    or (
      progress_done is not null and progress_total is not null and progress_updated_at is not null
      and progress_total >= 0 and progress_done between 0 and progress_total
    )
  )
);

create index learner_plan_members_user_idx on public.learner_plan_members (user_id);

insert into public.learner_plan_members (plan_id, user_id, role, joined_at)
select id, user_id, 'owner', created_at from public.learner_plans;

-- The caller's role on a plan, or null. SECURITY DEFINER so policies can use
-- it without depending on (or recursing through) the members table's own.
create or replace function private.learner_plan_role(p_plan_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.learner_plan_members
  where plan_id = p_plan_id and user_id = (select auth.uid());
$$;

revoke all on function private.learner_plan_role(uuid) from public, anon;
grant execute on function private.learner_plan_role(uuid) to authenticated;
grant usage on schema private to authenticated;

-- Owner checks in the invitation functions (0302) now mean any owner.
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
  ) then
    raise exception 'Plan not found or not owned by you' using errcode = 'insufficient_privilege';
  end if;
  return v_caller;
end;
$$;

-- Whoever creates a plan owns it.
create or replace function private.add_learner_plan_creator()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.learner_plan_members (plan_id, user_id, role, joined_at)
  values (new.id, new.user_id, 'owner', new.created_at)
  on conflict do nothing;
  return new;
end;
$$;

revoke all on function private.add_learner_plan_creator() from public, anon, authenticated;

create trigger learner_plans_add_creator
  after insert on public.learner_plans
  for each row execute function private.add_learner_plan_creator();

alter table public.learner_plan_members enable row level security;

-- The plans the caller owns, worked out once per query rather than per row.
create or replace function private.my_owned_learner_plan_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select plan_id from public.learner_plan_members
  where user_id = (select auth.uid()) and role = 'owner';
$$;

revoke all on function private.my_owned_learner_plan_ids() from public, anon;
grant execute on function private.my_owned_learner_plan_ids() to authenticated;

create policy "Members see themselves; owners see everyone on the plan"
  on public.learner_plan_members for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or plan_id in (select private.my_owned_learner_plan_ids())
  );

revoke all on table public.learner_plan_members from public, anon, authenticated;
grant select on table public.learner_plan_members to authenticated;

-- ---------------------------------------------------------------------------
-- Who added each item
-- ---------------------------------------------------------------------------

alter table public.learner_plan_items
  add column added_by uuid references auth.users(id) on delete set null;

-- Every existing item was added by its plan's creator. Filled in without
-- the items' triggers, so updated_at still says when each was last changed.
alter table public.learner_plan_items disable trigger user;
update public.learner_plan_items item
set added_by = plan.user_id
from public.learner_plans plan
where plan.id = item.plan_id;
alter table public.learner_plan_items enable trigger user;

create index learner_plan_items_added_by_idx on public.learner_plan_items (added_by) where added_by is not null;

-- As 0297, except that an item's records are those of whoever added it (any
-- owner), and only they can point it at something else.
create or replace function public.check_learner_plan_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
  v_owner uuid;
begin
  if tg_op = 'INSERT' then
    new.added_by := coalesce(v_caller, new.added_by, (select user_id from public.learner_plans where id = new.plan_id));
  else
    -- An item never moves plan, changes type or changes who added it.
    new.plan_id := old.plan_id;
    new.item_type := old.item_type;
    new.added_by := old.added_by;
    if v_caller is distinct from old.added_by and (
      (new.course_id is not null and new.course_id is distinct from old.course_id)
      or (new.skill_id is not null and new.skill_id is distinct from old.skill_id)
      or (new.skill_goal_id is not null and new.skill_goal_id is distinct from old.skill_goal_id)
      or (new.skill_resource_id is not null and new.skill_resource_id is distinct from old.skill_resource_id)
      or (new.step_skill_id is not null and new.step_skill_id is distinct from old.step_skill_id)
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

-- ---------------------------------------------------------------------------
-- Each member's own ticks
-- ---------------------------------------------------------------------------

create table public.learner_plan_item_progress (
  item_id uuid not null references public.learner_plan_items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- When they ticked it off (the day they say, which may be earlier).
  completed_on date not null,
  -- The activity the tick recorded; cleared if that activity is deleted.
  completion_statement_id uuid references public.xapi_statements(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (item_id, user_id)
);

create index learner_plan_item_progress_user_idx on public.learner_plan_item_progress (user_id);
create index learner_plan_item_progress_statement_idx on public.learner_plan_item_progress (completion_statement_id)
  where completion_statement_id is not null;

-- Existing ticks become the creator's own. A tick with an activity but no
-- date takes the activity's day.
insert into public.learner_plan_item_progress (item_id, user_id, completed_on, completion_statement_id)
select item.id, plan.user_id,
  coalesce(item.completed_on, (select statement.recorded_at::date from public.xapi_statements statement where statement.id = item.completion_statement_id)),
  item.completion_statement_id
from public.learner_plan_items item
join public.learner_plans plan on plan.id = item.plan_id
where item.completed_on is not null
   or exists (select 1 from public.xapi_statements statement where statement.id = item.completion_statement_id);

-- Only drop the old columns if every tick in them was moved.
do $$
begin
  if exists (
    select 1 from public.learner_plan_items item
    where (item.completed_on is not null or item.completion_statement_id is not null)
      and not exists (select 1 from public.learner_plan_item_progress progress where progress.item_id = item.id)
  ) then
    raise exception 'Some plan ticks were not moved to learner_plan_item_progress; not dropping their columns';
  end if;
end;
$$;

alter table public.learner_plan_items
  drop column completed_on,
  drop column completion_statement_id;

-- Only steps and resources are ticked, only by someone on the plan, and only
-- with their own activity.
create or replace function private.check_learner_plan_item_progress()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.item_id := old.item_id;
    new.user_id := old.user_id;
  end if;
  if not exists (
    select 1 from public.learner_plan_items item
    join public.learner_plan_members member on member.plan_id = item.plan_id and member.user_id = new.user_id
    where item.id = new.item_id and item.item_type in ('skill_resource', 'step')
  ) then
    raise exception 'Only steps and resources on a plan you are on can be ticked off' using errcode = 'check_violation';
  end if;
  if new.completion_statement_id is not null
     and (tg_op = 'INSERT' or new.completion_statement_id is distinct from old.completion_statement_id)
     and not exists (select 1 from public.xapi_statements where id = new.completion_statement_id and user_id = new.user_id) then
    raise exception 'You can only link your own activities to a plan' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function private.check_learner_plan_item_progress() from public, anon, authenticated;

create trigger learner_plan_item_progress_check
  before insert or update on public.learner_plan_item_progress
  for each row execute function private.check_learner_plan_item_progress();

alter table public.learner_plan_item_progress enable row level security;

create policy "Members manage their own ticks"
  on public.learner_plan_item_progress for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on table public.learner_plan_item_progress from public, anon, authenticated;
grant select, insert, update, delete on table public.learner_plan_item_progress to authenticated;

-- ---------------------------------------------------------------------------
-- Each member's own records for items someone else added
-- ---------------------------------------------------------------------------

create table public.learner_plan_item_links (
  item_id uuid not null references public.learner_plan_items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  -- The member's skill for a skill item, a step's skill, or a resource's
  -- skill (so the activity a tick records is linked to their own skill).
  skill_id uuid references public.skills(id) on delete set null,
  skill_goal_id uuid references public.skill_goals(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (item_id, user_id)
);

create index learner_plan_item_links_user_idx on public.learner_plan_item_links (user_id);

alter table public.learner_plan_item_links enable row level security;

create policy "Members see their own item records"
  on public.learner_plan_item_links for select
  to authenticated
  using (user_id = (select auth.uid()));

revoke all on table public.learner_plan_item_links from public, anon, authenticated;
grant select on table public.learner_plan_item_links to authenticated;

-- When whoever added an item points it at a different record, everyone
-- else's records for it no longer match: they link it again when asked.
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
     or (new.step_skill_id is not null and new.step_skill_id is distinct from old.step_skill_id) then
    delete from public.learner_plan_item_links where item_id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function private.unlink_repointed_learner_plan_item() from public, anon, authenticated;

create trigger learner_plan_items_unlink_repointed
  after update on public.learner_plan_items
  for each row execute function private.unlink_repointed_learner_plan_item();

-- Matches or makes the member's own record for one item (as 0300's copy
-- did): a catalogue course they already have, or a planned course; their
-- matching skill, or a new private one; an active goal of the same title on
-- that skill, or a new one with the same definition starting today.
create or replace function private.link_learner_plan_item(p_item_id uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.learner_plan_items%rowtype;
  v_course public.courses%rowtype;
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

-- Whether an item still needs the member's own record (see get_my_learner_plans).
create or replace function private.learner_plan_item_needs_link(p_item public.learner_plan_items, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_item.added_by is distinct from p_user
    and (
      p_item.item_type in ('course', 'skill', 'skill_goal', 'skill_resource')
      or (p_item.item_type = 'step' and p_item.step_skill_id is not null)
    )
    and not exists (
      select 1 from public.learner_plan_item_links link
      where link.item_id = p_item.id and link.user_id = p_user
    );
$$;

revoke all on function private.learner_plan_item_needs_link(public.learner_plan_items, uuid) from public, anon, authenticated;

-- The caller asks for their own records for every item on a plan that needs
-- one: on joining, and for items added since. Returns how many were linked.
create or replace function public.link_learner_plan_items_for_me(p_plan_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_item public.learner_plan_items%rowtype;
  v_count integer := 0;
begin
  if v_caller is null or private.learner_plan_role(p_plan_id) is null then
    raise exception 'Plan not found' using errcode = 'insufficient_privilege';
  end if;
  for v_item in
    select * from public.learner_plan_items where plan_id = p_plan_id order by position, created_at
  loop
    if private.learner_plan_item_needs_link(v_item, v_caller) then
      perform private.link_learner_plan_item(v_item.id, v_caller);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- Joining: becomes a follower (never changing someone already on the plan)
-- and gets their own records for its items.
create or replace function private.join_learner_plan(p_plan_id uuid, p_user uuid, p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item_id uuid;
begin
  insert into public.learner_plan_members (plan_id, user_id, role, invitation_id)
  values (p_plan_id, p_user, 'follower', p_invitation_id)
  on conflict (plan_id, user_id) do nothing;
  for v_item_id in
    select id from public.learner_plan_items where plan_id = p_plan_id order by position, created_at
  loop
    perform private.link_learner_plan_item(v_item_id, p_user);
  end loop;
end;
$$;

revoke all on function private.join_learner_plan(uuid, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Who can do what with a plan
-- ---------------------------------------------------------------------------

drop policy "Learners manage their own plans" on public.learner_plans;
drop policy "Learners manage their own plan sections" on public.learner_plan_sections;
drop policy "Learners manage their own plan items" on public.learner_plan_items;

-- The plans the caller is on, worked out once per query rather than per row
-- (as my_owned_learner_plan_ids above).
create or replace function private.my_learner_plan_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select plan_id from public.learner_plan_members where user_id = (select auth.uid());
$$;

revoke all on function private.my_learner_plan_ids() from public, anon;
grant execute on function private.my_learner_plan_ids() to authenticated;

create policy "Members see their plans"
  on public.learner_plans for select
  to authenticated
  using (user_id = (select auth.uid()) or id in (select private.my_learner_plan_ids()));
create policy "Learners create their own plans"
  on public.learner_plans for insert
  to authenticated
  with check (user_id = (select auth.uid()));
create policy "Owners change their plans"
  on public.learner_plans for update
  to authenticated
  using (id in (select private.my_owned_learner_plan_ids()))
  with check (id in (select private.my_owned_learner_plan_ids()));
create policy "Only the creator deletes a plan"
  on public.learner_plans for delete
  to authenticated
  using (user_id = (select auth.uid()));

create policy "Members see their plans' sections"
  on public.learner_plan_sections for select
  to authenticated
  using (plan_id in (select private.my_learner_plan_ids()));
create policy "Owners add plan sections"
  on public.learner_plan_sections for insert
  to authenticated
  with check (plan_id in (select private.my_owned_learner_plan_ids()));
create policy "Owners change plan sections"
  on public.learner_plan_sections for update
  to authenticated
  using (plan_id in (select private.my_owned_learner_plan_ids()))
  with check (plan_id in (select private.my_owned_learner_plan_ids()));
create policy "Owners remove plan sections"
  on public.learner_plan_sections for delete
  to authenticated
  using (plan_id in (select private.my_owned_learner_plan_ids()));

create policy "Members see their plans' items"
  on public.learner_plan_items for select
  to authenticated
  using (plan_id in (select private.my_learner_plan_ids()));
create policy "Owners add plan items"
  on public.learner_plan_items for insert
  to authenticated
  with check (plan_id in (select private.my_owned_learner_plan_ids()));
create policy "Owners change plan items"
  on public.learner_plan_items for update
  to authenticated
  using (plan_id in (select private.my_owned_learner_plan_ids()))
  with check (plan_id in (select private.my_owned_learner_plan_ids()));
create policy "Owners remove plan items"
  on public.learner_plan_items for delete
  to authenticated
  using (plan_id in (select private.my_owned_learner_plan_ids()));

-- A plan's share link is for its owners, whoever made it (0302 limited it
-- to whoever made it, who may since have stopped being an owner).
drop policy "Owners view their plans' share links" on public.learner_plan_share_links;
create policy "Owners view their plans' share links"
  on public.learner_plan_share_links for select
  to authenticated
  using (plan_id in (select private.my_owned_learner_plan_ids()));

-- ---------------------------------------------------------------------------
-- Reading plans as the viewer sees them
-- ---------------------------------------------------------------------------

-- The caller's plans (or one of them), shaped as the app reads plans: each
-- plan with its sections and items, every item's references and records
-- being the caller's own (their linked course, skill and goal, their ticks).
-- Others' records appear only as an item's title, the details of a
-- resource's link, and source_title for an item the caller hasn't linked
-- yet; a private file resource's path only to whoever added it.
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
        'step_title', refs.step_title,
        'step_skill_id', refs.r_step_skill_id,
        'completion_statement_id', refs.my_statement_id,
        'note', refs.note,
        'target_on', refs.target_on,
        'completed_on', refs.my_completed_on,
        'plan_knowledge_level', refs.plan_knowledge_level,
        'plan_practical_level', refs.plan_practical_level,
        'created_at', refs.created_at,
        'is_author', refs.is_author,
        'needs_link', refs.needs_link,
        'source_title', case when not refs.needs_link then null else case refs.item_type
          when 'course' then (select c.name from public.courses c where c.id = refs.course_id)
          when 'skill' then (select s.name from public.skills s where s.id = refs.skill_id)
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
        'is_creator', p.user_id = (select auth.uid()),
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

revoke all on function public.get_my_learner_plans(uuid) from public, anon;
grant execute on function public.get_my_learner_plans(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Joining, by connection invitation, email or link
-- ---------------------------------------------------------------------------

create or replace function public.invite_connections_to_learner_plan(
  p_plan_id uuid,
  p_recipient_ids uuid[]
)
returns table (invitation_id uuid, recipient_id uuid, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := private.assert_plan_owner(p_plan_id);
  v_recipient uuid;
  v_invitation_id uuid;
  v_created boolean;
begin
  if coalesce(cardinality(p_recipient_ids), 0) = 0 then
    raise exception 'Choose at least one connection' using errcode = 'check_violation';
  end if;

  for v_recipient in
    select distinct value from unnest(p_recipient_ids) as ids(value)
  loop
    if v_recipient = v_caller or not exists (
      select 1
      from public.connections connection
      where connection.user_a_id = least(v_caller, v_recipient)
        and connection.user_b_id = greatest(v_caller, v_recipient)
    ) then
      raise exception 'Plans can only be invited to your connections' using errcode = 'insufficient_privilege';
    end if;

    v_invitation_id := null;
    v_created := false;
    -- Someone already on the plan isn't invited again.
    if not exists (
      select 1 from public.learner_plan_members member
      where member.plan_id = p_plan_id and member.user_id = v_recipient
    ) then
      select invitation.id into v_invitation_id
      from public.learner_plan_invitations invitation
      where invitation.source_plan_id = p_plan_id
        and invitation.recipient_id = v_recipient
        and invitation.status = 'pending'
      order by invitation.created_at desc
      limit 1;

      if v_invitation_id is null then
        insert into public.learner_plan_invitations (source_plan_id, inviter_id, recipient_id)
        values (p_plan_id, v_caller, v_recipient)
        returning id into v_invitation_id;
        v_created := true;
      end if;
    end if;

    invitation_id := v_invitation_id;
    recipient_id := v_recipient;
    created := v_created;
    return next;
  end loop;
end;
$$;

create or replace function public.respond_to_learner_plan_invitation(
  p_invitation_id uuid,
  p_accept boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_invitation public.learner_plan_invitations%rowtype;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  select * into v_invitation
  from public.learner_plan_invitations
  where id = p_invitation_id
  for update;

  if not found or v_invitation.recipient_id is distinct from v_caller then
    raise exception 'Invitation not found' using errcode = 'insufficient_privilege';
  end if;
  if v_invitation.status <> 'pending' then
    raise exception 'Invitation has already been decided' using errcode = 'check_violation';
  end if;

  if p_accept and not exists (
    select 1 from public.learner_plan_members
    where plan_id = v_invitation.source_plan_id and user_id = v_invitation.inviter_id and role = 'owner'
  ) then
    raise exception 'This invitation is no longer valid' using errcode = 'check_violation';
  end if;

  if not p_accept then
    update public.learner_plan_invitations
    set status = 'declined', decided_at = now()
    where id = v_invitation.id;
    return null;
  end if;

  perform private.join_learner_plan(v_invitation.source_plan_id, v_caller, v_invitation.id);
  update public.learner_plan_invitations
  set status = 'accepted', decided_at = now()
  where id = v_invitation.id;

  return v_invitation.source_plan_id;
end;
$$;

-- Status for a signed-in caller: own_plan for an owner, joined (with the
-- plan's id) for someone already following it.
create or replace function public.get_learner_plan_invite_preview(p_code text)
returns table (
  kind text,
  status text,
  plan_title text,
  plan_description text,
  item_count integer,
  inviter_name text,
  joined_plan_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_caller uuid := (select auth.uid());
  v_plan_id uuid;
  v_owner uuid;
  v_kind text;
  v_status text;
  v_role text;
begin
  select 'email', invitation.source_plan_id, invitation.inviter_id,
    case invitation.status when 'pending' then 'open' when 'revoked' then 'revoked' else 'used' end
  into v_kind, v_plan_id, v_owner, v_status
  from public.learner_plan_invitations invitation
  where invitation.share_code = p_code and invitation.via = 'email';

  if v_plan_id is null then
    select 'link', link.plan_id, link.owner_id,
      case when link.revoked_at is null then 'open' else 'revoked' end
    into v_kind, v_plan_id, v_owner, v_status
    from public.learner_plan_share_links link
    where link.share_code = p_code;
  end if;

  if v_plan_id is null then
    return;
  end if;

  kind := v_kind;
  status := v_status;
  joined_plan_id := null;
  if v_caller is not null then
    select member.role into v_role
    from public.learner_plan_members member
    where member.plan_id = v_plan_id and member.user_id = v_caller;
    if v_role = 'owner' then
      status := 'own_plan';
    elsif v_role = 'follower' then
      status := 'joined';
      joined_plan_id := v_plan_id;
    end if;
  end if;

  -- A used or replaced code says only that, unless the caller is on the plan.
  if status in ('used', 'revoked') then
    return next;
    return;
  end if;

  select plan.title, plan.description,
    (select count(*)::integer from public.learner_plan_items item where item.plan_id = plan.id),
    coalesce(nullif(btrim(profile.full_name), ''), 'A LearnScope user')
  into plan_title, plan_description, item_count, inviter_name
  from public.learner_plans plan
  left join public.profiles profile on profile.id = v_owner
  where plan.id = v_plan_id;

  return next;
end;
$$;

create or replace function public.accept_learner_plan_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_invitation public.learner_plan_invitations%rowtype;
  v_link public.learner_plan_share_links%rowtype;
  v_plan_id uuid;
  v_owner uuid;
  v_invitation_id uuid;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  select * into v_invitation
  from public.learner_plan_invitations
  where share_code = p_code and via = 'email'
  for update;

  if found then
    v_plan_id := v_invitation.source_plan_id;
    v_owner := v_invitation.inviter_id;
  else
    select * into v_link
    from public.learner_plan_share_links
    where share_code = p_code
    for update;
    if not found then
      raise exception 'Invitation not found' using errcode = 'insufficient_privilege';
    end if;
    v_plan_id := v_link.plan_id;
    v_owner := v_link.owner_id;
  end if;

  if exists (
    select 1 from public.learner_plan_members
    where plan_id = v_plan_id and user_id = v_caller and role = 'owner'
  ) then
    raise exception 'This is your own plan' using errcode = 'check_violation';
  end if;
  -- Already following it: nothing to do.
  if exists (
    select 1 from public.learner_plan_members where plan_id = v_plan_id and user_id = v_caller
  ) then
    return v_plan_id;
  end if;

  if v_invitation.id is not null then
    if v_invitation.status <> 'pending' then
      raise exception 'This invitation has already been used' using errcode = 'check_violation';
    end if;
    if not exists (
      select 1 from public.learner_plan_members
      where plan_id = v_plan_id and user_id = v_owner and role = 'owner'
    ) then
      raise exception 'This invitation is no longer valid' using errcode = 'check_violation';
    end if;
    update public.learner_plan_invitations
    set recipient_id = v_caller, status = 'accepted', decided_at = now()
    where id = v_invitation.id;
    v_invitation_id := v_invitation.id;
  else
    if v_link.revoked_at is not null then
      raise exception 'This link has been replaced and no longer works' using errcode = 'check_violation';
    end if;
    insert into public.learner_plan_invitations (
      source_plan_id, inviter_id, recipient_id, via, share_link_id, status, decided_at
    ) values (
      v_plan_id, v_owner, v_caller, 'link', v_link.id, 'accepted', now()
    )
    returning id into v_invitation_id;
  end if;

  perform private.join_learner_plan(v_plan_id, v_caller, v_invitation_id);

  -- A connection invitation still waiting for the same plan is answered too.
  update public.learner_plan_invitations
  set status = 'accepted', decided_at = now()
  where source_plan_id = v_plan_id
    and recipient_id = v_caller
    and status = 'pending';

  return v_plan_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Members: leaving, roles, the owners' list, recording progress
-- ---------------------------------------------------------------------------

-- What happens when someone stops being an owner of a plan (made a
-- follower, leaving or removed): invitations they sent that are still
-- waiting are withdrawn, so only current owners decide who joins.
create or replace function private.withdraw_learner_plan_invitations_from(p_plan_id uuid, p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.learner_plan_invitations
  set status = 'revoked', decided_at = now()
  where source_plan_id = p_plan_id and inviter_id = p_user and status = 'pending';
$$;

revoke all on function private.withdraw_learner_plan_invitations_from(uuid, uuid) from public, anon, authenticated;

-- Taking someone off a plan (leaving, or removed by an owner): their ticks
-- and the links to their own records go; the records themselves, and the
-- activities their ticks recorded, stay theirs. Items they added stay on the
-- plan but stop pointing at their records, so nothing of theirs is shown to
-- (or copied for) anyone on it afterwards; members who already linked those
-- items keep their own records for them.
create or replace function private.take_off_learner_plan(p_plan_id uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.withdraw_learner_plan_invitations_from(p_plan_id, p_user);
  update public.learner_plan_items
  set course_id = null, skill_id = null, skill_goal_id = null, skill_resource_id = null, step_skill_id = null
  where plan_id = p_plan_id and added_by = p_user
    and (course_id is not null or skill_id is not null or skill_goal_id is not null
         or skill_resource_id is not null or step_skill_id is not null);
  delete from public.learner_plan_item_progress progress
  using public.learner_plan_items item
  where item.id = progress.item_id and item.plan_id = p_plan_id and progress.user_id = p_user;
  delete from public.learner_plan_item_links link
  using public.learner_plan_items item
  where item.id = link.item_id and item.plan_id = p_plan_id and link.user_id = p_user;
  delete from public.learner_plan_members where plan_id = p_plan_id and user_id = p_user;
end;
$$;

revoke all on function private.take_off_learner_plan(uuid, uuid) from public, anon, authenticated;

-- Anyone but the creator can leave.
create or replace function public.leave_learner_plan(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
begin
  if v_caller is null or private.learner_plan_role(p_plan_id) is null then
    raise exception 'Plan not found' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.learner_plans where id = p_plan_id and user_id = v_caller) then
    raise exception 'You created this plan, so you can delete it but not leave it' using errcode = 'check_violation';
  end if;
  perform private.take_off_learner_plan(p_plan_id, v_caller);
end;
$$;

-- An owner takes someone else off the plan, e.g. someone who joined with a
-- forwarded link. Never the creator.
create or replace function public.remove_learner_plan_member(p_plan_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := private.assert_plan_owner(p_plan_id);
begin
  if p_user_id = v_caller then
    raise exception 'To take yourself off the plan, leave it' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.learner_plans where id = p_plan_id and user_id = p_user_id) then
    raise exception 'The person who created the plan cannot be removed from it' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.learner_plan_members where plan_id = p_plan_id and user_id = p_user_id) then
    raise exception 'They are not on this plan' using errcode = 'check_violation';
  end if;
  perform private.take_off_learner_plan(p_plan_id, p_user_id);
end;
$$;

-- Any owner withdraws any invitation to the plan still waiting, whoever sent
-- it (0302 let only its sender).
create or replace function public.withdraw_learner_plan_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation public.learner_plan_invitations%rowtype;
begin
  select * into v_invitation
  from public.learner_plan_invitations
  where id = p_invitation_id
  for update;
  if not found then
    raise exception 'Invitation not found' using errcode = 'insufficient_privilege';
  end if;
  perform private.assert_plan_owner(v_invitation.source_plan_id);
  if v_invitation.status <> 'pending' then
    raise exception 'Only an invitation still waiting can be withdrawn' using errcode = 'check_violation';
  end if;
  update public.learner_plan_invitations
  set status = 'revoked', decided_at = now()
  where id = v_invitation.id;
end;
$$;

-- An owner makes someone on the plan an owner, or an owner a follower. The
-- creator always stays an owner.
create or replace function public.set_learner_plan_member_role(p_plan_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_plan_owner(p_plan_id);
  if p_role not in ('owner', 'follower') then
    raise exception 'Unknown role' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.learner_plans where id = p_plan_id and user_id = p_user_id) then
    raise exception 'The person who created the plan is always an owner' using errcode = 'check_violation';
  end if;
  update public.learner_plan_members
  set role = p_role
  where plan_id = p_plan_id and user_id = p_user_id;
  if not found then
    raise exception 'They are not on this plan' using errcode = 'check_violation';
  end if;
  if p_role = 'follower' then
    perform private.withdraw_learner_plan_invitations_from(p_plan_id, p_user_id);
  end if;
end;
$$;

-- For owners: everyone on the plan (role, whether they created it, progress)
-- and every invitation not (or no longer) matched by someone on it -- waiting,
-- declined, withdrawn, or accepted by someone who has since left.
drop function public.list_learner_plan_members(uuid);

create function public.list_learner_plan_members(p_plan_id uuid)
returns table (
  user_id uuid,
  invitation_id uuid,
  name text,
  role text,
  is_creator boolean,
  status text,
  via text,
  invited_at timestamptz,
  joined_at timestamptz,
  progress_done integer,
  progress_total integer,
  progress_updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_caller uuid := private.assert_plan_owner(p_plan_id);
begin
  return query
  select
    member.user_id,
    member.invitation_id,
    coalesce(nullif(btrim(profile.full_name), ''), 'A LearnScope user'),
    member.role,
    member.user_id = plan.user_id,
    'member'::text,
    coalesce(invitation.via, 'creator'),
    invitation.created_at,
    member.joined_at,
    member.progress_done,
    member.progress_total,
    member.progress_updated_at
  from public.learner_plan_members member
  join public.learner_plans plan on plan.id = member.plan_id
  left join public.profiles profile on profile.id = member.user_id
  left join public.learner_plan_invitations invitation on invitation.id = member.invitation_id
  where member.plan_id = p_plan_id

  union all

  select * from (
    select distinct on (coalesce(invitation.recipient_id::text, 'email:' || lower(invitation.invitee_email)))
      invitation.recipient_id,
      invitation.id,
      case
        when invitation.recipient_id is null then invitation.invitee_email
        else coalesce(nullif(btrim(profile.full_name), ''), 'A LearnScope user')
      end,
      null::text,
      false,
      case when invitation.status = 'accepted' then 'left' else invitation.status end,
      invitation.via,
      invitation.created_at,
      null::timestamptz,
      null::integer,
      null::integer,
      null::timestamptz
    from public.learner_plan_invitations invitation
    left join public.profiles profile on profile.id = invitation.recipient_id
    where invitation.source_plan_id = p_plan_id
      and not exists (
        select 1 from public.learner_plan_members member
        where member.plan_id = p_plan_id and member.user_id = invitation.recipient_id
      )
    order by coalesce(invitation.recipient_id::text, 'email:' || lower(invitation.invitee_email)),
      invitation.created_at desc
  ) invitations;
end;
$$;

revoke all on function public.list_learner_plan_members(uuid) from public, anon;
grant execute on function public.list_learner_plan_members(uuid) to authenticated;

-- Each member records their own progress on plans they're on, for the
-- owners to see; the time only moves on when the figures change. Returns
-- the plans, of those given, that the caller follows (their progress is
-- shared with its owners, so the page says so).
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
      update public.learner_plan_members
      set progress_done = v_done, progress_total = v_total, progress_updated_at = now()
      where plan_id = v_plan_id and user_id = v_caller
        and (progress_done, progress_total) is distinct from (v_done, v_total);
      if v_role = 'follower' then
        return next v_plan_id;
      end if;
    end if;
  end loop;
end;
$$;

revoke all on function public.link_learner_plan_items_for_me(uuid) from public, anon;
revoke all on function public.leave_learner_plan(uuid) from public, anon;
revoke all on function public.remove_learner_plan_member(uuid, uuid) from public, anon;
grant execute on function public.remove_learner_plan_member(uuid, uuid) to authenticated;
revoke all on function public.set_learner_plan_member_role(uuid, uuid, text) from public, anon;
grant execute on function public.link_learner_plan_items_for_me(uuid) to authenticated;
grant execute on function public.leave_learner_plan(uuid) to authenticated;
grant execute on function public.set_learner_plan_member_role(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- No longer used: copies (0300/0302) and progress on invitations (0301)
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from public.learner_plan_invitations where progress_done is not null) then
    raise exception 'Invitation progress (0301) holds data; move it before dropping its columns';
  end if;
end;
$$;

drop function private.copy_learner_plan_for(uuid, uuid);
drop trigger learner_plan_invitations_clear_progress_without_copy on public.learner_plan_invitations;
drop function private.clear_plan_progress_without_copy();
alter table public.learner_plan_invitations
  drop constraint learner_plan_invitations_progress_check,
  drop column progress_done,
  drop column progress_total,
  drop column progress_updated_at;

-- Reads of invitations, as 0302, without the dropped columns.
revoke select on table public.learner_plan_invitations from authenticated;
grant select (
  id, source_plan_id, inviter_id, recipient_id, status, copied_plan_id,
  created_at, decided_at, via, share_link_id
) on table public.learner_plan_invitations to authenticated;
