-- Lets a learner choosing a validator see what that validator's own skill
-- rests on: confirmed by another person (an accepted validation request), or
-- only an AI check that moved it into the maintaining phase. Eligibility is
-- unchanged -- requiring person-confirmed validators would leave nobody able
-- to validate the first learner -- this only makes the basis visible.
--
-- validator_directory is a security_invoker view and requesters can't read
-- other people's validation requests, so the answer comes from a narrow
-- SECURITY DEFINER helper. It returns a boolean only for a skill the caller
-- can already see in the directory (same discoverability rule as the view);
-- for anything else it returns null, so it can't be used to probe other
-- skills. search_path is public because is_connected names its tables
-- unqualified.

create function private.validator_skill_person_confirmed(p_skill_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.skill_validation_requests v
    where v.skill_id = s.id and v.status = 'confirmed'
  )
  from public.skills s
  where s.id = p_skill_id
    and s.lifecycle_stage in ('validated', 'maintained')
    and s.user_id <> (select auth.uid())
    and (s.offer_validate_others
      or (s.offer_validate_connections and public.is_connected((select auth.uid()), s.user_id)))
$$;

revoke all on function private.validator_skill_person_confirmed(uuid) from public, anon;
grant execute on function private.validator_skill_person_confirmed(uuid) to authenticated;

create or replace view public.validator_directory
with (security_invoker = true)
as
select s.id as skill_id,
  s.user_id as validator_id,
  s.library_skill_id,
  s.level,
  s.lifecycle_stage,
  s.offer_validate_connections,
  s.offer_validate_others,
  p.full_name,
  p.avatar_url,
  is_connected(auth.uid(), s.user_id) as is_connection,
  coalesce(private.validator_skill_person_confirmed(s.id), false) as person_confirmed
from skills s
join profiles p on p.id = s.user_id
where s.lifecycle_stage = any (array['validated'::text, 'maintained'::text])
  and s.user_id <> auth.uid()
  and (s.offer_validate_others = true or s.offer_validate_connections = true and is_connected(auth.uid(), s.user_id));
