create table courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  name text not null,
  provider text,
  completed_date date,
  notes text,
  created_at timestamptz not null default now()
);

alter table courses enable row level security;

create policy "Users manage their own courses"
  on courses for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index courses_user_id_idx on courses (user_id);

create table experience (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  type text not null check (type in ('education', 'employment')),
  title text not null,
  organization text not null,
  start_date date not null,
  end_date date,
  description text,
  created_at timestamptz not null default now()
);

alter table experience enable row level security;

create policy "Users manage their own experience"
  on experience for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index experience_user_id_idx on experience (user_id);
