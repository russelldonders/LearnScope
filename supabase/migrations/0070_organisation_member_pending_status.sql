-- Inviting an *existing* LearnScope user as org staff (api/admin/actions.js
-- inviteOrgStaff) previously granted access the moment the row was
-- inserted -- no consent step, since there's no Supabase Auth invite email
-- to accept for someone who already has an account. That let an org admin
-- silently enroll any existing user as staff purely by knowing their email,
-- conflicting with CLAUDE.md's "don't silently ... materially update
-- important learner information" principle. This adds a pending state,
-- mirroring the existing skill_validation_requests accept/decline pattern
-- (0041) rather than inventing a new shape: new-account invites (which
-- already require clicking the Supabase invite-email link -- a real
-- consent step) still insert straight to 'active'; existing-user invites
-- now insert 'pending' and only count as real membership once the invited
-- user accepts.

alter table organisation_members
  add column status text not null default 'active' check (status in ('pending', 'active'));

-- A pending row grants no access yet -- both membership-based branches now
-- also require it. Platform admins remain unconditional (unaffected by
-- either an org's or a member's status).
create or replace function is_org_admin(org_id uuid, check_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from organisation_members
    join organisations on organisations.id = organisation_members.organisation_id
    where organisation_members.organisation_id = org_id
      and organisation_members.user_id = check_user_id
      and organisation_members.role = 'admin'
      and organisation_members.status = 'active'
      and organisations.status = 'active'
  ) or is_platform_admin(check_user_id)
$$;

create or replace function is_org_member(org_id uuid, check_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from organisation_members
    join organisations on organisations.id = organisation_members.organisation_id
    where organisation_members.organisation_id = org_id
      and organisation_members.user_id = check_user_id
      and organisation_members.status = 'active'
      and organisations.status = 'active'
  ) or is_platform_admin(check_user_id)
$$;

-- is_org_member(...) above no longer covers a pending row (status isn't
-- 'active' yet), so without this, the invited user couldn't see their own
-- pending invite to decide on it -- a chicken-and-egg lockout. Any user can
-- always see their own membership rows, whatever their status.
create policy "Users can view their own organisation membership rows"
  on organisation_members for select
  to authenticated
  using (auth.uid() = user_id);

-- Runs as the invited user, same "security definer function performs the
-- one specific privileged action, after checking the caller is who they
-- claim to be" pattern as decide_validation_request (0041). Declining just
-- removes the row -- unlike a validation request, there's no reason to keep
-- a declined staff invite around as a historical record.
create or replace function decide_org_invite(p_member_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member organisation_members%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_member from organisation_members where id = p_member_id for update;
  if not found then
    raise exception 'Invitation not found';
  end if;
  if v_member.user_id != auth.uid() then
    raise exception 'Not authorized';
  end if;
  if v_member.status != 'pending' then
    raise exception 'This invitation has already been decided.';
  end if;

  if p_accept then
    update organisation_members set status = 'active' where id = p_member_id;
  else
    delete from organisation_members where id = p_member_id;
  end if;
end;
$$;

grant execute on function decide_org_invite(uuid, boolean) to authenticated;
