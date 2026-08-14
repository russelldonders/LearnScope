-- Which skills (and the proficiency level a course helps a learner reach)
-- each catalogue course is associated with. References the shared
-- skill_library, not a learner's personal skills, since the catalogue
-- itself isn't scoped to any one learner. A course can target zero or
-- more skills, each at one target level.
create table course_catalogue_skills (
  id uuid primary key default gen_random_uuid(),
  course_catalogue_id uuid references course_catalogue(id) on delete cascade not null,
  skill_library_id uuid references skill_library(id) on delete cascade not null,
  level int not null check (level between 1 and 5),
  created_at timestamptz not null default now(),
  unique (course_catalogue_id, skill_library_id)
);

alter table course_catalogue_skills enable row level security;

create policy "Authenticated users can view course catalogue skills"
  on course_catalogue_skills for select
  to authenticated
  using (true);

create index course_catalogue_skills_course_idx on course_catalogue_skills (course_catalogue_id);
create index course_catalogue_skills_skill_idx on course_catalogue_skills (skill_library_id);

-- Category tags on catalogue courses, reusing the same shared `tags`
-- vocabulary already used for skills (0024) so browsing/filtering uses one
-- consistent tag list rather than a separate course-only one.
create table course_catalogue_tags (
  id uuid primary key default gen_random_uuid(),
  course_catalogue_id uuid references course_catalogue(id) on delete cascade not null,
  tag_id uuid references tags(id) on delete cascade not null,
  created_at timestamptz not null default now(),
  unique (course_catalogue_id, tag_id)
);

alter table course_catalogue_tags enable row level security;

create policy "Authenticated users can view course catalogue tags"
  on course_catalogue_tags for select
  to authenticated
  using (true);

create index course_catalogue_tags_course_idx on course_catalogue_tags (course_catalogue_id);
create index course_catalogue_tags_tag_idx on course_catalogue_tags (tag_id);

-- Seed: give the 5 placeholder courses from 0035 representative skill and
-- tag associations, reusing existing skill_library/tags entries where they
-- already exist (both tables dedupe case-insensitively by name).
-- skill_library's plain lower(name) unique index was replaced in 0028 by
-- two partial indexes (public vs. private entries); match the public one
-- explicitly since these seeded entries are public (the column default).
insert into skill_library (name) values
  ('UX Design'), ('Project Management'), ('Data Analysis'), ('Interior Design'), ('Public Speaking')
on conflict ((lower(name))) where not is_private do nothing;

insert into tags (name) values
  ('Design'), ('Business'), ('Technical'), ('Communication')
on conflict ((lower(name))) do nothing;

insert into course_catalogue_skills (course_catalogue_id, skill_library_id, level)
select cc.id, sl.id, v.level
from (values
  ('Foundations of UX Design', 'UX Design', 2),
  ('Project Management Essentials', 'Project Management', 2),
  ('Data Analysis with Python', 'Data Analysis', 3),
  ('Interior Space Planning', 'Interior Design', 3),
  ('Effective Public Speaking', 'Public Speaking', 2)
) as v(course_name, skill_name, level)
join course_catalogue cc on cc.name = v.course_name
join skill_library sl on lower(sl.name) = lower(v.skill_name)
on conflict (course_catalogue_id, skill_library_id) do nothing;

insert into course_catalogue_tags (course_catalogue_id, tag_id)
select cc.id, t.id
from (values
  ('Foundations of UX Design', 'Design'),
  ('Project Management Essentials', 'Business'),
  ('Data Analysis with Python', 'Technical'),
  ('Interior Space Planning', 'Design'),
  ('Effective Public Speaking', 'Communication')
) as v(course_name, tag_name)
join course_catalogue cc on cc.name = v.course_name
join tags t on lower(t.name) = lower(v.tag_name)
on conflict (course_catalogue_id, tag_id) do nothing;
