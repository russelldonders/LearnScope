-- skills.category became nullable back in 0024 (replaced by tags), but this
-- snapshot column was never updated to match -- accept_invite_and_rate()
-- inserts v_skill.category directly, so rating any skill added since 0024
-- (which has no category at all) violates this NOT NULL constraint.
alter table skill_peer_ratings alter column skill_category drop not null;
