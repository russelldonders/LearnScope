-- Plan owners can see how far the people they invited have got through their
-- own copies of the plan ("Manage users" on the plan page).
--
-- Accepting an invitation shares progress with the inviter: only how many of
-- the copied plan's items are done out of how many count, and when that was
-- last worked out. No notes, evidence, records or item details cross over.
--
-- Progress is worked out in the recipient's browser (planProgress.js, which
-- reads goal progress from their own activities), so the recipient's client
-- records a snapshot here whenever it works it out. It is the recipient's own
-- progress, written only by them, and only onto their accepted invitation.
--
-- No invitation had been accepted on Staging when this was written, and
-- Production did not yet have invitations, so nobody accepted under the
-- earlier "progress is not shared" wording.

alter table public.learner_plan_invitations
  add column progress_done integer,
  add column progress_total integer,
  add column progress_updated_at timestamptz,
  add constraint learner_plan_invitations_progress_check check (
    (progress_done is null and progress_total is null and progress_updated_at is null)
    or (
      progress_done is not null and progress_total is not null and progress_updated_at is not null
      and progress_total >= 0 and progress_done between 0 and progress_total
    )
  );

-- A recipient deleting their copy set copied_plan_id to null, which the
-- accepted-row check rejected, so the delete failed. An accepted invitation
-- whose copy was deleted keeps status accepted with no copy.
alter table public.learner_plan_invitations
  drop constraint learner_plan_invitations_check1;
alter table public.learner_plan_invitations
  add constraint learner_plan_invitations_decision_check check (
    (status = 'pending' and decided_at is null and copied_plan_id is null)
    or (status = 'accepted' and decided_at is not null)
    or (status in ('declined', 'revoked') and decided_at is not null and copied_plan_id is null)
  );

-- Whether two people are still connected (connections stores each pair once,
-- lowest id first).
create or replace function private.are_connected(p_one uuid, p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.connections connection
    where connection.user_a_id = least(p_one, p_other)
      and connection.user_b_id = greatest(p_one, p_other)
  );
$$;

revoke all on function private.are_connected(uuid, uuid) from public, anon, authenticated;

-- A recipient who deletes their copy stops sharing: the last figures go too.
create or replace function private.clear_plan_progress_without_copy()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.copied_plan_id is null then
    new.progress_done := null;
    new.progress_total := null;
    new.progress_updated_at := null;
  end if;
  return new;
end;
$$;

revoke all on function private.clear_plan_progress_without_copy() from public, anon, authenticated;

create trigger learner_plan_invitations_clear_progress_without_copy
  before update of copied_plan_id on public.learner_plan_invitations
  for each row execute function private.clear_plan_progress_without_copy();

-- Sharing only lasts while the two are connected. When they disconnect (0293,
-- or an account deletion), progress already shared is cleared and an
-- invitation still waiting is withdrawn, so it can't be accepted afterwards
-- (respond_to_learner_plan_invitation only answers pending ones). Recipients
-- keep their copies. Follows 0294's pattern.
create or replace function private.stop_plan_sharing_on_disconnect()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.learner_plan_invitations invitation
  set status = case when invitation.status = 'pending' then 'revoked' else invitation.status end,
      decided_at = case when invitation.status = 'pending' then now() else invitation.decided_at end,
      progress_done = null,
      progress_total = null,
      progress_updated_at = null
  where (invitation.inviter_id = old.user_a_id and invitation.recipient_id = old.user_b_id)
     or (invitation.inviter_id = old.user_b_id and invitation.recipient_id = old.user_a_id);
  return old;
end;
$$;

revoke all on function private.stop_plan_sharing_on_disconnect() from public, anon, authenticated;

create trigger connections_stop_plan_sharing
  after delete on public.connections
  for each row execute function private.stop_plan_sharing_on_disconnect();

-- The recipient records their progress on plans they accepted, while still
-- connected to the inviter. Plans that weren't copied from an invitation are
-- ignored. The time is only moved on when the figures change, so it says when
-- progress last changed, not when the learner last opened the page. Returns
-- the ids of the given plans whose progress is shared, so the page can say so.
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
  v_invitation_id uuid;
  v_done integer;
  v_total integer;
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

    -- Only the caller's own accepted invitation for their own copy, and only
    -- while still connected to whoever sent it.
    v_invitation_id := null;
    select invitation.id into v_invitation_id
    from public.learner_plan_invitations invitation
    join public.learner_plans plan
      on plan.id = invitation.copied_plan_id and plan.user_id = v_caller
    where invitation.copied_plan_id = v_plan_id
      and invitation.recipient_id = v_caller
      and invitation.status = 'accepted'
      and private.are_connected(invitation.inviter_id, v_caller)
    limit 1;

    if v_invitation_id is not null then
      update public.learner_plan_invitations
      set progress_done = v_done,
          progress_total = v_total,
          progress_updated_at = now()
      where id = v_invitation_id
        and (progress_done, progress_total) is distinct from (v_done, v_total);
      return next v_plan_id;
    end if;
  end loop;
end;
$$;

revoke all on function public.record_learner_plan_progress(jsonb) from public, anon;
grant execute on function public.record_learner_plan_progress(jsonb) to authenticated;

-- Everyone the owner has invited to a plan: the latest invitation per person,
-- their name, where it stands, whether they're still connected, and their
-- shared progress (cleared once they disconnect). Owner only.
create or replace function public.list_learner_plan_members(p_plan_id uuid)
returns table (
  invitation_id uuid,
  recipient_id uuid,
  recipient_name text,
  status text,
  invited_at timestamptz,
  decided_at timestamptz,
  plan_removed boolean,
  connected boolean,
  progress_done integer,
  progress_total integer,
  progress_updated_at timestamptz
)
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
    select 1 from public.learner_plans
    where id = p_plan_id and user_id = v_caller
  ) then
    raise exception 'Plan not found or not owned by you' using errcode = 'insufficient_privilege';
  end if;

  return query
  select distinct on (invitation.recipient_id)
    invitation.id,
    invitation.recipient_id,
    coalesce(nullif(btrim(profile.full_name), ''), 'A connection'),
    invitation.status,
    invitation.created_at,
    invitation.decided_at,
    invitation.status = 'accepted' and invitation.copied_plan_id is null,
    private.are_connected(v_caller, invitation.recipient_id),
    invitation.progress_done,
    invitation.progress_total,
    invitation.progress_updated_at
  from public.learner_plan_invitations invitation
  left join public.profiles profile on profile.id = invitation.recipient_id
  where invitation.source_plan_id = p_plan_id
    and invitation.inviter_id = v_caller
  order by invitation.recipient_id, invitation.created_at desc;
end;
$$;

revoke all on function public.list_learner_plan_members(uuid) from public, anon;
grant execute on function public.list_learner_plan_members(uuid) to authenticated;
