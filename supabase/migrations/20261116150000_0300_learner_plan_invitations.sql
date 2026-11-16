-- A learner can invite existing connections to follow an independent copy
-- of one of their plans. The source remains private. Recipients see only the
-- invitation preview returned by the RPC below, and accepting creates new
-- learner-owned records so later progress never crosses account boundaries.

create table public.learner_plan_invitations (
  id uuid primary key default gen_random_uuid(),
  source_plan_id uuid not null references public.learner_plans(id) on delete cascade,
  inviter_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'revoked')),
  copied_plan_id uuid references public.learner_plans(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check (inviter_id <> recipient_id),
  check (
    (status = 'pending' and decided_at is null and copied_plan_id is null)
    or (status = 'accepted' and decided_at is not null and copied_plan_id is not null)
    or (status in ('declined', 'revoked') and decided_at is not null and copied_plan_id is null)
  )
);

create index learner_plan_invitations_inviter_plan_idx
  on public.learner_plan_invitations (inviter_id, source_plan_id, created_at desc);
create index learner_plan_invitations_recipient_status_idx
  on public.learner_plan_invitations (recipient_id, status, created_at desc);
create unique index learner_plan_invitations_pending_recipient_idx
  on public.learner_plan_invitations (source_plan_id, recipient_id)
  where status = 'pending';

alter table public.learner_plan_invitations enable row level security;

create policy "People view plan invitations they sent or received"
  on public.learner_plan_invitations for select
  to authenticated
  using (
    inviter_id = (select auth.uid())
    or recipient_id = (select auth.uid())
  );

revoke all on table public.learner_plan_invitations from public, anon, authenticated;
grant select on table public.learner_plan_invitations to authenticated;

-- Resolve one source skill to the recipient's own matching skill. Existing
-- library or same-named skills win; otherwise a private, unassessed skill is
-- created. This helper is private because its definer rights cross owners.
create or replace function private.resolve_invited_plan_skill(
  p_source_skill_id uuid,
  p_recipient_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.skills%rowtype;
  v_skill_id uuid;
begin
  if p_source_skill_id is null then
    return null;
  end if;

  select * into v_source
  from public.skills
  where id = p_source_skill_id;
  if not found then
    return null;
  end if;

  if v_source.library_skill_id is not null then
    select id into v_skill_id
    from public.skills
    where user_id = p_recipient_id
      and library_skill_id = v_source.library_skill_id
    order by date_added
    limit 1;
  end if;

  if v_skill_id is null then
    select id into v_skill_id
    from public.skills
    where user_id = p_recipient_id
      and lower(name) = lower(v_source.name)
    limit 1;
  end if;

  if v_skill_id is null then
    insert into public.skills (
      user_id, name, category, library_skill_id, source,
      lifecycle_stage, visible_on_profile
    ) values (
      p_recipient_id, v_source.name, coalesce(v_source.category, 'Other'),
      v_source.library_skill_id, 'manual', 'identified', false
    )
    returning id into v_skill_id;
  end if;

  return v_skill_id;
end;
$$;

revoke all on function private.resolve_invited_plan_skill(uuid, uuid)
  from public, anon, authenticated;

-- Only the plan owner can invite, and every recipient must still be one of
-- their connections at send time. An accepted invitation is not duplicated;
-- a declined/revoked one may be sent again later.
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
  v_caller uuid := (select auth.uid());
  v_recipient uuid;
  v_invitation_id uuid;
  v_created boolean;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if not exists (
    select 1 from public.learner_plans
    where id = p_plan_id and user_id = v_caller
  ) then
    raise exception 'Plan not found or not owned by you' using errcode = 'insufficient_privilege';
  end if;
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

    select invitation.id into v_invitation_id
    from public.learner_plan_invitations invitation
    where invitation.source_plan_id = p_plan_id
      and invitation.recipient_id = v_recipient
      and invitation.status in ('pending', 'accepted')
    order by invitation.created_at desc
    limit 1;
    v_created := false;

    if v_invitation_id is null then
      insert into public.learner_plan_invitations (
        source_plan_id, inviter_id, recipient_id
      ) values (
        p_plan_id, v_caller, v_recipient
      )
      returning id into v_invitation_id;
      v_created := true;
    end if;

    invitation_id := v_invitation_id;
    recipient_id := v_recipient;
    created := v_created;
    return next;
  end loop;
end;
$$;

revoke all on function public.invite_connections_to_learner_plan(uuid, uuid[])
  from public, anon;
grant execute on function public.invite_connections_to_learner_plan(uuid, uuid[])
  to authenticated;

-- The preview deliberately returns only invitation copy: no source plan id,
-- record ids, sections or items are exposed to the recipient.
create or replace function public.list_incoming_learner_plan_invitations()
returns table (
  id uuid,
  plan_title text,
  plan_description text,
  inviter_name text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    invitation.id,
    plan.title,
    plan.description,
    coalesce(nullif(btrim(profile.full_name), ''), 'A connection'),
    invitation.created_at
  from public.learner_plan_invitations invitation
  join public.learner_plans plan on plan.id = invitation.source_plan_id
  left join public.profiles profile on profile.id = invitation.inviter_id
  where invitation.recipient_id = (select auth.uid())
    and invitation.status = 'pending'
  order by invitation.created_at desc;
$$;

revoke all on function public.list_incoming_learner_plan_invitations()
  from public, anon;
grant execute on function public.list_incoming_learner_plan_invitations()
  to authenticated;

-- Accepting copies the source into a new private plan owned by the recipient.
-- Shared catalogue courses become (or reuse) their planned course; custom
-- courses are copied as planned records. Skills are matched/created privately.
-- Goals and link/video resources are copied onto those skills. A private file
-- resource cannot cross owners, so it becomes a checkable step naming it.
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
  v_source_plan public.learner_plans%rowtype;
  v_new_plan_id uuid;
  v_new_section_id uuid;
  v_section_map jsonb := '{}'::jsonb;
  v_new_skill_id uuid;
  v_new_course_id uuid;
  v_new_goal_id uuid;
  v_new_resource_id uuid;
  v_source_course public.courses%rowtype;
  v_source_goal public.skill_goals%rowtype;
  v_source_resource public.skill_resources%rowtype;
  v_step_title text;
  v_step_note text;
  section_row public.learner_plan_sections%rowtype;
  item_row public.learner_plan_items%rowtype;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  select * into v_invitation
  from public.learner_plan_invitations
  where id = p_invitation_id
  for update;

  if not found or v_invitation.recipient_id <> v_caller then
    raise exception 'Invitation not found' using errcode = 'insufficient_privilege';
  end if;
  if v_invitation.status <> 'pending' then
    raise exception 'Invitation has already been decided' using errcode = 'check_violation';
  end if;

  if not p_accept then
    update public.learner_plan_invitations
    set status = 'declined', decided_at = now()
    where id = v_invitation.id;
    return null;
  end if;

  select * into strict v_source_plan
  from public.learner_plans
  where id = v_invitation.source_plan_id;

  insert into public.learner_plans (
    user_id, title, description, starts_on, target_on, status
  ) values (
    v_caller, v_source_plan.title, v_source_plan.description,
    v_source_plan.starts_on, v_source_plan.target_on, 'planning'
  )
  returning id into v_new_plan_id;

  for section_row in
    select * from public.learner_plan_sections
    where plan_id = v_source_plan.id
    order by position, created_at
  loop
    insert into public.learner_plan_sections (plan_id, title, position, target_on)
    values (v_new_plan_id, section_row.title, section_row.position, section_row.target_on)
    returning id into v_new_section_id;
    v_section_map := v_section_map || jsonb_build_object(section_row.id::text, v_new_section_id::text);
  end loop;

  for item_row in
    select * from public.learner_plan_items
    where plan_id = v_source_plan.id
    order by position, created_at
  loop
    -- Records retain their previous value after a SELECT that finds no row,
    -- so clear optional source records on every iteration before fallbacks
    -- inspect them.
    v_source_resource := null;
    v_new_section_id := case
      when item_row.section_id is null then null
      else (v_section_map ->> item_row.section_id::text)::uuid
    end;

    if item_row.item_type = 'skill' and item_row.skill_id is not null then
      v_new_skill_id := private.resolve_invited_plan_skill(item_row.skill_id, v_caller);
      if v_new_skill_id is not null then
        insert into public.learner_plan_items (
          plan_id, section_id, position, item_type, skill_id, note, target_on,
          plan_knowledge_level, plan_practical_level
        ) values (
          v_new_plan_id, null, item_row.position, 'skill', v_new_skill_id,
          item_row.note, item_row.target_on,
          item_row.plan_knowledge_level, item_row.plan_practical_level
        );
        continue;
      end if;
    end if;

    if item_row.item_type = 'course' and item_row.course_id is not null then
      select * into v_source_course from public.courses where id = item_row.course_id;
      if found then
        v_new_course_id := null;
        if v_source_course.catalogue_course_id is not null then
          select id into v_new_course_id
          from public.courses
          where user_id = v_caller
            and catalogue_course_id = v_source_course.catalogue_course_id
          order by created_at desc
          limit 1;
        end if;
        if v_new_course_id is null then
          insert into public.courses (
            user_id, name, provider, duration, course_type,
            catalogue_course_id, status, planned_at
          ) values (
            v_caller, v_source_course.name, v_source_course.provider,
            v_source_course.duration, v_source_course.course_type,
            v_source_course.catalogue_course_id, 'planned', now()
          )
          returning id into v_new_course_id;
        end if;
        insert into public.learner_plan_items (
          plan_id, section_id, position, item_type, course_id, note, target_on
        ) values (
          v_new_plan_id, v_new_section_id, item_row.position, 'course',
          v_new_course_id, item_row.note, item_row.target_on
        );
        continue;
      end if;
    end if;

    if item_row.item_type = 'skill_goal' and item_row.skill_goal_id is not null then
      select * into v_source_goal from public.skill_goals where id = item_row.skill_goal_id;
      if found then
        v_new_skill_id := private.resolve_invited_plan_skill(v_source_goal.skill_id, v_caller);
        if v_new_skill_id is not null then
          insert into public.skill_goals (
            skill_id, original_text, title, metric, measure_kind, unit,
            direction, aggregation, period, target_value, target_date,
            started_on, tracker_question, log_every_days
          ) values (
            v_new_skill_id, v_source_goal.original_text, v_source_goal.title,
            v_source_goal.metric, v_source_goal.measure_kind, v_source_goal.unit,
            v_source_goal.direction, v_source_goal.aggregation, v_source_goal.period,
            v_source_goal.target_value, v_source_goal.target_date, current_date,
            v_source_goal.tracker_question, v_source_goal.log_every_days
          )
          returning id into v_new_goal_id;
          insert into public.learner_plan_items (
            plan_id, section_id, position, item_type, skill_goal_id, note, target_on
          ) values (
            v_new_plan_id, v_new_section_id, item_row.position, 'skill_goal',
            v_new_goal_id, item_row.note, item_row.target_on
          );
          continue;
        end if;
      end if;
    end if;

    if item_row.item_type = 'skill_resource' and item_row.skill_resource_id is not null then
      select * into v_source_resource from public.skill_resources where id = item_row.skill_resource_id;
      if found and v_source_resource.kind in ('link', 'video') then
        v_new_skill_id := private.resolve_invited_plan_skill(v_source_resource.skill_id, v_caller);
        if v_new_skill_id is not null then
          insert into public.skill_resources (
            user_id, skill_id, kind, title, url, note, audience
          ) values (
            v_caller, v_new_skill_id, v_source_resource.kind,
            v_source_resource.title, v_source_resource.url,
            v_source_resource.note, 'private'
          )
          returning id into v_new_resource_id;
          insert into public.learner_plan_items (
            plan_id, section_id, position, item_type, skill_resource_id, note, target_on
          ) values (
            v_new_plan_id, v_new_section_id, item_row.position, 'skill_resource',
            v_new_resource_id, item_row.note, item_row.target_on
          );
          continue;
        end if;
      end if;
    end if;

    -- Plain steps copy directly. Deleted references, private file resources,
    -- or an unresolvable skill/goal become a descriptive step rather than
    -- disappearing from the recipient's plan.
    v_step_title := case item_row.item_type
      when 'step' then item_row.step_title
      when 'skill' then coalesce(
        (select 'Develop ' || name from public.skills where id = item_row.skill_id),
        'Develop this skill'
      )
      when 'course' then coalesce(
        (select 'Complete ' || name from public.courses where id = item_row.course_id),
        'Complete this course'
      )
      when 'skill_goal' then coalesce(
        (select title from public.skill_goals where id = item_row.skill_goal_id),
        'Work towards this goal'
      )
      when 'skill_resource' then coalesce(
        (select 'Review ' || title from public.skill_resources where id = item_row.skill_resource_id),
        'Review this resource'
      )
      else 'Complete this plan item'
    end;
    v_step_note := item_row.note;
    if item_row.item_type = 'skill_resource' and v_source_resource.kind = 'file' then
      v_step_note := concat_ws(E'\n', v_step_note, 'Ask the inviter to share the private file separately.');
    end if;

    insert into public.learner_plan_items (
      plan_id, section_id, position, item_type, step_title, note, target_on,
      step_skill_id
    ) values (
      v_new_plan_id, v_new_section_id, item_row.position, 'step',
      left(v_step_title, 200), left(v_step_note, 1000), item_row.target_on,
      private.resolve_invited_plan_skill(item_row.step_skill_id, v_caller)
    );
  end loop;

  update public.learner_plan_invitations
  set status = 'accepted', decided_at = now(), copied_plan_id = v_new_plan_id
  where id = v_invitation.id;

  return v_new_plan_id;
end;
$$;

revoke all on function public.respond_to_learner_plan_invitation(uuid, boolean)
  from public, anon;
grant execute on function public.respond_to_learner_plan_invitation(uuid, boolean)
  to authenticated;

