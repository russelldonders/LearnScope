-- Tightens organisation plans (0328) after review:
--
--   * Nobody becomes an owner of an organisation plan: its organisation's
--     current admins own it, and only while they are admins. (An admin could
--     otherwise make a member an owner, who would keep seeing everyone's
--     progress after leaving the organisation.)
--   * Progress on an organisation plan is the organisation's to see only
--     while the member belongs to it: admins no longer read it from the
--     members table or list_learner_plan_members (only from
--     list_organisation_learner_plan_progress, which already hides former
--     members), a former member's browser stops recording it, and it's
--     cleared when their membership ends.
--   * An organisation plan no longer belongs to the admin who made it: its
--     user_id is empty and its creator is kept in created_by, so deleting
--     that admin's account no longer deletes the organisation's plan.
--   * Admins of a deactivated organisation no longer count.
--   * Assignments: someone who started a plan and then left it can be
--     assigned it again; re-assigning keeps the original assignment date;
--     an archived plan can't be started; a response locks its row.
--   * Recording progress without step statuses keeps the last ones.
--
-- Data: Staging may hold organisation plans made since 0328; their creator
-- moves from user_id to created_by. Nothing else changes for existing rows.

-- ---------------------------------------------------------------------------
-- Creator
-- ---------------------------------------------------------------------------

alter table public.learner_plans
  add column created_by uuid references auth.users(id) on delete set null,
  alter column user_id drop not null;

-- The touch trigger would pin user_id and move updated_at; this backfill
-- changes neither what the learner did nor when.
alter table public.learner_plans disable trigger learner_plans_touch;

update public.learner_plans
set created_by = user_id, user_id = null
where organisation_id is not null;

update public.learner_plans set created_by = user_id where organisation_id is null;

alter table public.learner_plans enable trigger learner_plans_touch;

alter table public.learner_plans
  add constraint learner_plans_owner_kind_check
    check ((organisation_id is null) = (user_id is not null));

-- created_by is whoever made the plan, set here and never changed.
create or replace function private.stamp_learner_plan_creator()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce((select auth.uid()), new.user_id, new.created_by);
  else
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;

revoke all on function private.stamp_learner_plan_creator() from public, anon, authenticated;

create trigger learner_plans_stamp_creator
  before insert or update on public.learner_plans
  for each row execute function private.stamp_learner_plan_creator();

drop policy "Learners create their own plans" on public.learner_plans;
create policy "Learners create their own plans"
  on public.learner_plans for insert
  to authenticated
  with check (
    (organisation_id is null and user_id = (select auth.uid()))
    or (organisation_id is not null and user_id is null and private.is_learner_plan_org_admin(organisation_id))
  );

-- ---------------------------------------------------------------------------
-- Admins of an active organisation
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
    and exists (select 1 from public.organisations where id = p_organisation_id and status = 'active')
    and (
      public.is_employer_admin(p_organisation_id, (select auth.uid()))
      or public.is_org_admin(p_organisation_id, (select auth.uid()))
    );
$$;

-- ---------------------------------------------------------------------------
-- No owners on an organisation plan
-- ---------------------------------------------------------------------------

create or replace function private.refuse_organisation_plan_owners()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'owner'
     and exists (select 1 from public.learner_plans where id = new.plan_id and organisation_id is not null) then
    raise exception 'An organisation plan is owned by its organisation''s admins' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function private.refuse_organisation_plan_owners() from public, anon, authenticated;

create trigger learner_plan_members_refuse_organisation_owners
  before insert or update of role on public.learner_plan_members
  for each row execute function private.refuse_organisation_plan_owners();

-- ---------------------------------------------------------------------------
-- Progress only while a member of the organisation
-- ---------------------------------------------------------------------------

-- Owners of a personal plan see everyone on it; on an organisation plan each
-- person sees only their own row (admins use
-- list_organisation_learner_plan_progress).
drop policy "Members see themselves; owners see everyone on the plan" on public.learner_plan_members;
create policy "Members see themselves; owners see everyone on the plan"
  on public.learner_plan_members for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or plan_id in (
      select owned.plan_id
      from private.my_owned_learner_plan_ids() as owned(plan_id)
      join public.learner_plans plan on plan.id = owned.plan_id
      where plan.organisation_id is null
    )
  );

-- As 0303, for personal plans only.
create or replace function public.list_learner_plan_members(p_plan_id uuid)
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
  if exists (select 1 from public.learner_plans where id = p_plan_id and organisation_id is not null) then
    raise exception 'Use the organisation''s plan progress instead' using errcode = 'insufficient_privilege';
  end if;
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

-- As 0328, except that on an organisation plan nothing is recorded once the
-- caller has left the organisation, and leaving out `items` keeps the last
-- step statuses.
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
    if v_role is null then
      continue;
    end if;
    select organisation_id into v_organisation_id from public.learner_plans where id = v_plan_id;
    if v_organisation_id is not null and not public.is_employer_member(v_organisation_id, v_caller) then
      continue;
    end if;

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
      update public.learner_plan_members
      set progress_done = v_done, progress_total = v_total, progress_items = v_items, progress_updated_at = now()
      where plan_id = v_plan_id and user_id = v_caller
        and (progress_done, progress_total, progress_items) is distinct from (v_done, v_total, v_items);
    else
      update public.learner_plan_members
      set progress_done = v_done, progress_total = v_total, progress_updated_at = now()
      where plan_id = v_plan_id and user_id = v_caller
        and (progress_done, progress_total) is distinct from (v_done, v_total);
    end if;
    if v_role = 'follower' then
      return next v_plan_id;
    end if;
  end loop;
end;
$$;

-- When someone stops being an active member of an organisation, their
-- recorded progress on its plans is cleared.
create or replace function private.clear_former_member_plan_progress()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organisation_id uuid := coalesce(old.employer_id, new.employer_id);
  v_user_id uuid := coalesce(old.user_id, new.user_id);
begin
  if tg_op = 'DELETE' or (old.status = 'active' and new.status is distinct from 'active') then
    update public.learner_plan_members member
    set progress_done = null, progress_total = null, progress_items = null, progress_updated_at = null
    from public.learner_plans plan
    where plan.id = member.plan_id
      and plan.organisation_id = v_organisation_id
      and member.user_id = v_user_id;
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function private.clear_former_member_plan_progress() from public, anon, authenticated;

create trigger employer_members_clear_plan_progress
  after update of status or delete on public.employer_members
  for each row execute function private.clear_former_member_plan_progress();

-- ---------------------------------------------------------------------------
-- Assignments
-- ---------------------------------------------------------------------------

-- As 0328, plus: someone who started the plan and has since left it can be
-- assigned it again, and re-assigning keeps the original date.
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
      set status = 'assigned', responded_at = null, assigned_by = excluded.assigned_by
      where public.learner_plan_assignments.status in ('dismissed', 'started')
    returning 1
  )
  select count(*) into v_count from assigned;
  return v_count;
end;
$$;

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
  select * into v_assignment from public.learner_plan_assignments where id = p_assignment_id for update;
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
    if exists (select 1 from public.learner_plans where id = v_assignment.plan_id and status = 'archived') then
      raise exception 'This plan is no longer available' using errcode = 'check_violation';
    end if;
    perform private.join_learner_plan(v_assignment.plan_id, v_caller, null);
  end if;
  update public.learner_plan_assignments
  set status = case when p_start then 'started' else 'dismissed' end, responded_at = now()
  where id = p_assignment_id;
  return v_assignment.plan_id;
end;
$$;

-- As 0328, without plans the member started and has since left.
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
    and (assignment.status = 'assigned' or (assignment.status = 'started' and member.user_id is not null))
    and plan.status <> 'archived'
    and (p_organisation_id is null or assignment.organisation_id = p_organisation_id)
  order by assignment.status, assignment.created_at desc;
$$;
