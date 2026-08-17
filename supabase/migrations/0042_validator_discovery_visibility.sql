-- validator_directory (0041) is security_invoker, so it only ever returns
-- rows the querying user is independently allowed to SELECT from `skills`.
-- No existing policy covered that case -- only the owner, or a connection
-- when skills_profile_visible/visible_on_profile are both on -- so the view
-- always came back empty for a genuine unrelated validator candidate. This
-- adds the missing narrow policy: a skill is discoverable for validation
-- purposes once its owner has reached validated/maintained and opted in,
-- either broadly or to connections specifically (same connection definition
-- used everywhere else: an existing skill_peer_ratings row either way).
create policy "Skills open to being asked to validate are discoverable"
  on skills for select
  using (
    lifecycle_stage in ('validated', 'maintained')
    and (
      offer_validate_others = true
      or (
        offer_validate_connections = true
        and exists (
          select 1 from skill_peer_ratings spr
          where (spr.rater_id = auth.uid() and spr.skill_owner_id = skills.user_id)
             or (spr.rater_id = skills.user_id and spr.skill_owner_id = auth.uid())
        )
      )
    )
  );
