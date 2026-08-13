-- Records a completed AI-generated baseline quiz: the questions asked (with
-- the learner's chosen answer embedded in each question object) and the
-- resulting score. Historical record, not an editable form -- no update or
-- delete policy, matching skill_assessments' pattern of preserving dated
-- history rather than rewriting it after the fact.
create table skill_baseline_quizzes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  skill_id uuid references skills(id) on delete cascade not null,
  questions jsonb not null,
  score int not null,
  total int not null,
  created_at timestamptz not null default now()
);

alter table skill_baseline_quizzes enable row level security;

create policy "Users can view their own baseline quizzes"
  on skill_baseline_quizzes for select
  using (auth.uid() = user_id);

create policy "Users can record their own baseline quizzes"
  on skill_baseline_quizzes for insert
  with check (
    auth.uid() = user_id
    and exists (select 1 from skills where skills.id = skill_id and skills.user_id = auth.uid())
  );

create index skill_baseline_quizzes_skill_id_idx on skill_baseline_quizzes (skill_id);
