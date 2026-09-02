-- CRITICAL security fixes, found by independent security review of
-- 20260902220000 (per-skill employer data sharing) and 20260902230000
-- (employer skill suggestions), both already live on Staging before this
-- fix. Two real, exploitable gaps -- Supabase auto-grants ALL on every new
-- table/function to anon/authenticated by default, and both migrations
-- assumed (in comments, incorrectly) that omitting an explicit grant meant
-- no access existed. It doesn't; an explicit revoke is required.

-- ----------------------------------------------------------------------------
-- 1. set_employer_data_access_shared_skills was directly callable by ANYONE,
-- including unauthenticated (anon) callers, with no auth check and no
-- ownership check on p_request_id -- only p_skill_ids' ownership was
-- validated, which trivially passes for an empty array. Any caller could
-- pass any learner's employer_data_access_requests.id and silently wipe
-- their shared-skill set. Fixed with both a revoke (the actual fix -- this
-- function is only ever meant to be called internally by the security
-- definer RPCs below it, which already establish ownership) and, as
-- defense in depth, explicit auth/ownership checks inside the function
-- itself rather than trusting callers alone.
-- ----------------------------------------------------------------------------

create or replace function set_employer_data_access_shared_skills(p_request_id uuid, p_skill_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from employer_data_access_requests
    where id = p_request_id and learner_id = auth.uid()
  ) then
    raise exception 'Not authorized';
  end if;

  if exists (
    select 1 from unnest(p_skill_ids) as sid
    where not exists (select 1 from skills where id = sid and user_id = auth.uid())
  ) then
    raise exception 'One or more selected skills do not belong to you.';
  end if;

  delete from employer_data_access_shared_skills where request_id = p_request_id;

  insert into employer_data_access_shared_skills (request_id, skill_id)
  select distinct p_request_id, sid from unnest(p_skill_ids) as sid;
end;
$$;

revoke all on function set_employer_data_access_shared_skills(uuid, uuid[]) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. employer_skill_suggestions' column-grain `grant update (status)` never
-- actually narrowed anything -- the table's default GRANT ALL to
-- authenticated (applied automatically on creation) was never revoked, so
-- a learner could rewrite any column on their own row (employer_id,
-- skill_library_id, suggested_target_level, target_date, comments,
-- assigned_by), not just status. Mirrors the exact fix already applied to
-- course_assignments in 20260902190000 -- revoke the blanket grant first.
-- ----------------------------------------------------------------------------

revoke update on table employer_skill_suggestions from authenticated;
grant update (status) on table employer_skill_suggestions to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Defense-in-depth: the remaining employer-data-access RPCs each have
-- correct internal auth.uid()/ownership checks (so this isn't currently
-- exploitable, unlike #1 above), but were left reachable by anon due to the
-- same missing-revoke root cause. Close them off explicitly, consistent
-- with suggest_skill_to_employer_members's own pattern in the same batch
-- of work.
-- ----------------------------------------------------------------------------

revoke all on function decide_employer_data_access_request(uuid, boolean, uuid[]) from public, anon, authenticated;
grant execute on function decide_employer_data_access_request(uuid, boolean, uuid[]) to authenticated;

revoke all on function share_data_with_employer(uuid, uuid[]) from public, anon, authenticated;
grant execute on function share_data_with_employer(uuid, uuid[]) to authenticated;

revoke all on function update_shared_employer_skills(uuid, uuid[]) from public, anon, authenticated;
grant execute on function update_shared_employer_skills(uuid, uuid[]) to authenticated;

revoke all on function revoke_employer_data_access(uuid) from public, anon, authenticated;
grant execute on function revoke_employer_data_access(uuid) to authenticated;

revoke all on function is_skill_shared_with_employer(uuid, uuid) from public, anon, authenticated;
grant execute on function is_skill_shared_with_employer(uuid, uuid) to authenticated;
