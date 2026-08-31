-- Drives dismissal of the "Add your current role" banner on the dashboard,
-- shown when the learner has skills/courses/connections but no experience
-- entries yet. Same pattern as cv_import_banner_dismissed_at (0110).
alter table profiles add column current_role_banner_dismissed_at timestamptz;
