-- Security review of 20260907210000 found a real gap: unlike the invite-based
-- accept_invite_and_rate flow (each rating gated behind a single-use invite
-- code the skill owner has to actively generate/send), the new direct-rate
-- path lets a connection call rate_connection_skill as many times as they
-- like with no server-side friction at all -- the only "already rated" guard
-- was the client's in-memory React state, trivially bypassed by calling the
-- RPC directly. That's a spam/harassment vector against someone the rater is
-- merely connected to.
--
-- Not fixed with a hard unique(skill_id, rater_id) constraint: skill_peer_
-- ratings is deliberately historical (0033 -- "ratings are informational
-- history now"), and the existing invite flow already allows the same rater
-- to rate the same skill again months later via a fresh invite. A permanent
-- one-rating-ever constraint would break that legitimate re-rating-over-time
-- case. A cooldown preserves it while closing the rapid-fire spam gap this
-- self-service path introduced.
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

  if exists (
    select 1 from skill_peer_ratings
    where skill_id = p_skill_id and rater_id = auth.uid() and rated_at > now() - interval '24 hours'
  ) then
    raise exception 'You already rated this skill recently. You can rate it again later.';
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
