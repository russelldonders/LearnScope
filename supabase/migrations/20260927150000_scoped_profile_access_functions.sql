-- Part 1 of 2 (see 20260927160000): functions that give scoped access to
-- profile columns other than identity, so the app can switch to them before
-- the column restriction lands. Additive only -- nothing is revoked here.

-- The learner's own full profile row (settings, preferences, location...).
-- Returns a set so PostgREST callers can still pick columns and use
-- .single(): supabase.rpc('get_my_profile').select('theme_preference').single()
create function public.get_my_profile()
returns setof public.profiles
language sql
stable
security definer
set search_path = public
as $$
  select * from public.profiles where id = auth.uid()
$$;

revoke all on function public.get_my_profile() from public, anon, authenticated;
grant execute on function public.get_my_profile() to authenticated;

-- Country/location as shown on someone's skills profile page: to the person
-- themselves, their connections, or someone they match through skill search
-- when they've opted into being visible to matches -- the same people the
-- skills profile itself is for. Anyone else gets no row.
create function public.get_profile_location(p_user_id uuid)
returns table (country text, location text)
language sql
stable
security definer
set search_path = public
as $$
  select p.country, p.location
  from public.profiles p
  where p.id = p_user_id
    and (
      p.id = auth.uid()
      or public.is_connected(auth.uid(), p.id)
      or (
        p.profile_visible_to_skill_matches
        and exists (
          select 1 from public.skills s
          where s.user_id = p.id
            and s.visible_on_profile
            and public.is_skill_search_match(auth.uid(), p.id, s.library_skill_id)
        )
      )
    )
$$;

revoke all on function public.get_profile_location(uuid) from public, anon, authenticated;
grant execute on function public.get_profile_location(uuid) to authenticated;

-- Platform admin console overview tile.
create function public.count_blocked_accounts()
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin(auth.uid()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return (select count(*) from public.profiles where account_status = 'blocked');
end;
$$;

revoke all on function public.count_blocked_accounts() from public, anon, authenticated;
grant execute on function public.count_blocked_accounts() to authenticated;
