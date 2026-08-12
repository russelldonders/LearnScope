-- Per-skill visibility on the skills profile (0016), on top of the
-- existing account-level opt-in (profiles.skills_profile_visible).
-- Off by default -- only skills the learner has explicitly chosen to
-- show should appear, matching the account-level default.
alter table skills add column visible_on_profile boolean not null default false;

-- Tighten the connections-read policy from 0016 to also require the
-- individual skill to be marked visible, not just the account-level flag.
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
    and exists (
      select 1 from skill_peer_ratings spr
      where (spr.rater_id = auth.uid() and spr.skill_owner_id = skills.user_id)
         or (spr.rater_id = skills.user_id and spr.skill_owner_id = auth.uid())
    )
  );
