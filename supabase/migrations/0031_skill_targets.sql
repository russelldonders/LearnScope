-- Records a skill target set while a skill is baseline_assessed: the level
-- the learner is aiming for, a target date, and why. Setting one advances
-- the skill to the target_set lifecycle stage. History-preserving like
-- skill_assessments, in case a target is ever re-set later.
create table skill_targets (
  id uuid primary key default gen_random_uuid(),
  skill_id uuid references skills(id) on delete cascade not null,
  user_id uuid references auth.users(id) not null,
  target_level int not null check (target_level between 1 and 5),
  target_date date not null,
  comments text,
  created_at timestamptz not null default now()
);

alter table skill_targets enable row level security;

create policy "Users manage their own skill targets"
  on skill_targets for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index skill_targets_skill_id_idx on skill_targets (skill_id);
