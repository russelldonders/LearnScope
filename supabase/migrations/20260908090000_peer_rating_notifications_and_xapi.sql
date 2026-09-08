-- Item 1+3 from the connection-rating notification request:
--   1. A skill owner should see a bell notification when a connection rates
--      one of their skills.
--   2. That rating should also land as a proper xAPI statement in each
--      side's own activity stream, not only as a skill_peer_ratings row.
--
-- seen_at tracks whether the *owner* has viewed a rating they received --
-- nullable, set once via mark_peer_ratings_seen() (below) rather than a
-- plain client update, since skill_peer_ratings has never had an
-- insert/update policy for regular users (see 0017's comment: "No insert/
-- update policy... both only change via accept_invite_and_rate()"). This
-- keeps that invariant -- the only new way to mutate a row is another
-- narrow SECURITY DEFINER function, not a general table grant.
alter table skill_peer_ratings add column seen_at timestamptz;

create or replace function mark_peer_ratings_seen()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  update skill_peer_ratings
  set seen_at = now()
  where skill_owner_id = auth.uid() and seen_at is null;
end;
$$;

revoke all on function mark_peer_ratings_seen() from public, anon;
grant execute on function mark_peer_ratings_seen() to authenticated;

-- rate_connection_skill (20260907220000) now also writes an xAPI-shaped
-- statement into xapi_statements under the *skill owner's own* user_id, so
-- the rating shows up in their own /activity feed and Dashboard "Skill
-- activity" widget -- not just as a skill_peer_ratings row. Only the
-- owner's copy needs to happen here (as the security-definer function
-- writing across the auth.uid()/user_id boundary, the same way
-- accept_invite_and_rate already writes skill_owner_id rows for someone
-- else); the rater's own copy is inserted client-side in rateConnectionSkill
-- (src/lib/connections.js) using the existing buildStatement() helper,
-- since that write stays within the rater's own row and needs no elevated
-- privilege.
--
-- Tagged with a `peer-rating` result extension (mirrors isDiagnosticStatement's
-- existing pattern) so SkillDetail.jsx's practical-evidence/Up-Next
-- calculations can exclude it -- skill_peer_ratings already independently
-- counts as "Confirmed" trust evidence for the owner (see
-- computeTrustStatus), so counting this statement too would let a
-- connection's rating silently tick off the owner's own "Record an
-- activity" milestone, which they never did.
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
  v_owner_name text;
  v_owner_email text;
  v_rating_id uuid;
  v_statement jsonb;
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
  select full_name into v_owner_name from profiles where id = v_skill.user_id;
  select email into v_owner_email from auth.users where id = v_skill.user_id;

  insert into skill_peer_ratings (
    skill_id, skill_name, skill_category, skill_owner_id, rater_id, rater_name, rater_email, level, comments
  )
  values (
    v_skill.id, v_skill.name, v_skill.category, v_skill.user_id, auth.uid(), v_rater_name, v_rater_email,
    p_level, nullif(p_comments, '')
  )
  returning id into v_rating_id;

  v_statement := jsonb_build_object(
    'id', gen_random_uuid(),
    'actor', jsonb_build_object(
      'objectType', 'Agent',
      'name', v_rater_name,
      'mbox', case when v_rater_email is not null then 'mailto:' || v_rater_email else null end
    ),
    'verb', jsonb_build_object(
      'id', 'https://learnscope.app/xapi/verbs/rated',
      'display', jsonb_build_object('en-US', 'Rated')
    ),
    'object', jsonb_build_object(
      'id', 'https://learnscope.app/activities/skill-' || v_skill.id || '/peer-rating',
      'objectType', 'Activity',
      'definition', jsonb_build_object(
        'name', jsonb_build_object('en-US', v_skill.name),
        'description', jsonb_build_object(
          'en-US',
          coalesce(v_rater_name, 'A connection') || ' rated this skill ' || p_level || '/5.'
            || case when nullif(p_comments, '') is not null then ' "' || p_comments || '"' else '' end
        )
      )
    ),
    'timestamp', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'result', jsonb_build_object(
      'extensions', jsonb_build_object(
        'https://learnscope.app/xapi/extensions/peer-rating',
        jsonb_build_object('level', p_level, 'raterId', auth.uid(), 'raterName', v_rater_name)
      )
    ),
    'context', jsonb_build_object(
      'extensions', jsonb_build_object(
        'https://learnscope.app/xapi/extensions/skill',
        jsonb_build_array(jsonb_build_object('id', v_skill.id, 'name', v_skill.name))
      )
    )
  );

  insert into xapi_statements (user_id, statement, recorded_at, skill_id)
  values (v_skill.user_id, v_statement, now(), v_skill.id);

  return v_rating_id;
end;
$$;

revoke all on function rate_connection_skill(uuid, int, text) from public, anon;
grant execute on function rate_connection_skill(uuid, int, text) to authenticated;
