-- Security review of 0058 found three real gaps, fixed here:
--
-- 1. CRITICAL: the "Recipients can accept or decline" UPDATE policy on
-- connection_requests only constrains recipient_id to stay equal to
-- auth.uid() -- RLS can gate which rows are updatable, not which columns
-- change, so a recipient could `update ... set status='accepted',
-- requester_id='<anyone>'` and the sync trigger would upsert a connection
-- between the attacker and a victim who never sent or saw the request.
-- Fixed by removing client UPDATE entirely and routing accept/decline
-- through a SECURITY DEFINER RPC (same shape as accept_invite_and_rate in
-- 0010_connections.sql) that only ever touches status/decided_at on a row
-- the caller is actually the recipient of. The INSERT policy is also
-- tightened so a requester can't insert a row pre-marked 'accepted' to
-- fabricate history.
--
-- 2. HIGH: the "Skill-search matches can view opted-in profiles" policy
-- never checked visible_on_profile, unlike the equivalent 0016 connections
-- policy -- once profile_visible_to_skill_matches was on, a skill-search
-- match could read every skill row for that user via the API directly,
-- not just the ones marked visible_on_profile (SkillsProfile.jsx's
-- .eq('visible_on_profile', true) filter is a query convenience, not an
-- enforced boundary).
--
-- 3. MEDIUM: that same policy only checked "viewer tracks some skill with
-- the same library_skill_id", not whether the owner had actually opted
-- that specific skill into search the way list_skill_matches requires --
-- so profile_visible_to_skill_matches alone (without ever using selective
-- mode to include anything) still exposed the profile to anyone sharing
-- any skill, contradicting the setting's own description.
-- ----------------------------------------------------------------------------

-- --- Fix 1: connection_requests ---

drop policy "Recipients can accept or decline" on connection_requests;
drop trigger connection_requests_sync_connection on connection_requests;
drop function sync_connection_from_request();

drop policy "Users can send a connection request" on connection_requests;
create policy "Users can send a connection request"
  on connection_requests for insert
  with check (auth.uid() = requester_id and status = 'pending');

create or replace function respond_to_connection_request(p_request_id uuid, p_accept boolean)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_request connection_requests%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_request from connection_requests where id = p_request_id for update;
  if not found then
    raise exception 'Request not found';
  end if;
  if v_request.recipient_id <> auth.uid() then
    raise exception 'Not authorized to respond to this request';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'This request has already been decided.';
  end if;

  update connection_requests
  set status = case when p_accept then 'accepted' else 'declined' end,
      decided_at = now()
  where id = p_request_id;

  if p_accept then
    perform upsert_connection(v_request.requester_id, v_request.recipient_id, 'request');
  end if;
end;
$$;

grant execute on function respond_to_connection_request(uuid, boolean) to authenticated;

-- --- Fix 2 + 3: skill-search matches policy ---

create or replace function is_skill_search_match(p_viewer_id uuid, p_skill_owner_id uuid, p_library_skill_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    p_library_skill_id is not null
    and exists (
      select 1 from skills v
      where v.user_id = p_viewer_id and v.library_skill_id = p_library_skill_id
    )
    and exists (
      select 1 from skills o
      join profiles po on po.id = o.user_id
      where o.user_id = p_skill_owner_id
        and o.library_skill_id = p_library_skill_id
        and (
          po.skill_search_visibility = 'all'
          or (
            po.skill_search_visibility = 'selective'
            and exists (
              select 1 from profile_searchable_skills pss
              where pss.profile_id = o.user_id and pss.skill_id = o.id
            )
          )
        )
    )
$$;

grant execute on function is_skill_search_match(uuid, uuid, uuid) to authenticated;

drop policy "Skill-search matches can view opted-in profiles" on skills;
create policy "Skill-search matches can view opted-in profiles"
  on skills for select
  using (
    skills.visible_on_profile = true
    and exists (
      select 1 from profiles p
      where p.id = skills.user_id and p.profile_visible_to_skill_matches = true
    )
    and is_skill_search_match(auth.uid(), skills.user_id, skills.library_skill_id)
  );

-- has_matching_library_skill (0059) is superseded by is_skill_search_match,
-- which checks actual search opt-in rather than just a shared library id.
drop function has_matching_library_skill(uuid, uuid);
