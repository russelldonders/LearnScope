-- Broaden the experience timeline beyond employment/education to also
-- cover projects, volunteer positions, and other experience -- these are
-- all "chapters" in the learner's development the same way a job is, just
-- without an employment relationship.
alter table experience drop constraint experience_type_check;
alter table experience add constraint experience_type_check
  check (type in ('education', 'employment', 'project', 'volunteer', 'other'));

-- Optional organization website, used to look up a logo to display next to
-- the organization name (looked up client-side from the domain -- nothing
-- to backfill here).
alter table experience add column organization_url text;
