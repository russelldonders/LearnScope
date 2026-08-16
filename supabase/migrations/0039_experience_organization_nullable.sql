-- The Project, Other Experience, and Course/Training experience types all
-- treat organization as optional at the app layer (not every project or
-- course has a formal organization behind it), but the column was still
-- `not null` from the original employment/education-only schema. Relax it
-- to match.
alter table experience alter column organization drop not null;
