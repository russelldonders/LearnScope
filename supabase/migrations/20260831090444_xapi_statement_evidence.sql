-- A logged skill activity can now carry evidence, the same shape
-- skill_assessments has had since 0007 (a link plus uploaded files) --
-- reuses the existing skill-evidence storage bucket and its RLS policy
-- (scoped only by the uploading user's own folder, not by table), so no
-- storage/policy changes are needed here.
alter table xapi_statements add column evidence_url text;
alter table xapi_statements add column evidence_paths text[];
