-- Central, cross-user skill catalog. Unlike every other table in this
-- schema, this one is intentionally NOT scoped to a single user: the whole
-- point is that skill *names* are shared/reusable so people don't each
-- invent their own "SQL" / "Sql" / "sql". Personal tracking data (level,
-- category, notes, dates, etc.) stays entirely on the existing per-user
-- `skills` table — this table only carries the reusable identity
-- (name/category/description) that a personal skill can optionally
-- reference for search-and-dedup. Read access is open to any authenticated
-- learner; write access only ever inserts (no update/delete policy), so a
-- library entry, once added, can't be edited or removed by other users.
create table skill_library (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  description text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create unique index skill_library_name_lower_idx on skill_library (lower(name));

alter table skill_library enable row level security;

create policy "Authenticated users can view the skill library"
  on skill_library for select
  to authenticated
  using (true);

create policy "Authenticated users can add to the skill library"
  on skill_library for insert
  to authenticated
  with check (auth.uid() = created_by);

-- Optional link from a personal skill to the shared catalog entry it was
-- found or created from. Nullable — older skills predate this feature, and
-- a user can still track something without publishing it to the library
-- (not currently exposed in the UI, but the schema shouldn't force it).
alter table skills add column library_skill_id uuid references skill_library(id) on delete set null;

create index skills_library_skill_id_idx on skills (library_skill_id);

-- Backfill: seed the library from every distinct skill name already in use
-- (case-insensitive), then link existing personal skills to their match.
insert into skill_library (name, category, created_by)
select distinct on (lower(name)) name, category, user_id
from skills
order by lower(name), date_added asc
on conflict ((lower(name))) do nothing;

update skills s
set library_skill_id = l.id
from skill_library l
where lower(l.name) = lower(s.name)
  and s.library_skill_id is null;
