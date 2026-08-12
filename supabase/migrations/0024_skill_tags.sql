-- Tags replace category as the way a skill is labeled: a skill can now
-- carry zero or more tags instead of exactly one required category.
-- Shared cross-user vocabulary, mirroring the skill_library pattern, so
-- "Technical"/"Leadership"/etc. stay consistent instead of fragmenting
-- into near-duplicates per user. Read access is open to any authenticated
-- learner; write access only ever inserts (no update/delete policy), so a
-- tag, once added, can't be edited or removed by other users.
create table tags (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create unique index tags_name_lower_idx on tags (lower(name));

alter table tags enable row level security;

create policy "Authenticated users can view tags"
  on tags for select
  to authenticated
  using (true);

create policy "Authenticated users can add tags"
  on tags for insert
  to authenticated
  with check (auth.uid() = created_by);

-- Which tags apply to which of a learner's own skills.
create table skill_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  skill_id uuid references skills(id) on delete cascade not null,
  tag_id uuid references tags(id) on delete cascade not null,
  created_at timestamptz not null default now(),
  unique (skill_id, tag_id)
);

alter table skill_tags enable row level security;

create policy "Users manage their own skill tags"
  on skill_tags for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (select 1 from skills where skills.id = skill_id and skills.user_id = auth.uid())
  );

-- Mirrors the "Connections can view visible skills profiles" policy on
-- skills (0022): a connection who can see a skill on someone's profile
-- should also see its tags, not just the bare name/level.
create policy "Connections can view tags on visible skills"
  on skill_tags for select
  using (
    exists (
      select 1 from skills s
      join profiles p on p.id = s.user_id
      where s.id = skill_tags.skill_id
        and s.visible_on_profile = true
        and p.skills_profile_visible = true
        and exists (
          select 1 from skill_peer_ratings spr
          where (spr.rater_id = auth.uid() and spr.skill_owner_id = s.user_id)
             or (spr.rater_id = s.user_id and spr.skill_owner_id = auth.uid())
        )
    )
  );

create index skill_tags_skill_id_idx on skill_tags (skill_id);
create index skill_tags_tag_id_idx on skill_tags (tag_id);

-- category becomes optional -- the column stays (existing values aren't
-- destroyed) but new skills no longer require it now that tags exist.
alter table skills alter column category drop not null;

-- Backfill: preserve each skill's existing category as an initial tag,
-- so historical categorization isn't lost by this change.
insert into tags (name, created_by)
select distinct on (lower(category)) category, user_id
from skills
where category is not null
order by lower(category), date_added asc
on conflict ((lower(name))) do nothing;

insert into skill_tags (user_id, skill_id, tag_id)
select s.user_id, s.id, t.id
from skills s
join tags t on lower(t.name) = lower(s.category)
where s.category is not null
on conflict (skill_id, tag_id) do nothing;
