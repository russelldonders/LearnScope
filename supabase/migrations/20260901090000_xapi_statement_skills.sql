-- Lets one logged activity relate to more than one skill. xapi_statements
-- keeps its skill_id column as the "primary" skill (first one picked when
-- logging) -- unchanged for every existing query/index that reads it -- and
-- this join table is the authoritative full set, including the primary
-- itself, so any caller can find every activity relevant to a skill by
-- querying here instead of guessing which activities have that skill as
-- only a secondary tag.
create table xapi_statement_skills (
  id uuid primary key default gen_random_uuid(),
  statement_id uuid references xapi_statements(id) on delete cascade not null,
  skill_id uuid references skills(id) on delete cascade not null,
  user_id uuid references auth.users(id) not null,
  created_at timestamptz not null default now(),
  unique (statement_id, skill_id)
);

alter table xapi_statement_skills enable row level security;

-- The with check also confirms the statement itself belongs to the caller
-- (not just that they're stamping their own user_id on the row) -- closes
-- off inserting a link against someone else's statement_id, which nothing
-- downstream would actually expose (every read still re-checks
-- xapi_statements' own RLS) but shouldn't be possible to write regardless.
create policy "Users manage their own activity-skill links"
  on xapi_statement_skills for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (select 1 from xapi_statements xs where xs.id = statement_id and xs.user_id = auth.uid())
  );

-- Mirrors 0041's "Validators can view activity for skills they're
-- validating" policy on xapi_statements itself -- without this, a
-- validator reviewing evidence could see an activity through its primary
-- skill_id but not through this table, silently hiding any skill it was
-- only a secondary related skill for.
create policy "Validators can view activity-skill links for skills they're validating"
  on xapi_statement_skills for select
  using (
    exists (
      select 1 from skill_validation_requests svr
      where svr.skill_id = xapi_statement_skills.skill_id and svr.validator_id = auth.uid()
    )
  );

create index xapi_statement_skills_statement_id_idx on xapi_statement_skills (statement_id);
create index xapi_statement_skills_skill_id_idx on xapi_statement_skills (skill_id);

-- Backfill every existing statement's already-known single skill so
-- nothing already logged goes missing once callers start reading through
-- this table.
insert into xapi_statement_skills (statement_id, skill_id, user_id)
select id, skill_id, user_id from xapi_statements where skill_id is not null;
