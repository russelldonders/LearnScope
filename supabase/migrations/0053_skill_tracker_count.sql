-- Anonymous, count-only lookup for "how many people (across all users, not
-- just connections) track this same skill" -- used by the new statistics
-- section on the skill page. Deliberately returns only an integer, never
-- rows: this is the one place in the schema that aggregates across users
-- without requiring their skills_profile_visible/visible_on_profile opt-in,
-- since a bare count can't identify anyone. SECURITY DEFINER so it can see
-- every user's skills rows for the count, bypassing the normal per-row RLS
-- that would otherwise restrict this to the caller's own + opted-in
-- connections' skills.
create or replace function count_skill_trackers(p_library_skill_id uuid)
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select count(distinct user_id)::integer
  from skills
  where library_skill_id = p_library_skill_id
$$;

grant execute on function count_skill_trackers(uuid) to authenticated;
