-- Shared, reusable diagnostic content (e.g. a level-calibrated quiz question
-- bank) -- the xAPI-Activity-Definition-shaped "what to ask", generated once
-- per skill+level+axis and reused by every learner doing that same check,
-- rather than regenerated (and re-billed) per learner. Keyed off the shared
-- skill_library catalog, not a personal skills row, since the whole point is
-- cross-user reuse. diagnostic_type is constrained to include 'interview'
-- from day one so a future conversational diagnostic can reuse this table
-- for its own cacheable content (e.g. a rubric/prompt template) without a
-- migration, even though only 'quiz' rows are ever written today.
--
-- Deliberately no insert/update/delete policy for regular users -- writes
-- only ever happen server-side (service-role) from the generation endpoint,
-- so a client can never poison a shared answer key that every other learner
-- of that skill+level then relies on. If a prompt is later improved,
-- prompt_version mints a new row rather than editing an old one.
create table skill_diagnostic_content (
  id uuid primary key default gen_random_uuid(),
  diagnostic_type text not null check (diagnostic_type in ('quiz', 'interview')),
  axis text not null default 'knowledge' check (axis in ('practical', 'knowledge')),
  library_skill_id uuid not null references skill_library(id) on delete cascade,
  skill_name text not null,
  level int not null check (level between 1 and 5),
  prompt_version int not null default 1,
  content jsonb not null,
  created_at timestamptz not null default now()
);

create unique index skill_diagnostic_content_identity_idx
  on skill_diagnostic_content (diagnostic_type, axis, library_skill_id, level, prompt_version);

alter table skill_diagnostic_content enable row level security;

create policy "Authenticated users can view diagnostic content"
  on skill_diagnostic_content for select
  to authenticated
  using (true);
