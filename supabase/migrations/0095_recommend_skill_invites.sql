-- "Recommend this skill" reuses the exact same connection_invites/share_code
-- mechanism as the existing invite-to-rate flow, rather than a parallel
-- table -- the two are the same underlying concept (an invite, addressed to
-- an email or shared as a link, redeemed once via share_code) with a
-- different outcome on accept. invite_type distinguishes the two so each
-- accept path only ever consumes its own kind of invite.
alter table connection_invites add column invite_type text not null default 'rate'
  check (invite_type in ('rate', 'recommend'));

-- Replaces the pending-dedup index from 0032 -- a learner may reasonably
-- want to both ask someone to rate a skill AND recommend they pick it up
-- themselves, so the two invite types shouldn't collide on uniqueness.
drop index connection_invites_unique_pending_idx;
create unique index connection_invites_unique_pending_idx
  on connection_invites (skill_id, lower(invitee_email), invite_type)
  where status = 'pending' and invitee_email is not null;

-- Recommending a skill only makes sense for one that's tied to the shared
-- library catalog (see 0013) -- that's what lets the invitee's new skill
-- reference the same library_skill_id instead of a same-named duplicate.
-- Recorded here too, not just in the UI gate, so a stale/tampered share
-- link can't be used to invite a recommendation for a purely private skill.
-- Return shape gained a column (invite_type), which Postgres won't let a
-- plain create-or-replace apply to an existing function -- has to be
-- dropped and recreated instead.
drop function get_invite_preview(text);

create function get_invite_preview(p_code text)
returns table (
  skill_name text,
  skill_category text,
  inviter_name text,
  status text,
  invite_type text
)
language sql
security definer
set search_path = public
as $$
  select s.name, s.category, coalesce(p.full_name, ''), ci.status, ci.invite_type
  from connection_invites ci
  join skills s on s.id = ci.skill_id
  left join profiles p on p.id = ci.inviter_id
  where ci.share_code = p_code
$$;

grant execute on function get_invite_preview(text) to anon, authenticated;

-- Unchanged except for the added invite_type guard, so a recommend invite's
-- share_code can never be redeemed as a rating (or vice versa) even if
-- someone hand-edits the URL.
create or replace function accept_invite_and_rate(p_code text, p_level int, p_comments text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite connection_invites%rowtype;
  v_skill skills%rowtype;
  v_rater_name text;
  v_rater_email text;
  v_rating_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_invite from connection_invites where share_code = p_code for update;
  if not found then
    raise exception 'Invite not found';
  end if;
  if v_invite.invite_type != 'rate' then
    raise exception 'This invite is not a rating invite.';
  end if;
  if v_invite.status != 'pending' then
    raise exception 'This invite has already been used.';
  end if;
  if v_invite.inviter_id = auth.uid() then
    raise exception 'You can''t rate your own skill.';
  end if;
  if p_level < 1 or p_level > 5 then
    raise exception 'Invalid level';
  end if;

  select * into v_skill from skills where id = v_invite.skill_id;
  select full_name into v_rater_name from profiles where id = auth.uid();
  select email into v_rater_email from auth.users where id = auth.uid();

  insert into skill_peer_ratings (
    skill_id, skill_name, skill_category, skill_owner_id,
    invite_id, rater_id, rater_name, rater_email, level, comments
  )
  values (
    v_invite.skill_id, v_skill.name, v_skill.category, v_skill.user_id,
    v_invite.id, auth.uid(), v_rater_name, v_rater_email, p_level, nullif(p_comments, '')
  )
  returning id into v_rating_id;

  update connection_invites
  set status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
  where id = v_invite.id;

  update skills s
  set level = latest.level
  from (
    select level, ts from (
      select level, assessed_at as ts from skill_assessments where skill_id = v_invite.skill_id
      union all
      select level, rated_at as ts from skill_peer_ratings where skill_id = v_invite.skill_id
    ) combined
    order by ts desc
    limit 1
  ) latest
  where s.id = v_invite.skill_id;

  return v_rating_id;
end;
$$;

grant execute on function accept_invite_and_rate(text, int, text) to authenticated;

-- Recommending a skill hands the invitee their own skills row, not a rating
-- on the inviter's -- library_skill_id is carried across so it's the same
-- reusable catalog entry, not a same-named duplicate (see 0013). Mirrors the
-- "pick an existing library skill" path in FindSkillModal, just server-side
-- since the invitee otherwise has no way to read an invite addressed to
-- them (connection_invites' only SELECT policy is "inviter can view their
-- own", same reasoning as accept_invite_and_rate above).
create or replace function accept_invite_and_recommend(p_code text, p_tracking_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite connection_invites%rowtype;
  v_skill skills%rowtype;
  v_new_skill_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_invite from connection_invites where share_code = p_code for update;
  if not found then
    raise exception 'Invite not found';
  end if;
  if v_invite.invite_type != 'recommend' then
    raise exception 'This invite is not a skill recommendation.';
  end if;
  if v_invite.status != 'pending' then
    raise exception 'This invite has already been used.';
  end if;
  if v_invite.inviter_id = auth.uid() then
    raise exception 'You can''t recommend a skill to yourself.';
  end if;

  select * into v_skill from skills where id = v_invite.skill_id;
  if v_skill.library_skill_id is null then
    raise exception 'This skill can no longer be recommended.';
  end if;

  insert into skills (
    user_id, name, library_skill_id, tracking_reason, lifecycle_stage, source, is_current_role
  )
  values (
    auth.uid(), v_skill.name, v_skill.library_skill_id, p_tracking_reason, 'identified', 'recommend', false
  )
  returning id into v_new_skill_id;

  update connection_invites
  set status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
  where id = v_invite.id;

  return v_new_skill_id;
end;
$$;

grant execute on function accept_invite_and_recommend(text, text) to authenticated;

alter table skills drop constraint skills_source_check;
alter table skills add constraint skills_source_check
  check (source in ('manual', 'cv_import', 'recommend'));

-- Mirrors list_incoming_rate_invites (0061) exactly, scoped to the other
-- invite_type -- see there for why this needs SECURITY DEFINER rather than a
-- plain table select.
create or replace function list_incoming_recommend_invites()
returns table (
  id uuid,
  inviter_id uuid,
  inviter_name text,
  skill_id uuid,
  skill_name text,
  skill_category text,
  share_code text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select ci.id, ci.inviter_id, p.full_name, ci.skill_id, s.name, s.category, ci.share_code, ci.created_at
  from connection_invites ci
  join skills s on s.id = ci.skill_id
  left join profiles p on p.id = ci.inviter_id
  where ci.status = 'pending'
    and ci.invite_type = 'recommend'
    and ci.invitee_email is not null
    and lower(ci.invitee_email) = lower((select email from auth.users where id = auth.uid()))
  order by ci.created_at desc
$$;

grant execute on function list_incoming_recommend_invites() to authenticated;

-- Scope the existing rate-invite listing to its own type, now that
-- connection_invites carries both kinds -- otherwise a pending recommend
-- invite would incorrectly show up as "wants your rating".
create or replace function list_incoming_rate_invites()
returns table (
  id uuid,
  inviter_id uuid,
  inviter_name text,
  skill_id uuid,
  skill_name text,
  skill_category text,
  share_code text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select ci.id, ci.inviter_id, p.full_name, ci.skill_id, s.name, s.category, ci.share_code, ci.created_at
  from connection_invites ci
  join skills s on s.id = ci.skill_id
  left join profiles p on p.id = ci.inviter_id
  where ci.status = 'pending'
    and ci.invite_type = 'rate'
    and ci.invitee_email is not null
    and lower(ci.invitee_email) = lower((select email from auth.users where id = auth.uid()))
  order by ci.created_at desc
$$;

grant execute on function list_incoming_rate_invites() to authenticated;
