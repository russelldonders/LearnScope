create table skills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  name text not null,
  category text not null,
  level int not null check (level between 1 and 5),
  notes text,
  date_added timestamptz not null default now()
);

alter table skills enable row level security;

create policy "Users manage their own skills"
  on skills for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index skills_user_id_idx on skills (user_id);
