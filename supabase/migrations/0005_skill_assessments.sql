create table skill_assessments (
  id uuid primary key default gen_random_uuid(),
  skill_id uuid references skills(id) on delete cascade not null,
  user_id uuid references auth.users(id) not null,
  level int not null check (level between 1 and 5),
  comments text,
  evidence_url text,
  evidence_path text,
  assessed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table skill_assessments enable row level security;

create policy "Users manage their own skill assessments"
  on skill_assessments for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index skill_assessments_skill_id_idx on skill_assessments (skill_id);
create index skill_assessments_assessed_at_idx on skill_assessments (assessed_at);

alter table skills add column next_checkin_date date;
alter table skills add column checkin_frequency_value int;
alter table skills add column checkin_frequency_unit text
  check (checkin_frequency_unit in ('weeks', 'months', 'years'));

insert into storage.buckets (id, name, public)
values ('skill-evidence', 'skill-evidence', false)
on conflict (id) do nothing;

create policy "Users manage their own skill evidence files"
  on storage.objects for all
  using (bucket_id = 'skill-evidence' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'skill-evidence' and (storage.foldername(name))[1] = auth.uid()::text);
