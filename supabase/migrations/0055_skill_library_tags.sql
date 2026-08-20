-- Lets the shared skill_library be filtered by the same shared `tags`
-- vocabulary already used for personal skills (0024) and course catalogue
-- entries (0036) -- mirrors course_catalogue_tags exactly. Needed so the
-- first-login wizard can filter "skills you might want to learn" by a
-- learner's stated interests without reading any other learner's private
-- skill_tags rows (which RLS already restricts to owners/connections).
-- No insert policy yet: nothing in the app writes to this table today,
-- it's populated by the backfill below and future migrations/seeding.
create table skill_library_tags (
  id uuid primary key default gen_random_uuid(),
  skill_library_id uuid references skill_library(id) on delete cascade not null,
  tag_id uuid references tags(id) on delete cascade not null,
  created_at timestamptz not null default now(),
  unique (skill_library_id, tag_id)
);

alter table skill_library_tags enable row level security;

-- Mirrors skill_library's own privacy rule (0028): a private entry's tag
-- associations shouldn't be visible to anyone but its creator, even though
-- this bridge table itself carries no name/description to leak directly.
create policy "Authenticated users can view visible skill library tags"
  on skill_library_tags for select
  to authenticated
  using (
    exists (
      select 1 from skill_library sl
      where sl.id = skill_library_tags.skill_library_id
        and (not sl.is_private or sl.created_by = auth.uid())
    )
  );

create index skill_library_tags_library_idx on skill_library_tags (skill_library_id);
create index skill_library_tags_tag_idx on skill_library_tags (tag_id);

-- Best-effort backfill from the legacy free-text category column, same
-- spirit as 0024's category-to-tag backfill. Coverage will be sparse
-- until entries accumulate matches -- the wizard's picker always falls
-- back to full search so a thin match set doesn't dead-end anyone.
insert into skill_library_tags (skill_library_id, tag_id)
select sl.id, t.id
from skill_library sl
join tags t on lower(t.name) = lower(sl.category)
where sl.category is not null
on conflict (skill_library_id, tag_id) do nothing;
