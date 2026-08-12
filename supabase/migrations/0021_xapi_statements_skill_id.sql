-- Let a recorded experience (xAPI statement) reference a specific skill
-- directly, mirroring course_id (0020), for the skill's own Experiences
-- tab. Statements already carry a skill reference inside
-- statement->context->extensions as a context extension (for xAPI
-- portability) -- this column is a queryable mirror of that, not a
-- replacement for it. Set null on delete so the statement survives if the
-- skill is later removed.
alter table xapi_statements add column skill_id uuid
  references skills(id) on delete set null;

create index xapi_statements_skill_id_idx on xapi_statements (skill_id);

-- Backfill from statements recorded before this column existed, whose
-- skill link only lives inside the JSON context extension.
update xapi_statements
set skill_id = (statement #>> '{context,extensions,https://learnscope.app/xapi/extensions/skill,id}')::uuid
where statement #>> '{context,extensions,https://learnscope.app/xapi/extensions/skill,id}' is not null
  and skill_id is null;
