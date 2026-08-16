-- Add "Course / Training" as its own experience type, alongside
-- employment/education/project/volunteer/other. This is a separate,
-- lighter-weight way to note a course as a timeline chapter using the
-- existing generic experience fields (title, provider, provider website,
-- dates, description) -- it does not touch the standalone `courses` table,
-- the training catalogue, or skill-to-course evidence linking, which stay
-- as they are and solve a different problem (which courses evidence which
-- skills).
alter table experience drop constraint experience_type_check;
alter table experience add constraint experience_type_check
  check (type in ('education', 'employment', 'project', 'volunteer', 'other', 'course'));
