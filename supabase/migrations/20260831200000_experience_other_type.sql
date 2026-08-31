-- Free-text label for what kind of experience an "Other Experience" entry
-- is (e.g. "Hackathon", "Open source contribution") -- the fixed type enum
-- only says "other", which isn't enough to distinguish entries from one
-- another on the learner's timeline.
alter table experience add column other_type text;
