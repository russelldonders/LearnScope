-- Peer ratings collected via an invite no longer silently roll the skill's
-- level forward -- ratings are informational history now; only an explicit
-- "Assess baseline" / "Evaluate Skill" action updates a skill's level.
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

  return v_rating_id;
end;
$$;

grant execute on function accept_invite_and_rate(text, int, text) to authenticated;
