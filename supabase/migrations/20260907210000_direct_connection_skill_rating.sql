-- Item 3: a global, learner-controlled toggle for whether connections can
-- rate a shared skill directly from the connection's skills profile view
-- (SkillsProfile.jsx), instead of only via an invite link/code
-- (accept_invite_and_rate, 0033). On by default, alongside the other
-- connection-visibility toggles already on `profiles` (skills_profile_visible,
-- profile_visible_to_skill_matches, activity_feed_visible).
alter table profiles
  add column allow_connection_skill_ratings boolean not null default true;

-- Mirrors accept_invite_and_rate's insert shape (skill_peer_ratings is
-- informational history only since 0033 -- no auto-level side effect here
-- either), but with no invite_id/share code: authorization instead rests on
-- the rater and skill owner being an actual connection, the skill being
-- visible on the owner's profile, and the owner's global rating opt-in.
create or replace function rate_connection_skill(p_skill_id uuid, p_level int, p_comments text)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_skill skills%rowtype;
  v_allow_ratings boolean;
  v_rater_name text;
  v_rater_email text;
  v_rating_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if p_level < 1 or p_level > 5 then
    raise exception 'Invalid level';
  end if;

  select * into v_skill from skills where id = p_skill_id and visible_on_profile = true;
  if not found then
    raise exception 'Skill not found';
  end if;
  if v_skill.user_id = auth.uid() then
    raise exception 'You can''t rate your own skill.';
  end if;
  if not is_connected(auth.uid(), v_skill.user_id) then
    raise exception 'You can only rate skills for a connection.';
  end if;

  select allow_connection_skill_ratings into v_allow_ratings from profiles where id = v_skill.user_id;
  if not coalesce(v_allow_ratings, false) then
    raise exception 'This person is not accepting ratings from connections right now.';
  end if;

  select full_name into v_rater_name from profiles where id = auth.uid();
  select email into v_rater_email from auth.users where id = auth.uid();

  insert into skill_peer_ratings (
    skill_id, skill_name, skill_category, skill_owner_id, rater_id, rater_name, rater_email, level, comments
  )
  values (
    v_skill.id, v_skill.name, v_skill.category, v_skill.user_id, auth.uid(), v_rater_name, v_rater_email,
    p_level, nullif(p_comments, '')
  )
  returning id into v_rating_id;

  return v_rating_id;
end;
$$;

revoke all on function rate_connection_skill(uuid, int, text) from public, anon;
grant execute on function rate_connection_skill(uuid, int, text) to authenticated;
