-- Central, shared catalogue of available courses and learning objects that
-- learners can browse and enrol into -- distinct from the personal
-- `courses` table, which records a learner's own training history. Read
-- access is open to any authenticated learner; there is no insert/update
-- policy yet since only seeded placeholder data exists for now (an editor
-- for creating/importing catalogue entries is planned separately).
create table course_catalogue (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  provider text,
  course_type text,
  duration text,
  synopsis text,
  created_at timestamptz not null default now()
);

alter table course_catalogue enable row level security;

create policy "Authenticated users can view the course catalogue"
  on course_catalogue for select
  to authenticated
  using (true);

-- Optional link from a personal course record to the catalogue entry it
-- was enrolled from. Nullable -- most courses are still logged directly
-- without going through the catalogue. Enrolling snapshots the catalogue
-- entry's details onto a normal `courses` row rather than referencing it
-- live, so a learner's record stays intact even if the catalogue entry is
-- later edited or removed.
alter table courses add column catalogue_course_id uuid references course_catalogue(id) on delete set null;

create index courses_catalogue_course_id_idx on courses (catalogue_course_id);

insert into course_catalogue (name, provider, course_type, duration, synopsis) values
  ('Foundations of UX Design', 'Design Academy', 'Online', '6 weeks', 'Learn the core principles of user-centred design, from research through to wireframing and usability testing.'),
  ('Project Management Essentials', 'Business Institute', 'In-person', '3 days', 'A practical introduction to planning, scheduling and leading projects from kickoff to delivery.'),
  ('Data Analysis with Python', 'CodeCraft', 'Online', '8 weeks', 'Get hands-on with pandas, visualisation and statistics to turn raw data into decisions.'),
  ('Interior Space Planning', 'Design Academy', 'Blended', '4 weeks', 'Explore layout, flow and function to design interior spaces that work for the people who use them.'),
  ('Effective Public Speaking', 'Communication Hub', 'Workshop', '1 day', 'Build confidence and structure for presenting clearly to any audience, in person or online.');
