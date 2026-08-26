-- Lets a learner set light/dark/system appearance from their profile
-- settings, mirroring the existing language/country self-service fields on
-- this table. 'system' (follow the OS/browser) is the default so nobody's
-- display flips unexpectedly on first load after this ships.
alter table profiles add column theme_preference text not null default 'system'
  check (theme_preference in ('light', 'dark', 'system'));
