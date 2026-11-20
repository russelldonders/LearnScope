-- Knowledge-check question pool per library skill and level.
--
-- Until now each library skill + level had one cached 10-question quiz in
-- skill_diagnostic_content (0049) that every learner got. This replaces that
-- for quizzes with a pool of individual questions:
--
-- - skill_questions: one row per question, targeted at one library skill
--   and one knowledge level, stored in the course builder's scored-question
--   format (a page-builder `test_question` block: single, multiple,
--   true_false, short_text, number, ordering or matching), so the same
--   marking and editing code serves both. Questions are never deleted from
--   the app -- they're deactivated, so past attempts that reference them
--   stay explainable.
-- - skill_question_servings: which questions each learner has been served,
--   so a returning learner gets ones they haven't seen.
--
-- api/generate-diagnostic-quiz.js does the picking and generating with the
-- service role: it serves 10 unseen active questions, generating 10 more
-- whenever a learner has run out and the level holds fewer than 100 active
-- ones; at 100 it serves a random 10, unseen first. Only platform admins can
-- query the pool, to edit, add, generate and deactivate questions in the
-- skill library. Note this is not answer-key secrecy: questions are served
-- with their answers and marked in the browser (as quizzes always were), so
-- a learner who takes a level repeatedly will see much of its pool.
--
-- skill_diagnostic_content stays as it is (interview plans still use it, and
-- old quiz rows remain the record past attempts point at); its current
-- (prompt_version 2) quiz questions are copied in below as each pool's first
-- questions so nothing already generated is lost or regenerated.

create table public.skill_questions (
  id uuid primary key default gen_random_uuid(),
  library_skill_id uuid not null references public.skill_library(id) on delete cascade,
  axis text not null default 'knowledge' check (axis in ('knowledge')),
  level int not null check (level between 1 and 5),
  question_type text not null
    check (question_type in ('single', 'multiple', 'true_false', 'short_text', 'number', 'ordering', 'matching')),
  question jsonb not null check (jsonb_typeof(question) = 'object' and question->>'type' = 'test_question'),
  status text not null default 'active' check (status in ('active', 'inactive')),
  source text not null check (source in ('ai', 'manual', 'imported')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index skill_questions_pool_idx on public.skill_questions (library_skill_id, axis, level, status);

create or replace function public.set_skill_question_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger set_skill_question_updated_at
  before update on public.skill_questions
  for each row execute function public.set_skill_question_updated_at();

alter table public.skill_questions enable row level security;

create policy "Platform admins can view skill questions"
  on public.skill_questions for select
  to authenticated
  using (public.is_platform_admin((select auth.uid())));

create policy "Platform admins can add skill questions"
  on public.skill_questions for insert
  to authenticated
  with check (public.is_platform_admin((select auth.uid())));

create policy "Platform admins can update skill questions"
  on public.skill_questions for update
  to authenticated
  using (public.is_platform_admin((select auth.uid())))
  with check (public.is_platform_admin((select auth.uid())));

-- No delete policy: deactivate instead.

-- Admins edit a question's content and status; which skill and level it
-- belongs to, and where it came from, stay as created.
revoke all on table public.skill_questions from anon, authenticated;
grant select, insert on table public.skill_questions to authenticated;
grant update (question, question_type, status) on table public.skill_questions to authenticated;
grant all on table public.skill_questions to service_role;

create table public.skill_question_servings (
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id uuid not null references public.skill_questions(id) on delete cascade,
  first_served_at timestamptz not null default now(),
  last_served_at timestamptz not null default now(),
  primary key (user_id, question_id)
);

create index skill_question_servings_question_idx on public.skill_question_servings (question_id);

-- Written and read only by the server (service role). RLS on with no
-- policies, so no client can read or forge another learner's history.
alter table public.skill_question_servings enable row level security;
revoke all on table public.skill_question_servings from anon, authenticated;
grant all on table public.skill_question_servings to service_role;

-- Seed each pool with the questions already generated for it (prompt_version
-- 2; version 1 was retired for putting the right answer first). Each old
-- multiple-choice question becomes a single-answer scored question.
insert into public.skill_questions (library_skill_id, axis, level, question_type, question, source, created_at)
select
  c.library_skill_id,
  'knowledge',
  c.level,
  'single',
  jsonb_build_object(
    'id', gen_random_uuid()::text,
    'type', 'test_question',
    'title', q->'description'->>'en-US',
    'layout', 'single',
    'points', 1,
    'tolerance', 0,
    'caption', '',
    'items', (
      select jsonb_agg(
        jsonb_build_object(
          'id', gen_random_uuid()::text,
          'label', ch->'description'->>'en-US',
          'detail', '',
          'value', 0,
          'correct', (ch->>'id') = (q->'correctResponsesPattern'->>0)
        )
        order by ord
      )
      from jsonb_array_elements(q->'choices') with ordinality as choice(ch, ord)
    )
  ),
  'imported',
  c.created_at
from public.skill_diagnostic_content c
cross join lateral jsonb_array_elements(c.content->'questions') as question(q)
where c.diagnostic_type = 'quiz'
  and c.axis = 'knowledge'
  and c.prompt_version = 2
  and coalesce(q->'description'->>'en-US', '') <> ''
  and q->'correctResponsesPattern'->>0 is not null
  and jsonb_array_length(coalesce(q->'choices', '[]'::jsonb)) >= 2;
