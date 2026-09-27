-- "Authenticated users can view profile names" (0010) is `using (true)`, and
-- the table-level SELECT grant meant any signed-in user could read every
-- column of every learner's profile: location, country, language, account
-- status, user code, preferences and settings timestamps.
--
-- Other people's profiles are only ever needed for identity (name, avatar)
-- plus the three visibility/rating switches that RLS policies on skills and
-- skill_tags evaluate as the viewer. So the row policy stays as-is, but
-- column access for the authenticated role is narrowed to exactly those.
-- Everything else is reached through the SECURITY DEFINER functions added
-- in 20260927150000 (get_my_profile, get_profile_location,
-- count_blocked_accounts), each scoped to who is legitimately allowed to
-- see it. Part 2 of 2: applied only once the app no longer reads those
-- columns directly. No data changes; UPDATE/INSERT privileges untouched.

revoke select on table public.profiles from anon, authenticated;

grant select (
  id,
  full_name,
  first_name,
  last_name,
  avatar_url,
  skills_profile_visible,
  profile_visible_to_skill_matches,
  allow_connection_skill_ratings
) on table public.profiles to authenticated;
