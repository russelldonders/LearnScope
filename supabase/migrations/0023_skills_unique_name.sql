-- Prevent adding the same skill twice: at most one skill row per learner
-- per name, case-insensitive. Checked for and cleaned up any pre-existing
-- duplicates in the live data before writing this migration, so this
-- should apply cleanly.
create unique index skills_user_id_name_lower_idx on skills (user_id, lower(name));
