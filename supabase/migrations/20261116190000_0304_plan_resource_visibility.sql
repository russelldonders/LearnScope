-- Who in a plan can see a resource on it (shared plans, 0303): only whoever
-- added it, all of the plan's owners, or everyone on the plan (the
-- default, and what every existing item keeps).
--
--   learner_plan_items.visibility  'private' | 'owners' | 'members'; only a
--                                  resource item can be anything but
--                                  'members'.
--
-- An item someone may not see is left out everywhere for them: reading the
-- table, get_my_learner_plans, ticking it, linking their own records for it
-- (on joining or later), and the invitation preview's item count. Whoever
-- added an item always sees it.

alter table public.learner_plan_items
  add column visibility text not null default 'members'
    check (visibility in ('private', 'owners', 'members')),
  add constraint learner_plan_items_visibility_type_check
    check (visibility = 'members' or item_type = 'skill_resource');

drop policy "Members see their plans' items" on public.learner_plan_items;
create policy "Members see their plans' items"
  on public.learner_plan_items for select
  to authenticated
  using (
    plan_id in (select private.my_learner_plan_ids())
    and (
      visibility = 'members'
      or added_by = (select auth.uid())
      or (visibility = 'owners' and plan_id in (select private.my_owned_learner_plan_ids()))
    )
  );

create or replace function private.learner_plan_item_needs_link(p_item public.learner_plan_items, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_item.added_by is distinct from p_user
    and (p_item.visibility = 'members' or (p_item.visibility = 'owners' and exists (
      select 1 from public.learner_plan_members owner_member
      where owner_member.plan_id = p_item.plan_id and owner_member.user_id = p_user and owner_member.role = 'owner'
    )))
    and (
      p_item.item_type in ('course', 'skill', 'skill_goal', 'skill_resource')
      or (p_item.item_type = 'step' and p_item.step_skill_id is not null)
    )
    and not exists (
      select 1 from public.learner_plan_item_links link
      where link.item_id = p_item.id and link.user_id = p_user
    );
$$;


create or replace function private.join_learner_plan(p_plan_id uuid, p_user uuid, p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.learner_plan_items%rowtype;
begin
  insert into public.learner_plan_members (plan_id, user_id, role, invitation_id)
  values (p_plan_id, p_user, 'follower', p_invitation_id)
  on conflict (plan_id, user_id) do nothing;
  -- Only items they can see (0304).
  for v_item in
    select * from public.learner_plan_items where plan_id = p_plan_id order by position, created_at
  loop
    if private.learner_plan_item_needs_link(v_item, p_user) then
      perform private.link_learner_plan_item(v_item.id, p_user);
    end if;
  end loop;
end;
$$;


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
      and (item.visibility = 'members' or item.added_by is not distinct from new.user_id or (item.visibility = 'owners' and member.role = 'owner'))
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
    (select count(*)::integer from public.learner_plan_items item where item.plan_id = plan.id and item.visibility = 'members'),
    coalesce(nullif(btrim(profile.full_name), ''), 'A LearnScope user')
  into plan_title, plan_description, item_count, inviter_name
  from public.learner_plans plan
  left join public.profiles profile on profile.id = v_owner
  where plan.id = v_plan_id;

  return next;
end;
$$;


-- Who sees a resource is the choice of whoever added it: another owner can
-- neither open someone's "owners only" resource to everyone nor hide it.
create or replace function private.guard_learner_plan_item_visibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.visibility is distinct from old.visibility
     and (select auth.uid()) is distinct from old.added_by then
    raise exception 'Only the person who added this resource can change who sees it' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_learner_plan_item_visibility() from public, anon, authenticated;

create trigger learner_plan_items_guard_visibility
  before update of visibility on public.learner_plan_items
  for each row execute function private.guard_learner_plan_item_visibility();

-- As 0303, plus: resources the person kept from others on the plan (only
-- them, or only owners) go with them, rather than staying behind where
-- nobody on the plan could see or remove them.
create or replace function private.take_off_learner_plan(p_plan_id uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.withdraw_learner_plan_invitations_from(p_plan_id, p_user);
  delete from public.learner_plan_items
  where plan_id = p_plan_id and added_by = p_user and visibility <> 'members';
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
