alter table skill_assessments add column source text not null default 'self'
  check (source in ('self', 'course'));

alter table skill_assessments add column course_id uuid
  references courses(id) on delete set null;

create index skill_assessments_course_id_idx on skill_assessments (course_id);
