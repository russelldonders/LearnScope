-- A skill created from reviewing synced activity (e.g. importing "Running"
-- the first time a Strava run is reviewed) is a new source distinct from
-- 'cv_import' -- generic across providers rather than 'strava_import', so a
-- future connector reuses this same value instead of widening the
-- constraint again.
alter table skills drop constraint skills_source_check;
alter table skills add constraint skills_source_check
  check (source in ('manual', 'cv_import', 'recommend', 'external_import'));
