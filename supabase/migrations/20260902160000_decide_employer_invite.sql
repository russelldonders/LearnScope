-- Phase 2 of the employer domain concept (follows 20260902090000/
-- 20260902150000): proper invite-with-consent semantics for employer_members,
-- mirroring decide_org_invite (0070) exactly for the accept/decline
-- mechanics -- runs as the invited user, checks auth.uid() against the row's
-- user_id and that it's still 'pending', for update to avoid a races with a
-- second concurrent decide call.
--
-- The one addition beyond decide_org_invite's shape: accepting an 'admin'
-- employer_members invite also has to grant the matching organisation_members
-- admin row on the employer's attached provider organisation -- this is the
-- second half of Phase 1's eager grant (addEmployerMember,
-- api/admin/actions.js), which this phase splits by consent state. An
-- existing user hasn't agreed to anything at insert time (that's the whole
-- point of landing them 'pending' instead of 'active'), so granting
-- provider-console access then would let an employer admin hand out that
-- access to someone who hasn't accepted anything -- the grant has to wait
-- until they actually accept, here. (A brand-new account still gets the
-- grant immediately at insert time in addEmployerMember, since clicking the
-- Supabase invite email *is* their consent, same as the org-staff invite
-- flow's own reasoning.) Security definer is what makes this possible: the
-- function runs with the privileges to write organisation_members on the
-- invited user's own behalf during their own accept action -- same trust
-- boundary create_employer already relies on to provision cross-table
-- resources on a caller's behalf after verifying who they are.
create or replace function decide_employer_invite(p_member_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member employer_members%rowtype;
  v_provider_organisation_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_member from employer_members where id = p_member_id for update;
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
    update employer_members set status = 'active' where id = p_member_id;

    if v_member.role = 'admin' then
      select provider_organisation_id into v_provider_organisation_id
      from employers where id = v_member.employer_id;

      -- Same on-conflict shape as addEmployerMember's own upsert (Phase 1):
      -- never downgrade an existing organisation_members row for this
      -- person -- admin is the top role there, so overwriting role/status
      -- to admin/active on conflict is always a promotion or a no-op, never
      -- a demotion.
      insert into organisation_members (organisation_id, user_id, role, status, invited_by)
      values (v_provider_organisation_id, v_member.user_id, 'admin', 'active', v_member.invited_by)
      on conflict (organisation_id, user_id) do update
        set role = 'admin', status = 'active', invited_by = excluded.invited_by;
    end if;
  else
    delete from employer_members where id = p_member_id;
  end if;
end;
$$;

grant execute on function decide_employer_invite(uuid, boolean) to authenticated;
