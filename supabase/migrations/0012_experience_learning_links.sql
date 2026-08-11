-- Link courses to the job/study period during which they were completed.
-- Many-to-many: a course may relate to more than one experience. Deleting a
-- link row removes only the association, never the course or experience.
create table course_experience_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  course_id uuid references courses(id) on delete cascade not null,
  experience_id uuid references experience(id) on delete cascade not null,
  created_at timestamptz not null default now(),
  unique (course_id, experience_id)
);

alter table course_experience_links enable row level security;

create policy "Users manage their own course-experience links"
  on course_experience_links for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (select 1 from courses where courses.id = course_id and courses.user_id = auth.uid())
    and exists (select 1 from experience where experience.id = experience_id and experience.user_id = auth.uid())
  );

create index course_experience_links_course_id_idx on course_experience_links (course_id);
create index course_experience_links_experience_id_idx on course_experience_links (experience_id);

-- Relationship between a skill and a job/study period. A skill can carry
-- more than one relationship to the same experience (e.g. both "developed"
-- and "demonstrated"), each stored as its own row.
create table skill_experience_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  skill_id uuid references skills(id) on delete cascade not null,
  experience_id uuid references experience(id) on delete cascade not null,
  relationship text not null
    check (relationship in ('first_acquired', 'developed', 'applied', 'demonstrated')),
  created_at timestamptz not null default now(),
  unique (skill_id, experience_id, relationship)
);

alter table skill_experience_links enable row level security;

create policy "Users manage their own skill-experience links"
  on skill_experience_links for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (select 1 from skills where skills.id = skill_id and skills.user_id = auth.uid())
    and exists (select 1 from experience where experience.id = experience_id and experience.user_id = auth.uid())
  );

create index skill_experience_links_skill_id_idx on skill_experience_links (skill_id);
create index skill_experience_links_experience_id_idx on skill_experience_links (experience_id);

-- Let a skill achievement (a skill_assessments row) reference the job/study
-- period it happened during. This reuses the existing assessments table —
-- which already separates assessed_at (effective/achievement date) from
-- created_at, and already carries level/comments/evidence/course_id — rather
-- than introducing a parallel achievements table. Set null on delete so the
-- historical achievement survives if the experience record is later removed.
alter table skill_assessments add column experience_id uuid
  references experience(id) on delete set null;

create index skill_assessments_experience_id_idx on skill_assessments (experience_id);
