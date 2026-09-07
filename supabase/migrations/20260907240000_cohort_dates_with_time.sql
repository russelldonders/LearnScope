-- Cohort start/end gain a time component -- a cohort can run entirely
-- within one day (e.g. a one-day workshop), so plain dates weren't enough
-- to tell a provider or learner when on that day it actually starts/ends.
-- Casting date -> timestamptz is safe and non-destructive for existing
-- rows: each existing date becomes midnight in the session's timezone,
-- preserving the same calendar date, and the frontend already treats a
-- cohort with only a date (no meaningful time) as just showing that date
-- (see formatCohortDateRange in src/lib/courseCatalogue.js).
alter table course_cohorts
  alter column start_date type timestamptz using (start_date::timestamptz),
  alter column end_date type timestamptz using (end_date::timestamptz);
