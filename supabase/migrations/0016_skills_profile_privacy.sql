-- Privacy setting: whether a learner's skills profile can be viewed by
-- people they're connected with (i.e. have exchanged a peer rating with),
-- via clicking their name on the Connections page. Off by default — this
-- is the first cross-user read of skills data in the schema, so access
-- must be explicit opt-in, never the default.
alter table profiles add column skills_profile_visible boolean not null default false;

-- Grants read access to another user's skills only when both are true:
--   1. that user has opted in (skills_profile_visible)
--   2. the viewer has an existing connection with them, defined the same
--      way the Connections page already defines it — a skill_peer_ratings
--      row linking the two accounts in either direction.
-- This is additive to (not a replacement for) the existing owner-only
-- policy from 0001_init.sql; Postgres RLS ORs together multiple permissive
-- SELECT policies, so the owner still always sees their own skills.
create policy "Connections can view visible skills profiles"
  on skills for select
  using (
    exists (
      select 1 from profiles p
      where p.id = skills.user_id
        and p.skills_profile_visible = true
    )
    and exists (
      select 1 from skill_peer_ratings spr
      where (spr.rater_id = auth.uid() and spr.skill_owner_id = skills.user_id)
         or (spr.rater_id = skills.user_id and spr.skill_owner_id = auth.uid())
    )
  );
