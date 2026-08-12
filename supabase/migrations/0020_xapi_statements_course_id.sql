-- Let a recorded experience (xAPI statement) reference the course it
-- happened during, for the course's own Experiences tab. Set null on
-- delete so the statement survives if the course is later removed --
-- deleting an association must never delete the underlying record.
alter table xapi_statements add column course_id uuid
  references courses(id) on delete set null;

create index xapi_statements_course_id_idx on xapi_statements (course_id);
