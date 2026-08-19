-- Centralizes two RLS checks that were duplicated verbatim across several
-- policies (a real drift risk -- a future policy could easily get the
-- subquery subtly wrong). Behavior-preserving: every existing call site
-- already only ever evaluates these with auth.uid() as one of the two
-- parties, so both functions are SECURITY INVOKER (the default -- no
-- `security definer`) and remain correctly scoped by the querying user's
-- own RLS on skill_peer_ratings/skill_validation_requests, exactly as the
-- inline subqueries were. No table, column, or data changes.

-- Whether two users are "connected" -- defined the same way it already is
-- everywhere else in the app: an existing skill_peer_ratings row between
-- them, in either direction.
create or replace function is_connected(a uuid, b uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from skill_peer_ratings spr
    where (spr.rater_id = a and spr.skill_owner_id = b)
       or (spr.rater_id = b and spr.skill_owner_id = a)
  )
$$;

grant execute on function is_connected(uuid, uuid) to authenticated;

-- Whether p_user_id is a validator for p_skill_id -- has a
-- skill_validation_requests row naming them validator_id on that skill,
-- pending or decided (matches the scoping already used by every "Validators
-- can view ... for skills they're validating" policy).
create or replace function is_skill_validator(p_skill_id uuid, p_user_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from skill_validation_requests svr
    where svr.skill_id = p_skill_id and svr.validator_id = p_user_id
  )
$$;

grant execute on function is_skill_validator(uuid, uuid) to authenticated;

-- skills: "Connections can view visible skills profiles" (0022)
drop policy "Connections can view visible skills profiles" on skills;
create policy "Connections can view visible skills profiles"
  on skills for select
  using (
    visible_on_profile = true
    and exists (
      select 1 from profiles p
      where p.id = skills.user_id
        and p.skills_profile_visible = true
    )
    and is_connected(auth.uid(), skills.user_id)
  );

-- skills: "Skills open to being asked to validate are discoverable" (0042)
drop policy "Skills open to being asked to validate are discoverable" on skills;
create policy "Skills open to being asked to validate are discoverable"
  on skills for select
  using (
    lifecycle_stage in ('validated', 'maintained')
    and (
      offer_validate_others = true
      or (offer_validate_connections = true and is_connected(auth.uid(), skills.user_id))
    )
  );

-- skills: "Validators can view skills they're validating" (0041)
drop policy "Validators can view skills they're validating" on skills;
create policy "Validators can view skills they're validating"
  on skills for select
  using (is_skill_validator(skills.id, auth.uid()));

-- skill_tags: "Connections can view tags on visible skills" (0024)
drop policy "Connections can view tags on visible skills" on skill_tags;
create policy "Connections can view tags on visible skills"
  on skill_tags for select
  using (
    exists (
      select 1 from skills s
      join profiles p on p.id = s.user_id
      where s.id = skill_tags.skill_id
        and s.visible_on_profile = true
        and p.skills_profile_visible = true
        and is_connected(auth.uid(), s.user_id)
    )
  );

-- skill_targets: "Validators can view targets for skills they're validating" (0041)
drop policy "Validators can view targets for skills they're validating" on skill_targets;
create policy "Validators can view targets for skills they're validating"
  on skill_targets for select
  using (is_skill_validator(skill_targets.skill_id, auth.uid()));

-- skill_assessments: "Validators can view assessments for skills they're validating" (0041)
drop policy "Validators can view assessments for skills they're validating" on skill_assessments;
create policy "Validators can view assessments for skills they're validating"
  on skill_assessments for select
  using (is_skill_validator(skill_assessments.skill_id, auth.uid()));

-- skill_peer_ratings: "Validators can view peer ratings for skills they're validating" (0041)
drop policy "Validators can view peer ratings for skills they're validating" on skill_peer_ratings;
create policy "Validators can view peer ratings for skills they're validating"
  on skill_peer_ratings for select
  using (is_skill_validator(skill_peer_ratings.skill_id, auth.uid()));

-- skill_course_links: "Validators can view course links for skills they're validating" (0041)
drop policy "Validators can view course links for skills they're validating" on skill_course_links;
create policy "Validators can view course links for skills they're validating"
  on skill_course_links for select
  using (is_skill_validator(skill_course_links.skill_id, auth.uid()));

-- xapi_statements: "Validators can view activity for skills they're validating" (0041)
-- skill_id is nullable on this table, so the not-null guard stays explicit.
drop policy "Validators can view activity for skills they're validating" on xapi_statements;
create policy "Validators can view activity for skills they're validating"
  on xapi_statements for select
  using (skill_id is not null and is_skill_validator(xapi_statements.skill_id, auth.uid()));

-- courses: "Validators can view courses linked to skills they're validating" (0044)
drop policy "Validators can view courses linked to skills they're validating" on courses;
create policy "Validators can view courses linked to skills they're validating"
  on courses for select
  using (
    exists (
      select 1 from skill_course_links scl
      where scl.course_id = courses.id
        and is_skill_validator(scl.skill_id, auth.uid())
    )
  );

-- skill_validation_requests: "Requesters can create requests for their own
-- skills, to eligible validators" (0041) -- only the nested connected-check
-- changes; the rest of the eligibility rule (skill ownership, matching
-- library_skill_id, validator's own level/stage, opt-in flag) is unchanged.
drop policy "Requesters can create requests for their own skills, to eligible validators" on skill_validation_requests;
create policy "Requesters can create requests for their own skills, to eligible validators"
  on skill_validation_requests for insert
  with check (
    auth.uid() = requester_id
    and exists (
      select 1 from skills req
      where req.id = skill_id and req.user_id = auth.uid()
    )
    and exists (
      select 1 from skills req
      join skills val on val.library_skill_id = req.library_skill_id
      where req.id = skill_id
        and val.user_id = validator_id
        and val.lifecycle_stage in ('validated', 'maintained')
        and val.level >= target_level
        and (
          val.offer_validate_others = true
          or (val.offer_validate_connections = true and is_connected(auth.uid(), validator_id))
        )
    )
  );

-- validator_directory (0041) -- recreated to use the helper; grants don't
-- survive a view drop, so the select grant is re-issued at the end.
drop view validator_directory;
create view validator_directory
  with (security_invoker = true)
as
select
  s.id as skill_id,
  s.user_id as validator_id,
  s.library_skill_id,
  s.level,
  s.lifecycle_stage,
  s.offer_validate_connections,
  s.offer_validate_others,
  p.full_name,
  p.avatar_url,
  is_connected(auth.uid(), s.user_id) as is_connection
from skills s
join profiles p on p.id = s.user_id
where s.lifecycle_stage in ('validated', 'maintained')
  and s.user_id != auth.uid()
  and (
    s.offer_validate_others = true
    or (s.offer_validate_connections = true and is_connected(auth.uid(), s.user_id))
  );

grant select on validator_directory to authenticated;
