-- Lets a Project or Course/Training Record be recorded as part of a Job or
-- Volunteer Position, rather than as an unrelated top-level chapter. A
-- nullable self-reference (not a join table) is enough since each
-- sub-experience belongs to at most one parent; "on delete set null" means
-- deleting the parent role doesn't destroy the project/course record it
-- was linked from -- it just becomes unlinked, matching the rule that
-- unlinking must not delete the underlying record.
alter table experience add column parent_experience_id uuid references experience(id) on delete set null;

create index experience_parent_experience_id_idx on experience (parent_experience_id);
