-- Relationship between a skill and a course, mirroring
-- skill_experience_links exactly. A skill can carry more than one
-- relationship to the same course (e.g. both "developed" and
-- "demonstrated"), each stored as its own row. This is the "skills
-- developed" side of the course Skills tab; dated achievements continue
-- to use skill_assessments.course_id (already present since
-- 0009_course_skill_link.sql).
create table skill_course_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  skill_id uuid references skills(id) on delete cascade not null,
  course_id uuid references courses(id) on delete cascade not null,
  relationship text not null
    check (relationship in ('first_acquired', 'developed', 'applied', 'demonstrated')),
  created_at timestamptz not null default now(),
  unique (skill_id, course_id, relationship)
);

alter table skill_course_links enable row level security;

create policy "Users manage their own skill-course links"
  on skill_course_links for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (select 1 from skills where skills.id = skill_id and skills.user_id = auth.uid())
    and exists (select 1 from courses where courses.id = course_id and courses.user_id = auth.uid())
  );

create index skill_course_links_skill_id_idx on skill_course_links (skill_id);
create index skill_course_links_course_id_idx on skill_course_links (course_id);
