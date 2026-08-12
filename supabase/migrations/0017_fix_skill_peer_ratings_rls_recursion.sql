-- 0016 added a `skills` SELECT policy that subqueries skill_peer_ratings.
-- That collided with the existing "Skill owners can view ratings on their
-- skills" policy on skill_peer_ratings, which subqueried `skills` in the
-- other direction -- a circular RLS reference Postgres reports as
-- "infinite recursion detected in policy for relation skill_peer_ratings".
-- Fix by having that policy check the already-denormalized
-- skill_owner_id column directly instead of joining back to skills.
-- skill_owner_id is trustworthy: it's only ever set by the
-- security-definer accept_invite_and_rate() function, never directly by
-- users, so this is equivalent access, not a weaker check.
drop policy "Skill owners can view ratings on their skills" on skill_peer_ratings;

create policy "Skill owners can view ratings on their skills"
  on skill_peer_ratings for select
  using (auth.uid() = skill_owner_id);
