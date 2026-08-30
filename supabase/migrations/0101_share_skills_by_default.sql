-- Flips skills-profile sharing from opt-in to opt-out, per explicit product
-- decision: new accounts (and new skills) now start shared with connections
-- rather than private, and a learner turns sharing off if they don't want
-- it, instead of turning it on. This only touches the "share with
-- connections" surface (profiles.skills_profile_visible / per-skill
-- visible_on_profile) -- skill_search_visibility (discoverability to people
-- you're NOT yet connected with) is untouched and still defaults to
-- 'hidden'; that's a materially bigger exposure (search vs. existing
-- connections only) and wasn't part of this change.
--
-- Existing accounts are included, not just new signups -- every row
-- currently at the old default (false) is flipped to true. There is no way
-- to distinguish "never touched, still at the old default" from "a learner
-- explicitly turned it back off" (both look like `false`), so this is a
-- one-time blanket flip for anyone not already sharing. Any row already
-- `true` (an explicit past opt-in) is untouched, and is excluded from the
-- WHERE clause below rather than reassigned, since it's already correct.
alter table profiles alter column skills_profile_visible set default true;
update profiles set skills_profile_visible = true where skills_profile_visible = false;

alter table skills alter column visible_on_profile set default true;
update skills set visible_on_profile = true where visible_on_profile = false;
