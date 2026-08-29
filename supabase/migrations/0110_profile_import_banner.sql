-- Drives the "import your CV/history" banner on the dashboard: shown until
-- the learner has actually run an import once, or explicitly dismissed it.
-- Kept as its own flag rather than inferring from skills.source='cv_import'
-- (0008) -- an import can add only courses/experience with no skills at
-- all, which that column alone wouldn't catch.
alter table profiles add column cv_imported_at timestamptz;
alter table profiles add column cv_import_banner_dismissed_at timestamptz;
