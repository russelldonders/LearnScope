-- =============================================================================
-- 0001_init.sql
-- =============================================================================

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



-- =============================================================================
-- 0002_profiles.sql
-- =============================================================================

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  country text,
  location text,
  language text,
  updated_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "Users manage their own profile"
  on profiles for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Backfill profile rows for any users created before this migration.
insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;



-- =============================================================================
-- 0003_courses_experience.sql
-- =============================================================================

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



-- =============================================================================
-- 0004_avatar_and_current_role.sql
-- =============================================================================

alter table profiles add column avatar_url text;

alter table skills add column is_current_role boolean not null default false;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "Avatar images are publicly accessible"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "Users can upload their own avatar"
  on storage.objects for insert
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can update their own avatar"
  on storage.objects for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can delete their own avatar"
  on storage.objects for delete
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);



-- =============================================================================
-- 0005_skill_assessments.sql
-- =============================================================================

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



-- =============================================================================
-- 0006_nullable_skill_level.sql
-- =============================================================================

alter table skills alter column level drop not null;



-- =============================================================================
-- 0007_tracking_reason_and_multi_evidence.sql
-- =============================================================================

alter table skills add column tracking_reason text
  check (tracking_reason in ('lifestyle', 'work', 'personal_interest', 'career_development'));

alter table skill_assessments add column evidence_paths text[];

update skill_assessments
set evidence_paths = array[evidence_path]
where evidence_path is not null and evidence_paths is null;



-- =============================================================================
-- 0008_skill_source.sql
-- =============================================================================

alter table skills add column source text
  not null default 'manual'
  check (source in ('manual', 'cv_import'));



-- =============================================================================
-- 0009_course_skill_link.sql
-- =============================================================================

alter table skill_assessments add column source text not null default 'self'
  check (source in ('self', 'course'));

alter table skill_assessments add column course_id uuid
  references courses(id) on delete set null;

create index skill_assessments_course_id_idx on skill_assessments (course_id);



-- =============================================================================
-- 0010_connections.sql
-- =============================================================================

-- Let any logged-in user see another user's display name/avatar (needed to
-- show who rated a skill, and who a connection is, across accounts). Insert/
-- update/delete stay restricted to the owner via the existing policy.
create policy "Authenticated users can view profile names"
  on profiles for select
  to authenticated
  using (true);

create table connection_invites (
  id uuid primary key default gen_random_uuid(),
  inviter_id uuid references auth.users(id) not null,
  skill_id uuid references skills(id) on delete cascade not null,
  invitee_email text,
  share_code text not null unique default replace(gen_random_uuid()::text, '-', ''),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  accepted_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

alter table connection_invites enable row level security;

create policy "Inviters can view their own invites"
  on connection_invites for select
  using (auth.uid() = inviter_id);

create policy "Inviters can create invites for their own skills"
  on connection_invites for insert
  with check (
    auth.uid() = inviter_id
    and exists (select 1 from skills where skills.id = skill_id and skills.user_id = auth.uid())
  );

create index connection_invites_inviter_id_idx on connection_invites (inviter_id);
create index connection_invites_share_code_idx on connection_invites (share_code);

-- skill_name/category/owner are snapshotted (not looked up live via the
-- skills table) because a rater has no RLS access to a skill they don't
-- own — without this they couldn't see what they'd even rated.
create table skill_peer_ratings (
  id uuid primary key default gen_random_uuid(),
  skill_id uuid references skills(id) on delete cascade not null,
  skill_name text not null,
  skill_category text not null,
  skill_owner_id uuid references auth.users(id) not null,
  invite_id uuid references connection_invites(id) on delete set null,
  rater_id uuid references auth.users(id) not null,
  rater_name text,
  rater_email text,
  level int not null check (level between 1 and 5),
  comments text,
  rated_at timestamptz not null default now()
);

alter table skill_peer_ratings enable row level security;

create policy "Skill owners can view ratings on their skills"
  on skill_peer_ratings for select
  using (exists (select 1 from skills where skills.id = skill_id and skills.user_id = auth.uid()));

create policy "Raters can view ratings they gave"
  on skill_peer_ratings for select
  using (auth.uid() = rater_id);

create index skill_peer_ratings_skill_id_idx on skill_peer_ratings (skill_id);
create index skill_peer_ratings_rater_id_idx on skill_peer_ratings (rater_id);
create index skill_peer_ratings_invite_id_idx on skill_peer_ratings (invite_id);

-- No insert/update policy on skill_peer_ratings or update policy on
-- connection_invites for regular users: both only change via
-- accept_invite_and_rate() below, so a rater can only ever act on an invite
-- addressed to them and only once (status flips out of 'pending').

create or replace function get_invite_preview(p_code text)
returns table (
  skill_name text,
  skill_category text,
  inviter_name text,
  status text
)
language sql
security definer
set search_path = public
as $$
  select s.name, s.category, coalesce(p.full_name, ''), ci.status
  from connection_invites ci
  join skills s on s.id = ci.skill_id
  left join profiles p on p.id = ci.inviter_id
  where ci.share_code = p_code
$$;

grant execute on function get_invite_preview(text) to anon, authenticated;

create or replace function accept_invite_and_rate(p_code text, p_level int, p_comments text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite connection_invites%rowtype;
  v_skill skills%rowtype;
  v_rater_name text;
  v_rater_email text;
  v_rating_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_invite from connection_invites where share_code = p_code for update;
  if not found then
    raise exception 'Invite not found';
  end if;
  if v_invite.status != 'pending' then
    raise exception 'This invite has already been used.';
  end if;
  if v_invite.inviter_id = auth.uid() then
    raise exception 'You can''t rate your own skill.';
  end if;
  if p_level < 1 or p_level > 5 then
    raise exception 'Invalid level';
  end if;

  select * into v_skill from skills where id = v_invite.skill_id;
  select full_name into v_rater_name from profiles where id = auth.uid();
  select email into v_rater_email from auth.users where id = auth.uid();

  insert into skill_peer_ratings (
    skill_id, skill_name, skill_category, skill_owner_id,
    invite_id, rater_id, rater_name, rater_email, level, comments
  )
  values (
    v_invite.skill_id, v_skill.name, v_skill.category, v_skill.user_id,
    v_invite.id, auth.uid(), v_rater_name, v_rater_email, p_level, nullif(p_comments, '')
  )
  returning id into v_rating_id;

  update connection_invites
  set status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
  where id = v_invite.id;

  update skills s
  set level = latest.level
  from (
    select level, ts from (
      select level, assessed_at as ts from skill_assessments where skill_id = v_invite.skill_id
      union all
      select level, rated_at as ts from skill_peer_ratings where skill_id = v_invite.skill_id
    ) combined
    order by ts desc
    limit 1
  ) latest
  where s.id = v_invite.skill_id;

  return v_rating_id;
end;
$$;

grant execute on function accept_invite_and_rate(text, int, text) to authenticated;



-- =============================================================================
-- 0011_peer_rating_owner_email.sql
-- =============================================================================

-- Snapshot the skill owner's email too (mirrors rater_email), so a user can
-- resolve the email of a connection regardless of which direction the
-- rating went — needed to let the invite flow offer "invite an existing
-- connection" without a fresh lookup.
alter table skill_peer_ratings add column skill_owner_email text;

create or replace function accept_invite_and_rate(p_code text, p_level int, p_comments text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite connection_invites%rowtype;
  v_skill skills%rowtype;
  v_owner_email text;
  v_rater_name text;
  v_rater_email text;
  v_rating_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_invite from connection_invites where share_code = p_code for update;
  if not found then
    raise exception 'Invite not found';
  end if;
  if v_invite.status != 'pending' then
    raise exception 'This invite has already been used.';
  end if;
  if v_invite.inviter_id = auth.uid() then
    raise exception 'You can''t rate your own skill.';
  end if;
  if p_level < 1 or p_level > 5 then
    raise exception 'Invalid level';
  end if;

  select * into v_skill from skills where id = v_invite.skill_id;
  select email into v_owner_email from auth.users where id = v_skill.user_id;
  select full_name into v_rater_name from profiles where id = auth.uid();
  select email into v_rater_email from auth.users where id = auth.uid();

  insert into skill_peer_ratings (
    skill_id, skill_name, skill_category, skill_owner_id, skill_owner_email,
    invite_id, rater_id, rater_name, rater_email, level, comments
  )
  values (
    v_invite.skill_id, v_skill.name, v_skill.category, v_skill.user_id, v_owner_email,
    v_invite.id, auth.uid(), v_rater_name, v_rater_email, p_level, nullif(p_comments, '')
  )
  returning id into v_rating_id;

  update connection_invites
  set status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
  where id = v_invite.id;

  update skills s
  set level = latest.level
  from (
    select level, ts from (
      select level, assessed_at as ts from skill_assessments where skill_id = v_invite.skill_id
      union all
      select level, rated_at as ts from skill_peer_ratings where skill_id = v_invite.skill_id
    ) combined
    order by ts desc
    limit 1
  ) latest
  where s.id = v_invite.skill_id;

  return v_rating_id;
end;
$$;

grant execute on function accept_invite_and_rate(text, int, text) to authenticated;



-- =============================================================================
-- 0012_experience_learning_links.sql
-- =============================================================================

-- Link courses to the job/study period during which they were completed.
-- Many-to-many: a course may relate to more than one experience. Deleting a
-- link row removes only the association, never the course or experience.
create table course_experience_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  course_id uuid references courses(id) on delete cascade not null,
  experience_id uuid references experience(id) on delete cascade not null,
  created_at timestamptz not null default now(),
  unique (course_id, experience_id)
);

alter table course_experience_links enable row level security;

create policy "Users manage their own course-experience links"
  on course_experience_links for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (select 1 from courses where courses.id = course_id and courses.user_id = auth.uid())
    and exists (select 1 from experience where experience.id = experience_id and experience.user_id = auth.uid())
  );

create index course_experience_links_course_id_idx on course_experience_links (course_id);
create index course_experience_links_experience_id_idx on course_experience_links (experience_id);

-- Relationship between a skill and a job/study period. A skill can carry
-- more than one relationship to the same experience (e.g. both "developed"
-- and "demonstrated"), each stored as its own row.
create table skill_experience_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  skill_id uuid references skills(id) on delete cascade not null,
  experience_id uuid references experience(id) on delete cascade not null,
  relationship text not null
    check (relationship in ('first_acquired', 'developed', 'applied', 'demonstrated')),
  created_at timestamptz not null default now(),
  unique (skill_id, experience_id, relationship)
);

alter table skill_experience_links enable row level security;

create policy "Users manage their own skill-experience links"
  on skill_experience_links for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (select 1 from skills where skills.id = skill_id and skills.user_id = auth.uid())
    and exists (select 1 from experience where experience.id = experience_id and experience.user_id = auth.uid())
  );

create index skill_experience_links_skill_id_idx on skill_experience_links (skill_id);
create index skill_experience_links_experience_id_idx on skill_experience_links (experience_id);

-- Let a skill achievement (a skill_assessments row) reference the job/study
-- period it happened during. This reuses the existing assessments table —
-- which already separates assessed_at (effective/achievement date) from
-- created_at, and already carries level/comments/evidence/course_id — rather
-- than introducing a parallel achievements table. Set null on delete so the
-- historical achievement survives if the experience record is later removed.
alter table skill_assessments add column experience_id uuid
  references experience(id) on delete set null;

create index skill_assessments_experience_id_idx on skill_assessments (experience_id);



-- =============================================================================
-- 0013_skill_library.sql
-- =============================================================================

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



-- =============================================================================
-- 0014_skill_lifecycle_stage.sql
-- =============================================================================

-- Lifecycle stage: where a tracked skill currently sits in its own
-- progression, distinct from its proficiency level (which stays on
-- skill_assessments history). Selected once when the skill is added;
-- nullable so existing skills predating this feature aren't force-fit
-- into a stage nobody chose for them.
alter table skills add column lifecycle_stage text
  check (lifecycle_stage in (
    'identified',
    'baseline_assessed',
    'target_set',
    'developing',
    'demonstrated',
    'validated',
    'maintained',
    'at_risk',
    'archived'
  ));



-- =============================================================================
-- 0015_xapi_statements.sql
-- =============================================================================

-- Day-to-day experience log, distinct from the `experience` table (work
-- history / education). Each row holds a full xAPI-shaped statement
-- (actor/verb/object/timestamp, optionally result/context) as jsonb so it
-- stays close to the real xAPI spec and could later be exported to an LRS.
-- recorded_at mirrors statement->>'timestamp' as a queryable/sortable
-- column; created_at is the separate audit trail of when the row was saved.
create table xapi_statements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  statement jsonb not null,
  recorded_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table xapi_statements enable row level security;

create policy "Users manage their own xapi statements"
  on xapi_statements for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index xapi_statements_user_id_idx on xapi_statements (user_id);
create index xapi_statements_recorded_at_idx on xapi_statements (recorded_at desc);



-- =============================================================================
-- 0016_skills_profile_privacy.sql
-- =============================================================================

-- Privacy setting: whether a learner's skills profile can be viewed by
-- people they're connected with (i.e. have exchanged a peer rating with),
-- via clicking their name on the Connections page. Off by default — this
-- is the first cross-user read of skills data in the schema, so access
-- must be explicit opt-in, never the default.
alter table profiles add column skills_profile_visible boolean not null default false;

-- Grants read access to another user's skills only when both are true:
--   1. that user has opted in (skills_profile_visible)
--   2. the viewer has an existing connection with them, defined the same
--      way the Connections page already defines it — a skill_peer_ratings
--      row linking the two accounts in either direction.
-- This is additive to (not a replacement for) the existing owner-only
-- policy from 0001_init.sql; Postgres RLS ORs together multiple permissive
-- SELECT policies, so the owner still always sees their own skills.
create policy "Connections can view visible skills profiles"
  on skills for select
  using (
    exists (
      select 1 from profiles p
      where p.id = skills.user_id
        and p.skills_profile_visible = true
    )
    and exists (
      select 1 from skill_peer_ratings spr
      where (spr.rater_id = auth.uid() and spr.skill_owner_id = skills.user_id)
         or (spr.rater_id = skills.user_id and spr.skill_owner_id = auth.uid())
    )
  );



-- =============================================================================
-- 0017_fix_skill_peer_ratings_rls_recursion.sql
-- =============================================================================

-- 0016 added a `skills` SELECT policy that subqueries skill_peer_ratings.
-- That collided with the existing "Skill owners can view ratings on their
-- skills" policy on skill_peer_ratings, which subqueried `skills` in the
-- other direction -- a circular RLS reference Postgres reports as
-- "infinite recursion detected in policy for relation skill_peer_ratings".
-- Fix by having that policy check the already-denormalized
-- skill_owner_id column directly instead of joining back to skills.
-- skill_owner_id is trustworthy: it's only ever set by the
-- security-definer accept_invite_and_rate() function, never directly by
-- users, so this is equivalent access, not a weaker check.
drop policy "Skill owners can view ratings on their skills" on skill_peer_ratings;

create policy "Skill owners can view ratings on their skills"
  on skill_peer_ratings for select
  using (auth.uid() = skill_owner_id);



-- =============================================================================
-- 0018_skill_course_links.sql
-- =============================================================================

-- Relationship between a skill and a course, mirroring
-- skill_experience_links exactly. A skill can carry more than one
-- relationship to the same course (e.g. both "developed" and
-- "demonstrated"), each stored as its own row. This is the "skills
-- developed" side of the course Skills tab; dated achievements continue
-- to use skill_assessments.course_id (already present since
-- 0009_course_skill_link.sql).
create table skill_course_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  skill_id uuid references skills(id) on delete cascade not null,
  course_id uuid references courses(id) on delete cascade not null,
  relationship text not null
    check (relationship in ('first_acquired', 'developed', 'applied', 'demonstrated')),
  created_at timestamptz not null default now(),
  unique (skill_id, course_id, relationship)
);

alter table skill_course_links enable row level security;

create policy "Users manage their own skill-course links"
  on skill_course_links for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (select 1 from skills where skills.id = skill_id and skills.user_id = auth.uid())
    and exists (select 1 from courses where courses.id = course_id and courses.user_id = auth.uid())
  );

create index skill_course_links_skill_id_idx on skill_course_links (skill_id);
create index skill_course_links_course_id_idx on skill_course_links (course_id);



-- =============================================================================
-- 0019_course_duration_and_type.sql
-- =============================================================================

-- Free-text duration ("6 weeks", "40 hours", "3 years"...) rather than a
-- structured value+unit pair -- durations for courses are reported in
-- wildly different units and a single text field keeps the form simple.
alter table courses add column duration text;

-- Course type/modality (Online, Degree, Blended, Seminar...). Free text
-- rather than a fixed enum so it stays extensible without a migration,
-- matching the same input+datalist "suggest, don't restrict" pattern
-- already used for skill categories.
alter table courses add column course_type text;



-- =============================================================================
-- 0020_xapi_statements_course_id.sql
-- =============================================================================

-- Let a recorded experience (xAPI statement) reference the course it
-- happened during, for the course's own Experiences tab. Set null on
-- delete so the statement survives if the course is later removed --
-- deleting an association must never delete the underlying record.
alter table xapi_statements add column course_id uuid
  references courses(id) on delete set null;

create index xapi_statements_course_id_idx on xapi_statements (course_id);



-- =============================================================================
-- 0021_xapi_statements_skill_id.sql
-- =============================================================================

-- Let a recorded experience (xAPI statement) reference a specific skill
-- directly, mirroring course_id (0020), for the skill's own Experiences
-- tab. Statements already carry a skill reference inside
-- statement->context->extensions as a context extension (for xAPI
-- portability) -- this column is a queryable mirror of that, not a
-- replacement for it. Set null on delete so the statement survives if the
-- skill is later removed.
alter table xapi_statements add column skill_id uuid
  references skills(id) on delete set null;

create index xapi_statements_skill_id_idx on xapi_statements (skill_id);

-- Backfill from statements recorded before this column existed, whose
-- skill link only lives inside the JSON context extension.
update xapi_statements
set skill_id = (statement #>> '{context,extensions,https://learnscope.app/xapi/extensions/skill,id}')::uuid
where statement #>> '{context,extensions,https://learnscope.app/xapi/extensions/skill,id}' is not null
  and skill_id is null;



-- =============================================================================
-- 0022_skill_visible_on_profile.sql
-- =============================================================================

-- Per-skill visibility on the skills profile (0016), on top of the
-- existing account-level opt-in (profiles.skills_profile_visible).
-- Off by default -- only skills the learner has explicitly chosen to
-- show should appear, matching the account-level default.
alter table skills add column visible_on_profile boolean not null default false;

-- Tighten the connections-read policy from 0016 to also require the
-- individual skill to be marked visible, not just the account-level flag.
drop policy "Connections can view visible skills profiles" on skills;

create policy "Connections can view visible skills profiles"
  on skills for select
  using (
    visible_on_profile = true
    and exists (
      select 1 from profiles p
      where p.id = skills.user_id
        and p.skills_profile_visible = true
    )
    and exists (
      select 1 from skill_peer_ratings spr
      where (spr.rater_id = auth.uid() and spr.skill_owner_id = skills.user_id)
         or (spr.rater_id = skills.user_id and spr.skill_owner_id = auth.uid())
    )
  );



-- =============================================================================
-- 0023_skills_unique_name.sql
-- =============================================================================

-- Prevent adding the same skill twice: at most one skill row per learner
-- per name, case-insensitive. Checked for and cleaned up any pre-existing
-- duplicates in the live data before writing this migration, so this
-- should apply cleanly.
create unique index skills_user_id_name_lower_idx on skills (user_id, lower(name));



-- =============================================================================
-- 0024_skill_tags.sql
-- =============================================================================

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



-- =============================================================================
-- 0025_connection_invites_dedup.sql
-- =============================================================================

-- Revoke pre-existing duplicate pending invites (same skill + email, more
-- than one still pending) before adding the constraint below, keeping the
-- oldest of each group. Revoking rather than deleting preserves the row for
-- history. There is no user-facing DELETE/UPDATE policy on this table (only
-- the accept_invite_and_rate() function can change status), so this has to
-- run here with the SQL editor's elevated privileges.
update connection_invites ci
set status = 'revoked'
where ci.status = 'pending'
  and ci.invitee_email is not null
  and ci.id not in (
    select distinct on (skill_id, lower(invitee_email)) id
    from connection_invites
    where status = 'pending' and invitee_email is not null
    order by skill_id, lower(invitee_email), created_at asc
  );

-- Prevent sending a second invite to the same email for the same skill while
-- one is still outstanding. Scoped to status='pending' (not a permanent
-- block) so a fresh invite can still be sent after the first was accepted or
-- revoked -- skills change over time, and a person may reasonably be asked
-- to rate the same skill again later.
create unique index connection_invites_unique_pending_idx
  on connection_invites (skill_id, lower(invitee_email))
  where status = 'pending' and invitee_email is not null;



-- =============================================================================
-- 0026_drop_skill_experience_relationship.sql
-- =============================================================================

-- Drop the skill/experience "relationship" distinction (first_acquired /
-- developed / applied / demonstrated). A skill is either associated with an
-- experience or it isn't -- the extra dimension was never surfaced
-- meaningfully in the UI, and the only remaining writers (auto-linking a
-- newly created skill, and syncing "part of my current role") always used a
-- single hardcoded value anyway.
--
-- Dedupe any pre-existing rows that used more than one relationship for the
-- same (skill_id, experience_id) pair down to one, keeping the earliest,
-- before tightening the unique constraint.
--
-- skill_course_links carries the same shape for a different purpose
-- (courses, not experiences) and is intentionally left untouched.
delete from skill_experience_links
where id not in (
  select distinct on (skill_id, experience_id) id
  from skill_experience_links
  order by skill_id, experience_id, created_at asc
);

-- CASCADE drops the old (skill_id, experience_id, relationship) unique
-- constraint along with the column, since it depends on it.
alter table skill_experience_links drop column relationship cascade;

alter table skill_experience_links
  add constraint skill_experience_links_skill_id_experience_id_key unique (skill_id, experience_id);



-- =============================================================================
-- 0027_skill_peer_ratings_category_nullable.sql
-- =============================================================================

-- skills.category became nullable back in 0024 (replaced by tags), but this
-- snapshot column was never updated to match -- accept_invite_and_rate()
-- inserts v_skill.category directly, so rating any skill added since 0024
-- (which has no category at all) violates this NOT NULL constraint.
alter table skill_peer_ratings alter column skill_category drop not null;



-- =============================================================================
-- 0028_skill_library_privacy.sql
-- =============================================================================

-- Support the new "Find skill" / "Create skill" split: searching the shared
-- library now only surfaces public entries plus the searcher's own private
-- ones. Defaults to public (false) so every existing library entry stays
-- visible exactly as before.
alter table skill_library add column is_private boolean not null default false;

drop policy "Authenticated users can view the skill library" on skill_library;

create policy "Authenticated users can view public or their own private skill library entries"
  on skill_library for select
  to authenticated
  using (not is_private or created_by = auth.uid());

-- The old global unique-on-name index doesn't work once private entries
-- exist: a private entry invisible to everyone else would silently block
-- any other user from ever creating a public (or their own private) entry
-- with that same name, with no way for them to see why. Split it: public
-- names stay globally unique (that's the whole point of the shared
-- catalog); private names only need to be unique per creator.
drop index skill_library_name_lower_idx;

create unique index skill_library_public_name_lower_idx
  on skill_library (lower(name))
  where not is_private;

create unique index skill_library_private_name_lower_idx
  on skill_library (created_by, lower(name))
  where is_private;



-- =============================================================================
-- 0029_skill_baseline_quizzes.sql
-- =============================================================================

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



-- =============================================================================
-- 0030_ai_baseline_assessment.sql
-- =============================================================================

-- Recognizes an AI-synthesized baseline assessment as a third assessment
-- source alongside the existing self/course, so it lands in the same
-- history table rather than a parallel one.
alter table skill_assessments drop constraint skill_assessments_source_check;
alter table skill_assessments add constraint skill_assessments_source_check
  check (source in ('self', 'course', 'ai_baseline'));

-- Lets a skill's owner see whether one of their peer raters also tracks
-- that same skill themselves (matched via the shared skill_library entry),
-- and how far along that rater's own copy is. Used client-side to weight
-- peer ratings when the AI proposes a baseline level -- a rater who is
-- further along in their own development of the same skill counts for more.
-- Restricted to the skill's own owner; a rater has already disclosed their
-- name and opinion on this exact skill by rating it, so surfacing their own
-- progress on that same skill back to the owner is a bounded extension of
-- that existing disclosure, not a new one.
create or replace function get_peer_rater_progress(p_skill_id uuid)
returns table (
  peer_rating_id uuid,
  rater_level int,
  rater_lifecycle_stage text
)
language sql
security definer
set search_path = public
as $$
  select
    spr.id as peer_rating_id,
    rs.level as rater_level,
    rs.lifecycle_stage as rater_lifecycle_stage
  from skill_peer_ratings spr
  join skills target on target.id = spr.skill_id
  left join skills rs
    on rs.user_id = spr.rater_id
    and rs.library_skill_id = target.library_skill_id
    and target.library_skill_id is not null
  where spr.skill_id = p_skill_id
    and target.user_id = auth.uid();
$$;

grant execute on function get_peer_rater_progress(uuid) to authenticated;



-- =============================================================================
-- 0031_skill_targets.sql
-- =============================================================================

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



-- =============================================================================
-- 0032_revoke_invite.sql
-- =============================================================================

-- Lets an inviter revoke their own pending connection invite. Previously
-- only accept_invite_and_rate() could change status (for the invitee's
-- accept flow); this adds the one narrow transition an inviter is allowed
-- to make themselves -- pending to revoked, on their own invites only.
create policy "Inviters can revoke their own pending invites"
  on connection_invites for update
  using (auth.uid() = inviter_id and status = 'pending')
  with check (auth.uid() = inviter_id and status = 'revoked');



-- =============================================================================
-- 0033_peer_rating_no_autolevel.sql
-- =============================================================================

-- Peer ratings collected via an invite no longer silently roll the skill's
-- level forward -- ratings are informational history now; only an explicit
-- "Assess baseline" / "Evaluate Skill" action updates a skill's level.
create or replace function accept_invite_and_rate(p_code text, p_level int, p_comments text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite connection_invites%rowtype;
  v_skill skills%rowtype;
  v_rater_name text;
  v_rater_email text;
  v_rating_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_invite from connection_invites where share_code = p_code for update;
  if not found then
    raise exception 'Invite not found';
  end if;
  if v_invite.status != 'pending' then
    raise exception 'This invite has already been used.';
  end if;
  if v_invite.inviter_id = auth.uid() then
    raise exception 'You can''t rate your own skill.';
  end if;
  if p_level < 1 or p_level > 5 then
    raise exception 'Invalid level';
  end if;

  select * into v_skill from skills where id = v_invite.skill_id;
  select full_name into v_rater_name from profiles where id = auth.uid();
  select email into v_rater_email from auth.users where id = auth.uid();

  insert into skill_peer_ratings (
    skill_id, skill_name, skill_category, skill_owner_id,
    invite_id, rater_id, rater_name, rater_email, level, comments
  )
  values (
    v_invite.skill_id, v_skill.name, v_skill.category, v_skill.user_id,
    v_invite.id, auth.uid(), v_rater_name, v_rater_email, p_level, nullif(p_comments, '')
  )
  returning id into v_rating_id;

  update connection_invites
  set status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
  where id = v_invite.id;

  return v_rating_id;
end;
$$;

grant execute on function accept_invite_and_rate(text, int, text) to authenticated;



-- =============================================================================
-- 0034_skill_evaluation_source.sql
-- =============================================================================

-- Recognizes "Evaluate Skill" (an always-available AI re-assessment,
-- distinct from the one-time "Assess baseline" done while identified) as
-- another skill_assessments source.
alter table skill_assessments drop constraint skill_assessments_source_check;
alter table skill_assessments add constraint skill_assessments_source_check
  check (source in ('self', 'course', 'ai_baseline', 'ai_evaluation'));



-- =============================================================================
-- 0035_course_catalogue.sql
-- =============================================================================

-- Central, shared catalogue of available courses and learning objects that
-- learners can browse and enrol into -- distinct from the personal
-- `courses` table, which records a learner's own training history. Read
-- access is open to any authenticated learner; there is no insert/update
-- policy yet since only seeded placeholder data exists for now (an editor
-- for creating/importing catalogue entries is planned separately).
create table course_catalogue (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  provider text,
  course_type text,
  duration text,
  synopsis text,
  created_at timestamptz not null default now()
);

alter table course_catalogue enable row level security;

create policy "Authenticated users can view the course catalogue"
  on course_catalogue for select
  to authenticated
  using (true);

-- Optional link from a personal course record to the catalogue entry it
-- was enrolled from. Nullable -- most courses are still logged directly
-- without going through the catalogue. Enrolling snapshots the catalogue
-- entry's details onto a normal `courses` row rather than referencing it
-- live, so a learner's record stays intact even if the catalogue entry is
-- later edited or removed.
alter table courses add column catalogue_course_id uuid references course_catalogue(id) on delete set null;

create index courses_catalogue_course_id_idx on courses (catalogue_course_id);

insert into course_catalogue (name, provider, course_type, duration, synopsis) values
  ('Foundations of UX Design', 'Design Academy', 'Online', '6 weeks', 'Learn the core principles of user-centred design, from research through to wireframing and usability testing.'),
  ('Project Management Essentials', 'Business Institute', 'In-person', '3 days', 'A practical introduction to planning, scheduling and leading projects from kickoff to delivery.'),
  ('Data Analysis with Python', 'CodeCraft', 'Online', '8 weeks', 'Get hands-on with pandas, visualisation and statistics to turn raw data into decisions.'),
  ('Interior Space Planning', 'Design Academy', 'Blended', '4 weeks', 'Explore layout, flow and function to design interior spaces that work for the people who use them.'),
  ('Effective Public Speaking', 'Communication Hub', 'Workshop', '1 day', 'Build confidence and structure for presenting clearly to any audience, in person or online.');



-- =============================================================================
-- 0036_course_catalogue_skills_and_tags.sql
-- =============================================================================

-- Which skills (and the proficiency level a course helps a learner reach)
-- each catalogue course is associated with. References the shared
-- skill_library, not a learner's personal skills, since the catalogue
-- itself isn't scoped to any one learner. A course can target zero or
-- more skills, each at one target level.
create table course_catalogue_skills (
  id uuid primary key default gen_random_uuid(),
  course_catalogue_id uuid references course_catalogue(id) on delete cascade not null,
  skill_library_id uuid references skill_library(id) on delete cascade not null,
  level int not null check (level between 1 and 5),
  created_at timestamptz not null default now(),
  unique (course_catalogue_id, skill_library_id)
);

alter table course_catalogue_skills enable row level security;

create policy "Authenticated users can view course catalogue skills"
  on course_catalogue_skills for select
  to authenticated
  using (true);

create index course_catalogue_skills_course_idx on course_catalogue_skills (course_catalogue_id);
create index course_catalogue_skills_skill_idx on course_catalogue_skills (skill_library_id);

-- Category tags on catalogue courses, reusing the same shared `tags`
-- vocabulary already used for skills (0024) so browsing/filtering uses one
-- consistent tag list rather than a separate course-only one.
create table course_catalogue_tags (
  id uuid primary key default gen_random_uuid(),
  course_catalogue_id uuid references course_catalogue(id) on delete cascade not null,
  tag_id uuid references tags(id) on delete cascade not null,
  created_at timestamptz not null default now(),
  unique (course_catalogue_id, tag_id)
);

alter table course_catalogue_tags enable row level security;

create policy "Authenticated users can view course catalogue tags"
  on course_catalogue_tags for select
  to authenticated
  using (true);

create index course_catalogue_tags_course_idx on course_catalogue_tags (course_catalogue_id);
create index course_catalogue_tags_tag_idx on course_catalogue_tags (tag_id);

-- Seed: give the 5 placeholder courses from 0035 representative skill and
-- tag associations, reusing existing skill_library/tags entries where they
-- already exist (both tables dedupe case-insensitively by name).
-- skill_library's plain lower(name) unique index was replaced in 0028 by
-- two partial indexes (public vs. private entries); match the public one
-- explicitly since these seeded entries are public (the column default).
insert into skill_library (name) values
  ('UX Design'), ('Project Management'), ('Data Analysis'), ('Interior Design'), ('Public Speaking')
on conflict ((lower(name))) where not is_private do nothing;

insert into tags (name) values
  ('Design'), ('Business'), ('Technical'), ('Communication')
on conflict ((lower(name))) do nothing;

insert into course_catalogue_skills (course_catalogue_id, skill_library_id, level)
select cc.id, sl.id, v.level
from (values
  ('Foundations of UX Design', 'UX Design', 2),
  ('Project Management Essentials', 'Project Management', 2),
  ('Data Analysis with Python', 'Data Analysis', 3),
  ('Interior Space Planning', 'Interior Design', 3),
  ('Effective Public Speaking', 'Public Speaking', 2)
) as v(course_name, skill_name, level)
join course_catalogue cc on cc.name = v.course_name
join skill_library sl on lower(sl.name) = lower(v.skill_name)
on conflict (course_catalogue_id, skill_library_id) do nothing;

insert into course_catalogue_tags (course_catalogue_id, tag_id)
select cc.id, t.id
from (values
  ('Foundations of UX Design', 'Design'),
  ('Project Management Essentials', 'Business'),
  ('Data Analysis with Python', 'Technical'),
  ('Interior Space Planning', 'Design'),
  ('Effective Public Speaking', 'Communication')
) as v(course_name, tag_name)
join course_catalogue cc on cc.name = v.course_name
join tags t on lower(t.name) = lower(v.tag_name)
on conflict (course_catalogue_id, tag_id) do nothing;



-- =============================================================================
-- 0037_experience_types_and_org_url.sql
-- =============================================================================

-- Broaden the experience timeline beyond employment/education to also
-- cover projects, volunteer positions, and other experience -- these are
-- all "chapters" in the learner's development the same way a job is, just
-- without an employment relationship.
alter table experience drop constraint experience_type_check;
alter table experience add constraint experience_type_check
  check (type in ('education', 'employment', 'project', 'volunteer', 'other'));

-- Optional organization website, used to look up a logo to display next to
-- the organization name (looked up client-side from the domain -- nothing
-- to backfill here).
alter table experience add column organization_url text;



-- =============================================================================
-- 0038_experience_course_type.sql
-- =============================================================================

-- Add "Course / Training" as its own experience type, alongside
-- employment/education/project/volunteer/other. This is a separate,
-- lighter-weight way to note a course as a timeline chapter using the
-- existing generic experience fields (title, provider, provider website,
-- dates, description) -- it does not touch the standalone `courses` table,
-- the training catalogue, or skill-to-course evidence linking, which stay
-- as they are and solve a different problem (which courses evidence which
-- skills).
alter table experience drop constraint experience_type_check;
alter table experience add constraint experience_type_check
  check (type in ('education', 'employment', 'project', 'volunteer', 'other', 'course'));



-- =============================================================================
-- 0039_experience_organization_nullable.sql
-- =============================================================================

-- The Project, Other Experience, and Course/Training experience types all
-- treat organization as optional at the app layer (not every project or
-- course has a formal organization behind it), but the column was still
-- `not null` from the original employment/education-only schema. Relax it
-- to match.
alter table experience alter column organization drop not null;



-- =============================================================================
-- 0040_experience_parent_link.sql
-- =============================================================================

-- Lets a Project or Course/Training Record be recorded as part of a Job or
-- Volunteer Position, rather than as an unrelated top-level chapter. A
-- nullable self-reference (not a join table) is enough since each
-- sub-experience belongs to at most one parent; "on delete set null" means
-- deleting the parent role doesn't destroy the project/course record it
-- was linked from -- it just becomes unlinked, matching the rule that
-- unlinking must not delete the underlying record.
alter table experience add column parent_experience_id uuid references experience(id) on delete set null;

create index experience_parent_experience_id_idx on experience (parent_experience_id);



-- =============================================================================
-- 0041_skill_validation.sql
-- =============================================================================

-- Per-skill opt-in to being asked to validate someone else's claim to have
-- reached their target level on this same skill. Deliberately narrower and
-- separate from the existing account-level skills_profile_visible flag
-- (0016) -- that's about letting connections browse your skills profile;
-- this is specifically about offering to assess other people's evidence.
-- Off by default, matching every other cross-user visibility flag so far.
alter table skills add column offer_validate_connections boolean not null default false;
alter table skills add column offer_validate_others boolean not null default false;

-- A single ask: "will you confirm I've reached my target level for this
-- skill". One row per request. A requester can ask several different
-- validators in parallel, but not send a second pending request to the same
-- validator for the same skill while one is already outstanding.
create table skill_validation_requests (
  id uuid primary key default gen_random_uuid(),
  skill_id uuid references skills(id) on delete cascade not null,
  requester_id uuid references auth.users(id) not null,
  validator_id uuid references auth.users(id) not null,
  target_level int not null check (target_level between 1 and 5),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'declined')),
  decision_comments text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

alter table skill_validation_requests enable row level security;

create unique index skill_validation_requests_pending_idx
  on skill_validation_requests (skill_id, validator_id)
  where status = 'pending';

create index skill_validation_requests_skill_id_idx on skill_validation_requests (skill_id);
create index skill_validation_requests_validator_id_idx on skill_validation_requests (validator_id);

create policy "Requesters can view their own validation requests"
  on skill_validation_requests for select
  using (auth.uid() = requester_id);

create policy "Validators can view requests addressed to them"
  on skill_validation_requests for select
  using (auth.uid() = validator_id);

-- The eligibility rule is enforced here, not just in the client: the named
-- validator must actually have this same skill (by library_skill_id) at or
-- above the requested target level, already be in the maintaining phase
-- themselves, and have opted in -- either broadly (offer_validate_others) or
-- to connections specifically (offer_validate_connections), where
-- "connection" is defined the same way it already is elsewhere in the app:
-- an existing skill_peer_ratings row between the two accounts.
create policy "Requesters can create requests for their own skills, to eligible validators"
  on skill_validation_requests for insert
  with check (
    auth.uid() = requester_id
    and exists (
      select 1 from skills req
      where req.id = skill_id and req.user_id = auth.uid()
    )
    and exists (
      select 1 from skills req
      join skills val on val.library_skill_id = req.library_skill_id
      where req.id = skill_id
        and val.user_id = validator_id
        and val.lifecycle_stage in ('validated', 'maintained')
        and val.level >= target_level
        and (
          val.offer_validate_others = true
          or (
            val.offer_validate_connections = true
            and exists (
              select 1 from skill_peer_ratings spr
              where (spr.rater_id = auth.uid() and spr.skill_owner_id = validator_id)
                 or (spr.rater_id = validator_id and spr.skill_owner_id = auth.uid())
            )
          )
        )
    )
  );

create policy "Validators can decide on requests addressed to them"
  on skill_validation_requests for update
  using (auth.uid() = validator_id and status = 'pending')
  with check (auth.uid() = validator_id);

-- Evidence access grant: once a request naming them exists (whatever its
-- status), the validator can read that one skill's full record -- the skill
-- itself, its targets, self/AI/peer/course assessments, peer ratings,
-- linked training, and recorded activity. Access persists for as long as
-- the request row exists, so a validator can always refer back to what they
-- reviewed and decided.
create policy "Validators can view skills they're validating"
  on skills for select
  using (
    exists (
      select 1 from skill_validation_requests svr
      where svr.skill_id = skills.id and svr.validator_id = auth.uid()
    )
  );

create policy "Validators can view targets for skills they're validating"
  on skill_targets for select
  using (
    exists (
      select 1 from skill_validation_requests svr
      where svr.skill_id = skill_targets.skill_id and svr.validator_id = auth.uid()
    )
  );

create policy "Validators can view assessments for skills they're validating"
  on skill_assessments for select
  using (
    exists (
      select 1 from skill_validation_requests svr
      where svr.skill_id = skill_assessments.skill_id and svr.validator_id = auth.uid()
    )
  );

create policy "Validators can view peer ratings for skills they're validating"
  on skill_peer_ratings for select
  using (
    exists (
      select 1 from skill_validation_requests svr
      where svr.skill_id = skill_peer_ratings.skill_id and svr.validator_id = auth.uid()
    )
  );

create policy "Validators can view course links for skills they're validating"
  on skill_course_links for select
  using (
    exists (
      select 1 from skill_validation_requests svr
      where svr.skill_id = skill_course_links.skill_id and svr.validator_id = auth.uid()
    )
  );

create policy "Validators can view activity for skills they're validating"
  on xapi_statements for select
  using (
    skill_id is not null
    and exists (
      select 1 from skill_validation_requests svr
      where svr.skill_id = xapi_statements.skill_id and svr.validator_id = auth.uid()
    )
  );

-- Evidence files are stored at {owner_user_id}/{skill_id}/..., so this can
-- be scoped to the exact skill rather than the owner's whole evidence
-- library.
create policy "Validators can view evidence files for skills they're validating"
  on storage.objects for select
  using (
    bucket_id = 'skill-evidence'
    and exists (
      select 1 from skill_validation_requests svr
      where svr.validator_id = auth.uid()
        and svr.skill_id::text = (storage.foldername(name))[2]
    )
  );

-- Narrow discovery surface for "who could I ask to validate this skill" --
-- exposes only what's needed to pick someone (name, avatar, level, whether
-- they're a connection), not the rest of their skill record.
-- security_invoker ensures the view runs with the querying user's own
-- permissions, not the (highly privileged) view owner's, though the WHERE
-- clause below already enforces the same eligibility rule as the insert
-- policy above.
create view validator_directory
  with (security_invoker = true)
as
select
  s.id as skill_id,
  s.user_id as validator_id,
  s.library_skill_id,
  s.level,
  s.lifecycle_stage,
  s.offer_validate_connections,
  s.offer_validate_others,
  p.full_name,
  p.avatar_url,
  exists (
    select 1 from skill_peer_ratings spr
    where (spr.rater_id = auth.uid() and spr.skill_owner_id = s.user_id)
       or (spr.rater_id = s.user_id and spr.skill_owner_id = auth.uid())
  ) as is_connection
from skills s
join profiles p on p.id = s.user_id
where s.lifecycle_stage in ('validated', 'maintained')
  and s.user_id != auth.uid()
  and (
    s.offer_validate_others = true
    or (
      s.offer_validate_connections = true
      and exists (
        select 1 from skill_peer_ratings spr
        where (spr.rater_id = auth.uid() and spr.skill_owner_id = s.user_id)
           or (spr.rater_id = s.user_id and spr.skill_owner_id = auth.uid())
      )
    )
  );

grant select on validator_directory to authenticated;

-- Runs as the validator, but needs to update the requester's skill record
-- when confirming -- the same "security definer function performs the one
-- specific privileged action, after checking the caller is who they claim
-- to be" pattern already used by accept_invite_and_rate() (0010).
create or replace function decide_validation_request(p_request_id uuid, p_confirmed boolean, p_comments text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request skill_validation_requests%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_request from skill_validation_requests where id = p_request_id for update;
  if not found then
    raise exception 'Request not found';
  end if;
  if v_request.validator_id != auth.uid() then
    raise exception 'Not authorized';
  end if;
  if v_request.status != 'pending' then
    raise exception 'This request has already been decided.';
  end if;

  update skill_validation_requests
  set status = case when p_confirmed then 'confirmed' else 'declined' end,
      decision_comments = nullif(p_comments, ''),
      decided_at = now()
  where id = p_request_id;

  if p_confirmed then
    update skills
    set lifecycle_stage = 'validated', level = v_request.target_level
    where id = v_request.skill_id;
  end if;
end;
$$;

grant execute on function decide_validation_request(uuid, boolean, text) to authenticated;

-- The validator's email is never exposed through validator_directory (that
-- view is deliberately limited to name/avatar/level for browsing) -- it's
-- only revealed to the requester once a request already exists, so they can
-- send the notification email for that specific request.
create or replace function get_validation_request_contact(p_request_id uuid)
returns table (email text, full_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request skill_validation_requests%rowtype;
begin
  select * into v_request from skill_validation_requests where id = p_request_id;
  if not found then
    raise exception 'Request not found';
  end if;
  if v_request.requester_id != auth.uid() then
    raise exception 'Not authorized';
  end if;
  return query
    select u.email, p.full_name
    from auth.users u
    left join profiles p on p.id = u.id
    where u.id = v_request.validator_id;
end;
$$;

grant execute on function get_validation_request_contact(uuid) to authenticated;



-- =============================================================================
-- 0042_validator_discovery_visibility.sql
-- =============================================================================

-- validator_directory (0041) is security_invoker, so it only ever returns
-- rows the querying user is independently allowed to SELECT from `skills`.
-- No existing policy covered that case -- only the owner, or a connection
-- when skills_profile_visible/visible_on_profile are both on -- so the view
-- always came back empty for a genuine unrelated validator candidate. This
-- adds the missing narrow policy: a skill is discoverable for validation
-- purposes once its owner has reached validated/maintained and opted in,
-- either broadly or to connections specifically (same connection definition
-- used everywhere else: an existing skill_peer_ratings row either way).
create policy "Skills open to being asked to validate are discoverable"
  on skills for select
  using (
    lifecycle_stage in ('validated', 'maintained')
    and (
      offer_validate_others = true
      or (
        offer_validate_connections = true
        and exists (
          select 1 from skill_peer_ratings spr
          where (spr.rater_id = auth.uid() and spr.skill_owner_id = skills.user_id)
             or (spr.rater_id = skills.user_id and spr.skill_owner_id = auth.uid())
        )
      )
    )
  );



-- =============================================================================
-- 0043_fix_validation_contact_type.sql
-- =============================================================================

-- auth.users.email is varchar(255), not text, so the function declared in
-- 0041 failed at call time with "structure of query does not match function
-- result type". Cast explicitly to match the declared return type.
create or replace function get_validation_request_contact(p_request_id uuid)
returns table (email text, full_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request skill_validation_requests%rowtype;
begin
  select * into v_request from skill_validation_requests where id = p_request_id;
  if not found then
    raise exception 'Request not found';
  end if;
  if v_request.requester_id != auth.uid() then
    raise exception 'Not authorized';
  end if;
  return query
    select u.email::text, p.full_name
    from auth.users u
    left join profiles p on p.id = u.id
    where u.id = v_request.validator_id;
end;
$$;



-- =============================================================================
-- 0044_validator_course_visibility.sql
-- =============================================================================

-- 0041 granted validators SELECT on skill_course_links (the join row) for
-- skills they're validating, but never on courses itself -- so the embedded
-- `skill_course_links.select('courses(name, completed_date)')` join used by
-- the validation review screen silently dropped the course under RLS,
-- leaving linked-training evidence invisible. Mirrors the scoping used by
-- every other "Validators can view ... for skills they're validating" policy
-- from 0041: readable only via a skill_course_links row tied to a skill the
-- validator has an active/decided request for.
create policy "Validators can view courses linked to skills they're validating"
  on courses for select
  using (
    exists (
      select 1
      from skill_course_links scl
      join skill_validation_requests svr on svr.skill_id = scl.skill_id
      where scl.course_id = courses.id
        and svr.validator_id = auth.uid()
    )
  );



-- =============================================================================
-- 0045_skill_highest_lifecycle_stage.sql
-- =============================================================================

-- Tracks the furthest a skill has ever gotten through its lifecycle,
-- separate from `lifecycle_stage` (the current/active stage), now that a
-- learner can click an earlier stage on the timeline to move the skill back
-- to it -- without this, doing so would look identical to never having
-- reached the later stage at all.
alter table skills add column highest_lifecycle_stage text
  check (highest_lifecycle_stage in (
    'identified',
    'baseline_assessed',
    'target_set',
    'developing',
    'demonstrated',
    'validated',
    'maintained',
    'at_risk',
    'archived'
  ));

-- An existing skill's current stage is, by definition, at least as far as
-- it's ever knowingly reached -- there's no historical trail to
-- reconstruct anything better than that for rows that already exist.
update skills set highest_lifecycle_stage = lifecycle_stage where lifecycle_stage is not null;

-- Keeps highest_lifecycle_stage monotonically non-decreasing regardless of
-- which code path moves lifecycle_stage -- the click-to-revert UI, the
-- forward stage-advance actions, or the decide_validation_request RPC
-- (0041). A trigger is used instead of repeating "take the max" logic at
-- every one of those call sites, so it can't drift out of sync at a call
-- site added later.
--
-- Fires on every insert/update (not scoped to "update of lifecycle_stage")
-- and always compares against OLD, not the client-submitted NEW, so a
-- client can't forge or erase the high-water mark by including
-- highest_lifecycle_stage directly in the same UPDATE -- whatever value
-- they send for that column is discarded and recomputed here. This is the
-- one column deliberately not owner-writable in practice, even though RLS
-- only checks user_id, not individual columns.
-- at_risk/archived are exception states outside the normal forward flow,
-- so they neither advance nor reset the high-water mark.
create or replace function sync_skill_highest_lifecycle_stage()
returns trigger
language plpgsql
as $$
declare
  flow_stages text[] := array['identified', 'baseline_assessed', 'target_set', 'developing', 'demonstrated', 'validated', 'maintained'];
  new_rank int;
  highest_rank int;
  prior_highest text;
begin
  prior_highest := case when tg_op = 'UPDATE' then old.highest_lifecycle_stage else null end;
  new.highest_lifecycle_stage := prior_highest;

  if new.lifecycle_stage is null then
    return new;
  end if;

  new_rank := array_position(flow_stages, new.lifecycle_stage);
  if new_rank is null then
    return new;
  end if;

  highest_rank := array_position(flow_stages, prior_highest);
  if highest_rank is null or new_rank > highest_rank then
    new.highest_lifecycle_stage := new.lifecycle_stage;
  end if;

  return new;
end;
$$;

create trigger skills_sync_highest_lifecycle_stage
  before insert or update on skills
  for each row
  execute function sync_skill_highest_lifecycle_stage();



-- =============================================================================
-- 0046_skill_knowledge_axis.sql
-- =============================================================================

-- Splits the single proficiency scale into two parallel axes: the existing
-- skills.level (kept for practical/demonstrated ability) and a new
-- skills.knowledge_level (theoretical understanding). skill_assessments now
-- tags each row with which axis it's evidence for, defaulting existing rows
-- to 'practical' so nothing already recorded changes meaning.
alter table skill_assessments add column axis text not null default 'practical'
  check (axis in ('practical', 'knowledge'));

alter table skills add column knowledge_level int check (knowledge_level between 1 and 5);



-- =============================================================================
-- 0047_skill_knowledge_level_guide.sql
-- =============================================================================

-- Caches the AI-generated per-level knowledge guidance (5 statements, one
-- per level) so opening the knowledge self-assessment doesn't call the LLM
-- every time -- generated once (at skill creation, or lazily the first time
-- it's needed) and reused after that.
alter table skills add column knowledge_level_guide jsonb;



-- =============================================================================
-- 0048_confirming_baseline_lifecycle_stage.sql
-- =============================================================================

-- Inserts a new lifecycle stage, "Confirming Baseline", between
-- "Establishing Baseline" (identified) and "Target Setting"
-- (baseline_assessed) -- once a skill's baseline is AI-assessed it now
-- needs a level-calibrated knowledge check before advancing to target
-- setting, rather than moving straight there.
alter table skills drop constraint skills_lifecycle_stage_check;
alter table skills add constraint skills_lifecycle_stage_check
  check (lifecycle_stage in (
    'identified',
    'confirming_baseline',
    'baseline_assessed',
    'target_set',
    'developing',
    'demonstrated',
    'validated',
    'maintained',
    'at_risk',
    'archived'
  ));

alter table skills drop constraint skills_highest_lifecycle_stage_check;
alter table skills add constraint skills_highest_lifecycle_stage_check
  check (highest_lifecycle_stage in (
    'identified',
    'confirming_baseline',
    'baseline_assessed',
    'target_set',
    'developing',
    'demonstrated',
    'validated',
    'maintained',
    'at_risk',
    'archived'
  ));

-- Re-defined with confirming_baseline inserted into the ranked flow, so the
-- high-water-mark trigger (0045) ranks it correctly relative to the stages
-- on either side of it.
create or replace function sync_skill_highest_lifecycle_stage()
returns trigger
language plpgsql
as $$
declare
  flow_stages text[] := array['identified', 'confirming_baseline', 'baseline_assessed', 'target_set', 'developing', 'demonstrated', 'validated', 'maintained'];
  new_rank int;
  highest_rank int;
  prior_highest text;
begin
  prior_highest := case when tg_op = 'UPDATE' then old.highest_lifecycle_stage else null end;
  new.highest_lifecycle_stage := prior_highest;

  if new.lifecycle_stage is null then
    return new;
  end if;

  new_rank := array_position(flow_stages, new.lifecycle_stage);
  if new_rank is null then
    return new;
  end if;

  highest_rank := array_position(flow_stages, prior_highest);
  if highest_rank is null or new_rank > highest_rank then
    new.highest_lifecycle_stage := new.lifecycle_stage;
  end if;

  return new;
end;
$$;



-- =============================================================================
-- 0049_skill_diagnostic_content.sql
-- =============================================================================

-- Shared, reusable diagnostic content (e.g. a level-calibrated quiz question
-- bank) -- the xAPI-Activity-Definition-shaped "what to ask", generated once
-- per skill+level+axis and reused by every learner doing that same check,
-- rather than regenerated (and re-billed) per learner. Keyed off the shared
-- skill_library catalog, not a personal skills row, since the whole point is
-- cross-user reuse. diagnostic_type is constrained to include 'interview'
-- from day one so a future conversational diagnostic can reuse this table
-- for its own cacheable content (e.g. a rubric/prompt template) without a
-- migration, even though only 'quiz' rows are ever written today.
--
-- Deliberately no insert/update/delete policy for regular users -- writes
-- only ever happen server-side (service-role) from the generation endpoint,
-- so a client can never poison a shared answer key that every other learner
-- of that skill+level then relies on. If a prompt is later improved,
-- prompt_version mints a new row rather than editing an old one.
create table skill_diagnostic_content (
  id uuid primary key default gen_random_uuid(),
  diagnostic_type text not null check (diagnostic_type in ('quiz', 'interview')),
  axis text not null default 'knowledge' check (axis in ('practical', 'knowledge')),
  library_skill_id uuid not null references skill_library(id) on delete cascade,
  skill_name text not null,
  level int not null check (level between 1 and 5),
  prompt_version int not null default 1,
  content jsonb not null,
  created_at timestamptz not null default now()
);

create unique index skill_diagnostic_content_identity_idx
  on skill_diagnostic_content (diagnostic_type, axis, library_skill_id, level, prompt_version);

alter table skill_diagnostic_content enable row level security;

create policy "Authenticated users can view diagnostic content"
  on skill_diagnostic_content for select
  to authenticated
  using (true);



-- =============================================================================
-- 0050_diagnostic_confirmed_assessment_source.sql
-- =============================================================================

-- Recognizes the Confirming Baseline knowledge-check quiz's confirm step as
-- another skill_assessments source, distinct from 'ai_baseline' (a
-- multi-source AI synthesis) since this is a single, MCQ-based, explicitly
-- learner-confirmed evidence type.
alter table skill_assessments drop constraint skill_assessments_source_check;
alter table skill_assessments add constraint skill_assessments_source_check
  check (source in ('self', 'course', 'ai_baseline', 'ai_evaluation', 'diagnostic_confirmed'));



-- =============================================================================
-- 0051_rls_helper_functions.sql
-- =============================================================================

-- Centralizes two RLS checks that were duplicated verbatim across several
-- policies (a real drift risk -- a future policy could easily get the
-- subquery subtly wrong). Behavior-preserving: every existing call site
-- already only ever evaluates these with auth.uid() as one of the two
-- parties, so both functions are SECURITY INVOKER (the default -- no
-- `security definer`) and remain correctly scoped by the querying user's
-- own RLS on skill_peer_ratings/skill_validation_requests, exactly as the
-- inline subqueries were. No table, column, or data changes.

-- Whether two users are "connected" -- defined the same way it already is
-- everywhere else in the app: an existing skill_peer_ratings row between
-- them, in either direction.
create or replace function is_connected(a uuid, b uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from skill_peer_ratings spr
    where (spr.rater_id = a and spr.skill_owner_id = b)
       or (spr.rater_id = b and spr.skill_owner_id = a)
  )
$$;

grant execute on function is_connected(uuid, uuid) to authenticated;

-- Whether p_user_id is a validator for p_skill_id -- has a
-- skill_validation_requests row naming them validator_id on that skill,
-- pending or decided (matches the scoping already used by every "Validators
-- can view ... for skills they're validating" policy).
create or replace function is_skill_validator(p_skill_id uuid, p_user_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from skill_validation_requests svr
    where svr.skill_id = p_skill_id and svr.validator_id = p_user_id
  )
$$;

grant execute on function is_skill_validator(uuid, uuid) to authenticated;

-- skills: "Connections can view visible skills profiles" (0022)
drop policy "Connections can view visible skills profiles" on skills;
create policy "Connections can view visible skills profiles"
  on skills for select
  using (
    visible_on_profile = true
    and exists (
      select 1 from profiles p
      where p.id = skills.user_id
        and p.skills_profile_visible = true
    )
    and is_connected(auth.uid(), skills.user_id)
  );

-- skills: "Skills open to being asked to validate are discoverable" (0042)
drop policy "Skills open to being asked to validate are discoverable" on skills;
create policy "Skills open to being asked to validate are discoverable"
  on skills for select
  using (
    lifecycle_stage in ('validated', 'maintained')
    and (
      offer_validate_others = true
      or (offer_validate_connections = true and is_connected(auth.uid(), skills.user_id))
    )
  );

-- skills: "Validators can view skills they're validating" (0041)
drop policy "Validators can view skills they're validating" on skills;
create policy "Validators can view skills they're validating"
  on skills for select
  using (is_skill_validator(skills.id, auth.uid()));

-- skill_tags: "Connections can view tags on visible skills" (0024)
drop policy "Connections can view tags on visible skills" on skill_tags;
create policy "Connections can view tags on visible skills"
  on skill_tags for select
  using (
    exists (
      select 1 from skills s
      join profiles p on p.id = s.user_id
      where s.id = skill_tags.skill_id
        and s.visible_on_profile = true
        and p.skills_profile_visible = true
        and is_connected(auth.uid(), s.user_id)
    )
  );

-- skill_targets: "Validators can view targets for skills they're validating" (0041)
drop policy "Validators can view targets for skills they're validating" on skill_targets;
create policy "Validators can view targets for skills they're validating"
  on skill_targets for select
  using (is_skill_validator(skill_targets.skill_id, auth.uid()));

-- skill_assessments: "Validators can view assessments for skills they're validating" (0041)
drop policy "Validators can view assessments for skills they're validating" on skill_assessments;
create policy "Validators can view assessments for skills they're validating"
  on skill_assessments for select
  using (is_skill_validator(skill_assessments.skill_id, auth.uid()));

-- skill_peer_ratings: "Validators can view peer ratings for skills they're validating" (0041)
drop policy "Validators can view peer ratings for skills they're validating" on skill_peer_ratings;
create policy "Validators can view peer ratings for skills they're validating"
  on skill_peer_ratings for select
  using (is_skill_validator(skill_peer_ratings.skill_id, auth.uid()));

-- skill_course_links: "Validators can view course links for skills they're validating" (0041)
drop policy "Validators can view course links for skills they're validating" on skill_course_links;
create policy "Validators can view course links for skills they're validating"
  on skill_course_links for select
  using (is_skill_validator(skill_course_links.skill_id, auth.uid()));

-- xapi_statements: "Validators can view activity for skills they're validating" (0041)
-- skill_id is nullable on this table, so the not-null guard stays explicit.
drop policy "Validators can view activity for skills they're validating" on xapi_statements;
create policy "Validators can view activity for skills they're validating"
  on xapi_statements for select
  using (skill_id is not null and is_skill_validator(xapi_statements.skill_id, auth.uid()));

-- courses: "Validators can view courses linked to skills they're validating" (0044)
drop policy "Validators can view courses linked to skills they're validating" on courses;
create policy "Validators can view courses linked to skills they're validating"
  on courses for select
  using (
    exists (
      select 1 from skill_course_links scl
      where scl.course_id = courses.id
        and is_skill_validator(scl.skill_id, auth.uid())
    )
  );

-- skill_validation_requests: "Requesters can create requests for their own
-- skills, to eligible validators" (0041) -- only the nested connected-check
-- changes; the rest of the eligibility rule (skill ownership, matching
-- library_skill_id, validator's own level/stage, opt-in flag) is unchanged.
drop policy "Requesters can create requests for their own skills, to eligible validators" on skill_validation_requests;
create policy "Requesters can create requests for their own skills, to eligible validators"
  on skill_validation_requests for insert
  with check (
    auth.uid() = requester_id
    and exists (
      select 1 from skills req
      where req.id = skill_id and req.user_id = auth.uid()
    )
    and exists (
      select 1 from skills req
      join skills val on val.library_skill_id = req.library_skill_id
      where req.id = skill_id
        and val.user_id = validator_id
        and val.lifecycle_stage in ('validated', 'maintained')
        and val.level >= target_level
        and (
          val.offer_validate_others = true
          or (val.offer_validate_connections = true and is_connected(auth.uid(), validator_id))
        )
    )
  );

-- validator_directory (0041) -- recreated to use the helper; grants don't
-- survive a view drop, so the select grant is re-issued at the end.
drop view validator_directory;
create view validator_directory
  with (security_invoker = true)
as
select
  s.id as skill_id,
  s.user_id as validator_id,
  s.library_skill_id,
  s.level,
  s.lifecycle_stage,
  s.offer_validate_connections,
  s.offer_validate_others,
  p.full_name,
  p.avatar_url,
  is_connected(auth.uid(), s.user_id) as is_connection
from skills s
join profiles p on p.id = s.user_id
where s.lifecycle_stage in ('validated', 'maintained')
  and s.user_id != auth.uid()
  and (
    s.offer_validate_others = true
    or (s.offer_validate_connections = true and is_connected(auth.uid(), s.user_id))
  );

grant select on validator_directory to authenticated;



-- =============================================================================
-- 0052_fix_skill_course_links_courses_rls_recursion.sql
-- =============================================================================

-- skill_course_links' base policy ("Users manage their own skill-course
-- links", 0018) checks `exists (select 1 from courses where courses.id =
-- course_id and courses.user_id = auth.uid())` as part of its WITH CHECK.
-- Evaluating that subquery re-applies courses' own SELECT policies, one of
-- which ("Validators can view courses linked to skills they're validating",
-- 0044, redefined in 0051) queries skill_course_links again -- a live
-- two-way RLS dependency Postgres reports as "infinite recursion detected in
-- policy for relation skill_course_links". Hit on any INSERT into
-- skill_course_links (e.g. Course Catalogue -> Enrol from a skill's Training
-- tab, via enrolInCatalogueCourse in src/lib/courseCatalogue.js).
--
-- Same shape of bug as 0017 (skills <-> skill_peer_ratings), fixed the same
-- way: move the cross-table check into a SECURITY DEFINER function so it
-- bypasses RLS internally instead of re-entering skill_course_links'
-- policies while skill_course_links' own policy is still being evaluated.
create or replace function is_course_linked_to_validating_skill(p_course_id uuid, p_validator_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from skill_course_links scl
    join skill_validation_requests svr on svr.skill_id = scl.skill_id
    where scl.course_id = p_course_id
      and svr.validator_id = p_validator_id
  )
$$;

grant execute on function is_course_linked_to_validating_skill(uuid, uuid) to authenticated;

drop policy "Validators can view courses linked to skills they're validating" on courses;
create policy "Validators can view courses linked to skills they're validating"
  on courses for select
  using (is_course_linked_to_validating_skill(courses.id, auth.uid()));



-- =============================================================================
-- 0053_skill_tracker_count.sql
-- =============================================================================

-- Anonymous, count-only lookup for "how many people (across all users, not
-- just connections) track this same skill" -- used by the new statistics
-- section on the skill page. Deliberately returns only an integer, never
-- rows: this is the one place in the schema that aggregates across users
-- without requiring their skills_profile_visible/visible_on_profile opt-in,
-- since a bare count can't identify anyone. SECURITY DEFINER so it can see
-- every user's skills rows for the count, bypassing the normal per-row RLS
-- that would otherwise restrict this to the caller's own + opted-in
-- connections' skills.
create or replace function count_skill_trackers(p_library_skill_id uuid)
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select count(distinct user_id)::integer
  from skills
  where library_skill_id = p_library_skill_id
$$;

grant execute on function count_skill_trackers(uuid) to authenticated;



-- =============================================================================
-- 0054_signup_names_and_onboarding.sql
-- =============================================================================

-- Signup now collects first/last name; rather than adding first_name/
-- last_name columns alongside the existing full_name (a competing
-- representation of the same information), the two values are combined
-- client-side and passed through signUp's user metadata, which this
-- trigger picks up when it creates the profile row -- before email
-- confirmation, since auth.users gets the insert immediately either way.
-- Falls back to whatever a provider (e.g. Google OAuth) already supplies
-- as full_name/name, so that path keeps working exactly as before.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    nullif(
      coalesce(
        nullif(trim(concat_ws(' ', new.raw_user_meta_data ->> 'first_name', new.raw_user_meta_data ->> 'last_name')), ''),
        new.raw_user_meta_data ->> 'full_name',
        new.raw_user_meta_data ->> 'name'
      ),
      ''
    )
  );
  return new;
end;
$$;

-- Gates the first-login wizard: null means "hasn't gone through it yet".
-- Backfilled to "already done" for every existing account below so the
-- wizard only ever appears for accounts created after this migration.
alter table profiles add column onboarding_completed_at timestamptz;

update profiles set onboarding_completed_at = now() where onboarding_completed_at is null;



-- =============================================================================
-- 0055_skill_library_tags.sql
-- =============================================================================

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



-- =============================================================================
-- 0056_split_profile_name.sql
-- =============================================================================

-- Splits the single full_name field into first_name/last_name so the
-- profile edit form (and CV import) can work with them separately,
-- matching what signup already collects. full_name becomes a generated
-- column derived from the two rather than a second stored copy -- the
-- dozen+ read-only call sites across the app (AppHeader, connections,
-- validation requests, etc.) all just SELECT full_name for display, so
-- keeping it as a real, always-in-sync column means none of them need to
-- change; only the few places that write a name needed updating.

alter table profiles add column first_name text;
alter table profiles add column last_name text;

-- Backfill from the existing full_name: first word -> first_name, the
-- remainder -> last_name. Collapses repeated internal whitespace (e.g.
-- "John   Smith") to a single space first, so the regenerated full_name
-- below reproduces the original faithfully rather than just approximately.
update profiles
set
  first_name = split_part(regexp_replace(trim(full_name), '\s+', ' ', 'g'), ' ', 1),
  last_name = nullif(
    trim(substring(
      regexp_replace(trim(full_name), '\s+', ' ', 'g')
      from length(split_part(regexp_replace(trim(full_name), '\s+', ' ', 'g'), ' ', 1)) + 1
    )),
    ''
  )
where full_name is not null and trim(full_name) <> '';

-- validator_directory (0051) selects profiles.full_name directly, which
-- blocks dropping the column outright -- drop and recreate it around the
-- swap instead of CASCADE, so the validator-discovery feature keeps working
-- unchanged rather than silently losing the view.
drop view validator_directory;

-- concat_ws() is STABLE, not IMMUTABLE (its variadic "any" signature can't
-- be proven side-effect-free), so it's rejected in a generated column
-- expression -- plain || concatenation with coalesce-to-'' is immutable
-- and gives the same result for two text columns.
alter table profiles drop column full_name;
alter table profiles add column full_name text
  generated always as (
    nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '')
  ) stored;

create view validator_directory
  with (security_invoker = true)
as
select
  s.id as skill_id,
  s.user_id as validator_id,
  s.library_skill_id,
  s.level,
  s.lifecycle_stage,
  s.offer_validate_connections,
  s.offer_validate_others,
  p.full_name,
  p.avatar_url,
  is_connected(auth.uid(), s.user_id) as is_connection
from skills s
join profiles p on p.id = s.user_id
where s.lifecycle_stage in ('validated', 'maintained')
  and s.user_id != auth.uid()
  and (
    s.offer_validate_others = true
    or (s.offer_validate_connections = true and is_connected(auth.uid(), s.user_id))
  );

grant select on validator_directory to authenticated;

-- full_name being generated can no longer be inserted into directly, so
-- this now writes first_name/last_name. For OAuth providers (e.g. Google)
-- that only supply a combined name, falls back to splitting it the same
-- way the backfill above did.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_first_name text;
  v_last_name text;
  v_provider_name text;
begin
  v_first_name := nullif(trim(new.raw_user_meta_data ->> 'first_name'), '');
  v_last_name := nullif(trim(new.raw_user_meta_data ->> 'last_name'), '');

  if v_first_name is null and v_last_name is null then
    v_provider_name := nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')), '');
    if v_provider_name is not null then
      v_provider_name := regexp_replace(v_provider_name, '\s+', ' ', 'g');
      v_first_name := split_part(v_provider_name, ' ', 1);
      v_last_name := nullif(trim(substring(v_provider_name from length(v_first_name) + 1)), '');
    end if;
  end if;

  insert into public.profiles (id, first_name, last_name)
  values (new.id, v_first_name, v_last_name);

  return new;
end;
$$;



-- =============================================================================
-- 0057_skill_practical_level_guide.sql
-- =============================================================================

-- Caches the AI-generated per-level practical-ability guidance (5
-- statements, one per level) for the practical axis, the same way
-- 0047 caches knowledge_level_guide for the knowledge axis -- generated
-- once (lazily, the first time it's needed) and reused after that.
alter table skills add column practical_level_guide jsonb;



-- =============================================================================
-- 0058_skill_discovery_and_connections.sql
-- =============================================================================

-- ============================================================================
-- Skill discovery + direct connections
--
-- Introduces "connections" as a first-class relationship (previously only
-- ever inferred from skill_peer_ratings), a direct connection-request flow
-- with a message, and opt-in skill-search discoverability so a learner can
-- be found by people tracking the same library skill even before they're
-- connected. Off by default throughout, matching the existing privacy-by-
-- design precedent (see 0016_skills_profile_privacy.sql).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. connections: the new source of truth for "these two people are
-- connected". Normalized so each pair appears once regardless of which side
-- created it (user_a_id is always the lexicographically smaller id).
-- ----------------------------------------------------------------------------
create table connections (
  id uuid primary key default gen_random_uuid(),
  user_a_id uuid references auth.users(id) not null,
  user_b_id uuid references auth.users(id) not null,
  source text not null check (source in ('peer_rating', 'request')),
  created_at timestamptz not null default now(),
  check (user_a_id <> user_b_id),
  unique (user_a_id, user_b_id)
);

create index connections_user_a_id_idx on connections (user_a_id);
create index connections_user_b_id_idx on connections (user_b_id);

alter table connections enable row level security;

create policy "Users can view their own connections"
  on connections for select
  using (auth.uid() = user_a_id or auth.uid() = user_b_id);

-- Normalizes the pair order and no-ops if the connection already exists
-- (from either the peer-rating trigger below or an accepted request), so
-- callers never have to know or care which side is "a" vs "b".
create or replace function upsert_connection(p_user_1 uuid, p_user_2 uuid, p_source text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if p_user_1 = p_user_2 then
    return;
  end if;
  insert into connections (user_a_id, user_b_id, source)
  values (least(p_user_1, p_user_2), greatest(p_user_1, p_user_2), p_source)
  on conflict (user_a_id, user_b_id) do nothing;
end;
$$;

-- A peer rating has always meant two accounts interacted directly -- it now
-- also establishes a standing connection, not just a rating event.
create or replace function sync_connection_from_peer_rating()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  perform upsert_connection(new.rater_id, new.skill_owner_id, 'peer_rating');
  return new;
end;
$$;

create trigger skill_peer_ratings_sync_connection
  after insert on skill_peer_ratings
  for each row execute function sync_connection_from_peer_rating();

-- Backfill: every pair that has already exchanged a rating is already a
-- connection today by the app's existing (inferred) definition -- carry
-- that forward rather than resetting everyone to disconnected.
insert into connections (user_a_id, user_b_id, source)
select distinct least(rater_id, skill_owner_id), greatest(rater_id, skill_owner_id), 'peer_rating'
from skill_peer_ratings
where rater_id <> skill_owner_id
on conflict (user_a_id, user_b_id) do nothing;

-- Centralizes "are these two people connected" behind the connections
-- table -- existing callers (the 0016 skills-visibility policy,
-- validator_directory, etc.) keep working unchanged since the function
-- signature doesn't change, they just become correct for request-based
-- connections too.
create or replace function is_connected(a uuid, b uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from connections
    where user_a_id = least(a, b) and user_b_id = greatest(a, b)
  )
$$;

-- ----------------------------------------------------------------------------
-- 2. connection_requests: a direct, targeted request to connect (with an
-- optional short message), distinct from the existing per-skill
-- connection_invites share-code flow -- this one names a specific person
-- rather than generating a link anyone can accept.
-- ----------------------------------------------------------------------------
create table connection_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid references auth.users(id) not null,
  recipient_id uuid references auth.users(id) not null,
  skill_id uuid references skills(id) on delete set null,
  message text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check (requester_id <> recipient_id)
);

-- Prevents sending a second request while one is already pending between
-- the same two people.
create unique index connection_requests_pending_pair_idx
  on connection_requests (requester_id, recipient_id)
  where status = 'pending';

alter table connection_requests enable row level security;

create policy "Users can view requests they sent or received"
  on connection_requests for select
  using (auth.uid() = requester_id or auth.uid() = recipient_id);

create policy "Users can send a connection request"
  on connection_requests for insert
  with check (auth.uid() = requester_id);

-- Only the recipient can act on it, and only the status/decided_at may
-- change -- everything else about the original request stays as sent.
create policy "Recipients can accept or decline"
  on connection_requests for update
  using (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);

create or replace function sync_connection_from_request()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.status = 'accepted' and old.status is distinct from 'accepted' then
    new.decided_at := now();
    perform upsert_connection(new.requester_id, new.recipient_id, 'request');
  elsif new.status = 'declined' and old.status is distinct from 'declined' then
    new.decided_at := now();
  end if;
  return new;
end;
$$;

create trigger connection_requests_sync_connection
  before update on connection_requests
  for each row execute function sync_connection_from_request();

-- ----------------------------------------------------------------------------
-- 3. Skill-search discoverability -- opt-in, off by default. Three modes:
-- never appear in skill-match searches, always appear, or a selective
-- per-skill list (profile_searchable_skills).
-- ----------------------------------------------------------------------------
alter table profiles add column skill_search_visibility text
  not null default 'hidden'
  check (skill_search_visibility in ('hidden', 'all', 'selective'));

alter table profiles add column auto_include_new_skills_in_search boolean not null default false;

-- Separate from skills_profile_visible (0016), which only ever gated
-- existing connections viewing each other's skills profile. This gates the
-- new case: someone who shares a skill but isn't connected yet.
alter table profiles add column profile_visible_to_skill_matches boolean not null default false;

create table profile_searchable_skills (
  profile_id uuid references auth.users(id) not null,
  skill_id uuid references skills(id) on delete cascade not null,
  primary key (profile_id, skill_id)
);

alter table profile_searchable_skills enable row level security;

create policy "Users can view their own searchable-skills list"
  on profile_searchable_skills for select
  using (auth.uid() = profile_id);

create policy "Users can manage their own searchable-skills list"
  on profile_searchable_skills for insert
  with check (auth.uid() = profile_id);

create policy "Users can remove from their own searchable-skills list"
  on profile_searchable_skills for delete
  using (auth.uid() = profile_id);

-- When "selective" mode + "auto-include new skills" are both on, a newly
-- added skill opts itself in immediately rather than silently staying
-- invisible until the learner remembers to go add it.
create or replace function sync_new_skill_search_visibility()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_mode text;
  v_auto boolean;
begin
  select skill_search_visibility, auto_include_new_skills_in_search
    into v_mode, v_auto
    from profiles where id = new.user_id;

  if v_mode = 'selective' and v_auto then
    insert into profile_searchable_skills (profile_id, skill_id)
    values (new.user_id, new.id)
    on conflict do nothing;
  end if;

  return new;
end;
$$;

create trigger skills_sync_search_visibility
  after insert on skills
  for each row execute function sync_new_skill_search_visibility();

-- Anonymized-by-default cross-user lookup, mirroring count_skill_trackers
-- (0053) and validator_directory (0056): SECURITY DEFINER so it can see
-- past normal per-row RLS, but it only ever returns rows for people who
-- have explicitly opted into skill-search visibility, and only exposes a
-- name/profile-view invitation when the viewer is further allowed to see
-- it (profile_visible_to_skill_matches, or they're already connected).
create or replace function list_skill_matches(p_library_skill_id uuid)
returns table (
  user_id uuid,
  full_name text,
  avatar_url text,
  level int,
  lifecycle_stage text,
  is_connection boolean,
  profile_viewable boolean,
  has_pending_request boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    s.user_id,
    p.full_name,
    p.avatar_url,
    s.level,
    s.lifecycle_stage,
    is_connected(auth.uid(), s.user_id) as is_connection,
    (p.profile_visible_to_skill_matches or is_connected(auth.uid(), s.user_id)) as profile_viewable,
    exists (
      select 1 from connection_requests cr
      where cr.status = 'pending'
        and ((cr.requester_id = auth.uid() and cr.recipient_id = s.user_id)
          or (cr.requester_id = s.user_id and cr.recipient_id = auth.uid()))
    ) as has_pending_request
  from skills s
  join profiles p on p.id = s.user_id
  where s.library_skill_id = p_library_skill_id
    and s.user_id <> auth.uid()
    and (
      p.skill_search_visibility = 'all'
      or (
        p.skill_search_visibility = 'selective'
        and exists (
          select 1 from profile_searchable_skills pss
          where pss.profile_id = s.user_id and pss.skill_id = s.id
        )
      )
    )
  order by p.full_name nulls last;
$$;

grant execute on function list_skill_matches(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Lets a skill-search match actually open the profile, when the owner
-- has opted in via profile_visible_to_skill_matches -- additive to (not a
-- replacement for) the existing 0016 connections-only policy, same pattern
-- it already documents: Postgres RLS ORs permissive SELECT policies
-- together, so a viewer only needs to satisfy one of them.
-- ----------------------------------------------------------------------------
create policy "Skill-search matches can view opted-in profiles"
  on skills for select
  using (
    exists (
      select 1 from profiles p
      where p.id = skills.user_id and p.profile_visible_to_skill_matches = true
    )
    and skills.library_skill_id is not null
    and exists (
      select 1 from skills my_skills
      where my_skills.user_id = auth.uid()
        and my_skills.library_skill_id = skills.library_skill_id
    )
  );



-- =============================================================================
-- 0059_fix_skill_search_matches_rls_recursion.sql
-- =============================================================================

-- 0058's "Skill-search matches can view opted-in profiles" policy on
-- skills checks `exists (select 1 from skills my_skills where
-- my_skills.user_id = auth.uid() and my_skills.library_skill_id =
-- skills.library_skill_id)` directly inside its own USING clause -- since
-- that subquery targets skills itself, evaluating it re-applies skills'
-- own SELECT policies (including this one), which Postgres reports as
-- "infinite recursion detected in policy for relation skills". Hit on any
-- read of the skills table (e.g. loading /skills at all).
--
-- Same shape of bug as 0052 (skill_course_links <-> courses), fixed the
-- same way: move the self-referencing check into a SECURITY DEFINER
-- function so it bypasses RLS internally instead of re-entering skills'
-- policies while skills' own policy is still being evaluated.
create or replace function has_matching_library_skill(p_viewer_id uuid, p_library_skill_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from skills
    where user_id = p_viewer_id and library_skill_id = p_library_skill_id
  )
$$;

grant execute on function has_matching_library_skill(uuid, uuid) to authenticated;

drop policy "Skill-search matches can view opted-in profiles" on skills;
create policy "Skill-search matches can view opted-in profiles"
  on skills for select
  using (
    exists (
      select 1 from profiles p
      where p.id = skills.user_id and p.profile_visible_to_skill_matches = true
    )
    and skills.library_skill_id is not null
    and has_matching_library_skill(auth.uid(), skills.library_skill_id)
  );



-- =============================================================================
-- 0060_fix_connection_request_and_skill_search_gaps.sql
-- =============================================================================

-- Security review of 0058 found three real gaps, fixed here:
--
-- 1. CRITICAL: the "Recipients can accept or decline" UPDATE policy on
-- connection_requests only constrains recipient_id to stay equal to
-- auth.uid() -- RLS can gate which rows are updatable, not which columns
-- change, so a recipient could `update ... set status='accepted',
-- requester_id='<anyone>'` and the sync trigger would upsert a connection
-- between the attacker and a victim who never sent or saw the request.
-- Fixed by removing client UPDATE entirely and routing accept/decline
-- through a SECURITY DEFINER RPC (same shape as accept_invite_and_rate in
-- 0010_connections.sql) that only ever touches status/decided_at on a row
-- the caller is actually the recipient of. The INSERT policy is also
-- tightened so a requester can't insert a row pre-marked 'accepted' to
-- fabricate history.
--
-- 2. HIGH: the "Skill-search matches can view opted-in profiles" policy
-- never checked visible_on_profile, unlike the equivalent 0016 connections
-- policy -- once profile_visible_to_skill_matches was on, a skill-search
-- match could read every skill row for that user via the API directly,
-- not just the ones marked visible_on_profile (SkillsProfile.jsx's
-- .eq('visible_on_profile', true) filter is a query convenience, not an
-- enforced boundary).
--
-- 3. MEDIUM: that same policy only checked "viewer tracks some skill with
-- the same library_skill_id", not whether the owner had actually opted
-- that specific skill into search the way list_skill_matches requires --
-- so profile_visible_to_skill_matches alone (without ever using selective
-- mode to include anything) still exposed the profile to anyone sharing
-- any skill, contradicting the setting's own description.
-- ----------------------------------------------------------------------------

-- --- Fix 1: connection_requests ---

drop policy "Recipients can accept or decline" on connection_requests;
drop trigger connection_requests_sync_connection on connection_requests;
drop function sync_connection_from_request();

drop policy "Users can send a connection request" on connection_requests;
create policy "Users can send a connection request"
  on connection_requests for insert
  with check (auth.uid() = requester_id and status = 'pending');

create or replace function respond_to_connection_request(p_request_id uuid, p_accept boolean)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_request connection_requests%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_request from connection_requests where id = p_request_id for update;
  if not found then
    raise exception 'Request not found';
  end if;
  if v_request.recipient_id <> auth.uid() then
    raise exception 'Not authorized to respond to this request';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'This request has already been decided.';
  end if;

  update connection_requests
  set status = case when p_accept then 'accepted' else 'declined' end,
      decided_at = now()
  where id = p_request_id;

  if p_accept then
    perform upsert_connection(v_request.requester_id, v_request.recipient_id, 'request');
  end if;
end;
$$;

grant execute on function respond_to_connection_request(uuid, boolean) to authenticated;

-- --- Fix 2 + 3: skill-search matches policy ---

create or replace function is_skill_search_match(p_viewer_id uuid, p_skill_owner_id uuid, p_library_skill_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    p_library_skill_id is not null
    and exists (
      select 1 from skills v
      where v.user_id = p_viewer_id and v.library_skill_id = p_library_skill_id
    )
    and exists (
      select 1 from skills o
      join profiles po on po.id = o.user_id
      where o.user_id = p_skill_owner_id
        and o.library_skill_id = p_library_skill_id
        and (
          po.skill_search_visibility = 'all'
          or (
            po.skill_search_visibility = 'selective'
            and exists (
              select 1 from profile_searchable_skills pss
              where pss.profile_id = o.user_id and pss.skill_id = o.id
            )
          )
        )
    )
$$;

grant execute on function is_skill_search_match(uuid, uuid, uuid) to authenticated;

drop policy "Skill-search matches can view opted-in profiles" on skills;
create policy "Skill-search matches can view opted-in profiles"
  on skills for select
  using (
    skills.visible_on_profile = true
    and exists (
      select 1 from profiles p
      where p.id = skills.user_id and p.profile_visible_to_skill_matches = true
    )
    and is_skill_search_match(auth.uid(), skills.user_id, skills.library_skill_id)
  );

-- has_matching_library_skill (0059) is superseded by is_skill_search_match,
-- which checks actual search opt-in rather than just a shared library id.
drop function has_matching_library_skill(uuid, uuid);



-- =============================================================================
-- 0061_incoming_rate_invites.sql
-- =============================================================================

-- Surfaces pending rate invites addressed to the current user's own email,
-- for the Connections page -- today connection_invites' only SELECT policy
-- is "Inviters can view their own invites" (0010), so an invitee has no way
-- to see an invite sent to them until they already have the share_code (the
-- same gap get_invite_preview/accept_invite_and_rate already work around
-- for the one-invite-you-already-have-a-link-for case). SECURITY DEFINER,
-- scoped tightly to rows whose invitee_email matches the caller's own
-- verified email -- nothing here is data the caller couldn't already see if
-- they simply opened the invite link themselves.
create or replace function list_incoming_rate_invites()
returns table (
  id uuid,
  inviter_id uuid,
  inviter_name text,
  skill_id uuid,
  skill_name text,
  skill_category text,
  share_code text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select ci.id, ci.inviter_id, p.full_name, ci.skill_id, s.name, s.category, ci.share_code, ci.created_at
  from connection_invites ci
  join skills s on s.id = ci.skill_id
  left join profiles p on p.id = ci.inviter_id
  where ci.status = 'pending'
    and ci.invitee_email is not null
    and lower(ci.invitee_email) = lower((select email from auth.users where id = auth.uid()))
  order by ci.created_at desc
$$;

grant execute on function list_incoming_rate_invites() to authenticated;



-- =============================================================================
-- 0062_backfill_cv_import_defaults.sql
-- =============================================================================

-- CV-imported skills never had lifecycle_stage or tracking_reason set
-- (unlike FindSkillModal's manual add path, which always sets both), so
-- every imported skill fell through every branch of computeUpNextItems and
-- never appeared in the Up Next checklist, showed no lifecycle badge on the
-- Skills grid, and had no "why are you tracking this" reason. The app-side
-- fixes (ResumeImportReviewModal.jsx) only cover imports going forward --
-- this backfills existing rows the same way.
update skills
set lifecycle_stage = 'identified'
where source = 'cv_import'
  and lifecycle_stage is null;

update skills
set tracking_reason = 'work'
where source = 'cv_import'
  and tracking_reason is null;



-- =============================================================================
-- 0063_connections_activity_feed.sql
-- =============================================================================

-- "What your connections are up to": an opt-in feed of recent milestones
-- from people the learner is connected to. Off by default, single global
-- toggle -- matching every other cross-user visibility flag so far
-- (skills_profile_visible 0016, profile_visible_to_skill_matches 0058).
alter table profiles add column activity_feed_visible boolean not null default false;

-- Aggregates recent milestone events across six source tables into one
-- shape. Each branch independently re-checks is_connected() and the
-- actor's own activity_feed_visible opt-in -- same SECURITY DEFINER
-- pattern as list_skill_matches (0058): the function can see past normal
-- per-row RLS, but only ever returns rows the caller is actually allowed
-- to see, checked row-by-row rather than relying on table-level grants.
--
-- Every date used here is when the record was created on the platform
-- (created_at, or date_added for skills, which has served that role since
-- 0001), never a backdated effective/historical date (assessed_at,
-- start_date, target_date) -- this is a feed of recent activity, not a
-- re-sorted timeline, so a historical entry backdated to years ago must
-- not flood someone's feed as if it just happened.
create or replace function list_connections_activity(p_limit int default 30)
returns table (
  event_type text,
  actor_id uuid,
  full_name text,
  avatar_url text,
  event_at timestamptz,
  skill_name text,
  level int,
  detail text
)
language sql
security definer
set search_path = public
stable
as $$
  select * from (
    -- Skill level confirmed: via quiz or AI assessment.
    select
      'skill_confirmed' as event_type,
      sa.user_id as actor_id,
      p.full_name,
      p.avatar_url,
      sa.created_at as event_at,
      s.name as skill_name,
      sa.level,
      (case sa.source
        when 'diagnostic_confirmed' then 'Confirmed via knowledge check'
        when 'ai_baseline' then 'AI-assessed baseline'
        when 'ai_evaluation' then 'AI assessment'
        else null
      end)::text as detail
    from skill_assessments sa
    join skills s on s.id = sa.skill_id
    join profiles p on p.id = sa.user_id
    where sa.source in ('diagnostic_confirmed', 'ai_baseline', 'ai_evaluation')
      and sa.user_id <> auth.uid()
      and is_connected(auth.uid(), sa.user_id)
      and p.activity_feed_visible = true

    union all

    -- Skill formally validated by another connection.
    select
      'skill_validated',
      svr.requester_id,
      p.full_name,
      p.avatar_url,
      svr.decided_at,
      s.name,
      svr.target_level,
      'Validated by a connection'::text
    from skill_validation_requests svr
    join skills s on s.id = svr.skill_id
    join profiles p on p.id = svr.requester_id
    where svr.status = 'confirmed'
      and svr.requester_id <> auth.uid()
      and is_connected(auth.uid(), svr.requester_id)
      and p.activity_feed_visible = true

    union all

    -- New skill added.
    select
      'skill_added',
      s.user_id,
      p.full_name,
      p.avatar_url,
      s.date_added,
      s.name,
      null::int,
      null::text
    from skills s
    join profiles p on p.id = s.user_id
    where s.user_id <> auth.uid()
      and is_connected(auth.uid(), s.user_id)
      and p.activity_feed_visible = true

    union all

    -- New experience added.
    select
      'experience_added',
      e.user_id,
      p.full_name,
      p.avatar_url,
      e.created_at,
      null::text,
      null::int,
      (e.type || ' at ' || e.organization || ': ' || e.title)::text
    from experience e
    join profiles p on p.id = e.user_id
    where e.user_id <> auth.uid()
      and is_connected(auth.uid(), e.user_id)
      and p.activity_feed_visible = true

    union all

    -- Course started (enrolled, not yet completed -- see 0035/Dashboard.jsx
    -- for why "in progress" is just completed_date is null, not a flag).
    select
      'course_started',
      c.user_id,
      p.full_name,
      p.avatar_url,
      c.created_at,
      null::text,
      null::int,
      (c.name || coalesce(' · ' || c.provider, ''))::text
    from courses c
    join profiles p on p.id = c.user_id
    where c.completed_date is null
      and c.user_id <> auth.uid()
      and is_connected(auth.uid(), c.user_id)
      and p.activity_feed_visible = true

    union all

    -- Target set for a skill.
    select
      'target_set',
      st.user_id,
      p.full_name,
      p.avatar_url,
      st.created_at,
      s.name,
      st.target_level,
      null::text
    from skill_targets st
    join skills s on s.id = st.skill_id
    join profiles p on p.id = st.user_id
    where st.user_id <> auth.uid()
      and is_connected(auth.uid(), st.user_id)
      and p.activity_feed_visible = true
  ) events
  order by event_at desc
  limit p_limit
$$;

grant execute on function list_connections_activity(int) to authenticated;



-- =============================================================================
-- 0064_account_deletion_cascades.sql
-- =============================================================================

-- Makes account deletion (auth.admin.deleteUser) actually work. Today only
-- profiles.id cascades from auth.users -- every other FK to auth.users(id)
-- has no ON DELETE action, which blocks deletion outright. This migration
-- only changes constraint behaviour; it does not touch any existing data.
--
-- Three categories:
--   1. CASCADE: rows the user owns outright, or pure relationship/pending
--      rows (connections, requests, invites) that have no meaning once one
--      party no longer exists.
--   2. SET NULL: rows that remain another learner's evidence even after the
--      referenced user is gone -- a peer rating given, a skill validation
--      performed -- so the row survives with its identifying FK stripped.
--      Two of these columns are currently NOT NULL and must be relaxed
--      first.
--   3. SET NULL on the two shared-catalog "created_by" columns (tags,
--      skill_library) -- these must never cascade, since deleting the
--      creator's account would otherwise delete a tag/library entry other
--      learners have already applied to their own skills.

-- ----------------------------------------------------------------------------
-- 1. Owned data + pure relationship/pending rows -- CASCADE
-- ----------------------------------------------------------------------------
alter table skills drop constraint skills_user_id_fkey,
  add constraint skills_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;

alter table courses drop constraint courses_user_id_fkey,
  add constraint courses_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;

alter table experience drop constraint experience_user_id_fkey,
  add constraint experience_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;

alter table skill_assessments drop constraint skill_assessments_user_id_fkey,
  add constraint skill_assessments_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;

alter table xapi_statements drop constraint xapi_statements_user_id_fkey,
  add constraint xapi_statements_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;

alter table skill_baseline_quizzes drop constraint skill_baseline_quizzes_user_id_fkey,
  add constraint skill_baseline_quizzes_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;

alter table skill_targets drop constraint skill_targets_user_id_fkey,
  add constraint skill_targets_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;

alter table skill_course_links drop constraint skill_course_links_user_id_fkey,
  add constraint skill_course_links_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;

alter table skill_tags drop constraint skill_tags_user_id_fkey,
  add constraint skill_tags_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;

alter table course_experience_links drop constraint course_experience_links_user_id_fkey,
  add constraint course_experience_links_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;

alter table skill_experience_links drop constraint skill_experience_links_user_id_fkey,
  add constraint skill_experience_links_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;

alter table connections drop constraint connections_user_a_id_fkey,
  add constraint connections_user_a_id_fkey foreign key (user_a_id) references auth.users(id) on delete cascade;
alter table connections drop constraint connections_user_b_id_fkey,
  add constraint connections_user_b_id_fkey foreign key (user_b_id) references auth.users(id) on delete cascade;

alter table connection_requests drop constraint connection_requests_requester_id_fkey,
  add constraint connection_requests_requester_id_fkey foreign key (requester_id) references auth.users(id) on delete cascade;
alter table connection_requests drop constraint connection_requests_recipient_id_fkey,
  add constraint connection_requests_recipient_id_fkey foreign key (recipient_id) references auth.users(id) on delete cascade;

alter table connection_invites drop constraint connection_invites_inviter_id_fkey,
  add constraint connection_invites_inviter_id_fkey foreign key (inviter_id) references auth.users(id) on delete cascade;

alter table profile_searchable_skills drop constraint profile_searchable_skills_profile_id_fkey,
  add constraint profile_searchable_skills_profile_id_fkey foreign key (profile_id) references auth.users(id) on delete cascade;

alter table skill_peer_ratings drop constraint skill_peer_ratings_skill_owner_id_fkey,
  add constraint skill_peer_ratings_skill_owner_id_fkey foreign key (skill_owner_id) references auth.users(id) on delete cascade;

alter table skill_validation_requests drop constraint skill_validation_requests_requester_id_fkey,
  add constraint skill_validation_requests_requester_id_fkey foreign key (requester_id) references auth.users(id) on delete cascade;

-- ----------------------------------------------------------------------------
-- 2. Evidence another learner still relies on -- SET NULL
-- ----------------------------------------------------------------------------
alter table skill_peer_ratings alter column rater_id drop not null;
alter table skill_peer_ratings drop constraint skill_peer_ratings_rater_id_fkey,
  add constraint skill_peer_ratings_rater_id_fkey foreign key (rater_id) references auth.users(id) on delete set null;

alter table skill_validation_requests alter column validator_id drop not null;
alter table skill_validation_requests drop constraint skill_validation_requests_validator_id_fkey,
  add constraint skill_validation_requests_validator_id_fkey foreign key (validator_id) references auth.users(id) on delete set null;

alter table connection_invites drop constraint connection_invites_accepted_by_fkey,
  add constraint connection_invites_accepted_by_fkey foreign key (accepted_by) references auth.users(id) on delete set null;

-- ----------------------------------------------------------------------------
-- 3. Shared-catalog attribution -- SET NULL (never cascade: these rows are
-- used by other learners, deleting one user must not delete the tag/library
-- entry itself)
-- ----------------------------------------------------------------------------
alter table tags drop constraint tags_created_by_fkey,
  add constraint tags_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;

alter table skill_library drop constraint skill_library_created_by_fkey,
  add constraint skill_library_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;

-- ----------------------------------------------------------------------------
-- 4. Pre-deletion scrub: FK SET NULL above only clears rater_id, not the
-- denormalized rater_name/rater_email snapshot on skill_peer_ratings
-- (stored because a rater has no RLS access to the skill they rated -- see
-- 0010/0011). Must be called and committed before auth.admin.deleteUser(),
-- since auth.uid() stops resolving once the user row is gone. Mirrors the
-- existing SECURITY DEFINER precedent (accept_invite_and_rate,
-- decide_validation_request).
--
-- Also handles two things SET NULL alone would leave broken:
--   - a pending validation request naming this user as validator would
--     otherwise sit "pending" forever once validator_id goes null, with no
--     one able to act on it -- decline it instead, same as a real decision.
--   - a private skill_library entry only this user could ever see (RLS:
--     `not is_private or created_by = auth.uid()`) would otherwise become
--     permanently invisible dead data once created_by goes null. Delete it
--     outright; skills.library_skill_id/skill_diagnostic_content.library_
--     skill_id already handle a missing library row (set null / cascade).
-- ----------------------------------------------------------------------------
create or replace function delete_own_account_scrub()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  update skill_peer_ratings
  set rater_name = null, rater_email = null
  where rater_id = auth.uid();

  update skill_validation_requests
  set status = 'declined', decided_at = now(),
    decision_comments = coalesce(decision_comments, 'Validator account was deleted.')
  where validator_id = auth.uid() and status = 'pending';

  delete from skill_library where created_by = auth.uid() and is_private;
end;
$$;

grant execute on function delete_own_account_scrub() to authenticated;



-- =============================================================================
-- 0065_platform_roles_and_organisations.sql
-- =============================================================================

-- Foundational role/permission system: a flat platform_admins allowlist
-- (full platform-owner console access -- a table rather than a single flag
-- so more than one account can hold it), plus organisations/
-- organisation_members for provider-type orgs. In this pass, organisations
-- are created and staffed only by platform admins; organisation_members
-- also lets an org's own admin manage their own trainers/staff, per the
-- "should be able to create profiles for all their trainers and admin
-- staff" requirement. No provider-facing UI yet -- this schema is what
-- that follow-up pass will build on.

create table platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now()
);

-- type stays free text (default 'provider') rather than a check constraint
-- so future org types (training providers already covered, but also
-- employers/coaches per CLAUDE.md's future-direction section) don't need a
-- migration just to be assignable -- no UI for anything but 'provider' yet.
create table organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null default 'provider',
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table organisation_members (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'trainer')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organisation_id, user_id)
);

create index organisation_members_org_idx on organisation_members (organisation_id);
create index organisation_members_user_idx on organisation_members (user_id);

-- ----------------------------------------------------------------------------
-- Helper functions -- security definer, mirroring the resolution 0052/0059
-- established for self-referencing RLS: platform_admins' own SELECT policy
-- needs is_platform_admin(), which queries platform_admins itself, so the
-- check has to bypass RLS internally rather than re-entering it mid-
-- evaluation. Same shape applies to organisation_members via
-- is_org_admin/is_org_member below.
-- ----------------------------------------------------------------------------

create or replace function is_platform_admin(check_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from platform_admins where user_id = check_user_id
  )
$$;

grant execute on function is_platform_admin(uuid) to authenticated;

create or replace function is_org_admin(org_id uuid, check_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from organisation_members
    where organisation_id = org_id and user_id = check_user_id and role = 'admin'
  ) or is_platform_admin(check_user_id)
$$;

grant execute on function is_org_admin(uuid, uuid) to authenticated;

create or replace function is_org_member(org_id uuid, check_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from organisation_members
    where organisation_id = org_id and user_id = check_user_id
  ) or is_platform_admin(check_user_id)
$$;

grant execute on function is_org_member(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------

alter table platform_admins enable row level security;

create policy "Platform admins can view the admin list"
  on platform_admins for select
  to authenticated
  using (is_platform_admin(auth.uid()));

create policy "Platform admins can grant platform admin access"
  on platform_admins for insert
  to authenticated
  with check (is_platform_admin(auth.uid()));

create policy "Platform admins can revoke platform admin access"
  on platform_admins for delete
  to authenticated
  using (is_platform_admin(auth.uid()));

alter table organisations enable row level security;

-- Open select: providers should be visible/browsable (e.g. a course
-- catalogue entry showing who offers it), not just to platform admins.
create policy "Authenticated users can view organisations"
  on organisations for select
  to authenticated
  using (true);

create policy "Platform admins can create organisations"
  on organisations for insert
  to authenticated
  with check (is_platform_admin(auth.uid()));

create policy "Platform admins can update organisations"
  on organisations for update
  to authenticated
  using (is_platform_admin(auth.uid()))
  with check (is_platform_admin(auth.uid()));

alter table organisation_members enable row level security;

create policy "Platform admins and org members can view organisation members"
  on organisation_members for select
  to authenticated
  using (is_org_member(organisation_id, auth.uid()));

create policy "Platform admins and org admins can add organisation members"
  on organisation_members for insert
  to authenticated
  with check (is_org_admin(organisation_id, auth.uid()));

create policy "Platform admins and org admins can remove organisation members"
  on organisation_members for delete
  to authenticated
  using (is_org_admin(organisation_id, auth.uid()));

-- ----------------------------------------------------------------------------
-- profiles.account_status -- display-only mirror of the auth-level ban set
-- by api/admin/set-user-blocked.js (auth.admin.updateUserById ban_duration).
-- Lets the admin console show status without an extra auth-admin API round
-- trip. profiles' existing "Users manage their own profile" policy (0002)
-- is for-all/auth.uid()=id, which would otherwise let a learner unblock
-- themselves just by editing their own profile row -- guard the column with
-- a trigger rather than restructuring that broad policy.
-- ----------------------------------------------------------------------------

alter table profiles add column account_status text not null default 'active' check (account_status in ('active', 'blocked'));

create or replace function prevent_self_account_status_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.account_status is distinct from old.account_status
     and auth.uid() is not null
     and not is_platform_admin(auth.uid()) then
    raise exception 'account_status can only be changed by a platform admin';
  end if;
  return new;
end;
$$;

create trigger prevent_self_account_status_change_trigger
  before update on profiles
  for each row execute procedure prevent_self_account_status_change();



-- =============================================================================
-- 0066_provider_catalogue_and_moderation.sql
-- =============================================================================

-- Extends the shared course_catalogue with provider ownership and an
-- approval workflow (platform admins can create/curate directly, or
-- approve/reject/deactivate entries submitted by an organisation's own
-- members), and adds a deactivate-only moderation hook to skill_library and
-- tags (0013/0024 both shipped with no update policy at all, by design at
-- the time -- this is the "editor, planned separately" 0035 referred to).

alter table course_catalogue
  add column organisation_id uuid references organisations(id) on delete set null,
  add column status text not null default 'approved'
    check (status in ('draft', 'pending_approval', 'approved', 'rejected', 'inactive')),
  add column created_by uuid references auth.users(id) on delete set null,
  add column approved_by uuid references auth.users(id) on delete set null,
  add column approved_at timestamptz,
  add column rejection_reason text;

-- Existing seed rows have no organisation and default to 'approved', so
-- they keep showing up in the catalogue exactly as before.

create index course_catalogue_organisation_idx on course_catalogue (organisation_id);
create index course_catalogue_status_idx on course_catalogue (status);

drop policy "Authenticated users can view the course catalogue" on course_catalogue;

create policy "View approved courses, your own organisation's, or as a platform admin"
  on course_catalogue for select
  to authenticated
  using (
    status = 'approved'
    or is_platform_admin(auth.uid())
    or (organisation_id is not null and is_org_member(organisation_id, auth.uid()))
  );

-- Providers insert their own drafts/submissions only, never pre-approved;
-- platform admins can insert directly (any organisation_id, including
-- null for platform-curated entries) at any status.
create policy "Platform admins and organisation members can add catalogue entries"
  on course_catalogue for insert
  to authenticated
  with check (
    is_platform_admin(auth.uid())
    or (
      organisation_id is not null
      and is_org_member(organisation_id, auth.uid())
      and status in ('draft', 'pending_approval')
      and created_by = auth.uid()
    )
  );

create policy "Platform admins can update any catalogue entry"
  on course_catalogue for update
  to authenticated
  using (is_platform_admin(auth.uid()))
  with check (is_platform_admin(auth.uid()));

-- An organisation's own members can only touch their own not-yet-approved
-- (or bounced-back) entries, and can never set status to 'approved'
-- themselves -- enforced by the with check below, not just the app layer.
create policy "Organisation members can edit their own draft or rejected entries"
  on course_catalogue for update
  to authenticated
  using (
    organisation_id is not null
    and is_org_member(organisation_id, auth.uid())
    and status in ('draft', 'rejected')
  )
  with check (
    organisation_id is not null
    and is_org_member(organisation_id, auth.uid())
    and status in ('draft', 'pending_approval', 'rejected')
  );

-- skill_library: deactivate-only moderation hook -- entries stay (matches
-- the "de-activate" language, not delete), platform admins only. 0013
-- shipped with insert-only, no update policy at all.
alter table skill_library add column status text not null default 'active' check (status in ('active', 'inactive'));

create policy "Platform admins can update skill library entries"
  on skill_library for update
  to authenticated
  using (is_platform_admin(auth.uid()))
  with check (is_platform_admin(auth.uid()));

-- tags: same shape -- blacklist rather than delete. 0024 also shipped with
-- insert-only, no update policy at all.
alter table tags add column is_blacklisted boolean not null default false;

create policy "Platform admins can update tags"
  on tags for update
  to authenticated
  using (is_platform_admin(auth.uid()))
  with check (is_platform_admin(auth.uid()));



-- =============================================================================
-- 0067_prevent_last_platform_admin_removal.sql
-- =============================================================================

-- Guards against removing the platform's only remaining admin. 0065's RLS
-- on platform_admins only restricts *who* may delete a row (any platform
-- admin) -- it says nothing about how many would be left afterwards, so as
-- written a lone admin (or two admins deleting each other) could delete
-- every row and leave nobody able to reach the console at all, including
-- via a future "revoke platform admin" feature that doesn't exist yet, or
-- direct SQL. That's a job for a trigger, not RLS.
create or replace function prevent_last_platform_admin_removal()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if (select count(*) from platform_admins) <= 1 then
    raise exception 'Cannot remove the last remaining platform admin.';
  end if;
  return old;
end;
$$;

create trigger prevent_last_platform_admin_removal_trigger
  before delete on platform_admins
  for each row execute procedure prevent_last_platform_admin_removal();



-- =============================================================================
-- 0068_organisation_url.sql
-- =============================================================================

-- Adds a website URL to organisations, for the platform-admin provider edit
-- form and the (now built) provider-facing console. Nullable/additive --
-- existing organisations simply have no url until edited.

alter table organisations add column url text;



-- =============================================================================
-- 0069_deactivated_org_revokes_access.sql
-- =============================================================================

-- Deactivating a provider organisation (organisations.status = 'inactive')
-- previously had no effect on its staff's actual access -- is_org_admin/
-- is_org_member never checked status, so a "deactivated" org's own admins
-- and trainers could still manage staff and submit training exactly as
-- before. Now that the provider console (built on top of these functions)
-- gives that access real consequence, tie it to status: the
-- organisation_members-based branch now also requires the organisation to
-- be active. The is_platform_admin(...) fallback is left unconditional on
-- both functions, so platform admins retain full access to inactive orgs
-- (e.g. to reactivate one, or inspect it while deciding whether to).

create or replace function is_org_admin(org_id uuid, check_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from organisation_members
    join organisations on organisations.id = organisation_members.organisation_id
    where organisation_members.organisation_id = org_id
      and organisation_members.user_id = check_user_id
      and organisation_members.role = 'admin'
      and organisations.status = 'active'
  ) or is_platform_admin(check_user_id)
$$;

create or replace function is_org_member(org_id uuid, check_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from organisation_members
    join organisations on organisations.id = organisation_members.organisation_id
    where organisation_members.organisation_id = org_id
      and organisation_members.user_id = check_user_id
      and organisations.status = 'active'
  ) or is_platform_admin(check_user_id)
$$;



-- =============================================================================
-- 0070_organisation_member_pending_status.sql
-- =============================================================================

-- Inviting an *existing* LearnScope user as org staff (api/admin/actions.js
-- inviteOrgStaff) previously granted access the moment the row was
-- inserted -- no consent step, since there's no Supabase Auth invite email
-- to accept for someone who already has an account. That let an org admin
-- silently enroll any existing user as staff purely by knowing their email,
-- conflicting with CLAUDE.md's "don't silently ... materially update
-- important learner information" principle. This adds a pending state,
-- mirroring the existing skill_validation_requests accept/decline pattern
-- (0041) rather than inventing a new shape: new-account invites (which
-- already require clicking the Supabase invite-email link -- a real
-- consent step) still insert straight to 'active'; existing-user invites
-- now insert 'pending' and only count as real membership once the invited
-- user accepts.

alter table organisation_members
  add column status text not null default 'active' check (status in ('pending', 'active'));

-- A pending row grants no access yet -- both membership-based branches now
-- also require it. Platform admins remain unconditional (unaffected by
-- either an org's or a member's status).
create or replace function is_org_admin(org_id uuid, check_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from organisation_members
    join organisations on organisations.id = organisation_members.organisation_id
    where organisation_members.organisation_id = org_id
      and organisation_members.user_id = check_user_id
      and organisation_members.role = 'admin'
      and organisation_members.status = 'active'
      and organisations.status = 'active'
  ) or is_platform_admin(check_user_id)
$$;

create or replace function is_org_member(org_id uuid, check_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from organisation_members
    join organisations on organisations.id = organisation_members.organisation_id
    where organisation_members.organisation_id = org_id
      and organisation_members.user_id = check_user_id
      and organisation_members.status = 'active'
      and organisations.status = 'active'
  ) or is_platform_admin(check_user_id)
$$;

-- is_org_member(...) above no longer covers a pending row (status isn't
-- 'active' yet), so without this, the invited user couldn't see their own
-- pending invite to decide on it -- a chicken-and-egg lockout. Any user can
-- always see their own membership rows, whatever their status.
create policy "Users can view their own organisation membership rows"
  on organisation_members for select
  to authenticated
  using (auth.uid() = user_id);

-- Runs as the invited user, same "security definer function performs the
-- one specific privileged action, after checking the caller is who they
-- claim to be" pattern as decide_validation_request (0041). Declining just
-- removes the row -- unlike a validation request, there's no reason to keep
-- a declined staff invite around as a historical record.
create or replace function decide_org_invite(p_member_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member organisation_members%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_member from organisation_members where id = p_member_id for update;
  if not found then
    raise exception 'Invitation not found';
  end if;
  if v_member.user_id != auth.uid() then
    raise exception 'Not authorized';
  end if;
  if v_member.status != 'pending' then
    raise exception 'This invitation has already been decided.';
  end if;

  if p_accept then
    update organisation_members set status = 'active' where id = p_member_id;
  else
    delete from organisation_members where id = p_member_id;
  end if;
end;
$$;

grant execute on function decide_org_invite(uuid, boolean) to authenticated;



-- =============================================================================
-- 0071_course_content.sql
-- =============================================================================

-- Course content: what a provider actually attaches inside a course they're
-- building (video, downloadable files, SCORM packages) -- distinct from
-- course_catalogue, which stays pure metadata (name/type/duration/synopsis)
-- per its own 0035 comment. One course has many ordered content items.
--
-- Storage: a single PUBLIC bucket, not the skill-evidence private+signed-URL
-- pattern. SCORM packages are many interlinked files (html/js/css/images)
-- referencing each other by relative path -- a signed-URL-per-file scheme
-- would break every relative reference inside uploaded SCORM content, and
-- rewriting them isn't attempted here. Paths are namespaced by random
-- course/content-item uuids, so this is "unlisted" (unguessable) rather
-- than genuinely access-controlled: a draft course's content is reachable
-- by anyone with the exact URL, not just the owning org or platform admins,
-- even though the *course_catalogue row itself* stays properly RLS-gated.
-- Acceptable given approved courses are meant to be broadly browsable
-- anyway; revisit with a signed proxy if draft-stage confidentiality of
-- attached files specifically becomes a real requirement.
insert into storage.buckets (id, name, public)
values ('course-content', 'course-content', true)
on conflict (id) do nothing;

create table course_content_items (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references course_catalogue(id) on delete cascade not null,
  type text not null check (type in ('video', 'file', 'scorm')),
  title text not null,
  position int not null default 0,
  -- video/file: the object path of the single uploaded file.
  -- scorm: the folder prefix the package was extracted under.
  storage_path text not null,
  file_name text,
  -- scorm only: path (relative to storage_path) to the launch html, read
  -- from the package's imsmanifest.xml at upload time.
  launch_path text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table course_content_items enable row level security;

create index course_content_items_course_id_idx on course_content_items (course_id);

-- Same visibility as the owning course itself (course_catalogue's own
-- select policy, 0066): approved, or the owning org's own members, or a
-- platform admin.
create policy "View content for viewable courses"
  on course_content_items for select
  to authenticated
  using (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_content_items.course_id
        and (
          cc.status = 'approved'
          or is_platform_admin(auth.uid())
          or (cc.organisation_id is not null and is_org_member(cc.organisation_id, auth.uid()))
        )
    )
  );

-- Content can only be added/edited/removed while the course itself is still
-- editable (draft/rejected) -- same edit window course_catalogue's own
-- org-member update policy (0066) already enforces on the course row.
-- Platform admins are unconditional, matching every other admin override in
-- this schema.
create policy "Manage content for editable courses"
  on course_content_items for all
  to authenticated
  using (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_content_items.course_id
        and (
          is_platform_admin(auth.uid())
          or (
            cc.organisation_id is not null
            and is_org_member(cc.organisation_id, auth.uid())
            and cc.status in ('draft', 'rejected')
          )
        )
    )
  )
  with check (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_content_items.course_id
        and (
          is_platform_admin(auth.uid())
          or (
            cc.organisation_id is not null
            and is_org_member(cc.organisation_id, auth.uid())
            and cc.status in ('draft', 'rejected')
          )
        )
    )
  );

-- Per-learner progress through a content item -- mainly SCORM's cmi data
-- model (lesson_status, score, session_time, ...), but the same shape
-- covers a simple "watched"/"downloaded" marker for video/file too.
create table course_content_progress (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid references course_content_items(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  status text not null default 'not_attempted'
    check (status in ('not_attempted', 'incomplete', 'completed', 'passed', 'failed')),
  score numeric,
  cmi_data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (content_item_id, user_id)
);

alter table course_content_progress enable row level security;

create index course_content_progress_user_id_idx on course_content_progress (user_id);

create policy "Users manage their own content progress"
  on course_content_progress for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);



-- =============================================================================
-- 0072_course_content_storage_policies.sql
-- =============================================================================

-- 0071 created the course-content bucket but never added storage.objects
-- policies for it (every other bucket in this schema has explicit ones --
-- 0004 avatars, 0005 skill-evidence, 0041 skill-evidence-for-validators).
-- storage.objects has RLS enabled with no matching policy default-denies,
-- so uploads/deletes were unconditionally rejected. Reads stay governed by
-- the bucket's own public=true flag (Supabase's public object endpoint
-- bypasses storage.objects RLS by design -- that's what "public" means),
-- so no SELECT policy is added here; only write/delete need one.
--
-- Authorization is derived from the literal object path's course-id folder
-- segment ((storage.foldername(name))[1]), never from
-- course_content_items.storage_path -- a row's own claimed path can't be
-- trusted to prove which folder it's actually allowed to touch.

create policy "Org members can upload content for their own editable courses"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'course-content'
    and exists (
      select 1 from course_catalogue cc
      where cc.id::text = (storage.foldername(name))[1]
        and (
          is_platform_admin(auth.uid())
          or (
            cc.organisation_id is not null
            and is_org_member(cc.organisation_id, auth.uid())
            and cc.status in ('draft', 'rejected')
          )
        )
    )
  );

create policy "Org members can remove content for their own editable courses"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'course-content'
    and exists (
      select 1 from course_catalogue cc
      where cc.id::text = (storage.foldername(name))[1]
        and (
          is_platform_admin(auth.uid())
          or (
            cc.organisation_id is not null
            and is_org_member(cc.organisation_id, auth.uid())
            and cc.status in ('draft', 'rejected')
          )
        )
    )
  );

-- Ties a content_items row to the storage folder it's actually allowed to
-- touch -- without this, a caller with legitimate insert/update rights on
-- their own (draft) course's row could set storage_path to a folder prefix
-- under a *different* course, and deleteContentItem's recursive walk would
-- then remove another tenant's files (the storage policies above only
-- check the real object path, not this column, so both are needed
-- together).
alter table course_content_items
  add constraint course_content_items_storage_path_scoped
  check (storage_path like course_id::text || '/%');



-- =============================================================================
-- 0073_content_resource_library.sql
-- =============================================================================

-- Content (video/file/SCORM) moves from "belongs to one course" to "belongs
-- to an organisation, reusable across courses" -- a provider uploads a
-- resource once into their org's library, then attaches (links) it to
-- however many courses need it, rather than re-uploading the same file per
-- course. course_content_items becomes content_resources (organisation-
-- scoped); course_content_links is the new many-to-many attachment, with
-- its own per-course ordering (a resource's position makes sense only in
-- the context of a specific course, so it moves off the resource itself and
-- onto the link).

alter table course_content_items rename to content_resources;

alter table content_resources add column organisation_id uuid references organisations(id) on delete cascade;

update content_resources cr
set organisation_id = cc.organisation_id
from course_catalogue cc
where cc.id = cr.course_id;

-- Every content_resources row so far was created through a course that
-- always had an organisation_id (0066's insert policy requires it) -- this
-- should be a no-op verification, not an actual backfill gap.
alter table content_resources alter column organisation_id set not null;

create table course_content_links (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references course_catalogue(id) on delete cascade not null,
  resource_id uuid references content_resources(id) on delete cascade not null,
  position int not null default 0,
  created_at timestamptz not null default now(),
  unique (course_id, resource_id)
);

insert into course_content_links (course_id, resource_id, position)
select course_id, id, position from content_resources where course_id is not null;

create index course_content_links_course_id_idx on course_content_links (course_id);
create index course_content_links_resource_id_idx on course_content_links (resource_id);

-- Must drop before dropping course_id -- both old policies reference it.
drop policy "View content for viewable courses" on content_resources;
drop policy "Manage content for editable courses" on content_resources;

alter table content_resources drop constraint course_content_items_storage_path_scoped;
alter table content_resources drop column course_id;
alter table content_resources drop column position;

-- Storage folders are now namespaced by organisation_id, not course_id (see
-- storage.objects policies below).
alter table content_resources
  add constraint content_resources_storage_path_scoped
  check (storage_path like organisation_id::text || '/%');

create index content_resources_organisation_id_idx on content_resources (organisation_id);

alter table course_content_links enable row level security;

-- A resource is visible to its own org (any member), a platform admin, or
-- anyone if it's actually linked into at least one approved course --
-- mirrors course_catalogue's own "approved is public" rule, just derived
-- through the link table since a resource has no status of its own.
create policy "View own org's resources, or linked into an approved course"
  on content_resources for select
  to authenticated
  using (
    is_platform_admin(auth.uid())
    or is_org_member(organisation_id, auth.uid())
    or exists (
      select 1 from course_content_links ccl
      join course_catalogue cc on cc.id = ccl.course_id
      where ccl.resource_id = content_resources.id and cc.status = 'approved'
    )
  );

-- Resources aren't tied to one course's draft/rejected edit window anymore
-- -- any active member of the owning org can manage the library itself
-- (is_org_member already requires organisations.status = 'active', 0069).
create policy "Org members manage their own organisation's resources"
  on content_resources for all
  to authenticated
  using (is_platform_admin(auth.uid()) or is_org_member(organisation_id, auth.uid()))
  with check (is_platform_admin(auth.uid()) or is_org_member(organisation_id, auth.uid()));

create policy "View links for viewable courses"
  on course_content_links for select
  to authenticated
  using (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_content_links.course_id
        and (
          cc.status = 'approved'
          or is_platform_admin(auth.uid())
          or (cc.organisation_id is not null and is_org_member(cc.organisation_id, auth.uid()))
        )
    )
  );

-- Attaching/detaching a resource requires BOTH: the course is one of the
-- caller's own, still editable (draft/rejected), AND the resource being
-- linked actually belongs to an org the caller is a member of -- otherwise
-- an org admin could attach another organisation's private resource into
-- their own course.
create policy "Org members manage links for their own editable courses"
  on course_content_links for all
  to authenticated
  using (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_content_links.course_id
        and (
          is_platform_admin(auth.uid())
          or (
            cc.organisation_id is not null
            and is_org_member(cc.organisation_id, auth.uid())
            and cc.status in ('draft', 'rejected')
          )
        )
    )
    and exists (
      select 1 from content_resources cr
      where cr.id = course_content_links.resource_id
        and (is_platform_admin(auth.uid()) or is_org_member(cr.organisation_id, auth.uid()))
    )
  )
  with check (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_content_links.course_id
        and (
          is_platform_admin(auth.uid())
          or (
            cc.organisation_id is not null
            and is_org_member(cc.organisation_id, auth.uid())
            and cc.status in ('draft', 'rejected')
          )
        )
    )
    and exists (
      select 1 from content_resources cr
      where cr.id = course_content_links.resource_id
        and (is_platform_admin(auth.uid()) or is_org_member(cr.organisation_id, auth.uid()))
    )
  );

-- Storage RLS (0072) checked the object path's first folder segment against
-- course_catalogue; resources (and their storage folders) now belong
-- directly to an organisation, so check that directly -- simpler, and no
-- longer depends on any particular course existing/being editable.
drop policy "Org members can upload content for their own editable courses" on storage.objects;
drop policy "Org members can remove content for their own editable courses" on storage.objects;

-- Matches the folder segment as text against organisations.id::text, rather
-- than casting the (arbitrary, attacker-influenceable) path segment to
-- uuid directly -- SQL's AND doesn't guarantee left-to-right short-circuit
-- evaluation, so a direct `(storage.foldername(name))[1]::uuid` could throw
-- mid-evaluation for any malformed path on this table (any bucket, not just
-- this one), regardless of the bucket_id check placed "before" it. A text
-- comparison can't throw.
create policy "Org members can upload their own organisation's resources"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'course-content'
    and exists (
      select 1 from organisations o
      where o.id::text = (storage.foldername(name))[1]
        and (is_platform_admin(auth.uid()) or is_org_member(o.id, auth.uid()))
    )
  );

create policy "Org members can remove their own organisation's resources"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'course-content'
    and exists (
      select 1 from organisations o
      where o.id::text = (storage.foldername(name))[1]
        and (is_platform_admin(auth.uid()) or is_org_member(o.id, auth.uid()))
    )
  );



-- =============================================================================
-- 0074_fix_content_resources_rls_recursion.sql
-- =============================================================================

-- 0073's "View own org's resources, or linked into an approved course" policy
-- on content_resources joins into course_content_links to check for an
-- approved-course link. Evaluating that join requires Postgres to also check
-- course_content_links' own policies -- including its "Org members manage
-- links for their own editable courses" ("for all") policy, which queries
-- back into content_resources directly. That closes the loop: content_resources
-- -> course_content_links -> content_resources -> ..., which Postgres reports
-- as "infinite recursion detected in policy for relation content_resources".
--
-- Same shape of bug as 0052/0059, fixed the same way: move the self-
-- referencing check into a SECURITY DEFINER function so it bypasses RLS
-- internally instead of re-entering content_resources' policies while
-- content_resources' own policy is still being evaluated.
create or replace function can_manage_content_resource(p_resource_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from content_resources cr
    where cr.id = p_resource_id
      and (is_platform_admin(p_user_id) or is_org_member(cr.organisation_id, p_user_id))
  )
$$;

grant execute on function can_manage_content_resource(uuid, uuid) to authenticated;

drop policy "Org members manage links for their own editable courses" on course_content_links;
create policy "Org members manage links for their own editable courses"
  on course_content_links for all
  to authenticated
  using (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_content_links.course_id
        and (
          is_platform_admin(auth.uid())
          or (
            cc.organisation_id is not null
            and is_org_member(cc.organisation_id, auth.uid())
            and cc.status in ('draft', 'rejected')
          )
        )
    )
    and can_manage_content_resource(course_content_links.resource_id, auth.uid())
  )
  with check (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_content_links.course_id
        and (
          is_platform_admin(auth.uid())
          or (
            cc.organisation_id is not null
            and is_org_member(cc.organisation_id, auth.uid())
            and cc.status in ('draft', 'rejected')
          )
        )
    )
    and can_manage_content_resource(course_content_links.resource_id, auth.uid())
  );



-- =============================================================================
-- 0075_lock_platform_admin_removal_check.sql
-- =============================================================================

-- prevent_last_platform_admin_removal (0067) reads `count(*) from
-- platform_admins` with no locking before deciding whether to allow the
-- delete. Two concurrent deletes targeting different admins (e.g. two of
-- exactly two remaining admins deleting each other, or an admin hard-
-- deleting another admin's account via api/admin/actions.js's deleteUser
-- while a second such delete runs at the same time) can each read the
-- pre-deletion count and both pass the check before either commits,
-- cascading platform_admins to zero rows and leaving no one who can reach
-- /admin. `for update` takes a row lock on every matching row for the
-- duration of the transaction, so the second trigger invocation blocks
-- until the first transaction commits (and re-reads a now-lower count) or
-- rolls back, making the check safe under concurrent deletes.
-- Postgres doesn't allow FOR UPDATE directly on an aggregate query (count(*)
-- FOR UPDATE is a syntax error), so the lock and the count are two
-- statements: the first blocks until it can lock every current row (waiting
-- out any concurrent trigger evaluation), the second then counts under a
-- fresh snapshot that reflects whatever the transaction we waited on did.
create or replace function prevent_last_platform_admin_removal()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  perform 1 from platform_admins for update;
  if (select count(*) from platform_admins) <= 1 then
    raise exception 'Cannot remove the last remaining platform admin.';
  end if;
  return old;
end;
$$;



-- =============================================================================
-- 0076_provider_skills_and_admin_visibility.sql
-- =============================================================================

-- Provider-specific skills: extends skill_library with a third scope
-- alongside "public" and "private to one user" (0028) -- an organisation's
-- own skill, visible only to that org's members (and platform admins)
-- unless it's actually in use on one of their approved catalogue courses,
-- mirroring content_resources' (0073) "own org, or linked into an approved
-- course" visibility rule. Mutually exclusive with is_private: that flag is
-- about one learner's personal privacy, this is about org ownership, and a
-- row can't be both at once.
alter table skill_library add column organisation_id uuid references organisations(id) on delete cascade;

alter table skill_library
  add constraint skill_library_org_not_private check (not (is_private and organisation_id is not null));

create index skill_library_organisation_id_idx on skill_library (organisation_id);

-- Org-scoped names only need to be unique within that org, same reasoning
-- as 0028's private-per-creator index.
create unique index skill_library_org_name_lower_idx
  on skill_library (organisation_id, lower(name))
  where organisation_id is not null;

-- Platform admins need to see every skill (public, everyone's private
-- entries, every org's provider-specific ones) for the new admin skill
-- console -- 0028's policy had no admin bypass at all, since AdminSkills.jsx
-- previously only ever managed public entries. Org-scoped entries are
-- otherwise visible to that org's own members, or to anyone if the skill is
-- actually targeted by one of their approved catalogue courses (so
-- CourseCatalogue.jsx's public skill tags keep resolving for non-members).
drop policy "Authenticated users can view public or their own private skill library entries" on skill_library;

create policy "View public, personal, own organisation's, or platform-admin-visible skill library entries"
  on skill_library for select
  to authenticated
  using (
    is_platform_admin(auth.uid())
    or (organisation_id is null and (not is_private or created_by = auth.uid()))
    or (
      organisation_id is not null
      and (
        is_org_member(organisation_id, auth.uid())
        or exists (
          select 1 from course_catalogue_skills ccs
          join course_catalogue cc on cc.id = ccs.course_catalogue_id
          where ccs.skill_library_id = skill_library.id and cc.status = 'approved'
        )
      )
    )
  );

-- Extends the existing "insert your own" rule (0013) to also allow an org
-- member to insert with organisation_id set to one of their own
-- organisations -- personal inserts (organisation_id null) are unaffected.
drop policy "Authenticated users can add to the skill library" on skill_library;

create policy "Users can add personal skill library entries; org members can add their organisation's"
  on skill_library for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and (organisation_id is null or is_org_member(organisation_id, auth.uid()))
  );

-- The standalone "which library skills does this org want to offer its
-- customers" roster -- decoupled from any specific course (a provider may
-- want to declare a skill focus before/without building a course for it
-- yet), unlike course_catalogue_skills which targets one course at a time.
create table organisation_offered_skills (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  skill_library_id uuid not null references skill_library(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organisation_id, skill_library_id)
);

create index organisation_offered_skills_organisation_idx on organisation_offered_skills (organisation_id);
create index organisation_offered_skills_skill_idx on organisation_offered_skills (skill_library_id);

alter table organisation_offered_skills enable row level security;

-- No learner-facing surface for this yet (not requested) -- kept scoped to
-- the owning org's own members and platform admins, same shape as
-- content_resources' "Org members manage their own organisation's
-- resources" policy.
create policy "Org members and platform admins manage their organisation's offered skills"
  on organisation_offered_skills for all
  to authenticated
  using (is_platform_admin(auth.uid()) or is_org_member(organisation_id, auth.uid()))
  with check (is_platform_admin(auth.uid()) or is_org_member(organisation_id, auth.uid()));

-- Per-level breakdown of count_skill_trackers (0053) -- same anonymous,
-- count-only shape (never returns rows/user identities), just grouped by
-- level for the new admin skill detail page's statistics section. Open to
-- any authenticated user like count_skill_trackers, since a level-bucketed
-- count carries no more privacy risk than the flat total already does.
create or replace function skill_level_stats(p_library_skill_id uuid)
returns table (level int, tracker_count int)
language sql
security definer
set search_path = public
stable
as $$
  select level, count(distinct user_id)::int as tracker_count
  from skills
  where library_skill_id = p_library_skill_id
  group by level
  order by level
$$;

grant execute on function skill_level_stats(uuid) to authenticated;



-- =============================================================================
-- 0077_offered_skills_check_ownership.sql
-- =============================================================================

-- 0076's organisation_offered_skills policy only checked the offered row's
-- own organisation_id against is_org_member -- it never confirmed the
-- referenced skill_library_id is actually one that organisation is allowed
-- to offer (public, or their own provider-specific skill). A direct API
-- call with a guessed skill_library.id could otherwise roster another
-- org's provider-only skill, or someone's private personal skill, into this
-- org's offered list. skill_library's own SELECT RLS still governs whether
-- the row's contents can be read back, so this was never a live data leak,
-- but it's a real authorization-completeness gap worth closing.
drop policy "Org members and platform admins manage their organisation's offered skills" on organisation_offered_skills;

create policy "Org members and platform admins manage their organisation's offered skills"
  on organisation_offered_skills for all
  to authenticated
  using (is_platform_admin(auth.uid()) or is_org_member(organisation_id, auth.uid()))
  with check (
    (is_platform_admin(auth.uid()) or is_org_member(organisation_id, auth.uid()))
    and exists (
      select 1 from skill_library sl
      where sl.id = organisation_offered_skills.skill_library_id
        and (sl.organisation_id is null or sl.organisation_id = organisation_offered_skills.organisation_id)
    )
  );



-- =============================================================================
-- 0078_course_sections.sql
-- =============================================================================

-- Named, ordered groups of content within one course_catalogue entry --
-- content_resources/course_content_links (0073) stay flat and reusable
-- across courses; a section only groups how one specific course presents
-- its links, so section ownership follows the course, not the resource.
-- Nothing in the schema grouped course content before this (course_
-- content_links.position was a single flat counter per course) -- this is
-- the provider-facing course editor's new structuring concept.
create table course_sections (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references course_catalogue(id) on delete cascade not null,
  title text not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index course_sections_course_id_idx on course_sections (course_id);

alter table course_content_links add column section_id uuid references course_sections(id) on delete set null;
create index course_content_links_section_id_idx on course_content_links (section_id);

-- Backfill: every course that already has content gets one "General"
-- section so existing links stay visible/grouped once the editor UI
-- expects every item to belong to a section, rather than becoming silently
-- orphaned. Existing course_content_links.position values were already
-- sequential per course, so relative order is preserved unchanged inside
-- this one bucket.
insert into course_sections (course_id, title, position)
select distinct course_id, 'General', 0
from course_content_links;

update course_content_links ccl
set section_id = cs.id
from course_sections cs
where cs.course_id = ccl.course_id and cs.position = 0 and cs.title = 'General';

alter table course_sections enable row level security;

-- Same visibility rule as course_content_links/content_resources: a
-- section is viewable wherever its course is (approved and public,
-- platform admin, or the owning org's own members).
create policy "View sections for viewable courses"
  on course_sections for select
  to authenticated
  using (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_sections.course_id
        and (
          cc.status = 'approved'
          or is_platform_admin(auth.uid())
          or (cc.organisation_id is not null and is_org_member(cc.organisation_id, auth.uid()))
        )
    )
  );

-- Same manage rule as course_catalogue's own org-members update policy
-- (0066): only while the course is still draft/rejected.
create policy "Org members manage sections for their own editable courses"
  on course_sections for all
  to authenticated
  using (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_sections.course_id
        and (
          is_platform_admin(auth.uid())
          or (
            cc.organisation_id is not null
            and is_org_member(cc.organisation_id, auth.uid())
            and cc.status in ('draft', 'rejected')
          )
        )
    )
  )
  with check (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_sections.course_id
        and (
          is_platform_admin(auth.uid())
          or (
            cc.organisation_id is not null
            and is_org_member(cc.organisation_id, auth.uid())
            and cc.status in ('draft', 'rejected')
          )
        )
    )
  );

-- Extends 0074's course_content_links manage policy (unchanged `using`) with
-- one more `with check` condition: a link's section_id, if set, must belong
-- to the same course_id it's linked into -- otherwise an org admin could
-- point a link at a section from an entirely different course, corrupting
-- that other course's structure even though resource/course ownership
-- checks both still pass individually.
drop policy "Org members manage links for their own editable courses" on course_content_links;

create policy "Org members manage links for their own editable courses"
  on course_content_links for all
  to authenticated
  using (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_content_links.course_id
        and (
          is_platform_admin(auth.uid())
          or (
            cc.organisation_id is not null
            and is_org_member(cc.organisation_id, auth.uid())
            and cc.status in ('draft', 'rejected')
          )
        )
    )
    and can_manage_content_resource(course_content_links.resource_id, auth.uid())
  )
  with check (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_content_links.course_id
        and (
          is_platform_admin(auth.uid())
          or (
            cc.organisation_id is not null
            and is_org_member(cc.organisation_id, auth.uid())
            and cc.status in ('draft', 'rejected')
          )
        )
    )
    and can_manage_content_resource(course_content_links.resource_id, auth.uid())
    and (
      course_content_links.section_id is null
      or exists (
        select 1 from course_sections cs
        where cs.id = course_content_links.section_id and cs.course_id = course_content_links.course_id
      )
    )
  );



-- =============================================================================
-- 0079_xapi_resources.sql
-- =============================================================================

-- xAPI (Tin Can) content packages as a fourth content_resources type,
-- alongside video/file/scorm (0071) -- uploaded/attached the same way as a
-- SCORM package, but launched via a URL + query-string launch payload
-- (endpoint/auth/actor/registration) rather than a window.API runtime,
-- since that's how the xAPI spec's own launch method works.
-- Constraint keeps its original name from before the course_content_items
-- -> content_resources rename (0073) -- table renames don't rename
-- constraints, same reasoning as that migration's own
-- course_content_items_storage_path_scoped drop.
alter table content_resources drop constraint course_content_items_type_check;
alter table content_resources add constraint content_resources_type_check
  check (type in ('video', 'file', 'scorm', 'xapi'));

-- Links a recorded statement back to the content package that produced it.
-- Nullable and "on delete set null" -- same "don't delete the underlying
-- record on unlink" rule as every other association in this schema; a
-- statement is evidence of what a learner did and must survive even if the
-- resource is later removed. Statements from the existing self-report flow
-- (RecordActivityModal etc.) keep resource_id null, exactly as before.
alter table xapi_statements add column resource_id uuid
  references content_resources(id) on delete set null;

create index xapi_statements_resource_id_idx on xapi_statements (resource_id);

-- One row per "launch" of an xAPI package -- the registration (this row's
-- id) and a random bearer token are embedded in the package's launch URL,
-- and the api/xapi/[...path].js LRS endpoint looks up incoming Basic-auth
-- requests against this table (via the service role, since the request has
-- no Supabase session -- it authenticates with this token instead) to learn
-- which user/resource/course a statement submission belongs to. Short-lived
-- by design: a launch is one learning session, not a standing credential.
create table xapi_launch_sessions (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid references content_resources(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  -- The learner's own `courses` row (not course_catalogue) -- mirrors
  -- xapi_statements.course_id (0020) so statements recorded via a package
  -- link to the same "course" a self-reported statement would. Nullable:
  -- previewing a resource from the org's library (not yet attached to any
  -- enrolled course) has no course context.
  course_id uuid references courses(id) on delete set null,
  token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '4 hours')
);

create index xapi_launch_sessions_token_idx on xapi_launch_sessions (token);

alter table xapi_launch_sessions enable row level security;

-- A learner creates their own launch session when opening an xAPI package
-- (self-service, like connection_invites); the LRS endpoint itself reads
-- this table via the service role, bypassing RLS entirely, since incoming
-- statement requests carry the session token, not a Supabase JWT.
create policy "Users create and view their own xapi launch sessions"
  on xapi_launch_sessions for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);



-- =============================================================================
-- 0080_xapi_launch_session_hardening.sql
-- =============================================================================

-- 0079's "for all" policy on xapi_launch_sessions had two gaps: (1) it
-- covered UPDATE with no restriction beyond "still my row", so a learner
-- could repoint their own session's resource_id/course_id to anything with
-- a matching row, and push expires_at arbitrarily into the future --
-- defeating the "one launch, short-lived, resource-scoped credential"
-- design entirely; (2) neither INSERT nor that UPDATE verified resource_id
-- was actually visible to the caller, or course_id actually belonged to
-- them -- only that the row existed (FK checks aren't an authorization
-- check). Splitting into SELECT/INSERT/DELETE (no UPDATE at all -- a
-- session is immutable once created; DELETE lets a learner revoke their own
-- early) and adding real ownership/visibility checks on INSERT closes both.
drop policy "Users create and view their own xapi launch sessions" on xapi_launch_sessions;

create policy "Users view their own xapi launch sessions"
  on xapi_launch_sessions for select
  to authenticated
  using (auth.uid() = user_id);

-- Mirrors content_resources' own select policy (0074) for the resource
-- visibility check, and courses' ownership for course_id -- a session can
-- only be minted for a resource/course the caller could actually see/owns
-- in the first place.
create policy "Users create their own xapi launch sessions"
  on xapi_launch_sessions for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from content_resources cr
      where cr.id = xapi_launch_sessions.resource_id
        and (
          is_platform_admin(auth.uid())
          or is_org_member(cr.organisation_id, auth.uid())
          or exists (
            select 1 from course_content_links ccl
            join course_catalogue cc on cc.id = ccl.course_id
            where ccl.resource_id = cr.id and cc.status = 'approved'
          )
        )
    )
    and (
      course_id is null
      or exists (select 1 from courses c where c.id = xapi_launch_sessions.course_id and c.user_id = auth.uid())
    )
  );

create policy "Users delete their own xapi launch sessions"
  on xapi_launch_sessions for delete
  to authenticated
  using (auth.uid() = user_id);

-- Table-level backstop (not just RLS): even a direct insert can't set
-- expires_at further out than the intended 4-hour window from created_at,
-- regardless of what the client-side call omits/includes.
alter table xapi_launch_sessions
  add constraint xapi_launch_sessions_expiry_bounded
  check (expires_at <= created_at + interval '4 hours');



-- =============================================================================
-- 0081_organisation_self_service_settings.sql
-- =============================================================================

-- Provider self-service org settings: a logo and an "about us" blurb, plus
-- genuine self-service editing of the website url (0068) -- previously
-- organisations had no update policy at all except for platform admins
-- (0065), so a provider could never edit their own org's url either, only
-- ask a platform admin to do it via AdminProviders.jsx.
alter table organisations add column logo_url text;
alter table organisations add column about text;

-- Additive to (not a replacement for) the existing platform-admin update
-- policy -- RLS can't restrict this to specific columns, so name/status/
-- type stay platform-admin-only via the trigger below instead, same
-- approach as 0065's prevent_self_account_status_change guard on profiles:
-- renaming, deactivating, or changing an org's type has moderation
-- implications (deactivation revokes staff access org-wide, 0069) that
-- should stay a platform decision, while url/logo/about are the org's own
-- identity to manage.
create policy "Org admins can update their own organisation"
  on organisations for update
  to authenticated
  using (is_org_admin(id, auth.uid()))
  with check (is_org_admin(id, auth.uid()));

create or replace function prevent_org_identity_change_by_non_admin()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if (new.name is distinct from old.name
      or new.status is distinct from old.status
      or new.type is distinct from old.type)
     and auth.uid() is not null
     and not is_platform_admin(auth.uid()) then
    raise exception 'name, status, and type can only be changed by a platform admin';
  end if;
  return new;
end;
$$;

create trigger prevent_org_identity_change_by_non_admin_trigger
  before update on organisations
  for each row execute procedure prevent_org_identity_change_by_non_admin();

-- Org logos: same public-bucket, path-scoped-by-owner pattern as avatars
-- (0004_avatar_and_current_role.sql), scoped by organisation_id instead of
-- user_id. Upload/replace/remove restricted to that organisation's own
-- admins (is_org_admin), matching the Users tab's admin-only gating in the
-- provider console -- trainers can build training/resources but org
-- identity settings are an admin-only action.
insert into storage.buckets (id, name, public)
values ('org-logos', 'org-logos', true)
on conflict (id) do nothing;

create policy "Organisation logos are publicly accessible"
  on storage.objects for select
  using (bucket_id = 'org-logos');

create policy "Org admins can upload their own organisation's logo"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'org-logos'
    and exists (
      select 1 from organisations o
      where o.id::text = (storage.foldername(name))[1] and is_org_admin(o.id, auth.uid())
    )
  );

create policy "Org admins can replace their own organisation's logo"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'org-logos'
    and exists (
      select 1 from organisations o
      where o.id::text = (storage.foldername(name))[1] and is_org_admin(o.id, auth.uid())
    )
  )
  with check (
    bucket_id = 'org-logos'
    and exists (
      select 1 from organisations o
      where o.id::text = (storage.foldername(name))[1] and is_org_admin(o.id, auth.uid())
    )
  );

create policy "Org admins can remove their own organisation's logo"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'org-logos'
    and exists (
      select 1 from organisations o
      where o.id::text = (storage.foldername(name))[1] and is_org_admin(o.id, auth.uid())
    )
  );



-- =============================================================================
-- 0082_organisation_guard_created_by.sql
-- =============================================================================

-- 0081's identity-change trigger guarded name/status/type but missed
-- created_by -- an audit-only field (not used in any RLS/authorization
-- check, per this schema's convention), but an org admin could still
-- rewrite it via a raw PostgREST PATCH bypassing updateOrganisation()'s own
-- JS wrapper. No live privilege-escalation impact, but cheap to close for
-- defense in depth and consistency with the trigger's own stated intent:
-- org admins manage their own identity, not provenance.
create or replace function prevent_org_identity_change_by_non_admin()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if (new.name is distinct from old.name
      or new.status is distinct from old.status
      or new.type is distinct from old.type
      or new.created_by is distinct from old.created_by)
     and auth.uid() is not null
     and not is_platform_admin(auth.uid()) then
    raise exception 'name, status, type, and created_by can only be changed by a platform admin';
  end if;
  return new;
end;
$$;



-- =============================================================================
-- 0083_skill_level_guide_sample.sql
-- =============================================================================

-- Skill-specific level guide text (practical_level_guide/knowledge_level_
-- guide, 0047/0057) is cached per learner instance on `skills`, not shared
-- by `skill_library` -- a platform admin has no standing RLS access to any
-- learner's own skills rows (owner-only, 0001), so the admin skill detail
-- page needs a way to see *some* real, already-generated guide for a
-- library skill. Anonymous, content-only lookup -- same shape as
-- count_skill_trackers (0053) and skill_level_stats (0076): no user
-- identity in the result, so no privacy opt-in needed, open to any
-- authenticated user like those two. Prefers a row with both axes
-- populated, then the most recently added.
create or replace function skill_level_guide_sample(p_library_skill_id uuid)
returns table (practical_level_guide jsonb, knowledge_level_guide jsonb)
language sql
security definer
set search_path = public
stable
as $$
  select practical_level_guide, knowledge_level_guide
  from skills
  where library_skill_id = p_library_skill_id
    and (practical_level_guide is not null or knowledge_level_guide is not null)
  order by
    (practical_level_guide is not null and knowledge_level_guide is not null) desc,
    date_added desc
  limit 1
$$;

grant execute on function skill_level_guide_sample(uuid) to authenticated;



-- =============================================================================
-- 0084_external_video_resources.sql
-- =============================================================================

-- External video (YouTube/Vimeo) as a fifth content_resources type, alongside
-- video/file/scorm/xapi (0071, 0079) -- a link the provider pastes, not a
-- file they upload, so there's nothing to put in storage_path. Reuses the
-- same table/course_content_links attachment mechanism rather than a
-- parallel "linked resource" concept (see CLAUDE.md's domain-duplication
-- rule) -- an external video is just another kind of launchable content item.
alter table content_resources drop constraint content_resources_type_check;
alter table content_resources add constraint content_resources_type_check
  check (type in ('video', 'file', 'scorm', 'xapi', 'external_video'));

alter table content_resources alter column storage_path drop not null;

alter table content_resources add column external_url text;

-- external_video rows carry a URL and no storage; every other type carries
-- storage and no URL. The app stores its own canonicalized embed URL here
-- (youtube.com/embed/{id} or player.vimeo.com/video/{id}), not whatever the
-- provider originally pasted -- see courseContent.js's addExternalVideoResource.
alter table content_resources add constraint content_resources_storage_or_external_check
  check (
    (type = 'external_video' and storage_path is null and external_url is not null)
    or (type <> 'external_video' and storage_path is not null and external_url is null)
  );



-- =============================================================================
-- 0085_fix_storage_policy_name_shadowing.sql
-- =============================================================================

-- 0073's and 0081's storage.objects policies for course-content and
-- org-logos each run `select 1 from organisations o where o.id::text =
-- (storage.foldername(name))[1] ...` inside the policy's USING/WITH CHECK.
-- Postgres resolves that unqualified `name` against the *closest* enclosing
-- FROM clause first -- and organisations has its own `name` column (the
-- org's display name), so it silently binds to `o.name` instead of the
-- intended (correlated) `storage.objects.name`, i.e. the actual upload
-- path. `pg_policies` confirms every one of these shipped as
-- `(storage.foldername(o.name))[1]`.
--
-- An org's display name is never a valid uuid, so `o.id::text = (...)[1]`
-- can never match -- these five policies have silently rejected every
-- upload/replace/remove since the day each shipped: course-content video/
-- file/SCORM/xAPI uploads (0073) and org logo uploads (0081). Only
-- external_video resources (content_resources-only, no storage write) and
-- avatar/skill-evidence uploads (different, unaffected policies) ever
-- worked. Fix: qualify the storage object's own path column explicitly so
-- it can't be shadowed by the subquery's organisations alias.

drop policy "Org members can upload their own organisation's resources" on storage.objects;
create policy "Org members can upload their own organisation's resources"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'course-content'
    and exists (
      select 1 from organisations o
      where o.id::text = (storage.foldername(storage.objects.name))[1]
        and (is_platform_admin(auth.uid()) or is_org_member(o.id, auth.uid()))
    )
  );

drop policy "Org members can remove their own organisation's resources" on storage.objects;
create policy "Org members can remove their own organisation's resources"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'course-content'
    and exists (
      select 1 from organisations o
      where o.id::text = (storage.foldername(storage.objects.name))[1]
        and (is_platform_admin(auth.uid()) or is_org_member(o.id, auth.uid()))
    )
  );

drop policy "Org admins can upload their own organisation's logo" on storage.objects;
create policy "Org admins can upload their own organisation's logo"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'org-logos'
    and exists (
      select 1 from organisations o
      where o.id::text = (storage.foldername(storage.objects.name))[1] and is_org_admin(o.id, auth.uid())
    )
  );

drop policy "Org admins can replace their own organisation's logo" on storage.objects;
create policy "Org admins can replace their own organisation's logo"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'org-logos'
    and exists (
      select 1 from organisations o
      where o.id::text = (storage.foldername(storage.objects.name))[1] and is_org_admin(o.id, auth.uid())
    )
  )
  with check (
    bucket_id = 'org-logos'
    and exists (
      select 1 from organisations o
      where o.id::text = (storage.foldername(storage.objects.name))[1] and is_org_admin(o.id, auth.uid())
    )
  );

drop policy "Org admins can remove their own organisation's logo" on storage.objects;
create policy "Org admins can remove their own organisation's logo"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'org-logos'
    and exists (
      select 1 from organisations o
      where o.id::text = (storage.foldername(storage.objects.name))[1] and is_org_admin(o.id, auth.uid())
    )
  );



-- =============================================================================
-- 0086_profile_theme_preference.sql
-- =============================================================================

-- Lets a learner set light/dark/system appearance from their profile
-- settings, mirroring the existing language/country self-service fields on
-- this table. 'system' (follow the OS/browser) is the default so nobody's
-- display flips unexpectedly on first load after this ships.
alter table profiles add column theme_preference text not null default 'system'
  check (theme_preference in ('light', 'dark', 'system'));



-- =============================================================================
-- 0087_video_edit_overlays.sql
-- =============================================================================

-- Non-destructive video editing (trim/filter/speed + text & sticker
-- overlays) for provider training videos: the edit is stored as data and
-- applied at playback time (EditedVideoPlayer.jsx), never baked into the
-- uploaded file itself -- no re-encoding, no new storage write path, and
-- the original upload stays byte-for-byte untouched. Lives directly on
-- content_resources (one video = one edit) rather than a new table, since
-- it's never queried independently of its resource and inherits that
-- table's existing RLS ("Org members manage their own organisation's
-- resources") with no policy changes needed.
alter table content_resources add column video_edit jsonb;



-- =============================================================================
-- 0088_provider_unpublish_approved_course.sql
-- =============================================================================

-- Providers previously had no way back into an approved course at all --
-- every provider-facing UPDATE policy (course_catalogue's own edit policy,
-- course_content_links' attach/detach policy, and course sections' policies,
-- 0066/0071/0078) requires status in ('draft', 'rejected'), and even a
-- platform admin's only lever on an approved course (AdminCatalogue's
-- "Deactivate" -> status 'inactive') doesn't unlock those either. Decision
-- (see conversation): self-service -- a provider can unpublish their own
-- approved course straight back to draft, edit it, and resubmit, same as
-- any other draft. This migration adds only the one missing capability
-- (the unpublish transition itself); once a course is back in 'draft', the
-- existing draft-editing policies already handle everything else
-- unchanged.
--
-- Deliberately a separate, narrow policy rather than widening the existing
-- "Organisation members can edit their own draft or rejected entries"
-- policy to include 'approved' -- that would let updateProviderCourse's
-- plain field edits (name/synopsis/etc, which never touch status) succeed
-- directly against a still-approved, live row. Keeping this policy scoped
-- to approved-only-going-to-draft means every other write path stays
-- blocked until the course has actually been unpublished first.
create policy "Organisation members can unpublish their own approved course"
  on course_catalogue for update
  to authenticated
  using (
    organisation_id is not null
    and is_org_member(organisation_id, auth.uid())
    and status = 'approved'
  )
  with check (
    organisation_id is not null
    and is_org_member(organisation_id, auth.uid())
    and status = 'draft'
  );

-- Decision: a learner already partway through a course keeps their access
-- to it even while the provider has it back in draft for edits -- only new
-- discovery/enrollment is hidden (course_catalogue's public "status =
-- approved" branch, unchanged). Extends the four course-visibility SELECT
-- policies (plus the xapi launch-session policy that embeds the same
-- check) with an additional branch: the requesting user has their own
-- `courses` row already pointing at this catalogue entry. `courses`' own
-- RLS ("Users manage their own courses") only checks user_id = auth.uid()
-- and never references any of these tables back, so this can't recreate
-- 0074's policy-recursion bug.

drop policy "View approved courses, your own organisation's, or as a platform admin" on course_catalogue;
create policy "View approved courses, your own organisation's, as a platform admin, or your own enrollment"
  on course_catalogue for select
  to authenticated
  using (
    status = 'approved'
    or is_platform_admin(auth.uid())
    or (organisation_id is not null and is_org_member(organisation_id, auth.uid()))
    or exists (select 1 from courses c where c.catalogue_course_id = course_catalogue.id and c.user_id = auth.uid())
  );

drop policy "View sections for viewable courses" on course_sections;
create policy "View sections for viewable courses"
  on course_sections for select
  to authenticated
  using (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_sections.course_id
        and (
          cc.status = 'approved'
          or is_platform_admin(auth.uid())
          or (cc.organisation_id is not null and is_org_member(cc.organisation_id, auth.uid()))
          or exists (select 1 from courses c where c.catalogue_course_id = cc.id and c.user_id = auth.uid())
        )
    )
  );

drop policy "View links for viewable courses" on course_content_links;
create policy "View links for viewable courses"
  on course_content_links for select
  to authenticated
  using (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_content_links.course_id
        and (
          cc.status = 'approved'
          or is_platform_admin(auth.uid())
          or (cc.organisation_id is not null and is_org_member(cc.organisation_id, auth.uid()))
          or exists (select 1 from courses c where c.catalogue_course_id = cc.id and c.user_id = auth.uid())
        )
    )
  );

drop policy "View own org's resources, or linked into an approved course" on content_resources;
create policy "View own org's resources, linked into an approved course, or your own enrollment"
  on content_resources for select
  to authenticated
  using (
    is_platform_admin(auth.uid())
    or is_org_member(organisation_id, auth.uid())
    or exists (
      select 1 from course_content_links ccl
      join course_catalogue cc on cc.id = ccl.course_id
      where ccl.resource_id = content_resources.id
        and (
          cc.status = 'approved'
          or exists (select 1 from courses c where c.catalogue_course_id = cc.id and c.user_id = auth.uid())
        )
    )
  );

drop policy "Users create their own xapi launch sessions" on xapi_launch_sessions;
create policy "Users create their own xapi launch sessions"
  on xapi_launch_sessions for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from content_resources cr
      where cr.id = xapi_launch_sessions.resource_id
        and (
          is_platform_admin(auth.uid())
          or is_org_member(cr.organisation_id, auth.uid())
          or exists (
            select 1 from course_content_links ccl
            join course_catalogue cc on cc.id = ccl.course_id
            where ccl.resource_id = cr.id
              and (
                cc.status = 'approved'
                or exists (select 1 from courses c where c.catalogue_course_id = cc.id and c.user_id = auth.uid())
              )
          )
        )
    )
    and (course_id is null or exists (select 1 from courses c where c.id = xapi_launch_sessions.course_id and c.user_id = auth.uid()))
  );



-- =============================================================================
-- 0089_shared_skill_library_level_guides.sql
-- =============================================================================

-- AI-generated level guide text (knowledge_level_guide/practical_level_guide,
-- 0047/0057) only ever depends on the skill *name*, so it was wasteful to
-- cache it per learner instance on `skills` -- every learner tracking, say,
-- "Python" was independently generating and paying for an identical guide.
-- Moves the cache onto the shared `skill_library` row instead, so the first
-- learner to need a guide for a given library skill generates it for
-- everyone. Custom skills with no library_skill_id (0013) still fall back to
-- the existing per-instance columns on `skills`, which stay as-is.
--
-- A private library entry (is_private, 0028) is only ever readable by its
-- creator anyway, so caching there is already correctly scoped to just that
-- one person -- no special-casing needed between public/private entries.
alter table skill_library add column knowledge_level_guide jsonb;
alter table skill_library add column practical_level_guide jsonb;

-- skill_library intentionally has no update policy (0013) -- entries are
-- immutable once created, by design. Rather than opening a general UPDATE
-- policy (which would also let any authenticated user rewrite name/category/
-- description), this narrow security-definer function is the only write
-- path: it only ever touches the two guide columns, and only when a column
-- is still null, so a slower concurrent generation can never clobber one
-- that already landed. Same pattern as the read-only skill_level_guide_sample
-- (0083).
create or replace function set_skill_library_level_guide(p_skill_library_id uuid, p_axis text, p_statements jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_axis = 'knowledge' then
    update skill_library
    set knowledge_level_guide = coalesce(knowledge_level_guide, p_statements)
    where id = p_skill_library_id;
  elsif p_axis = 'practical' then
    update skill_library
    set practical_level_guide = coalesce(practical_level_guide, p_statements)
    where id = p_skill_library_id;
  else
    raise exception 'invalid axis: %', p_axis;
  end if;
end;
$$;

grant execute on function set_skill_library_level_guide(uuid, text, jsonb) to authenticated;



-- =============================================================================
-- 0090_provider_public_profile.sql
-- =============================================================================

-- Public provider profile pages: an opt-in, anonymously-readable page at
-- /providers/:slug listing an organisation's offered skills and approved
-- training courses. 0076 deliberately kept offered-skills visibility scoped
-- to org members only ("no learner-facing surface for this yet, not
-- requested") -- this is that request, but still opt-in per-organisation
-- (public_profile_enabled, default false) rather than making every
-- provider's roster public the moment this ships.
alter table organisations add column slug text unique;
alter table organisations add column public_profile_enabled boolean not null default false;

-- Lowercase, non-alphanumeric runs collapsed to a single hyphen, trimmed --
-- e.g. "Acme Training Ltd." -> "acme-training-ltd".
create or replace function slugify_organisation_name(p_name text)
returns text
language sql
immutable
as $$
  select trim(both '-' from regexp_replace(lower(trim(p_name)), '[^a-z0-9]+', '-', 'g'))
$$;

-- Appends -2, -3, ... on collision. p_existing_id excludes the row being
-- (re)slugged itself, so re-running this for an unchanged name doesn't
-- collide with its own current slug.
create or replace function generate_unique_organisation_slug(p_name text, p_existing_id uuid)
returns text
language plpgsql
as $$
declare
  base_slug text := nullif(slugify_organisation_name(p_name), '');
  candidate text;
  suffix int := 1;
begin
  base_slug := coalesce(base_slug, 'provider');
  candidate := base_slug;
  while exists (
    select 1 from organisations
    where slug = candidate and id is distinct from p_existing_id
  ) loop
    suffix := suffix + 1;
    candidate := base_slug || '-' || suffix;
  end loop;
  return candidate;
end;
$$;

create or replace function set_organisation_slug()
returns trigger
language plpgsql
as $$
begin
  if new.slug is null then
    new.slug := generate_unique_organisation_slug(new.name, new.id);
  end if;
  return new;
end;
$$;

create trigger set_organisation_slug_trigger
  before insert on organisations
  for each row execute procedure set_organisation_slug();

-- Backfill existing organisations one row at a time (not a single bulk
-- UPDATE) so two orgs sharing a name still get distinct slugs -- a
-- statement-level snapshot wouldn't see an earlier row's new slug within
-- the same UPDATE, but each iteration of this loop is its own statement.
do $$
declare
  r record;
begin
  for r in select id, name from organisations where slug is null order by created_at loop
    update organisations set slug = generate_unique_organisation_slug(r.name, r.id) where id = r.id;
  end loop;
end $$;

-- Anonymous-safe read: a single security-definer RPC (same pattern as
-- get_invite_preview, 0010) rather than opening organisations/
-- course_catalogue/organisation_offered_skills RLS to anon directly. Returns
-- null organisation (and empty skills/courses) uniformly whether the slug
-- doesn't exist, the org is inactive, or public_profile_enabled is false --
-- so this can't be used to enumerate which providers exist vs. have opted
-- out.
create or replace function get_provider_profile(p_slug text)
returns json
language sql
security definer
set search_path = public
stable
as $$
  select json_build_object(
    'organisation', (
      select json_build_object(
        'id', o.id,
        'name', o.name,
        'about', o.about,
        'logoUrl', o.logo_url,
        'url', o.url
      )
      from organisations o
      where o.slug = p_slug and o.status = 'active' and o.public_profile_enabled = true
    ),
    'skills', (
      select coalesce(json_agg(json_build_object(
        'id', sl.id,
        'name', sl.name,
        'category', sl.category,
        'description', sl.description
      ) order by sl.name), '[]'::json)
      from organisation_offered_skills oos
      join skill_library sl on sl.id = oos.skill_library_id
      join organisations o on o.id = oos.organisation_id
      where o.slug = p_slug and o.status = 'active' and o.public_profile_enabled = true
    ),
    'courses', (
      select coalesce(json_agg(json_build_object(
        'id', cc.id,
        'name', cc.name,
        'synopsis', cc.synopsis,
        'courseType', cc.course_type,
        'duration', cc.duration
      ) order by cc.name), '[]'::json)
      from course_catalogue cc
      join organisations o on o.id = cc.organisation_id
      where o.slug = p_slug and o.status = 'active' and o.public_profile_enabled = true
        and cc.status = 'approved'
    )
  )
$$;

grant execute on function get_provider_profile(text) to anon, authenticated;



-- =============================================================================
-- 0091_provider_profile_course_details.sql
-- =============================================================================

-- The public provider page's course tiles should look like the catalogue's
-- own browse card (same skill/tag chips), not a stripped-down summary --
-- replace get_provider_profile's courses branch to also aggregate
-- course_catalogue_skills/course_catalogue_tags per course, matching what
-- src/lib/courseCatalogue.js's listCatalogueCourses() already returns for
-- these same rows.
create or replace function get_provider_profile(p_slug text)
returns json
language sql
security definer
set search_path = public
stable
as $$
  select json_build_object(
    'organisation', (
      select json_build_object(
        'id', o.id,
        'name', o.name,
        'about', o.about,
        'logoUrl', o.logo_url,
        'url', o.url
      )
      from organisations o
      where o.slug = p_slug and o.status = 'active' and o.public_profile_enabled = true
    ),
    'skills', (
      select coalesce(json_agg(json_build_object(
        'id', sl.id,
        'name', sl.name,
        'category', sl.category,
        'description', sl.description
      ) order by sl.name), '[]'::json)
      from organisation_offered_skills oos
      join skill_library sl on sl.id = oos.skill_library_id
      join organisations o on o.id = oos.organisation_id
      where o.slug = p_slug and o.status = 'active' and o.public_profile_enabled = true
    ),
    'courses', (
      select coalesce(json_agg(json_build_object(
        'id', cc.id,
        'name', cc.name,
        'synopsis', cc.synopsis,
        'courseType', cc.course_type,
        'duration', cc.duration,
        'skillEntries', (
          select coalesce(json_agg(json_build_object(
            'skillId', ccs.skill_library_id,
            'skillName', sl2.name,
            'level', ccs.level
          )), '[]'::json)
          from course_catalogue_skills ccs
          join skill_library sl2 on sl2.id = ccs.skill_library_id
          where ccs.course_catalogue_id = cc.id
        ),
        'tags', (
          select coalesce(json_agg(json_build_object('id', t.id, 'name', t.name)), '[]'::json)
          from course_catalogue_tags cct
          join tags t on t.id = cct.tag_id
          where cct.course_catalogue_id = cc.id
        )
      ) order by cc.name), '[]'::json)
      from course_catalogue cc
      join organisations o on o.id = cc.organisation_id
      where o.slug = p_slug and o.status = 'active' and o.public_profile_enabled = true
        and cc.status = 'approved'
    )
  )
$$;

grant execute on function get_provider_profile(text) to anon, authenticated;



-- =============================================================================
-- 0092_skill_knowledge_level_source_stats.sql
-- =============================================================================

-- Per-knowledge-level breakdown of self-rated vs assessed trackers, for the
-- platform admin skill detail page's new "assessment stats" view. Same
-- anonymous, count-only shape as skill_level_stats (0076)/count_skill_trackers
-- (0053) -- never returns user identities, just grouped counts, so it needs
-- no privacy opt-in.
--
-- Buckets each tracker under their *current* skills.knowledge_level (the
-- same column skill_level_stats groups practical level by), using the source
-- of that user's most recent knowledge-axis skill_assessments row to decide
-- self vs assessed. A tracker with no knowledge-axis assessment row at all
-- (knowledge_level set some other way) counts toward neither bucket.
create or replace function skill_knowledge_level_source_stats(p_library_skill_id uuid)
returns table (level int, self_count int, assessed_count int)
language sql
security definer
set search_path = public
stable
as $$
  with latest_knowledge_assessment as (
    select distinct on (sa.user_id)
      sa.user_id, sa.source
    from skill_assessments sa
    join skills s on s.id = sa.skill_id
    where s.library_skill_id = p_library_skill_id
      and sa.axis = 'knowledge'
    order by sa.user_id, sa.assessed_at desc
  )
  select
    s.knowledge_level as level,
    count(*) filter (where lka.source = 'self')::int as self_count,
    count(*) filter (where lka.source is not null and lka.source != 'self')::int as assessed_count
  from skills s
  left join latest_knowledge_assessment lka on lka.user_id = s.user_id
  where s.library_skill_id = p_library_skill_id
    and s.knowledge_level is not null
  group by s.knowledge_level
  order by s.knowledge_level
$$;

grant execute on function skill_knowledge_level_source_stats(uuid) to authenticated;



-- =============================================================================
-- 0093_course_catalogue_image.sql
-- =============================================================================

-- Course cover image, overtaking CourseThumbnail's generated gradient
-- placeholder once set. Distinct from organisations.logo_url (0081), which
-- is a small provider badge, not the course's own image.
alter table course_catalogue add column image_url text;

insert into storage.buckets (id, name, public)
values ('course-catalogue-images', 'course-catalogue-images', true)
on conflict (id) do nothing;

-- No SELECT policy, matching the course-content bucket (0072) rather than
-- org-logos (0081): the bucket's public=true flag already serves images via
-- an unauthenticated GET that bypasses storage.objects RLS entirely, so a
-- SELECT policy here would only ever grant *listing* the bucket's contents
-- -- a capability nothing in this feature needs.
--
-- Write access mirrors 0072's course-content bucket exactly: an
-- organisation member may upload/replace/remove their own course's image
-- while it's draft/rejected (the same window course_catalogue's own update
-- policy allows them to edit the rest of the course in), or a platform
-- admin at any status. Authorization is derived from the literal object
-- path's course-id folder segment, not from course_catalogue.image_url --
-- a row's own claimed URL can't be trusted to prove which folder it's
-- actually allowed to touch.
create policy "Course editors can upload their course's image"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'course-catalogue-images'
    and exists (
      select 1 from course_catalogue cc
      where cc.id::text = (storage.foldername(name))[1]
        and (
          is_platform_admin(auth.uid())
          or (
            cc.organisation_id is not null
            and is_org_member(cc.organisation_id, auth.uid())
            and cc.status in ('draft', 'rejected')
          )
        )
    )
  );

create policy "Course editors can replace their course's image"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'course-catalogue-images'
    and exists (
      select 1 from course_catalogue cc
      where cc.id::text = (storage.foldername(name))[1]
        and (
          is_platform_admin(auth.uid())
          or (
            cc.organisation_id is not null
            and is_org_member(cc.organisation_id, auth.uid())
            and cc.status in ('draft', 'rejected')
          )
        )
    )
  )
  with check (
    bucket_id = 'course-catalogue-images'
    and exists (
      select 1 from course_catalogue cc
      where cc.id::text = (storage.foldername(name))[1]
        and (
          is_platform_admin(auth.uid())
          or (
            cc.organisation_id is not null
            and is_org_member(cc.organisation_id, auth.uid())
            and cc.status in ('draft', 'rejected')
          )
        )
    )
  );

create policy "Course editors can remove their course's image"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'course-catalogue-images'
    and exists (
      select 1 from course_catalogue cc
      where cc.id::text = (storage.foldername(name))[1]
        and (
          is_platform_admin(auth.uid())
          or (
            cc.organisation_id is not null
            and is_org_member(cc.organisation_id, auth.uid())
            and cc.status in ('draft', 'rejected')
          )
        )
    )
  );



-- =============================================================================
-- 0094_provider_profile_course_image.sql
-- =============================================================================

-- The public provider page (0091) built its course tiles before 0093 added
-- course_catalogue.image_url -- surface it here too, the same way 0091
-- added skill/tag chips, so an uploaded course image replaces
-- CourseThumbnail's placeholder on the public page exactly as it already
-- does on the learner-facing catalogue (src/lib/courseCatalogue.js, a plain
-- `select *` that already carries the new column with no query change
-- needed there).
create or replace function get_provider_profile(p_slug text)
returns json
language sql
security definer
set search_path = public
stable
as $$
  select json_build_object(
    'organisation', (
      select json_build_object(
        'id', o.id,
        'name', o.name,
        'about', o.about,
        'logoUrl', o.logo_url,
        'url', o.url
      )
      from organisations o
      where o.slug = p_slug and o.status = 'active' and o.public_profile_enabled = true
    ),
    'skills', (
      select coalesce(json_agg(json_build_object(
        'id', sl.id,
        'name', sl.name,
        'category', sl.category,
        'description', sl.description
      ) order by sl.name), '[]'::json)
      from organisation_offered_skills oos
      join skill_library sl on sl.id = oos.skill_library_id
      join organisations o on o.id = oos.organisation_id
      where o.slug = p_slug and o.status = 'active' and o.public_profile_enabled = true
    ),
    'courses', (
      select coalesce(json_agg(json_build_object(
        'id', cc.id,
        'name', cc.name,
        'synopsis', cc.synopsis,
        'courseType', cc.course_type,
        'duration', cc.duration,
        'imageUrl', cc.image_url,
        'skillEntries', (
          select coalesce(json_agg(json_build_object(
            'skillId', ccs.skill_library_id,
            'skillName', sl2.name,
            'level', ccs.level
          )), '[]'::json)
          from course_catalogue_skills ccs
          join skill_library sl2 on sl2.id = ccs.skill_library_id
          where ccs.course_catalogue_id = cc.id
        ),
        'tags', (
          select coalesce(json_agg(json_build_object('id', t.id, 'name', t.name)), '[]'::json)
          from course_catalogue_tags cct
          join tags t on t.id = cct.tag_id
          where cct.course_catalogue_id = cc.id
        )
      ) order by cc.name), '[]'::json)
      from course_catalogue cc
      join organisations o on o.id = cc.organisation_id
      where o.slug = p_slug and o.status = 'active' and o.public_profile_enabled = true
        and cc.status = 'approved'
    )
  )
$$;

grant execute on function get_provider_profile(text) to anon, authenticated;



-- =============================================================================
-- 0095_recommend_skill_invites.sql
-- =============================================================================

-- "Recommend this skill" reuses the exact same connection_invites/share_code
-- mechanism as the existing invite-to-rate flow, rather than a parallel
-- table -- the two are the same underlying concept (an invite, addressed to
-- an email or shared as a link, redeemed once via share_code) with a
-- different outcome on accept. invite_type distinguishes the two so each
-- accept path only ever consumes its own kind of invite.
alter table connection_invites add column invite_type text not null default 'rate'
  check (invite_type in ('rate', 'recommend'));

-- Replaces the pending-dedup index from 0032 -- a learner may reasonably
-- want to both ask someone to rate a skill AND recommend they pick it up
-- themselves, so the two invite types shouldn't collide on uniqueness.
drop index connection_invites_unique_pending_idx;
create unique index connection_invites_unique_pending_idx
  on connection_invites (skill_id, lower(invitee_email), invite_type)
  where status = 'pending' and invitee_email is not null;

-- Recommending a skill only makes sense for one that's tied to the shared
-- library catalog (see 0013) -- that's what lets the invitee's new skill
-- reference the same library_skill_id instead of a same-named duplicate.
-- Recorded here too, not just in the UI gate, so a stale/tampered share
-- link can't be used to invite a recommendation for a purely private skill.
-- Return shape gained a column (invite_type), which Postgres won't let a
-- plain create-or-replace apply to an existing function -- has to be
-- dropped and recreated instead.
drop function get_invite_preview(text);

create function get_invite_preview(p_code text)
returns table (
  skill_name text,
  skill_category text,
  inviter_name text,
  status text,
  invite_type text
)
language sql
security definer
set search_path = public
as $$
  select s.name, s.category, coalesce(p.full_name, ''), ci.status, ci.invite_type
  from connection_invites ci
  join skills s on s.id = ci.skill_id
  left join profiles p on p.id = ci.inviter_id
  where ci.share_code = p_code
$$;

grant execute on function get_invite_preview(text) to anon, authenticated;

-- Unchanged except for the added invite_type guard, so a recommend invite's
-- share_code can never be redeemed as a rating (or vice versa) even if
-- someone hand-edits the URL.
create or replace function accept_invite_and_rate(p_code text, p_level int, p_comments text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite connection_invites%rowtype;
  v_skill skills%rowtype;
  v_rater_name text;
  v_rater_email text;
  v_rating_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_invite from connection_invites where share_code = p_code for update;
  if not found then
    raise exception 'Invite not found';
  end if;
  if v_invite.invite_type != 'rate' then
    raise exception 'This invite is not a rating invite.';
  end if;
  if v_invite.status != 'pending' then
    raise exception 'This invite has already been used.';
  end if;
  if v_invite.inviter_id = auth.uid() then
    raise exception 'You can''t rate your own skill.';
  end if;
  if p_level < 1 or p_level > 5 then
    raise exception 'Invalid level';
  end if;

  select * into v_skill from skills where id = v_invite.skill_id;
  select full_name into v_rater_name from profiles where id = auth.uid();
  select email into v_rater_email from auth.users where id = auth.uid();

  insert into skill_peer_ratings (
    skill_id, skill_name, skill_category, skill_owner_id,
    invite_id, rater_id, rater_name, rater_email, level, comments
  )
  values (
    v_invite.skill_id, v_skill.name, v_skill.category, v_skill.user_id,
    v_invite.id, auth.uid(), v_rater_name, v_rater_email, p_level, nullif(p_comments, '')
  )
  returning id into v_rating_id;

  update connection_invites
  set status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
  where id = v_invite.id;

  update skills s
  set level = latest.level
  from (
    select level, ts from (
      select level, assessed_at as ts from skill_assessments where skill_id = v_invite.skill_id
      union all
      select level, rated_at as ts from skill_peer_ratings where skill_id = v_invite.skill_id
    ) combined
    order by ts desc
    limit 1
  ) latest
  where s.id = v_invite.skill_id;

  return v_rating_id;
end;
$$;

grant execute on function accept_invite_and_rate(text, int, text) to authenticated;

-- Recommending a skill hands the invitee their own skills row, not a rating
-- on the inviter's -- library_skill_id is carried across so it's the same
-- reusable catalog entry, not a same-named duplicate (see 0013). Mirrors the
-- "pick an existing library skill" path in FindSkillModal, just server-side
-- since the invitee otherwise has no way to read an invite addressed to
-- them (connection_invites' only SELECT policy is "inviter can view their
-- own", same reasoning as accept_invite_and_rate above).
create or replace function accept_invite_and_recommend(p_code text, p_tracking_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite connection_invites%rowtype;
  v_skill skills%rowtype;
  v_new_skill_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_invite from connection_invites where share_code = p_code for update;
  if not found then
    raise exception 'Invite not found';
  end if;
  if v_invite.invite_type != 'recommend' then
    raise exception 'This invite is not a skill recommendation.';
  end if;
  if v_invite.status != 'pending' then
    raise exception 'This invite has already been used.';
  end if;
  if v_invite.inviter_id = auth.uid() then
    raise exception 'You can''t recommend a skill to yourself.';
  end if;

  select * into v_skill from skills where id = v_invite.skill_id;
  if v_skill.library_skill_id is null then
    raise exception 'This skill can no longer be recommended.';
  end if;

  insert into skills (
    user_id, name, library_skill_id, tracking_reason, lifecycle_stage, source, is_current_role
  )
  values (
    auth.uid(), v_skill.name, v_skill.library_skill_id, p_tracking_reason, 'identified', 'recommend', false
  )
  returning id into v_new_skill_id;

  update connection_invites
  set status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
  where id = v_invite.id;

  return v_new_skill_id;
end;
$$;

grant execute on function accept_invite_and_recommend(text, text) to authenticated;

alter table skills drop constraint skills_source_check;
alter table skills add constraint skills_source_check
  check (source in ('manual', 'cv_import', 'recommend'));

-- Mirrors list_incoming_rate_invites (0061) exactly, scoped to the other
-- invite_type -- see there for why this needs SECURITY DEFINER rather than a
-- plain table select.
create or replace function list_incoming_recommend_invites()
returns table (
  id uuid,
  inviter_id uuid,
  inviter_name text,
  skill_id uuid,
  skill_name text,
  skill_category text,
  share_code text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select ci.id, ci.inviter_id, p.full_name, ci.skill_id, s.name, s.category, ci.share_code, ci.created_at
  from connection_invites ci
  join skills s on s.id = ci.skill_id
  left join profiles p on p.id = ci.inviter_id
  where ci.status = 'pending'
    and ci.invite_type = 'recommend'
    and ci.invitee_email is not null
    and lower(ci.invitee_email) = lower((select email from auth.users where id = auth.uid()))
  order by ci.created_at desc
$$;

grant execute on function list_incoming_recommend_invites() to authenticated;

-- Scope the existing rate-invite listing to its own type, now that
-- connection_invites carries both kinds -- otherwise a pending recommend
-- invite would incorrectly show up as "wants your rating".
create or replace function list_incoming_rate_invites()
returns table (
  id uuid,
  inviter_id uuid,
  inviter_name text,
  skill_id uuid,
  skill_name text,
  skill_category text,
  share_code text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select ci.id, ci.inviter_id, p.full_name, ci.skill_id, s.name, s.category, ci.share_code, ci.created_at
  from connection_invites ci
  join skills s on s.id = ci.skill_id
  left join profiles p on p.id = ci.inviter_id
  where ci.status = 'pending'
    and ci.invite_type = 'rate'
    and ci.invitee_email is not null
    and lower(ci.invitee_email) = lower((select email from auth.users where id = auth.uid()))
  order by ci.created_at desc
$$;

grant execute on function list_incoming_rate_invites() to authenticated;



-- =============================================================================
-- 0096_decline_invite.sql
-- =============================================================================

-- Lets an invitee dismiss a pending invite addressed to their own verified
-- email, for either invite_type. Needed most for 'recommend' invites: unlike
-- a rating (which always succeeds), accept_invite_and_recommend can fail
-- permanently for a given invitee (e.g. they already track a same-named
-- skill -- see skills_user_id_name_lower_idx), and until now there was no
-- way for that invitee to get the invite out of their own pending-actions
-- list/badge count (only the inviter could revoke it, via the policy added
-- in 0032). Reuses the existing 'revoked' status rather than adding a new
-- one -- from the data model's perspective a declined invite and a
-- withdrawn one are the same "no longer active, never acted on" state.
create or replace function decline_invite(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite connection_invites%rowtype;
  v_own_email text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_invite from connection_invites where share_code = p_code for update;
  if not found then
    raise exception 'Invite not found';
  end if;
  if v_invite.status != 'pending' then
    raise exception 'This invite has already been used.';
  end if;

  select email into v_own_email from auth.users where id = auth.uid();
  if v_invite.invitee_email is null or lower(v_invite.invitee_email) != lower(v_own_email) then
    raise exception 'You can''t decline this invite.';
  end if;

  update connection_invites set status = 'revoked' where id = v_invite.id;
end;
$$;

grant execute on function decline_invite(text) to authenticated;



-- =============================================================================
-- 0097_fix_course_image_storage_policy.sql
-- =============================================================================

-- 0093's policies accidentally bind `name` to course_catalogue.name instead
-- of the storage object's path, so every UUID-folder check fails.

drop policy "Course editors can upload their course's image" on storage.objects;
create policy "Course editors can upload their course's image"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'course-catalogue-images' and exists (
      select 1 from course_catalogue cc
      where cc.id::text = (storage.foldername(storage.objects.name))[1]
        and (is_platform_admin((select auth.uid())) or (
          cc.organisation_id is not null
          and is_org_member(cc.organisation_id, (select auth.uid()))
          and cc.status in ('draft', 'rejected')
        ))
    )
  );

drop policy "Course editors can replace their course's image" on storage.objects;
create policy "Course editors can replace their course's image"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'course-catalogue-images' and exists (
      select 1 from course_catalogue cc
      where cc.id::text = (storage.foldername(storage.objects.name))[1]
        and (is_platform_admin((select auth.uid())) or (
          cc.organisation_id is not null
          and is_org_member(cc.organisation_id, (select auth.uid()))
          and cc.status in ('draft', 'rejected')
        ))
    )
  )
  with check (
    bucket_id = 'course-catalogue-images' and exists (
      select 1 from course_catalogue cc
      where cc.id::text = (storage.foldername(storage.objects.name))[1]
        and (is_platform_admin((select auth.uid())) or (
          cc.organisation_id is not null
          and is_org_member(cc.organisation_id, (select auth.uid()))
          and cc.status in ('draft', 'rejected')
        ))
    )
  );

-- Storage upsert also performs a SELECT before UPDATE. Keep that SELECT
-- path-scoped to editors; the public object endpoint remains unaffected.
create policy "Course editors can read their course image object for replacement"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'course-catalogue-images' and exists (
      select 1 from course_catalogue cc
      where cc.id::text = (storage.foldername(storage.objects.name))[1]
        and (is_platform_admin((select auth.uid())) or (
          cc.organisation_id is not null
          and is_org_member(cc.organisation_id, (select auth.uid()))
          and cc.status in ('draft', 'rejected')
        ))
    )
  );

drop policy "Course editors can remove their course's image" on storage.objects;
create policy "Course editors can remove their course's image"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'course-catalogue-images' and exists (
      select 1 from course_catalogue cc
      where cc.id::text = (storage.foldername(storage.objects.name))[1]
        and (is_platform_admin((select auth.uid())) or (
          cc.organisation_id is not null
          and is_org_member(cc.organisation_id, (select auth.uid()))
          and cc.status in ('draft', 'rejected')
        ))
    )
  );



-- =============================================================================
-- 0098_screen_recording_resource_type.sql
-- =============================================================================

-- Screen recordings share the existing secure video storage and playback
-- pipeline, but remain a distinct resource kind throughout the product.
alter table content_resources drop constraint content_resources_type_check;
alter table content_resources add constraint content_resources_type_check
  check (type in ('video', 'screen_recording', 'file', 'scorm', 'xapi', 'external_video'));



-- =============================================================================
-- 0099_web_url_resource_type.sql
-- =============================================================================

-- Generic web links are stored resources, distinct from canonicalized
-- YouTube/Vimeo embeds. Both URL-backed types carry external_url and no
-- storage path; uploaded resource types retain the inverse invariant.
alter table content_resources drop constraint content_resources_type_check;
alter table content_resources add constraint content_resources_type_check
  check (type in ('video', 'screen_recording', 'file', 'scorm', 'xapi', 'external_video', 'web_url'));

alter table content_resources drop constraint content_resources_storage_or_external_check;
alter table content_resources add constraint content_resources_storage_or_external_check
  check (
    (
      type in ('external_video', 'web_url')
      and storage_path is null
      and external_url is not null
      and external_url ~ '^https?://'
    )
    or (type not in ('external_video', 'web_url') and storage_path is not null and external_url is null)
  );



-- =============================================================================
-- 0101_share_skills_by_default.sql
-- =============================================================================

-- Flips skills-profile sharing from opt-in to opt-out, per explicit product
-- decision: new accounts (and new skills) now start shared with connections
-- rather than private, and a learner turns sharing off if they don't want
-- it, instead of turning it on. This only touches the "share with
-- connections" surface (profiles.skills_profile_visible / per-skill
-- visible_on_profile) -- skill_search_visibility (discoverability to people
-- you're NOT yet connected with) is untouched and still defaults to
-- 'hidden'; that's a materially bigger exposure (search vs. existing
-- connections only) and wasn't part of this change.
--
-- Existing accounts are included, not just new signups -- every row
-- currently at the old default (false) is flipped to true. There is no way
-- to distinguish "never touched, still at the old default" from "a learner
-- explicitly turned it back off" (both look like `false`), so this is a
-- one-time blanket flip for anyone not already sharing. Any row already
-- `true` (an explicit past opt-in) is untouched, and is excluded from the
-- WHERE clause below rather than reassigned, since it's already correct.
alter table profiles alter column skills_profile_visible set default true;
update profiles set skills_profile_visible = true where skills_profile_visible = false;

alter table skills alter column visible_on_profile set default true;
update skills set visible_on_profile = true where visible_on_profile = false;



-- =============================================================================
-- 0102_scoped_connection_activity.sql
-- =============================================================================

-- Lets list_connections_activity (0063) be scoped to a single connection
-- instead of always aggregating across all of them -- needed so
-- SkillsProfile.jsx can show "what this person's been up to" on their own
-- profile page, reusing the exact same query/privacy checks (is_connected +
-- the actor's own activity_feed_visible opt-in) rather than a second
-- function. p_user_id defaults to null, which preserves the existing
-- "across every connection" behavior Dashboard.jsx already relies on.
create or replace function list_connections_activity(p_limit int default 30, p_user_id uuid default null)
returns table (
  event_type text,
  actor_id uuid,
  full_name text,
  avatar_url text,
  event_at timestamptz,
  skill_name text,
  level int,
  detail text
)
language sql
security definer
set search_path = public
stable
as $$
  select * from (
    select
      'skill_confirmed' as event_type,
      sa.user_id as actor_id,
      p.full_name,
      p.avatar_url,
      sa.created_at as event_at,
      s.name as skill_name,
      sa.level,
      (case sa.source
        when 'diagnostic_confirmed' then 'Confirmed via knowledge check'
        when 'ai_baseline' then 'AI-assessed baseline'
        when 'ai_evaluation' then 'AI assessment'
        else null
      end)::text as detail
    from skill_assessments sa
    join skills s on s.id = sa.skill_id
    join profiles p on p.id = sa.user_id
    where sa.source in ('diagnostic_confirmed', 'ai_baseline', 'ai_evaluation')
      and sa.user_id <> auth.uid()
      and (p_user_id is null or sa.user_id = p_user_id)
      and is_connected(auth.uid(), sa.user_id)
      and p.activity_feed_visible = true

    union all

    select
      'skill_validated',
      svr.requester_id,
      p.full_name,
      p.avatar_url,
      svr.decided_at,
      s.name,
      svr.target_level,
      'Validated by a connection'::text
    from skill_validation_requests svr
    join skills s on s.id = svr.skill_id
    join profiles p on p.id = svr.requester_id
    where svr.status = 'confirmed'
      and svr.requester_id <> auth.uid()
      and (p_user_id is null or svr.requester_id = p_user_id)
      and is_connected(auth.uid(), svr.requester_id)
      and p.activity_feed_visible = true

    union all

    select
      'skill_added',
      s.user_id,
      p.full_name,
      p.avatar_url,
      s.date_added,
      s.name,
      null::int,
      null::text
    from skills s
    join profiles p on p.id = s.user_id
    where s.user_id <> auth.uid()
      and (p_user_id is null or s.user_id = p_user_id)
      and is_connected(auth.uid(), s.user_id)
      and p.activity_feed_visible = true

    union all

    select
      'experience_added',
      e.user_id,
      p.full_name,
      p.avatar_url,
      e.created_at,
      null::text,
      null::int,
      (e.type || ' at ' || e.organization || ': ' || e.title)::text
    from experience e
    join profiles p on p.id = e.user_id
    where e.user_id <> auth.uid()
      and (p_user_id is null or e.user_id = p_user_id)
      and is_connected(auth.uid(), e.user_id)
      and p.activity_feed_visible = true

    union all

    select
      'course_started',
      c.user_id,
      p.full_name,
      p.avatar_url,
      c.created_at,
      null::text,
      null::int,
      (c.name || coalesce(' · ' || c.provider, ''))::text
    from courses c
    join profiles p on p.id = c.user_id
    where c.completed_date is null
      and c.user_id <> auth.uid()
      and (p_user_id is null or c.user_id = p_user_id)
      and is_connected(auth.uid(), c.user_id)
      and p.activity_feed_visible = true

    union all

    select
      'target_set',
      st.user_id,
      p.full_name,
      p.avatar_url,
      st.created_at,
      s.name,
      st.target_level,
      null::text
    from skill_targets st
    join skills s on s.id = st.skill_id
    join profiles p on p.id = st.user_id
    where st.user_id <> auth.uid()
      and (p_user_id is null or st.user_id = p_user_id)
      and is_connected(auth.uid(), st.user_id)
      and p.activity_feed_visible = true
  ) events
  order by event_at desc
  limit p_limit
$$;

grant execute on function list_connections_activity(int, uuid) to authenticated;



-- =============================================================================
-- 0103_connection_profile_growth_and_member_since.sql
-- =============================================================================

-- Backs two additions to SkillsProfile.jsx: a "member since" date in the
-- header, and a "recent growth" panel replacing the plain activity feed.

-- auth.users.created_at is the true signup date -- deliberately not
-- duplicated onto profiles (would be a second representation of the same
-- fact, out of sync the moment either drifted). profiles.full_name/
-- avatar_url are already visible to any authenticated user (see 0061's
-- "Authenticated users can view profile names" policy), so signup date
-- sits at the same visibility level -- identity-ish metadata, not the
-- skill/activity data that's actually access-gated.
create or replace function get_member_since(p_user_id uuid)
returns timestamptz
language sql
security definer
set search_path = public
stable
as $$
  select created_at from auth.users where id = p_user_id
$$;

grant execute on function get_member_since(uuid) to authenticated;

-- Same shape as Dashboard.jsx's own loadRecentGrowth (recent practical-axis
-- level jumps, each paired with the level just before it and any current
-- target), just scoped to one other person and re-derived server-side --
-- skill_assessments/skill_targets are RLS'd to their own owner, so a
-- connection has no client-side way to read this directly. Gated by the
-- exact same is_connected + activity_feed_visible check as
-- list_connections_activity (0063/0102): this is the same privacy boundary,
-- just a richer per-skill shape than that feed's flat event rows.
create or replace function list_connection_recent_growth(p_user_id uuid, p_limit int default 5)
returns table (
  skill_id uuid,
  skill_name text,
  level int,
  previous_level int,
  assessed_at timestamptz,
  target_level int,
  target_date date
)
language sql
security definer
set search_path = public
stable
as $$
  select
    sa.skill_id,
    s.name,
    sa.level,
    (
      select sa2.level
      from skill_assessments sa2
      where sa2.skill_id = sa.skill_id
        and sa2.axis = 'practical'
        and sa2.assessed_at < sa.assessed_at
      order by sa2.assessed_at desc
      limit 1
    ) as previous_level,
    sa.assessed_at,
    t.target_level,
    t.target_date
  from skill_assessments sa
  join skills s on s.id = sa.skill_id
  left join lateral (
    select target_level, target_date
    from skill_targets
    where skill_id = sa.skill_id and user_id = p_user_id
    order by created_at desc
    limit 1
  ) t on true
  where sa.axis = 'practical'
    and sa.user_id = p_user_id
    and sa.assessed_at >= now() - interval '28 days'
    and sa.user_id <> auth.uid()
    and is_connected(auth.uid(), sa.user_id)
    and exists (
      select 1 from profiles p where p.id = p_user_id and p.activity_feed_visible = true
    )
  order by sa.assessed_at desc
  limit p_limit
$$;

grant execute on function list_connection_recent_growth(uuid, int) to authenticated;



-- =============================================================================
-- 0104_share_activity_and_search_by_default.sql
-- =============================================================================

-- Same opt-in-to-opt-out flip as 0101 (skills profile sharing), applied to
-- the two remaining cross-user visibility defaults: connections seeing your
-- activity feed, and being discoverable in skill search by anyone tracking
-- the same skill (not just existing connections). Existing accounts are
-- included, not just new signups -- every row currently at the old default
-- is flipped. As with 0101, a row already at a non-default value (an
-- explicit past choice, including 'selective' for skill search) is left
-- alone, since a plain UPDATE can't tell "never touched" apart from
-- "deliberately set back to the old default" -- both look identical.
alter table profiles alter column activity_feed_visible set default true;
update profiles set activity_feed_visible = true where activity_feed_visible = false;

alter table profiles alter column skill_search_visibility set default 'all';
update profiles set skill_search_visibility = 'all' where skill_search_visibility = 'hidden';



-- =============================================================================
-- 0105_provider_course_participants.sql
-- =============================================================================

-- Provider-admin participant reporting for catalogue courses.

create index if not exists courses_catalogue_course_created_at_idx
  on courses (catalogue_course_id, created_at)
  where catalogue_course_id is not null;

create index if not exists course_content_progress_content_item_user_idx
  on course_content_progress (content_item_id, user_id);

-- Keep course/progress policies out of course_catalogue's own RLS graph:
-- its learner visibility policy refers back to courses, so a direct lookup
-- here would recurse. This bounded helper only answers an authorization
-- question and follows the project's existing is_org_admin helper pattern.
create or replace function is_course_provider_admin(check_course_id uuid, check_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from course_catalogue cc
    where cc.id = check_course_id
      and cc.organisation_id is not null
      and is_org_admin(cc.organisation_id, check_user_id)
  )
$$;

revoke all on function is_course_provider_admin(uuid, uuid) from public;
grant execute on function is_course_provider_admin(uuid, uuid) to authenticated;

drop policy if exists "Provider admins can view their course participants" on courses;
create policy "Provider admins can view their course participants"
  on courses for select
  to authenticated
  using (
    catalogue_course_id is not null
    and is_course_provider_admin(catalogue_course_id, (select auth.uid()))
  );

drop policy if exists "Provider admins can view participant progress" on course_content_progress;
create policy "Provider admins can view participant progress"
  on course_content_progress for select
  to authenticated
  using (
    exists (
      select 1
      from course_content_links ccl
      where ccl.resource_id = course_content_progress.content_item_id
        and is_course_provider_admin(ccl.course_id, (select auth.uid()))
    )
  );



-- =============================================================================
-- 0106_fix_course_image_storage_authorization.sql
-- =============================================================================

-- 0097 still bound the path expression inside its course_catalogue
-- subquery to course_catalogue.name. Pass the storage object path into a
-- bounded helper instead, so PostgreSQL cannot rebind the outer name.

create or replace function can_manage_course_catalogue_image(object_path text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from course_catalogue cc
    where cc.id::text = (storage.foldername(object_path))[1]
      and (
        is_platform_admin((select auth.uid()))
        or (
          cc.organisation_id is not null
          and is_org_member(cc.organisation_id, (select auth.uid()))
          and cc.status in ('draft', 'rejected')
        )
      )
  )
$$;

revoke all on function can_manage_course_catalogue_image(text) from public;
grant execute on function can_manage_course_catalogue_image(text) to authenticated;

drop policy if exists "Course editors can upload their course's image" on storage.objects;
create policy "Course editors can upload their course's image"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'course-catalogue-images'
    and can_manage_course_catalogue_image(name)
  );

drop policy if exists "Course editors can replace their course's image" on storage.objects;
create policy "Course editors can replace their course's image"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'course-catalogue-images'
    and can_manage_course_catalogue_image(name)
  )
  with check (
    bucket_id = 'course-catalogue-images'
    and can_manage_course_catalogue_image(name)
  );

drop policy if exists "Course editors can read their course image object for replacement" on storage.objects;
create policy "Course editors can read their course image object for replacement"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'course-catalogue-images'
    and can_manage_course_catalogue_image(name)
  );

drop policy if exists "Course editors can remove their course's image" on storage.objects;
create policy "Course editors can remove their course's image"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'course-catalogue-images'
    and can_manage_course_catalogue_image(name)
  );



-- =============================================================================
-- 0107_course_versioning_and_code.sql
-- =============================================================================

-- Immutable published course versions. Providers edit a cloned draft while
-- the currently approved version remains live for learners.

alter table course_catalogue
  add column course_code text,
  add column version_group_id uuid,
  add column version_number integer not null default 1 check (version_number > 0),
  add column is_current_published boolean not null default false;

update course_catalogue
set version_group_id = id,
    is_current_published = (status = 'approved');

alter table course_catalogue alter column version_group_id set not null;

create unique index course_catalogue_group_version_idx
  on course_catalogue (version_group_id, version_number);

create unique index course_catalogue_one_current_published_idx
  on course_catalogue (version_group_id)
  where is_current_published;

create index course_catalogue_org_group_version_idx
  on course_catalogue (organisation_id, version_group_id, version_number desc);

drop policy if exists "Organisation members can unpublish their own approved course" on course_catalogue;

create or replace function create_course_draft_version(p_course_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source course_catalogue%rowtype;
  v_existing_id uuid;
  v_new_id uuid := gen_random_uuid();
  v_new_version integer;
  v_section record;
  v_new_section_id uuid;
begin
  select * into v_source
  from course_catalogue
  where id = p_course_id and status = 'approved';

  if not found then
    raise exception 'Only an approved course can be versioned';
  end if;

  if not (
    is_platform_admin((select auth.uid()))
    or (
      v_source.organisation_id is not null
      and is_org_member(v_source.organisation_id, (select auth.uid()))
    )
  ) then
    raise exception 'Not authorized';
  end if;

  select id into v_existing_id
  from course_catalogue
  where version_group_id = v_source.version_group_id
    and status in ('draft', 'pending_approval', 'rejected')
  order by version_number desc
  limit 1;

  if v_existing_id is not null then
    return v_existing_id;
  end if;

  select coalesce(max(version_number), 0) + 1 into v_new_version
  from course_catalogue
  where version_group_id = v_source.version_group_id;

  insert into course_catalogue (
    id, name, provider, course_type, duration, synopsis, organisation_id,
    status, created_by, image_url, course_code, version_group_id,
    version_number, is_current_published
  ) values (
    v_new_id, v_source.name, v_source.provider, v_source.course_type,
    v_source.duration, v_source.synopsis, v_source.organisation_id,
    'draft', (select auth.uid()), v_source.image_url, v_source.course_code,
    v_source.version_group_id, v_new_version, false
  );

  insert into course_catalogue_skills (course_catalogue_id, skill_library_id, level)
  select v_new_id, skill_library_id, level
  from course_catalogue_skills
  where course_catalogue_id = p_course_id;

  insert into course_catalogue_tags (course_catalogue_id, tag_id)
  select v_new_id, tag_id
  from course_catalogue_tags
  where course_catalogue_id = p_course_id;

  for v_section in
    select id, title, position
    from course_sections
    where course_id = p_course_id
    order by position, created_at
  loop
    v_new_section_id := gen_random_uuid();
    insert into course_sections (id, course_id, title, position)
    values (v_new_section_id, v_new_id, v_section.title, v_section.position);

    insert into course_content_links (course_id, resource_id, position, section_id)
    select v_new_id, resource_id, position, v_new_section_id
    from course_content_links
    where course_id = p_course_id and section_id = v_section.id;
  end loop;

  insert into course_content_links (course_id, resource_id, position, section_id)
  select v_new_id, resource_id, position, null
  from course_content_links
  where course_id = p_course_id and section_id is null;

  return v_new_id;
end;
$$;

revoke all on function create_course_draft_version(uuid) from public;
grant execute on function create_course_draft_version(uuid) to authenticated;

create or replace function publish_course_version(p_course_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_group_id uuid;
begin
  if not is_platform_admin((select auth.uid())) then
    raise exception 'Not authorized';
  end if;

  select version_group_id into v_group_id
  from course_catalogue
  where id = p_course_id
  for update;

  if v_group_id is null then
    raise exception 'Course not found';
  end if;

  update course_catalogue
  set status = 'inactive', is_current_published = false
  where version_group_id = v_group_id
    and is_current_published
    and id <> p_course_id;

  update course_catalogue
  set status = 'approved',
      is_current_published = true,
      approved_by = (select auth.uid()),
      approved_at = now(),
      rejection_reason = null
  where id = p_course_id;
end;
$$;

revoke all on function publish_course_version(uuid) from public;
grant execute on function publish_course_version(uuid) to authenticated;

create or replace function get_provider_profile(p_slug text)
returns json
language sql
security definer
set search_path = public
stable
as $$
  select json_build_object(
    'organisation', (
      select json_build_object('id', o.id, 'name', o.name, 'about', o.about, 'logoUrl', o.logo_url, 'url', o.url)
      from organisations o
      where o.slug = p_slug and o.status = 'active' and o.public_profile_enabled = true
    ),
    'skills', (
      select coalesce(json_agg(json_build_object(
        'id', sl.id, 'name', sl.name, 'category', sl.category, 'description', sl.description
      ) order by sl.name), '[]'::json)
      from organisation_offered_skills oos
      join skill_library sl on sl.id = oos.skill_library_id
      join organisations o on o.id = oos.organisation_id
      where o.slug = p_slug and o.status = 'active' and o.public_profile_enabled = true
    ),
    'courses', (
      select coalesce(json_agg(json_build_object(
        'id', cc.id, 'name', cc.name, 'synopsis', cc.synopsis,
        'courseType', cc.course_type, 'duration', cc.duration,
        'imageUrl', cc.image_url, 'courseCode', cc.course_code,
        'versionNumber', cc.version_number,
        'skillEntries', (
          select coalesce(json_agg(json_build_object(
            'skillId', ccs.skill_library_id, 'skillName', sl2.name, 'level', ccs.level
          )), '[]'::json)
          from course_catalogue_skills ccs
          join skill_library sl2 on sl2.id = ccs.skill_library_id
          where ccs.course_catalogue_id = cc.id
        ),
        'tags', (
          select coalesce(json_agg(json_build_object('id', t.id, 'name', t.name)), '[]'::json)
          from course_catalogue_tags cct
          join tags t on t.id = cct.tag_id
          where cct.course_catalogue_id = cc.id
        )
      ) order by cc.name), '[]'::json)
      from course_catalogue cc
      join organisations o on o.id = cc.organisation_id
      where o.slug = p_slug and o.status = 'active' and o.public_profile_enabled = true
        and cc.status = 'approved' and cc.is_current_published
    )
  )
$$;

grant execute on function get_provider_profile(text) to anon, authenticated;



-- =============================================================================
-- 0108_course_section_instructions.sql
-- =============================================================================

-- Optional learner-facing guidance for each course section. Keep version
-- cloning in sync so a provider's instructions carry into the next draft.

alter table course_sections
  add column instructions text;

create or replace function create_course_draft_version(p_course_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source course_catalogue%rowtype;
  v_existing_id uuid;
  v_new_id uuid := gen_random_uuid();
  v_new_version integer;
  v_section record;
  v_new_section_id uuid;
begin
  select * into v_source
  from course_catalogue
  where id = p_course_id and status = 'approved';

  if not found then
    raise exception 'Only an approved course can be versioned';
  end if;

  if not (
    is_platform_admin((select auth.uid()))
    or (
      v_source.organisation_id is not null
      and is_org_member(v_source.organisation_id, (select auth.uid()))
    )
  ) then
    raise exception 'Not authorized';
  end if;

  select id into v_existing_id
  from course_catalogue
  where version_group_id = v_source.version_group_id
    and status in ('draft', 'pending_approval', 'rejected')
  order by version_number desc
  limit 1;

  if v_existing_id is not null then
    return v_existing_id;
  end if;

  select coalesce(max(version_number), 0) + 1 into v_new_version
  from course_catalogue
  where version_group_id = v_source.version_group_id;

  insert into course_catalogue (
    id, name, provider, course_type, duration, synopsis, organisation_id,
    status, created_by, image_url, course_code, version_group_id,
    version_number, is_current_published
  ) values (
    v_new_id, v_source.name, v_source.provider, v_source.course_type,
    v_source.duration, v_source.synopsis, v_source.organisation_id,
    'draft', (select auth.uid()), v_source.image_url, v_source.course_code,
    v_source.version_group_id, v_new_version, false
  );

  insert into course_catalogue_skills (course_catalogue_id, skill_library_id, level)
  select v_new_id, skill_library_id, level
  from course_catalogue_skills
  where course_catalogue_id = p_course_id;

  insert into course_catalogue_tags (course_catalogue_id, tag_id)
  select v_new_id, tag_id
  from course_catalogue_tags
  where course_catalogue_id = p_course_id;

  for v_section in
    select id, title, instructions, position
    from course_sections
    where course_id = p_course_id
    order by position, created_at
  loop
    v_new_section_id := gen_random_uuid();
    insert into course_sections (id, course_id, title, instructions, position)
    values (v_new_section_id, v_new_id, v_section.title, v_section.instructions, v_section.position);

    insert into course_content_links (course_id, resource_id, position, section_id)
    select v_new_id, resource_id, position, v_new_section_id
    from course_content_links
    where course_id = p_course_id and section_id = v_section.id;
  end loop;

  insert into course_content_links (course_id, resource_id, position, section_id)
  select v_new_id, resource_id, position, null
  from course_content_links
  where course_id = p_course_id and section_id is null;

  return v_new_id;
end;
$$;

revoke all on function create_course_draft_version(uuid) from public;
grant execute on function create_course_draft_version(uuid) to authenticated;



-- =============================================================================
-- 0109_onboarding_wizard_steps.sql
-- =============================================================================

-- Platform-admin-configurable first-login wizard: each row is one of the
-- steps Onboarding.jsx already knows how to render (CV/history import,
-- skills to learn), toggleable on/off from /admin/onboarding. `key` stays
-- fixed and matches the step identifiers in Onboarding.jsx -- this table
-- only controls which known steps show and in what order, not what a step
-- does, so no dynamic step-creation UI is needed.
create table onboarding_steps (
  key text primary key,
  label text not null,
  enabled boolean not null default true,
  order_index integer not null,
  updated_at timestamptz not null default now()
);
insert into onboarding_steps (key, label, order_index) values
  ('import', 'Import your CV or LinkedIn history', 0),
  ('skills', 'Choose skills you want to learn', 1);

alter table onboarding_steps enable row level security;

-- Every signed-in user needs to read this to render their own onboarding
-- wizard -- it's shared platform configuration, not private data.
create policy "Authenticated users can view onboarding steps"
  on onboarding_steps for select
  to authenticated
  using (true);

create policy "Platform admins can update onboarding steps"
  on onboarding_steps for update
  to authenticated
  using (is_platform_admin(auth.uid()))
  with check (is_platform_admin(auth.uid()));



-- =============================================================================
-- 0110_profile_import_banner.sql
-- =============================================================================

-- Drives the "import your CV/history" banner on the dashboard: shown until
-- the learner has actually run an import once, or explicitly dismissed it.
-- Kept as its own flag rather than inferring from skills.source='cv_import'
-- (0008) -- an import can add only courses/experience with no skills at
-- all, which that column alone wouldn't catch.
alter table profiles add column cv_imported_at timestamptz;
alter table profiles add column cv_import_banner_dismissed_at timestamptz;



-- =============================================================================
-- 0111_provider_catalogues.sql
-- =============================================================================

-- Provider-owned catalogue destinations plus the platform-managed global
-- catalogue. Publication choices belong to a specific immutable course
-- version, so a new version can request a different destination set without
-- changing where the currently published version appears.

create table catalogues (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references organisations(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  description text,
  is_global boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (is_global and organisation_id is null)
    or (not is_global and organisation_id is not null)
  )
);

create unique index catalogues_one_global_idx
  on catalogues (is_global)
  where is_global;

create unique index catalogues_organisation_name_idx
  on catalogues (organisation_id, lower(name))
  where organisation_id is not null;

create index catalogues_organisation_idx on catalogues (organisation_id, name);

insert into catalogues (name, description, is_global)
values ('Global catalogue', 'Training published across LearnScope.', true);

create table course_catalogue_publications (
  course_id uuid references course_catalogue(id) on delete cascade not null,
  catalogue_id uuid references catalogues(id) on delete cascade not null,
  selected_by uuid references auth.users(id) on delete set null,
  selected_at timestamptz not null default now(),
  published_at timestamptz,
  primary key (course_id, catalogue_id)
);

create index course_catalogue_publications_catalogue_idx
  on course_catalogue_publications (catalogue_id, published_at, course_id);

-- Preserve the existing learner catalogue exactly: every version that is
-- live when this migration runs starts published to the Global catalogue.
insert into course_catalogue_publications (course_id, catalogue_id, selected_by, selected_at, published_at)
select cc.id, c.id, cc.created_by, cc.created_at, coalesce(cc.approved_at, cc.created_at)
from course_catalogue cc
cross join catalogues c
where cc.status = 'approved'
  and cc.is_current_published
  and c.is_global;

alter table catalogues enable row level security;
alter table course_catalogue_publications enable row level security;

create policy "Authenticated users can view catalogues"
  on catalogues for select
  to authenticated
  using (true);

create policy "Provider admins and platform admins can create catalogues"
  on catalogues for insert
  to authenticated
  with check (
    is_platform_admin((select auth.uid()))
    or (
      not is_global
      and organisation_id is not null
      and is_org_admin(organisation_id, (select auth.uid()))
    )
  );

create policy "Provider admins and platform admins can update catalogues"
  on catalogues for update
  to authenticated
  using (
    is_platform_admin((select auth.uid()))
    or (
      not is_global
      and organisation_id is not null
      and is_org_admin(organisation_id, (select auth.uid()))
    )
  )
  with check (
    is_platform_admin((select auth.uid()))
    or (
      not is_global
      and organisation_id is not null
      and is_org_admin(organisation_id, (select auth.uid()))
    )
  );

create policy "Provider admins can delete their own catalogues"
  on catalogues for delete
  to authenticated
  using (
    not is_global
    and organisation_id is not null
    and (
      is_platform_admin((select auth.uid()))
      or is_org_admin(organisation_id, (select auth.uid()))
    )
  );

create policy "View publication destinations for viewable courses"
  on course_catalogue_publications for select
  to authenticated
  using (
    exists (
      select 1
      from course_catalogue cc
      where cc.id = course_catalogue_publications.course_id
        and (
          (cc.status = 'approved' and cc.is_current_published and course_catalogue_publications.published_at is not null)
          or is_platform_admin((select auth.uid()))
          or (
            cc.organisation_id is not null
            and is_org_member(cc.organisation_id, (select auth.uid()))
          )
          or exists (
            select 1 from courses c
            where c.catalogue_course_id = cc.id
              and c.user_id = (select auth.uid())
          )
        )
    )
  );

create policy "Manage destinations for editable provider courses"
  on course_catalogue_publications for all
  to authenticated
  using (
    exists (
      select 1
      from course_catalogue cc
      join catalogues c on c.id = course_catalogue_publications.catalogue_id
      where cc.id = course_catalogue_publications.course_id
        and (
          is_platform_admin((select auth.uid()))
          or (
            cc.organisation_id is not null
            and is_org_member(cc.organisation_id, (select auth.uid()))
            and cc.status in ('draft', 'rejected')
            and (c.is_global or c.organisation_id = cc.organisation_id)
          )
        )
    )
  )
  with check (
    exists (
      select 1
      from course_catalogue cc
      join catalogues c on c.id = course_catalogue_publications.catalogue_id
      where cc.id = course_catalogue_publications.course_id
        and (
          is_platform_admin((select auth.uid()))
          or (
            cc.organisation_id is not null
            and is_org_member(cc.organisation_id, (select auth.uid()))
            and cc.status in ('draft', 'rejected')
            and (c.is_global or c.organisation_id = cc.organisation_id)
          )
        )
    )
  );

grant select, insert, update, delete on table catalogues to authenticated;
grant select, insert, update, delete on table course_catalogue_publications to authenticated;

create or replace function submit_course_for_publication(p_course_id uuid, p_catalogue_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_organisation_id uuid;
begin
  select organisation_id into v_organisation_id
  from course_catalogue
  where id = p_course_id
    and status in ('draft', 'rejected')
  for update;

  if v_organisation_id is null then
    raise exception 'Course is not editable or does not belong to a provider';
  end if;

  if not (
    is_platform_admin((select auth.uid()))
    or is_org_member(v_organisation_id, (select auth.uid()))
  ) then
    raise exception 'Not authorized';
  end if;

  if coalesce(cardinality(p_catalogue_ids), 0) = 0 then
    raise exception 'Choose at least one catalogue';
  end if;

  if exists (
    select 1
    from unnest(p_catalogue_ids) selected_id
    left join catalogues c
      on c.id = selected_id
      and (c.is_global or c.organisation_id = v_organisation_id)
    where c.id is null
  ) then
    raise exception 'One or more catalogues are not available to this provider';
  end if;

  delete from course_catalogue_publications where course_id = p_course_id;

  insert into course_catalogue_publications (course_id, catalogue_id, selected_by)
  select p_course_id, selected_id, (select auth.uid())
  from (select distinct unnest(p_catalogue_ids) as selected_id) selected;

  update course_catalogue
  set status = 'pending_approval', rejection_reason = null
  where id = p_course_id;
end;
$$;

revoke all on function submit_course_for_publication(uuid, uuid[]) from public;
grant execute on function submit_course_for_publication(uuid, uuid[]) to authenticated;

create or replace function publish_course_version(p_course_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_group_id uuid;
begin
  if not is_platform_admin((select auth.uid())) then
    raise exception 'Not authorized';
  end if;

  if not exists (
    select 1 from course_catalogue_publications
    where course_id = p_course_id
  ) then
    raise exception 'Choose at least one publication catalogue';
  end if;

  select version_group_id into v_group_id
  from course_catalogue
  where id = p_course_id
  for update;

  if v_group_id is null then
    raise exception 'Course not found';
  end if;

  update course_catalogue
  set status = 'inactive', is_current_published = false
  where version_group_id = v_group_id
    and is_current_published
    and id <> p_course_id;

  update course_catalogue
  set status = 'approved',
      is_current_published = true,
      approved_by = (select auth.uid()),
      approved_at = now(),
      rejection_reason = null
  where id = p_course_id;

  update course_catalogue_publications
  set published_at = now()
  where course_id = p_course_id;
end;
$$;

revoke all on function publish_course_version(uuid) from public;
grant execute on function publish_course_version(uuid) to authenticated;

-- Approved courses only appear to general learners after at least one
-- selected catalogue destination has actually been published. Provider
-- staff, platform admins, and existing enrollees retain their prior access.
-- Keep the lookup out of course_catalogue_publications' RLS graph: that
-- table's own SELECT policy checks its parent course, so an inline EXISTS
-- here would recurse back into course_catalogue.
create or replace function is_course_published_to_catalogue(check_course_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from course_catalogue_publications
    where course_id = check_course_id
      and published_at is not null
  )
$$;

revoke all on function is_course_published_to_catalogue(uuid) from public;
grant execute on function is_course_published_to_catalogue(uuid) to authenticated;

drop policy if exists "View approved courses, your own organisation's, as a platform admin, or your own enrollment" on course_catalogue;
create policy "View published courses, your own organisation's, as a platform admin, or your own enrollment"
  on course_catalogue for select
  to authenticated
  using (
    (
      status = 'approved'
      and is_current_published
      and is_course_published_to_catalogue(id)
    )
    or is_platform_admin((select auth.uid()))
    or (
      organisation_id is not null
      and is_org_member(organisation_id, (select auth.uid()))
    )
    or exists (
      select 1 from courses c
      where c.catalogue_course_id = course_catalogue.id
        and c.user_id = (select auth.uid())
    )
  );



-- =============================================================================
-- 0112_catalogue_approvers.sql
-- =============================================================================

-- Redesigned against 0111's real per-catalogue model (a provider can own
-- several named catalogues, plus the platform-managed Global catalogue) --
-- an org admin designates specific active members of their own org as
-- approvers of one of their org's own (non-global) catalogues, able to
-- approve/reject/deactivate a course being published into that catalogue,
-- without needing a platform admin. Nobody can be an approver of the
-- Global catalogue (it has no organisation_id, so the insert policy below
-- can never match it) -- publishing anything into it stays platform-admin
-- only, same as today.

create table catalogue_approvers (
  id uuid primary key default gen_random_uuid(),
  catalogue_id uuid not null references catalogues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (catalogue_id, user_id)
);

create index catalogue_approvers_catalogue_idx on catalogue_approvers (catalogue_id);
create index catalogue_approvers_user_idx on catalogue_approvers (user_id);

-- security definer, same shape/reason as is_org_admin/is_org_member (0065),
-- including the organisations.status = 'active' check 0069 added to those
-- two -- without it, a platform admin deactivating a provider org would
-- leave a previously-designated approver still able to move that org's
-- course_catalogue rows.
create or replace function is_catalogue_approver(p_catalogue_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from catalogue_approvers ca
    join catalogues c on c.id = ca.catalogue_id
    join organisations o on o.id = c.organisation_id
    where ca.catalogue_id = p_catalogue_id
      and ca.user_id = p_user_id
      and o.status = 'active'
  )
$$;

grant execute on function is_catalogue_approver(uuid, uuid) to authenticated;

alter table catalogue_approvers enable row level security;

create policy "Org members can view their organisation's catalogue approvers"
  on catalogue_approvers for select
  to authenticated
  using (
    exists (
      select 1 from catalogues c
      where c.id = catalogue_approvers.catalogue_id
        and c.organisation_id is not null
        and is_org_member(c.organisation_id, auth.uid())
    )
  );

-- The target catalogue must belong to the calling admin's own organisation
-- (never the Global catalogue, since it has no organisation_id), and the
-- designated user must already be an active member of that same
-- organisation (not a still-pending invite, matching is_org_member's own
-- 0070 status check) -- this is a list of that org's own users against
-- that org's own catalogue, not an arbitrary allowlist. added_by is pinned
-- to the caller so a crafted request can't misattribute (or null out) who
-- granted the approval right.
create policy "Org admins can designate catalogue approvers from their own users"
  on catalogue_approvers for insert
  to authenticated
  with check (
    added_by = auth.uid()
    and exists (
      select 1 from catalogues c
      where c.id = catalogue_approvers.catalogue_id
        and c.organisation_id is not null
        and is_org_admin(c.organisation_id, auth.uid())
        and exists (
          select 1 from organisation_members om
          where om.organisation_id = c.organisation_id
            and om.user_id = catalogue_approvers.user_id
            and om.status = 'active'
        )
    )
  );

create policy "Org admins can remove catalogue approvers"
  on catalogue_approvers for delete
  to authenticated
  using (
    exists (
      select 1 from catalogues c
      where c.id = catalogue_approvers.catalogue_id
        and c.organisation_id is not null
        and is_org_admin(c.organisation_id, auth.uid())
    )
  );

-- catalogue_approvers has no FK to organisation_members (it points at
-- catalogues/auth.users, since an approver grant should outlive a role
-- change), so removing someone's staff access (removeOrganisationMember --
-- a hard delete, not a status flip) wouldn't otherwise also revoke an
-- existing approver grant on that org's catalogues.
create or replace function revoke_catalogue_approver_on_membership_removal()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  delete from catalogue_approvers
  using catalogues
  where catalogue_approvers.catalogue_id = catalogues.id
    and catalogues.organisation_id = old.organisation_id
    and catalogue_approvers.user_id = old.user_id;
  return old;
end;
$$;

create trigger revoke_catalogue_approver_on_membership_removal_trigger
  after delete on organisation_members
  for each row execute procedure revoke_catalogue_approver_on_membership_removal();

-- Reject/deactivate/approve are all authorized through security-definer
-- RPCs rather than plain-table-update RLS grants. A general-purpose RLS
-- UPDATE policy for a catalogue approver (who may be an ordinary staff
-- member, not an org admin) can only constrain the columns it names in its
-- with-check -- it can't stop the same statement from also rewriting
-- name/synopsis/image_url/etc on a pending_approval or already-approved
-- row, since 0066's own org-member edit policy only ever applies while
-- status is draft/rejected. Routing every transition through a function
-- that performs its own narrow `set status = ..., <specific columns>`
-- closes that off entirely, and lets each one check authorization against
-- the *specific* catalogue(s) the course was actually submitted to
-- (course_catalogue_publications), not just "approver of some catalogue in
-- this org" -- matching what an org that splits approval authority across
-- multiple catalogues actually expects.
--
-- All three also front-load the authorization check ahead of any
-- course-specific detail: a non-admin caller always gets a flat 'Not
-- authorized' whether the course doesn't exist, has no publications yet, or
-- they're simply not an approver for all of its selected catalogues, so
-- probing an arbitrary course id can't be used to learn anything about it.
-- Platform admins (who can already see everything) get the more specific
-- diagnostic instead.

create or replace function publish_course_version(p_course_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_caller uuid := (select auth.uid());
  v_is_admin boolean := is_platform_admin(v_caller);
  v_has_publications boolean;
  v_approved_for_all boolean;
begin
  select version_group_id into v_group_id
  from course_catalogue
  where id = p_course_id
  for update;

  v_has_publications := v_group_id is not null and exists (
    select 1 from course_catalogue_publications where course_id = p_course_id
  );

  v_approved_for_all := v_group_id is not null and not exists (
    select 1
    from course_catalogue_publications ccp
    where ccp.course_id = p_course_id
      and not is_catalogue_approver(ccp.catalogue_id, v_caller)
  );

  if not v_is_admin and (v_group_id is null or not v_has_publications or not v_approved_for_all) then
    raise exception 'Not authorized';
  end if;

  if v_is_admin and v_group_id is null then
    raise exception 'Course not found';
  end if;

  if not v_has_publications then
    raise exception 'Choose at least one publication catalogue';
  end if;

  update course_catalogue
  set status = 'inactive', is_current_published = false
  where version_group_id = v_group_id
    and is_current_published
    and id <> p_course_id;

  update course_catalogue
  set status = 'approved',
      is_current_published = true,
      approved_by = v_caller,
      approved_at = now(),
      rejection_reason = null
  where id = p_course_id;

  update course_catalogue_publications
  set published_at = now()
  where course_id = p_course_id;
end;
$$;

revoke all on function publish_course_version(uuid) from public;
grant execute on function publish_course_version(uuid) to authenticated;

create or replace function reject_course_submission(p_course_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
  v_is_admin boolean := is_platform_admin(v_caller);
  v_status text;
  v_found boolean;
  v_has_publications boolean;
  v_approved_for_all boolean;
begin
  select status into v_status
  from course_catalogue
  where id = p_course_id
  for update;

  v_found := found;

  v_has_publications := v_found and exists (
    select 1 from course_catalogue_publications where course_id = p_course_id
  );

  v_approved_for_all := v_found and not exists (
    select 1
    from course_catalogue_publications ccp
    where ccp.course_id = p_course_id
      and not is_catalogue_approver(ccp.catalogue_id, v_caller)
  );

  if not v_is_admin and (not v_found or not v_has_publications or not v_approved_for_all) then
    raise exception 'Not authorized';
  end if;

  if not v_found then
    raise exception 'Course not found';
  end if;

  if v_status <> 'pending_approval' then
    raise exception 'Only a pending submission can be rejected';
  end if;

  update course_catalogue
  set status = 'rejected',
      rejection_reason = p_reason,
      approved_by = null,
      approved_at = null,
      is_current_published = false
  where id = p_course_id;
end;
$$;

revoke all on function reject_course_submission(uuid, text) from public;
grant execute on function reject_course_submission(uuid, text) to authenticated;

create or replace function deactivate_course_publication(p_course_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
  v_is_admin boolean := is_platform_admin(v_caller);
  v_status text;
  v_found boolean;
  v_has_publications boolean;
  v_approved_for_all boolean;
begin
  select status into v_status
  from course_catalogue
  where id = p_course_id
  for update;

  v_found := found;

  v_has_publications := v_found and exists (
    select 1 from course_catalogue_publications where course_id = p_course_id
  );

  v_approved_for_all := v_found and not exists (
    select 1
    from course_catalogue_publications ccp
    where ccp.course_id = p_course_id
      and not is_catalogue_approver(ccp.catalogue_id, v_caller)
  );

  if not v_is_admin and (not v_found or not v_has_publications or not v_approved_for_all) then
    raise exception 'Not authorized';
  end if;

  if not v_found then
    raise exception 'Course not found';
  end if;

  if v_status <> 'approved' then
    raise exception 'Only an approved course can be deactivated';
  end if;

  update course_catalogue
  set status = 'inactive', is_current_published = false
  where id = p_course_id;
end;
$$;

revoke all on function deactivate_course_publication(uuid) from public;
grant execute on function deactivate_course_publication(uuid) to authenticated;



-- =============================================================================
-- 0113_unique_reference_codes.sql
-- =============================================================================

-- Prefixed sequential reference codes (CRS-00001, ORG-00001, USR-00001,
-- SKL-00001) for courses, providers, users and shared-library skills --
-- admin-facing identifiers for support/reference conversations, distinct
-- from organisations.slug (0090, learner/public-facing, used in URLs).
-- Follows the same auto-generate-on-insert-if-null + one-time-backfill
-- shape 0090 already established for slugs.

create sequence course_code_seq;
create sequence organisation_code_seq;
create sequence user_code_seq;
create sequence skill_code_seq;

create or replace function generate_course_code()
returns text
language sql
as $$
  select 'CRS-' || lpad(nextval('course_code_seq')::text, 5, '0')
$$;

create or replace function generate_organisation_code()
returns text
language sql
as $$
  select 'ORG-' || lpad(nextval('organisation_code_seq')::text, 5, '0')
$$;

create or replace function generate_user_code()
returns text
language sql
as $$
  select 'USR-' || lpad(nextval('user_code_seq')::text, 5, '0')
$$;

create or replace function generate_skill_code()
returns text
language sql
as $$
  select 'SKL-' || lpad(nextval('skill_code_seq')::text, 5, '0')
$$;

-- Courses -- course_code (0107) already exists as a plain nullable text
-- column with no generation or uniqueness. A course is versioned
-- (version_group_id/version_number, 0107): every version of the same
-- course shares one code (create_course_draft_version already copies it
-- forward), so uniqueness is enforced against each version_group's v1 row
-- only, not every row -- a plain unique index on the column would reject
-- v2+ rows carrying their v1's own code.
create or replace function set_course_code()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.course_code is null then
    new.course_code := generate_course_code();
  end if;
  return new;
end;
$$;

create trigger set_course_code_trigger
  before insert on course_catalogue
  for each row execute procedure set_course_code();

-- Backfill: one code per version_group, reusing an existing non-null code
-- already present anywhere in that group (defensive) before generating a
-- fresh one, then propagated to every row in the group.
do $$
declare
  r record;
  v_code text;
begin
  for r in
    select distinct version_group_id
    from course_catalogue
    where version_group_id in (
      select version_group_id from course_catalogue where course_code is null
    )
    order by version_group_id
  loop
    select course_code into v_code
    from course_catalogue
    where version_group_id = r.version_group_id and course_code is not null
    limit 1;

    if v_code is null then
      v_code := generate_course_code();
    end if;

    update course_catalogue
    set course_code = v_code
    where version_group_id = r.version_group_id and course_code is null;
  end loop;
end $$;

create unique index course_catalogue_code_unique_idx
  on course_catalogue (course_code)
  where version_number = 1;

-- Providers -- new admin-only reference code, alongside (not replacing)
-- the existing public-facing slug.
alter table organisations add column org_code text;

create or replace function set_organisation_code()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.org_code is null then
    new.org_code := generate_organisation_code();
  end if;
  return new;
end;
$$;

create trigger set_organisation_code_trigger
  before insert on organisations
  for each row execute procedure set_organisation_code();

update organisations set org_code = generate_organisation_code() where org_code is null;

alter table organisations alter column org_code set not null;
create unique index organisations_org_code_unique_idx on organisations (org_code);

-- Users
alter table profiles add column user_code text;

create or replace function set_user_code()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.user_code is null then
    new.user_code := generate_user_code();
  end if;
  return new;
end;
$$;

create trigger set_user_code_trigger
  before insert on profiles
  for each row execute procedure set_user_code();

update profiles set user_code = generate_user_code() where user_code is null;

alter table profiles alter column user_code set not null;
create unique index profiles_user_code_unique_idx on profiles (user_code);

-- Skills -- the shared skill_library catalogue only (personal per-user
-- tracked skills, the `skills` table, are a different concept and were
-- explicitly out of scope for this).
alter table skill_library add column skill_code text;

create or replace function set_skill_code()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.skill_code is null then
    new.skill_code := generate_skill_code();
  end if;
  return new;
end;
$$;

create trigger set_skill_code_trigger
  before insert on skill_library
  for each row execute procedure set_skill_code();

update skill_library set skill_code = generate_skill_code() where skill_code is null;

alter table skill_library alter column skill_code set not null;
create unique index skill_library_skill_code_unique_idx on skill_library (skill_code);



-- =============================================================================
-- 20260830101243_education_subject_experiences.sql
-- =============================================================================

-- Subjects are experience records nested beneath an Education experience.
-- Reusing the existing parent relationship means they automatically appear
-- in the education timeline and can carry their own dates, description and
-- linked skills without introducing a parallel content model.

alter table public.experience drop constraint experience_type_check;
alter table public.experience add constraint experience_type_check
  check (type in ('education', 'employment', 'project', 'volunteer', 'other', 'course', 'subject'));

create or replace function public.validate_experience_parent_type()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  parent_type text;
  parent_user_id uuid;
begin
  if new.parent_experience_id is null then
    if new.type = 'subject' then
      raise exception 'A subject must belong to an education experience';
    end if;
    return new;
  end if;

  if new.parent_experience_id = new.id then
    raise exception 'An experience cannot be its own parent';
  end if;

  select type, user_id
    into parent_type, parent_user_id
  from public.experience
  where id = new.parent_experience_id;

  if not found then
    raise exception 'Parent experience not found';
  end if;

  if parent_user_id <> new.user_id then
    raise exception 'Parent and child experiences must belong to the same user';
  end if;

  if parent_type = 'education' and new.type <> 'subject' then
    raise exception 'Education experiences can only contain subjects';
  end if;

  if new.type = 'subject' and parent_type <> 'education' then
    raise exception 'Subjects can only belong to education experiences';
  end if;

  if parent_type in ('employment', 'volunteer') and new.type not in ('project', 'course', 'other') then
    raise exception 'This experience type cannot be added to a job or volunteer position';
  end if;

  if parent_type not in ('education', 'employment', 'volunteer') then
    raise exception 'This experience type cannot contain sub-experiences';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_experience_parent_type() from public;

create trigger validate_experience_parent_type_before_write
before insert or update of type, parent_experience_id, user_id
on public.experience
for each row execute function public.validate_experience_parent_type();



-- =============================================================================
-- 20260830104823_optional_subject_dates_and_duration.sql
-- =============================================================================

-- Subjects may be recorded with exact dates, a human-readable study
-- duration, or both. Other experience types retain the app's required-date
-- behaviour even though the column must become nullable for subjects.

alter table public.experience
  alter column start_date drop not null,
  add column study_duration text;

alter table public.experience
  add constraint experience_subject_timing_check check (
    (
      type = 'subject'
      and (start_date is not null or length(trim(study_duration)) > 0)
      and (end_date is null or start_date is not null)
    )
    or (
      type <> 'subject'
      and start_date is not null
      and study_duration is null
    )
  );



-- =============================================================================
-- 20260830110158_structured_subject_duration.sql
-- =============================================================================

-- Replace free-text duration entry with a queryable number and fixed unit.
-- Keep the old text column as a legacy fallback so any duration entered
-- between the preceding deployment and this one is not discarded.

alter table public.experience
  add column study_duration_value integer,
  add column study_duration_unit text;

update public.experience e
set study_duration_value = parsed.duration_value,
    study_duration_unit = parsed.duration_unit,
    study_duration = null
from (
  select id,
         parts[1]::integer as duration_value,
         case
           when lower(parts[2]) like 'day%' then 'days'
           when lower(parts[2]) like 'month%' then 'months'
           else 'years'
         end as duration_unit
  from public.experience
  cross join lateral regexp_match(study_duration, '^\s*([0-9]+)\s*(day|days|month|months|year|years)\s*$', 'i') as parsed_match(parts)
  where type = 'subject'
) parsed
where e.id = parsed.id;

alter table public.experience drop constraint experience_subject_timing_check;

alter table public.experience
  add constraint experience_subject_timing_check check (
    (
      type = 'subject'
      and (
        start_date is not null
        or (study_duration_value is not null and study_duration_unit is not null)
        or length(trim(study_duration)) > 0
      )
      and (end_date is null or start_date is not null)
      and (study_duration_value is null or study_duration_value > 0)
      and (study_duration_unit is null or study_duration_unit in ('days', 'months', 'years'))
      and ((study_duration_value is null) = (study_duration_unit is null))
    )
    or (
      type <> 'subject'
      and start_date is not null
      and study_duration is null
      and study_duration_value is null
      and study_duration_unit is null
    )
  );

-- Institution details are owned by the parent education row. Copy them on
-- every subject write so direct API calls cannot create conflicting values.
create or replace function public.validate_experience_parent_type()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  parent_type text;
  parent_user_id uuid;
  parent_organization text;
  parent_organization_url text;
begin
  if new.parent_experience_id is null then
    if new.type = 'subject' then
      raise exception 'A subject must belong to an education experience';
    end if;
    return new;
  end if;

  if new.parent_experience_id = new.id then
    raise exception 'An experience cannot be its own parent';
  end if;

  select type, user_id, organization, organization_url
    into parent_type, parent_user_id, parent_organization, parent_organization_url
  from public.experience
  where id = new.parent_experience_id;

  if not found then raise exception 'Parent experience not found'; end if;
  if parent_user_id <> new.user_id then raise exception 'Parent and child experiences must belong to the same user'; end if;
  if parent_type = 'education' and new.type <> 'subject' then raise exception 'Education experiences can only contain subjects'; end if;
  if new.type = 'subject' and parent_type <> 'education' then raise exception 'Subjects can only belong to education experiences'; end if;
  if parent_type in ('employment', 'volunteer') and new.type not in ('project', 'course', 'other') then raise exception 'This experience type cannot be added to a job or volunteer position'; end if;
  if parent_type not in ('education', 'employment', 'volunteer') then raise exception 'This experience type cannot contain sub-experiences'; end if;

  if new.type = 'subject' then
    new.organization := parent_organization;
    new.organization_url := parent_organization_url;
  end if;

  return new;
end;
$$;

drop trigger validate_experience_parent_type_before_write on public.experience;
create trigger validate_experience_parent_type_before_write
before insert or update of type, parent_experience_id, user_id, organization, organization_url
on public.experience
for each row execute function public.validate_experience_parent_type();

create or replace function public.sync_subject_organization_from_parent()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.type = 'education'
     and (new.organization is distinct from old.organization
          or new.organization_url is distinct from old.organization_url) then
    update public.experience
    set organization = new.organization,
        organization_url = new.organization_url
    where parent_experience_id = new.id
      and type = 'subject';
  end if;

  return new;
end;
$$;

revoke all on function public.sync_subject_organization_from_parent() from public;

create trigger sync_subject_organization_after_parent_update
after update of organization, organization_url
on public.experience
for each row execute function public.sync_subject_organization_from_parent();



-- =============================================================================
-- 20260830125114_enforce_child_experience_date_bounds.sql
-- =============================================================================

-- Keep nested experiences within their parent's period at the database
-- boundary, including writes made outside the web client.

create or replace function public.validate_experience_parent_type()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  parent_type text;
  parent_user_id uuid;
  parent_organization text;
  parent_organization_url text;
  parent_start_date date;
  parent_end_date date;
begin
  if new.parent_experience_id is null then
    if new.type = 'subject' then
      raise exception 'A subject must belong to an education experience';
    end if;

    if tg_op = 'UPDATE'
       and (new.start_date is distinct from old.start_date
            or new.end_date is distinct from old.end_date)
       and exists (
         select 1
         from public.experience child
         where child.parent_experience_id = new.id
           and (
             child.start_date < new.start_date
             or child.end_date < new.start_date
             or (new.end_date is not null and child.start_date > new.end_date)
             or (new.end_date is not null and child.end_date > new.end_date)
           )
       ) then
      raise exception 'Parent dates cannot exclude an existing sub-experience';
    end if;

    return new;
  end if;

  if new.parent_experience_id = new.id then
    raise exception 'An experience cannot be its own parent';
  end if;

  select type, user_id, organization, organization_url, start_date, end_date
    into parent_type, parent_user_id, parent_organization, parent_organization_url,
         parent_start_date, parent_end_date
  from public.experience
  where id = new.parent_experience_id;

  if not found then raise exception 'Parent experience not found'; end if;
  if parent_user_id <> new.user_id then raise exception 'Parent and child experiences must belong to the same user'; end if;
  if parent_type = 'education' and new.type <> 'subject' then raise exception 'Education experiences can only contain subjects'; end if;
  if new.type = 'subject' and parent_type <> 'education' then raise exception 'Subjects can only belong to education experiences'; end if;
  if parent_type in ('employment', 'volunteer') and new.type not in ('project', 'course', 'other') then raise exception 'This experience type cannot be added to a job or volunteer position'; end if;
  if parent_type not in ('education', 'employment', 'volunteer') then raise exception 'This experience type cannot contain sub-experiences'; end if;

  if new.start_date < parent_start_date or new.end_date < parent_start_date then
    raise exception 'Sub-experience dates cannot be before the parent start date';
  end if;
  if parent_end_date is not null
     and (new.start_date > parent_end_date or new.end_date > parent_end_date) then
    raise exception 'Sub-experience dates cannot be after the parent end date';
  end if;
  if new.start_date is not null and new.end_date < new.start_date then
    raise exception 'Sub-experience end date cannot be before its start date';
  end if;

  if new.type = 'subject' then
    new.organization := parent_organization;
    new.organization_url := parent_organization_url;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_experience_parent_type() from public;

drop trigger validate_experience_parent_type_before_write on public.experience;
create trigger validate_experience_parent_type_before_write
before insert or update of type, parent_experience_id, user_id, organization,
  organization_url, start_date, end_date
on public.experience
for each row execute function public.validate_experience_parent_type();



-- =============================================================================
-- 20260830131618_link_skill_activity_to_experience.sql
-- =============================================================================

-- A logged skill activity can optionally happen within a specific work,
-- education, subject, project, or other experience. The xAPI statement keeps
-- the portable context extension; this column is its queryable mirror.

alter table public.xapi_statements
  add column experience_id uuid references public.experience(id) on delete set null;

create index xapi_statements_experience_id_recorded_at_idx
  on public.xapi_statements (experience_id, recorded_at desc)
  where experience_id is not null;

create or replace function public.validate_xapi_statement_context_ownership()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.skill_id is not null and not exists (
    select 1 from public.skills
    where id = new.skill_id and user_id = new.user_id
  ) then
    raise exception 'Activity skill must belong to the same user';
  end if;

  if new.experience_id is not null and not exists (
    select 1 from public.experience
    where id = new.experience_id and user_id = new.user_id
  ) then
    raise exception 'Activity experience must belong to the same user';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_xapi_statement_context_ownership() from public;

create trigger validate_xapi_statement_context_ownership_before_write
before insert or update of user_id, skill_id, experience_id
on public.xapi_statements
for each row execute function public.validate_xapi_statement_context_ownership();



-- =============================================================================
-- 20260831090444_xapi_statement_evidence.sql
-- =============================================================================

-- A logged skill activity can now carry evidence, the same shape
-- skill_assessments has had since 0007 (a link plus uploaded files) --
-- reuses the existing skill-evidence storage bucket and its RLS policy
-- (scoped only by the uploading user's own folder, not by table), so no
-- storage/policy changes are needed here.
alter table xapi_statements add column evidence_url text;
alter table xapi_statements add column evidence_paths text[];



-- =============================================================================
-- 20260831113000_provider_catalogue_workspace.sql
-- =============================================================================

-- Expand provider catalogues into scoped workspaces with skills and role-based users.
alter table catalogue_approvers
  add column role text not null default 'approver'
  check (role in ('admin', 'approver'));

create table catalogue_skills (
  id uuid primary key default gen_random_uuid(),
  catalogue_id uuid not null references catalogues(id) on delete cascade,
  skill_library_id uuid not null references skill_library(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (catalogue_id, skill_library_id)
);

create index catalogue_skills_catalogue_idx on catalogue_skills (catalogue_id);
create index catalogue_skills_skill_idx on catalogue_skills (skill_library_id);

create or replace function is_catalogue_admin(p_catalogue_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from catalogue_approvers ca
    join catalogues c on c.id = ca.catalogue_id
    join organisations o on o.id = c.organisation_id
    where ca.catalogue_id = p_catalogue_id
      and ca.user_id = p_user_id
      and ca.role = 'admin'
      and o.status = 'active'
  )
$$;

revoke all on function is_catalogue_admin(uuid, uuid) from public;
grant execute on function is_catalogue_admin(uuid, uuid) to authenticated;

create policy "Catalogue admins can update their catalogue"
  on catalogues for update to authenticated
  using (is_catalogue_admin(id, (select auth.uid())))
  with check (is_catalogue_admin(id, (select auth.uid())));

create policy "Catalogue admins can add catalogue users"
  on catalogue_approvers for insert to authenticated
  with check (
    added_by = (select auth.uid())
    and is_catalogue_admin(catalogue_id, (select auth.uid()))
    and exists (
      select 1 from catalogues c
      join organisation_members om on om.organisation_id = c.organisation_id
      where c.id = catalogue_id and om.user_id = catalogue_approvers.user_id and om.status = 'active'
    )
  );

create policy "Catalogue admins can update catalogue users"
  on catalogue_approvers for update to authenticated
  using (is_catalogue_admin(catalogue_id, (select auth.uid())))
  with check (is_catalogue_admin(catalogue_id, (select auth.uid())));

create policy "Organisation admins can update catalogue users"
  on catalogue_approvers for update to authenticated
  using (
    exists (select 1 from catalogues c where c.id = catalogue_id and is_org_admin(c.organisation_id, (select auth.uid())))
  )
  with check (
    exists (select 1 from catalogues c where c.id = catalogue_id and is_org_admin(c.organisation_id, (select auth.uid())))
  );

create policy "Catalogue admins can remove catalogue users"
  on catalogue_approvers for delete to authenticated
  using (is_catalogue_admin(catalogue_id, (select auth.uid())));

alter table catalogue_skills enable row level security;

create policy "Organisation members can view catalogue skills"
  on catalogue_skills for select to authenticated
  using (
    exists (
      select 1 from catalogues c
      where c.id = catalogue_id and is_org_member(c.organisation_id, (select auth.uid()))
    )
  );

create policy "Catalogue admins manage catalogue skills"
  on catalogue_skills for all to authenticated
  using (
    is_catalogue_admin(catalogue_id, (select auth.uid()))
    or exists (select 1 from catalogues c where c.id = catalogue_id and is_org_admin(c.organisation_id, (select auth.uid())))
  )
  with check (
    (
      is_catalogue_admin(catalogue_id, (select auth.uid()))
      or exists (select 1 from catalogues c where c.id = catalogue_id and is_org_admin(c.organisation_id, (select auth.uid())))
    )
    and exists (
      select 1
      from catalogues c
      join organisation_offered_skills os on os.organisation_id = c.organisation_id
      where c.id = catalogue_id and os.skill_library_id = catalogue_skills.skill_library_id
    )
  );



-- =============================================================================
-- 20260831114500_provider_admin_catalogue_inheritance.sql
-- =============================================================================

-- Organisation provider admins automatically administer every catalogue
-- owned by their organisation; explicit catalogue-admin grants remain for
-- non-admin provider users.
create or replace function is_catalogue_admin(p_catalogue_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from catalogues c
    where c.id = p_catalogue_id
      and is_org_admin(c.organisation_id, p_user_id)
  ) or exists (
    select 1
    from catalogue_approvers ca
    join catalogues c on c.id = ca.catalogue_id
    join organisations o on o.id = c.organisation_id
    where ca.catalogue_id = p_catalogue_id
      and ca.user_id = p_user_id
      and ca.role = 'admin'
      and o.status = 'active'
  )
$$;

revoke all on function is_catalogue_admin(uuid, uuid) from public;
grant execute on function is_catalogue_admin(uuid, uuid) to authenticated;



-- =============================================================================
-- 20260831120000_catalogue_resources.sql
-- =============================================================================

-- Allow an organisation resource to be assigned to one or more catalogues
-- without duplicating or transferring ownership of the underlying resource.
create table catalogue_resources (
  id uuid primary key default gen_random_uuid(),
  catalogue_id uuid not null references catalogues(id) on delete cascade,
  resource_id uuid not null references content_resources(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (catalogue_id, resource_id)
);

create index catalogue_resources_catalogue_idx on catalogue_resources (catalogue_id);
create index catalogue_resources_resource_idx on catalogue_resources (resource_id);

alter table catalogue_resources enable row level security;

revoke all on table catalogue_resources from anon, authenticated;
grant select, insert, delete on table catalogue_resources to authenticated;

create policy "Organisation members can view catalogue resources"
  on catalogue_resources for select to authenticated
  using (
    exists (
      select 1
      from catalogues c
      where c.id = catalogue_resources.catalogue_id
        and is_org_member(c.organisation_id, (select auth.uid()))
    )
  );

create policy "Catalogue admins can assign resources"
  on catalogue_resources for insert to authenticated
  with check (
    is_catalogue_admin(catalogue_resources.catalogue_id, (select auth.uid()))
    and catalogue_resources.created_by = (select auth.uid())
    and exists (
      select 1
      from catalogues c
      join content_resources cr on cr.organisation_id = c.organisation_id
      where c.id = catalogue_resources.catalogue_id
        and cr.id = catalogue_resources.resource_id
    )
  );

create policy "Catalogue admins can unassign resources"
  on catalogue_resources for delete to authenticated
  using (is_catalogue_admin(catalogue_resources.catalogue_id, (select auth.uid())));



-- =============================================================================
-- 20260831121500_assign_existing_course_to_catalogue.sql
-- =============================================================================

-- Catalogue admins can assign an existing course owned by the catalogue's
-- organisation. Approved current versions are published immediately;
-- editable versions enter (or remain in) the normal approval workflow.
create or replace function assign_course_to_catalogue(p_catalogue_id uuid, p_course_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
  v_catalogue_organisation_id uuid;
  v_course_organisation_id uuid;
  v_course_status text;
  v_is_current_published boolean;
begin
  if v_caller is null or not is_catalogue_admin(p_catalogue_id, v_caller) then
    raise exception 'Not authorized';
  end if;

  select organisation_id
  into v_catalogue_organisation_id
  from catalogues
  where id = p_catalogue_id
    and not is_global;

  select organisation_id, status, is_current_published
  into v_course_organisation_id, v_course_status, v_is_current_published
  from course_catalogue
  where id = p_course_id
  for update;

  if v_catalogue_organisation_id is null
    or v_course_organisation_id is distinct from v_catalogue_organisation_id then
    raise exception 'Course and catalogue must belong to the same organisation';
  end if;

  if v_course_status not in ('draft', 'rejected', 'pending_approval', 'approved')
    or (v_course_status = 'approved' and not v_is_current_published) then
    raise exception 'This course version cannot be added to a catalogue';
  end if;

  insert into course_catalogue_publications (
    course_id,
    catalogue_id,
    selected_by,
    published_at
  )
  values (
    p_course_id,
    p_catalogue_id,
    v_caller,
    case when v_course_status = 'approved' then now() else null end
  )
  on conflict (course_id, catalogue_id) do nothing;

  if v_course_status in ('draft', 'rejected') then
    update course_catalogue
    set status = 'pending_approval', rejection_reason = null
    where id = p_course_id;
  end if;
end;
$$;

revoke all on function assign_course_to_catalogue(uuid, uuid) from public, anon, authenticated;
grant execute on function assign_course_to_catalogue(uuid, uuid) to authenticated;



-- =============================================================================
-- 20260831123000_require_published_catalogue_courses.sql
-- =============================================================================

-- Tighten catalogue assignment: only a current course version that has
-- already been approved and published to at least one catalogue may be
-- added from inside another catalogue.
create or replace function assign_course_to_catalogue(p_catalogue_id uuid, p_course_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
  v_catalogue_organisation_id uuid;
  v_course_organisation_id uuid;
  v_course_status text;
  v_is_current_published boolean;
begin
  if v_caller is null or not is_catalogue_admin(p_catalogue_id, v_caller) then
    raise exception 'Not authorized';
  end if;

  select organisation_id
  into v_catalogue_organisation_id
  from catalogues
  where id = p_catalogue_id
    and not is_global;

  select organisation_id, status, is_current_published
  into v_course_organisation_id, v_course_status, v_is_current_published
  from course_catalogue
  where id = p_course_id
  for update;

  if v_catalogue_organisation_id is null
    or v_course_organisation_id is distinct from v_catalogue_organisation_id then
    raise exception 'Course and catalogue must belong to the same organisation';
  end if;

  if v_course_status <> 'approved'
    or not v_is_current_published
    or not is_course_published_to_catalogue(p_course_id) then
    raise exception 'Only published courses can be added to a catalogue';
  end if;

  insert into course_catalogue_publications (
    course_id,
    catalogue_id,
    selected_by,
    published_at
  )
  values (p_course_id, p_catalogue_id, v_caller, now())
  on conflict (course_id, catalogue_id) do nothing;
end;
$$;

revoke all on function assign_course_to_catalogue(uuid, uuid) from public, anon, authenticated;
grant execute on function assign_course_to_catalogue(uuid, uuid) to authenticated;



-- =============================================================================
-- 20260831124500_allow_first_catalogue_publication.sql
-- =============================================================================

-- A current approved course may receive its first catalogue destination;
-- it does not need to have a pre-existing publication row.
create or replace function assign_course_to_catalogue(p_catalogue_id uuid, p_course_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
  v_catalogue_organisation_id uuid;
  v_course_organisation_id uuid;
  v_course_status text;
  v_is_current_published boolean;
begin
  if v_caller is null or not is_catalogue_admin(p_catalogue_id, v_caller) then
    raise exception 'Not authorized';
  end if;

  select organisation_id
  into v_catalogue_organisation_id
  from catalogues
  where id = p_catalogue_id
    and not is_global;

  select organisation_id, status, is_current_published
  into v_course_organisation_id, v_course_status, v_is_current_published
  from course_catalogue
  where id = p_course_id
  for update;

  if v_catalogue_organisation_id is null
    or v_course_organisation_id is distinct from v_catalogue_organisation_id then
    raise exception 'Course and catalogue must belong to the same organisation';
  end if;

  if v_course_status <> 'approved' or not v_is_current_published then
    raise exception 'Only published courses can be added to a catalogue';
  end if;

  insert into course_catalogue_publications (
    course_id,
    catalogue_id,
    selected_by,
    published_at
  )
  values (p_course_id, p_catalogue_id, v_caller, now())
  on conflict (course_id, catalogue_id) do nothing;
end;
$$;

revoke all on function assign_course_to_catalogue(uuid, uuid) from public, anon, authenticated;
grant execute on function assign_course_to_catalogue(uuid, uuid) to authenticated;



-- =============================================================================
-- 20260831130759_resource_versioning.sql
-- =============================================================================

-- Immutable resource version families. Existing rows remain live as
-- published v1, preserving every course and catalogue link.
alter table content_resources
  add column version_group_id uuid,
  add column version_number integer,
  add column status text,
  add column is_current_published boolean,
  add column published_at timestamptz,
  add column published_by uuid references auth.users(id) on delete set null;

update content_resources
set version_group_id = id,
    version_number = 1,
    status = 'published',
    is_current_published = true,
    published_at = created_at,
    published_by = created_by;

alter table content_resources
  alter column version_group_id set not null,
  alter column version_number set not null,
  alter column version_number set default 1,
  alter column status set not null,
  alter column status set default 'published',
  alter column is_current_published set not null,
  alter column is_current_published set default true,
  add constraint content_resources_version_number_positive check (version_number > 0),
  add constraint content_resources_status_check check (status in ('draft', 'published', 'inactive')),
  add constraint content_resources_version_group_version_key unique (version_group_id, version_number);

create unique index content_resources_one_current_published_idx
  on content_resources (version_group_id)
  where is_current_published;

create index content_resources_version_group_idx
  on content_resources (version_group_id, version_number desc);

create or replace function initialise_resource_version()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.version_group_id := coalesce(new.version_group_id, new.id);
  new.version_number := coalesce(new.version_number, 1);
  new.status := coalesce(new.status, 'published');
  new.is_current_published := coalesce(new.is_current_published, new.status = 'published');
  if new.status = 'published' then
    new.published_at := coalesce(new.published_at, now());
    new.published_by := coalesce(new.published_by, new.created_by);
  end if;
  return new;
end;
$$;

create trigger initialise_resource_version_trigger
  before insert on content_resources
  for each row execute procedure initialise_resource_version();

create or replace function create_resource_draft_version(p_resource_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_source public.content_resources%rowtype;
  v_new_id uuid := gen_random_uuid();
  v_next_version integer;
begin
  select * into v_source
  from public.content_resources
  where id = p_resource_id
  for update;

  if v_source.id is null
    or v_caller is null
    or not public.is_org_member(v_source.organisation_id, v_caller) then
    raise exception 'Not authorized';
  end if;

  if v_source.status <> 'published' or not v_source.is_current_published then
    raise exception 'Create a version from the current published resource';
  end if;

  if exists (
    select 1 from public.content_resources
    where version_group_id = v_source.version_group_id and status = 'draft'
  ) then
    raise exception 'This resource already has a draft version';
  end if;

  select coalesce(max(version_number), 0) + 1 into v_next_version
  from public.content_resources
  where version_group_id = v_source.version_group_id;

  insert into public.content_resources (
    id, organisation_id, type, title, storage_path, file_name, launch_path,
    external_url, video_edit, created_by, version_group_id, version_number,
    status, is_current_published, published_at, published_by
  ) values (
    v_new_id, v_source.organisation_id, v_source.type, v_source.title,
    v_source.storage_path, v_source.file_name, v_source.launch_path,
    v_source.external_url, v_source.video_edit, v_caller,
    v_source.version_group_id, v_next_version, 'draft', false, null, null
  );

  return v_new_id;
end;
$$;

create or replace function publish_resource_version(p_resource_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_resource public.content_resources%rowtype;
begin
  select * into v_resource
  from public.content_resources
  where id = p_resource_id
  for update;

  if v_resource.id is null
    or v_caller is null
    or not public.is_org_member(v_resource.organisation_id, v_caller) then
    raise exception 'Not authorized';
  end if;

  if v_resource.status <> 'draft' then
    raise exception 'Only a draft resource version can be published';
  end if;

  update public.content_resources
  set status = 'inactive', is_current_published = false, updated_at = now()
  where version_group_id = v_resource.version_group_id
    and is_current_published;

  update public.content_resources
  set status = 'published',
      is_current_published = true,
      published_at = now(),
      published_by = v_caller,
      updated_at = now()
  where id = p_resource_id;

  update public.catalogue_resources cr
  set resource_id = p_resource_id
  where cr.resource_id in (
    select id from public.content_resources
    where version_group_id = v_resource.version_group_id
      and id <> p_resource_id
  )
  and not exists (
    select 1 from public.catalogue_resources existing
    where existing.catalogue_id = cr.catalogue_id
      and existing.resource_id = p_resource_id
  );
end;
$$;

revoke all on function create_resource_draft_version(uuid) from public, anon, authenticated;
revoke all on function publish_resource_version(uuid) from public, anon, authenticated;
grant execute on function create_resource_draft_version(uuid) to authenticated;
grant execute on function publish_resource_version(uuid) to authenticated;

-- Resource rows are immutable once published. Direct client updates are
-- limited to drafts; the narrowly-scoped publish function performs the
-- controlled state transition.
drop policy "Org members manage their own organisation's resources" on content_resources;

create policy "Org members create resources for their organisation"
  on content_resources for insert to authenticated
  with check (
    is_platform_admin((select auth.uid()))
    or is_org_member(organisation_id, (select auth.uid()))
  );

create policy "Org members update draft resources"
  on content_resources for update to authenticated
  using (
    status = 'draft'
    and (
      is_platform_admin((select auth.uid()))
      or is_org_member(organisation_id, (select auth.uid()))
    )
  )
  with check (
    status = 'draft'
    and not is_current_published
    and (
      is_platform_admin((select auth.uid()))
      or is_org_member(organisation_id, (select auth.uid()))
    )
  );

create policy "Org members delete resources for their organisation"
  on content_resources for delete to authenticated
  using (
    is_platform_admin((select auth.uid()))
    or is_org_member(organisation_id, (select auth.uid()))
  );

-- Catalogue assignments accept only the current published version.
drop policy "Catalogue admins can assign resources" on catalogue_resources;
create policy "Catalogue admins can assign resources"
  on catalogue_resources for insert to authenticated
  with check (
    is_catalogue_admin(catalogue_resources.catalogue_id, (select auth.uid()))
    and catalogue_resources.created_by = (select auth.uid())
    and exists (
      select 1
      from catalogues c
      join content_resources cr on cr.organisation_id = c.organisation_id
      where c.id = catalogue_resources.catalogue_id
        and cr.id = catalogue_resources.resource_id
        and cr.status = 'published'
        and cr.is_current_published
    )
  );



-- =============================================================================
-- 20260831150000_content_page_resources.sql
-- =============================================================================

-- Authored content pages are reusable organisation resources, attached to
-- courses through the existing course_content_links relationship. Their
-- versioned block document lives on the resource row; unlike uploaded media
-- there is no storage object or external URL to manage.
alter table content_resources drop constraint content_resources_type_check;
alter table content_resources add constraint content_resources_type_check
  check (type in ('video', 'screen_recording', 'file', 'scorm', 'xapi', 'external_video', 'web_url', 'page'));

alter table content_resources add column page_content jsonb;

alter table content_resources drop constraint content_resources_storage_or_external_check;
alter table content_resources add constraint content_resources_storage_or_external_check
  check (
    (type in ('external_video', 'web_url') and storage_path is null and external_url is not null and external_url ~ '^https?://' and page_content is null)
    or (type = 'page' and storage_path is null and external_url is null and page_content is not null)
    or (type not in ('external_video', 'web_url', 'page') and storage_path is not null and external_url is null and page_content is null)
  );

alter table content_resources add constraint content_resources_page_content_check
  check (
    page_content is null
    or (
      jsonb_typeof(page_content) = 'object'
      and page_content->>'version' = '1'
      and jsonb_typeof(page_content->'blocks') = 'array'
      and jsonb_array_length(page_content->'blocks') <= 100
    )
  );



-- =============================================================================
-- 20260831153000_allow_project_under_education.sql
-- =============================================================================

-- Education entries can now also contain "project" children, not just
-- subjects (e.g. a dissertation or capstone project completed during a
-- degree), reusing the same "project" type already allowed under jobs and
-- volunteer positions rather than inventing a new concept.

create or replace function public.validate_experience_parent_type()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  parent_type text;
  parent_user_id uuid;
  parent_organization text;
  parent_organization_url text;
  parent_start_date date;
  parent_end_date date;
begin
  if new.parent_experience_id is null then
    if new.type = 'subject' then
      raise exception 'A subject must belong to an education experience';
    end if;

    if tg_op = 'UPDATE'
       and (new.start_date is distinct from old.start_date
            or new.end_date is distinct from old.end_date)
       and exists (
         select 1
         from public.experience child
         where child.parent_experience_id = new.id
           and (
             child.start_date < new.start_date
             or child.end_date < new.start_date
             or (new.end_date is not null and child.start_date > new.end_date)
             or (new.end_date is not null and child.end_date > new.end_date)
           )
       ) then
      raise exception 'Parent dates cannot exclude an existing sub-experience';
    end if;

    return new;
  end if;

  if new.parent_experience_id = new.id then
    raise exception 'An experience cannot be its own parent';
  end if;

  select type, user_id, organization, organization_url, start_date, end_date
    into parent_type, parent_user_id, parent_organization, parent_organization_url,
         parent_start_date, parent_end_date
  from public.experience
  where id = new.parent_experience_id;

  if not found then raise exception 'Parent experience not found'; end if;
  if parent_user_id <> new.user_id then raise exception 'Parent and child experiences must belong to the same user'; end if;
  if parent_type = 'education' and new.type not in ('subject', 'project') then raise exception 'Education experiences can only contain subjects or projects'; end if;
  if new.type = 'subject' and parent_type <> 'education' then raise exception 'Subjects can only belong to education experiences'; end if;
  if parent_type in ('employment', 'volunteer') and new.type not in ('project', 'course', 'other') then raise exception 'This experience type cannot be added to a job or volunteer position'; end if;
  if parent_type not in ('education', 'employment', 'volunteer') then raise exception 'This experience type cannot contain sub-experiences'; end if;

  if new.start_date < parent_start_date or new.end_date < parent_start_date then
    raise exception 'Sub-experience dates cannot be before the parent start date';
  end if;
  if parent_end_date is not null
     and (new.start_date > parent_end_date or new.end_date > parent_end_date) then
    raise exception 'Sub-experience dates cannot be after the parent end date';
  end if;
  if new.start_date is not null and new.end_date < new.start_date then
    raise exception 'Sub-experience end date cannot be before its start date';
  end if;

  if new.type = 'subject' then
    new.organization := parent_organization;
    new.organization_url := parent_organization_url;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_experience_parent_type() from public;

drop trigger validate_experience_parent_type_before_write on public.experience;
create trigger validate_experience_parent_type_before_write
before insert or update of type, parent_experience_id, user_id, organization,
  organization_url, start_date, end_date
on public.experience
for each row execute function public.validate_experience_parent_type();



-- =============================================================================
-- 20260831160000_external_connections.sql
-- =============================================================================

-- External data source connections (OAuth), starting with Strava. This is
-- deliberately a different concept from "connections" (0058, learner-to-
-- learner social relationships) -- an external_connection links a learner
-- to their own account on a third-party service, not to another learner.
--
-- Tokens are held server-side only and never exposed to the client's own
-- Supabase session: RLS is enabled with zero policies granted to
-- authenticated/anon, so a plain client query returns nothing regardless of
-- ownership. The only two sanctioned access paths are (a) the service-role
-- client (supabaseAdmin(), used from api/strava/[...path].js -- same
-- pattern as api/xapi/[...path].js's launch-session lookups) for anything
-- touching the token columns, and (b) get_my_external_connections() below
-- for the one safe, non-secret read the client needs (status/last synced),
-- mirroring the existing is_connected()/upsert_connection() security-
-- definer precedent from 0058.
create table external_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  provider text not null check (provider in ('strava')),
  provider_account_id text not null,
  access_token text not null,
  refresh_token text not null,
  token_expires_at timestamptz not null,
  scope text,
  status text not null default 'active' check (status in ('active', 'error')),
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz,
  unique (user_id, provider)
);

alter table external_connections enable row level security;

create index external_connections_user_id_idx on external_connections (user_id);

create or replace function get_my_external_connections()
returns table (
  id uuid,
  provider text,
  provider_account_id text,
  status text,
  connected_at timestamptz,
  last_synced_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select id, provider, provider_account_id, status, connected_at, last_synced_at
  from external_connections
  where user_id = auth.uid()
$$;

revoke all on function get_my_external_connections() from public;
grant execute on function get_my_external_connections() to authenticated;



-- =============================================================================
-- 20260831160500_skill_source_external_import.sql
-- =============================================================================

-- A skill created from reviewing synced activity (e.g. importing "Running"
-- the first time a Strava run is reviewed) is a new source distinct from
-- 'cv_import' -- generic across providers rather than 'strava_import', so a
-- future connector reuses this same value instead of widening the
-- constraint again.
alter table skills drop constraint skills_source_check;
alter table skills add constraint skills_source_check
  check (source in ('manual', 'cv_import', 'recommend', 'external_import'));



-- =============================================================================
-- 20260831170000_provider_skill_alignment.sql
-- =============================================================================

-- Provider-managed alignment between an offered skill and the organisation's
-- reusable resources. The resource remains the source record; removing an
-- alignment only removes this association.
create table content_resource_skills (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references content_resources(id) on delete cascade,
  skill_library_id uuid not null references skill_library(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (resource_id, skill_library_id)
);

create index content_resource_skills_resource_idx on content_resource_skills (resource_id);
create index content_resource_skills_skill_idx on content_resource_skills (skill_library_id);

alter table content_resource_skills enable row level security;

revoke all on table content_resource_skills from anon, authenticated;
grant select, insert, delete on table content_resource_skills to authenticated;

create policy "Org members and platform admins view resource skill alignments"
  on content_resource_skills for select
  to authenticated
  using (
    is_platform_admin((select auth.uid()))
    or exists (
      select 1
      from content_resources cr
      where cr.id = content_resource_skills.resource_id
        and is_org_member(cr.organisation_id, (select auth.uid()))
    )
  );

create policy "Org members align their resources to offered skills"
  on content_resource_skills for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1
      from content_resources cr
      join organisation_offered_skills oos
        on oos.organisation_id = cr.organisation_id
       and oos.skill_library_id = content_resource_skills.skill_library_id
      where cr.id = content_resource_skills.resource_id
        and is_org_member(cr.organisation_id, (select auth.uid()))
    )
  );

create policy "Org members remove their resource skill alignments"
  on content_resource_skills for delete
  to authenticated
  using (
    is_platform_admin((select auth.uid()))
    or exists (
      select 1
      from content_resources cr
      where cr.id = content_resource_skills.resource_id
        and is_org_member(cr.organisation_id, (select auth.uid()))
    )
  );

-- course_catalogue_skills is the existing source of truth for which skills a
-- course targets. Providers may manage those rows only for editable courses
-- owned by one of their organisations, and only for skills on that
-- organisation's offered-skills roster.
grant insert, update, delete on table course_catalogue_skills to authenticated;

create policy "Org members add offered skills to editable training"
  on course_catalogue_skills for insert
  to authenticated
  with check (
    exists (
      select 1
      from course_catalogue cc
      join organisation_offered_skills oos
        on oos.organisation_id = cc.organisation_id
       and oos.skill_library_id = course_catalogue_skills.skill_library_id
      where cc.id = course_catalogue_skills.course_catalogue_id
        and cc.status in ('draft', 'rejected')
        and is_org_member(cc.organisation_id, (select auth.uid()))
    )
  );

create policy "Org members update offered skills on editable training"
  on course_catalogue_skills for update
  to authenticated
  using (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_catalogue_skills.course_catalogue_id
        and cc.status in ('draft', 'rejected')
        and is_org_member(cc.organisation_id, (select auth.uid()))
    )
  )
  with check (
    exists (
      select 1
      from course_catalogue cc
      join organisation_offered_skills oos
        on oos.organisation_id = cc.organisation_id
       and oos.skill_library_id = course_catalogue_skills.skill_library_id
      where cc.id = course_catalogue_skills.course_catalogue_id
        and cc.status in ('draft', 'rejected')
        and is_org_member(cc.organisation_id, (select auth.uid()))
    )
  );

create policy "Org members remove skills from editable training"
  on course_catalogue_skills for delete
  to authenticated
  using (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_catalogue_skills.course_catalogue_id
        and cc.status in ('draft', 'rejected')
        and is_org_member(cc.organisation_id, (select auth.uid()))
    )
  );



-- =============================================================================
-- 20260831180000_published_provider_skill_alignment.sql
-- =============================================================================

-- Skill alignment is catalogue metadata managed from the provider skill
-- workspace. Providers choose from current published training rather than
-- editing course content, so allow alignment rows on the current approved
-- version while keeping all course fields and publication state protected by
-- course_catalogue's existing policies.
drop policy "Org members add offered skills to editable training" on course_catalogue_skills;
drop policy "Org members update offered skills on editable training" on course_catalogue_skills;
drop policy "Org members remove skills from editable training" on course_catalogue_skills;

create policy "Org members add offered skills to published training"
  on course_catalogue_skills for insert
  to authenticated
  with check (
    exists (
      select 1
      from course_catalogue cc
      join organisation_offered_skills oos
        on oos.organisation_id = cc.organisation_id
       and oos.skill_library_id = course_catalogue_skills.skill_library_id
      where cc.id = course_catalogue_skills.course_catalogue_id
        and cc.status = 'approved'
        and cc.is_current_published
        and is_org_member(cc.organisation_id, (select auth.uid()))
    )
  );

create policy "Org members update offered skills on published training"
  on course_catalogue_skills for update
  to authenticated
  using (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_catalogue_skills.course_catalogue_id
        and cc.status = 'approved'
        and cc.is_current_published
        and is_org_member(cc.organisation_id, (select auth.uid()))
    )
  )
  with check (
    exists (
      select 1
      from course_catalogue cc
      join organisation_offered_skills oos
        on oos.organisation_id = cc.organisation_id
       and oos.skill_library_id = course_catalogue_skills.skill_library_id
      where cc.id = course_catalogue_skills.course_catalogue_id
        and cc.status = 'approved'
        and cc.is_current_published
        and is_org_member(cc.organisation_id, (select auth.uid()))
    )
  );

create policy "Org members remove skills from published training"
  on course_catalogue_skills for delete
  to authenticated
  using (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_catalogue_skills.course_catalogue_id
        and cc.status = 'approved'
        and cc.is_current_published
        and is_org_member(cc.organisation_id, (select auth.uid()))
    )
  );



-- =============================================================================
-- 20260831190000_current_role_banner_dismissal.sql
-- =============================================================================

-- Drives dismissal of the "Add your current role" banner on the dashboard,
-- shown when the learner has skills/courses/connections but no experience
-- entries yet. Same pattern as cv_import_banner_dismissed_at (0110).
alter table profiles add column current_role_banner_dismissed_at timestamptz;



-- =============================================================================
-- 20260831200000_experience_other_type.sql
-- =============================================================================

-- Free-text label for what kind of experience an "Other Experience" entry
-- is (e.g. "Hackathon", "Open source contribution") -- the fixed type enum
-- only says "other", which isn't enough to distinguish entries from one
-- another on the learner's timeline.
alter table experience add column other_type text;



-- =============================================================================
-- 20260901090000_xapi_statement_skills.sql
-- =============================================================================

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



-- =============================================================================
-- 20260901100000_decouple_publish_from_catalogue.sql
-- =============================================================================

-- Separate "publish" (make this version the org's current live version)
-- from "push to catalogue" (make it discoverable through a specific
-- catalogue, which already has its own approval gate). A course version
-- with no catalogue selected is never distributed anywhere outside its own
-- organisation -- learner browsing (listCatalogueCourses) only surfaces
-- rows with a published course_catalogue_publications entry, so there is
-- no external party who needs to sign off on a catalogue-less publish.
-- Pushing an already-published version into a catalogue afterwards
-- remains the separate assign_course_to_catalogue step (20260831121500
-- onward), unchanged by this migration.

create or replace function submit_course_for_publication(p_course_id uuid, p_catalogue_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
  v_organisation_id uuid;
  v_group_id uuid;
  v_catalogue_ids uuid[] := coalesce(p_catalogue_ids, '{}');
begin
  select organisation_id, version_group_id into v_organisation_id, v_group_id
  from course_catalogue
  where id = p_course_id
    and status in ('draft', 'rejected')
  for update;

  if v_organisation_id is null then
    raise exception 'Course is not editable or does not belong to a provider';
  end if;

  if not (
    is_platform_admin(v_caller)
    or is_org_member(v_organisation_id, v_caller)
  ) then
    raise exception 'Not authorized';
  end if;

  if cardinality(v_catalogue_ids) = 0 then
    update course_catalogue
    set status = 'inactive', is_current_published = false
    where version_group_id = v_group_id
      and is_current_published
      and id <> p_course_id;

    update course_catalogue
    set status = 'approved',
        is_current_published = true,
        approved_by = v_caller,
        approved_at = now(),
        rejection_reason = null
    where id = p_course_id;

    delete from course_catalogue_publications where course_id = p_course_id;
    return;
  end if;

  if exists (
    select 1
    from unnest(v_catalogue_ids) selected_id
    left join catalogues c
      on c.id = selected_id
      and (c.is_global or c.organisation_id = v_organisation_id)
    where c.id is null
  ) then
    raise exception 'One or more catalogues are not available to this provider';
  end if;

  delete from course_catalogue_publications where course_id = p_course_id;

  insert into course_catalogue_publications (course_id, catalogue_id, selected_by)
  select p_course_id, selected_id, v_caller
  from (select distinct unnest(v_catalogue_ids) as selected_id) selected;

  update course_catalogue
  set status = 'pending_approval', rejection_reason = null
  where id = p_course_id;
end;
$$;

revoke all on function submit_course_for_publication(uuid, uuid[]) from public;
grant execute on function submit_course_for_publication(uuid, uuid[]) to authenticated;

-- Deactivating a catalogue-attached course still requires being an
-- approver of every catalogue it was published to (unchanged). A
-- catalogue-less approved course has nobody in that role, so any member of
-- its own organisation may take it back to inactive -- the same "no
-- catalogue means no external gatekeeper" reasoning as the publish side
-- above, and without it a catalogue-less publish could only ever be
-- reversed by a platform admin.
create or replace function deactivate_course_publication(p_course_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
  v_is_admin boolean := is_platform_admin(v_caller);
  v_status text;
  v_organisation_id uuid;
  v_found boolean;
  v_has_publications boolean;
  v_approved_for_all boolean;
  v_is_org_member boolean;
begin
  select status, organisation_id into v_status, v_organisation_id
  from course_catalogue
  where id = p_course_id
  for update;

  v_found := found;

  v_has_publications := v_found and exists (
    select 1 from course_catalogue_publications where course_id = p_course_id
  );

  v_approved_for_all := v_found and not exists (
    select 1
    from course_catalogue_publications ccp
    where ccp.course_id = p_course_id
      and not is_catalogue_approver(ccp.catalogue_id, v_caller)
  );

  v_is_org_member := v_found and v_organisation_id is not null and is_org_member(v_organisation_id, v_caller);

  if not v_is_admin
    and not (v_has_publications and v_approved_for_all)
    and not (not v_has_publications and v_is_org_member)
  then
    raise exception 'Not authorized';
  end if;

  if not v_found then
    raise exception 'Course not found';
  end if;

  if v_status <> 'approved' then
    raise exception 'Only an approved course can be deactivated';
  end if;

  update course_catalogue
  set status = 'inactive', is_current_published = false
  where id = p_course_id;
end;
$$;

revoke all on function deactivate_course_publication(uuid) from public;
grant execute on function deactivate_course_publication(uuid) to authenticated;



-- =============================================================================
-- 20260901120000_fix_resource_draft_version_page_content.sql
-- =============================================================================

-- create_resource_draft_version (20260831130759) predates page_content
-- (20260831150000) and never copied it into the new draft row, so
-- creating a new version of a 'page' resource always violated
-- content_resources_storage_or_external_check (which requires page_content
-- to be set whenever type = 'page'). v_source is a full %rowtype select,
-- so v_source.page_content is already populated -- it just needed adding
-- to the explicit insert column list.
create or replace function create_resource_draft_version(p_resource_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_source public.content_resources%rowtype;
  v_new_id uuid := gen_random_uuid();
  v_next_version integer;
begin
  select * into v_source
  from public.content_resources
  where id = p_resource_id
  for update;

  if v_source.id is null
    or v_caller is null
    or not public.is_org_member(v_source.organisation_id, v_caller) then
    raise exception 'Not authorized';
  end if;

  if v_source.status <> 'published' or not v_source.is_current_published then
    raise exception 'Create a version from the current published resource';
  end if;

  if exists (
    select 1 from public.content_resources
    where version_group_id = v_source.version_group_id and status = 'draft'
  ) then
    raise exception 'This resource already has a draft version';
  end if;

  select coalesce(max(version_number), 0) + 1 into v_next_version
  from public.content_resources
  where version_group_id = v_source.version_group_id;

  insert into public.content_resources (
    id, organisation_id, type, title, storage_path, file_name, launch_path,
    external_url, video_edit, page_content, created_by, version_group_id,
    version_number, status, is_current_published, published_at, published_by
  ) values (
    v_new_id, v_source.organisation_id, v_source.type, v_source.title,
    v_source.storage_path, v_source.file_name, v_source.launch_path,
    v_source.external_url, v_source.video_edit, v_source.page_content, v_caller,
    v_source.version_group_id, v_next_version, 'draft', false, null, null
  );

  return v_new_id;
end;
$$;

revoke all on function create_resource_draft_version(uuid) from public, anon, authenticated;
grant execute on function create_resource_draft_version(uuid) to authenticated;



-- =============================================================================
-- 20260901130000_content_resource_codes.sql
-- =============================================================================

-- Prefixed reference code for org resource-library items (RES-00001),
-- matching the CRS-/ORG-/USR-/SKL- codes already established (0113) for
-- courses/providers/users/skills. content_resources is versioned exactly
-- like course_catalogue (version_group_id/version_number,
-- 20260831130759), so this follows course_code's shape exactly: nullable
-- column, generate-if-null trigger, uniqueness scoped to each
-- version_group's v1 row only, and create_resource_draft_version copies
-- the code forward explicitly rather than letting a new version get a
-- freshly generated one.

create sequence resource_code_seq;

create or replace function generate_resource_code()
returns text
language sql
as $$
  select 'RES-' || lpad(nextval('resource_code_seq')::text, 5, '0')
$$;

alter table content_resources add column resource_code text;

create or replace function set_resource_code()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.resource_code is null then
    new.resource_code := generate_resource_code();
  end if;
  return new;
end;
$$;

create trigger set_resource_code_trigger
  before insert on content_resources
  for each row execute procedure set_resource_code();

-- Backfill: one code per version_group, reusing an existing non-null code
-- already present anywhere in that group (defensive) before generating a
-- fresh one, then propagated to every row in the group.
do $$
declare
  r record;
  v_code text;
begin
  for r in
    select distinct version_group_id
    from content_resources
    where version_group_id in (
      select version_group_id from content_resources where resource_code is null
    )
    order by version_group_id
  loop
    select resource_code into v_code
    from content_resources
    where version_group_id = r.version_group_id and resource_code is not null
    limit 1;

    if v_code is null then
      v_code := generate_resource_code();
    end if;

    update content_resources
    set resource_code = v_code
    where version_group_id = r.version_group_id and resource_code is null;
  end loop;
end $$;

create unique index content_resources_resource_code_unique_idx
  on content_resources (resource_code)
  where version_number = 1;

-- create_resource_draft_version must now also copy resource_code forward
-- (same reasoning as course_code in create_course_draft_version) so a new
-- draft version keeps its published parent's code instead of getting a
-- freshly generated one.
create or replace function create_resource_draft_version(p_resource_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_source public.content_resources%rowtype;
  v_new_id uuid := gen_random_uuid();
  v_next_version integer;
begin
  select * into v_source
  from public.content_resources
  where id = p_resource_id
  for update;

  if v_source.id is null
    or v_caller is null
    or not public.is_org_member(v_source.organisation_id, v_caller) then
    raise exception 'Not authorized';
  end if;

  if v_source.status <> 'published' or not v_source.is_current_published then
    raise exception 'Create a version from the current published resource';
  end if;

  if exists (
    select 1 from public.content_resources
    where version_group_id = v_source.version_group_id and status = 'draft'
  ) then
    raise exception 'This resource already has a draft version';
  end if;

  select coalesce(max(version_number), 0) + 1 into v_next_version
  from public.content_resources
  where version_group_id = v_source.version_group_id;

  insert into public.content_resources (
    id, organisation_id, type, title, storage_path, file_name, launch_path,
    external_url, video_edit, page_content, resource_code, created_by,
    version_group_id, version_number, status, is_current_published,
    published_at, published_by
  ) values (
    v_new_id, v_source.organisation_id, v_source.type, v_source.title,
    v_source.storage_path, v_source.file_name, v_source.launch_path,
    v_source.external_url, v_source.video_edit, v_source.page_content,
    v_source.resource_code, v_caller, v_source.version_group_id,
    v_next_version, 'draft', false, null, null
  );

  return v_new_id;
end;
$$;

revoke all on function create_resource_draft_version(uuid) from public, anon, authenticated;
grant execute on function create_resource_draft_version(uuid) to authenticated;



-- =============================================================================
-- 20260902090000_employers.sql
-- =============================================================================

-- Phase 1 foundation for the "employer" domain concept (CLAUDE.md future-
-- direction section): a company running its own in-house LMS, distinct from
-- "organisations" (which today are only ever training providers, staffed by
-- organisation_members). An employer gets its own dedicated,
-- auto-provisioned provider organisation "attached" underneath it, so it can
-- author its own courses/catalogues/resources through the *existing*
-- provider console/RLS model verbatim -- no duplication of that machinery.
-- employer_members is a separate, new membership concept for an employer's
-- own managed learners (not provider staff) -- deliberately NOT the same
-- table as organisation_members, since staffing the attached provider org
-- (who can author training) and belonging to the employer as a managed
-- learner are different relationships that will diverge in later phases
-- (bulk import, course assignment, consent-based data sharing).
--
-- Only foundation here: schema, RLS, and create_employer(). No bulk import,
-- no course assignment, no automatic RLS visibility into org-assigned
-- training, no learner-facing UI -- all explicitly later phases.

-- ----------------------------------------------------------------------------
-- Reference codes -- same generate-on-insert-if-null shape as 0113's
-- generate_organisation_code()/set_organisation_code().
-- ----------------------------------------------------------------------------

create sequence employer_code_seq;

create or replace function generate_employer_code()
returns text
language sql
as $$
  select 'EMP-' || lpad(nextval('employer_code_seq')::text, 5, '0')
$$;

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------

create table employers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  employer_code text,
  provider_organisation_id uuid not null references organisations(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function set_employer_code()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.employer_code is null then
    new.employer_code := generate_employer_code();
  end if;
  return new;
end;
$$;

create trigger set_employer_code_trigger
  before insert on employers
  for each row execute procedure set_employer_code();

create unique index employers_employer_code_unique_idx on employers (employer_code);

-- One attached provider org per employer, and one employer per provider org.
create unique index employers_provider_organisation_id_unique_idx on employers (provider_organisation_id);

create table employer_members (
  id uuid primary key default gen_random_uuid(),
  employer_id uuid not null references employers(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('admin', 'member')),
  status text not null default 'active' check (status in ('active', 'pending')),
  invited_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (employer_id, user_id)
);

create index employer_members_employer_idx on employer_members (employer_id);
create index employer_members_user_idx on employer_members (user_id);

-- ----------------------------------------------------------------------------
-- Helper functions -- security definer/stable, mirroring is_org_admin/
-- is_org_member (0065) exactly, including the is_platform_admin OR-bypass
-- that lets a platform admin add the very first admin member to a
-- brand-new employer with no existing members yet (same chicken-and-egg
-- resolution organisation_members already relies on for its own insert
-- policy). The first parameter is named p_employer_id rather than
-- employer_id (unlike the brief's literal suggestion) because employer_id
-- is also a column name on employer_members -- 0065 avoided the identical
-- trap by naming its own parameter org_id rather than organisation_id;
-- reusing the column name here would make every unqualified employer_id
-- reference in the query ambiguous.
-- ----------------------------------------------------------------------------

create or replace function is_employer_admin(p_employer_id uuid, check_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from employer_members
    where employer_id = p_employer_id and user_id = check_user_id and role = 'admin'
  ) or is_platform_admin(check_user_id)
$$;

grant execute on function is_employer_admin(uuid, uuid) to authenticated;

create or replace function is_employer_member(p_employer_id uuid, check_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from employer_members
    where employer_id = p_employer_id and user_id = check_user_id
  ) or is_platform_admin(check_user_id)
$$;

grant execute on function is_employer_member(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------

alter table employers enable row level security;

-- Unlike organisations' "any authenticated user can view" (providers are a
-- public directory) -- employers are private company entities, so select is
-- scoped to members only.
create policy "Employer members can view their employer"
  on employers for select
  to authenticated
  using (is_employer_member(id, auth.uid()));

-- No insert policy -- creation only happens through create_employer() below
-- (security definer, platform-admin-gated), same as organisations having no
-- open insert path outside its own platform-admin-only policy.
create policy "Employer admins can update their employer"
  on employers for update
  to authenticated
  using (is_employer_admin(id, auth.uid()))
  with check (is_employer_admin(id, auth.uid()));

-- No delete policy -- mirrors organisations having none.

alter table employer_members enable row level security;

create policy "Employer members can view employer members"
  on employer_members for select
  to authenticated
  using (is_employer_member(employer_id, auth.uid()));

create policy "Employer admins can add employer members"
  on employer_members for insert
  to authenticated
  with check (is_employer_admin(employer_id, auth.uid()));

create policy "Employer admins can update employer members"
  on employer_members for update
  to authenticated
  using (is_employer_admin(employer_id, auth.uid()))
  with check (is_employer_admin(employer_id, auth.uid()));

create policy "Employer admins can remove employer members"
  on employer_members for delete
  to authenticated
  using (is_employer_admin(employer_id, auth.uid()));

-- ----------------------------------------------------------------------------
-- create_employer -- security definer RPC, platform-admin-only (checked
-- internally, same "raise exception" gating convention as other admin-gated
-- RPCs, e.g. 20260831124500_allow_first_catalogue_publication.sql's
-- publish_course_version). Creates the attached provider organisation and
-- the employer row atomically (one function invocation = one transaction),
-- so it's impossible to end up with one created without the other.
-- ----------------------------------------------------------------------------

create or replace function create_employer(p_name text)
returns employers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
  v_organisation_id uuid;
  v_employer employers;
begin
  if v_caller is null or not is_platform_admin(v_caller) then
    raise exception 'Not authorized';
  end if;

  insert into organisations (name, created_by)
  values (p_name, v_caller)
  returning id into v_organisation_id;

  insert into employers (name, provider_organisation_id, created_by)
  values (p_name, v_organisation_id, v_caller)
  returning * into v_employer;

  return v_employer;
end;
$$;

grant execute on function create_employer(text) to authenticated;



-- =============================================================================
-- 20260902150000_employers_drop_update_policy.sql
-- =============================================================================

-- Security-review follow-up on 20260902090000 (employer Phase 1 foundation).
--
-- employers' UPDATE policy ("Employer admins can update their employer")
-- had no column-grain restriction, so an employer admin could repoint
-- provider_organisation_id (or overwrite employer_code/created_by) via a
-- direct client update -- even though the schema treats the employer <->
-- attached-provider-org attachment as set-once-at-creation (there's a
-- unique index on provider_organisation_id, and create_employer is the only
-- intended way to establish it). RLS can't do column-grain checks, and
-- there's no legitimate "rename my employer" UI in this feature yet to
-- preserve, so simplest correct fix for Phase 1 is to drop the policy
-- entirely -- mirrors organisations, which also has no self-service update
-- policy today (only a platform-admin-gated one). A future phase that wants
-- self-service renaming can reintroduce update access with a BEFORE UPDATE
-- trigger guarding the immutable columns.
drop policy "Employer admins can update their employer" on employers;



-- =============================================================================
-- 20260902160000_decide_employer_invite.sql
-- =============================================================================

-- Phase 2 of the employer domain concept (follows 20260902090000/
-- 20260902150000): proper invite-with-consent semantics for employer_members,
-- mirroring decide_org_invite (0070) exactly for the accept/decline
-- mechanics -- runs as the invited user, checks auth.uid() against the row's
-- user_id and that it's still 'pending', for update to avoid a races with a
-- second concurrent decide call.
--
-- The one addition beyond decide_org_invite's shape: accepting an 'admin'
-- employer_members invite also has to grant the matching organisation_members
-- admin row on the employer's attached provider organisation -- this is the
-- second half of Phase 1's eager grant (addEmployerMember,
-- api/admin/actions.js), which this phase splits by consent state. An
-- existing user hasn't agreed to anything at insert time (that's the whole
-- point of landing them 'pending' instead of 'active'), so granting
-- provider-console access then would let an employer admin hand out that
-- access to someone who hasn't accepted anything -- the grant has to wait
-- until they actually accept, here. (A brand-new account still gets the
-- grant immediately at insert time in addEmployerMember, since clicking the
-- Supabase invite email *is* their consent, same as the org-staff invite
-- flow's own reasoning.) Security definer is what makes this possible: the
-- function runs with the privileges to write organisation_members on the
-- invited user's own behalf during their own accept action -- same trust
-- boundary create_employer already relies on to provision cross-table
-- resources on a caller's behalf after verifying who they are.
create or replace function decide_employer_invite(p_member_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member employer_members%rowtype;
  v_provider_organisation_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_member from employer_members where id = p_member_id for update;
  if not found then
    raise exception 'Invitation not found';
  end if;
  if v_member.user_id != auth.uid() then
    raise exception 'Not authorized';
  end if;
  if v_member.status != 'pending' then
    raise exception 'This invitation has already been decided.';
  end if;

  if p_accept then
    update employer_members set status = 'active' where id = p_member_id;

    if v_member.role = 'admin' then
      select provider_organisation_id into v_provider_organisation_id
      from employers where id = v_member.employer_id;

      -- Same on-conflict shape as addEmployerMember's own upsert (Phase 1):
      -- never downgrade an existing organisation_members row for this
      -- person -- admin is the top role there, so overwriting role/status
      -- to admin/active on conflict is always a promotion or a no-op, never
      -- a demotion.
      insert into organisation_members (organisation_id, user_id, role, status, invited_by)
      values (v_provider_organisation_id, v_member.user_id, 'admin', 'active', v_member.invited_by)
      on conflict (organisation_id, user_id) do update
        set role = 'admin', status = 'active', invited_by = excluded.invited_by;
    end if;
  else
    delete from employer_members where id = p_member_id;
  end if;
end;
$$;

grant execute on function decide_employer_invite(uuid, boolean) to authenticated;



-- =============================================================================
-- 20260902170000_fix_employer_membership_status_check.sql
-- =============================================================================

-- CRITICAL security fix, found by security review of Phase 2 (employer
-- invite-with-consent, 20260902160000).
--
-- is_employer_admin/is_employer_member (20260902090000) never filtered on
-- employer_members.status -- unlike the org equivalents they were supposed
-- to mirror, is_org_admin/is_org_member (0070), which explicitly require
-- status = 'active' because "a pending row grants no access yet." That
-- check never made it into the employer versions.
--
-- This was latent and harmless in Phase 1 (nothing created a 'pending'
-- employer_members row back then -- addEmployerMember only ever inserted
-- 'active' rows for an existing user). Phase 2's addEmployerMember
-- existing-user branch now creates real, reachable 'pending' rows, so a
-- user invited as role='admin' but who has NOT accepted anything already
-- satisfied is_employer_admin -- meaning they could, via a direct
-- supabase.from('employer_members') call bypassing the app UI entirely:
-- read the full membership roster for that employer (is_employer_member
-- also passed, so employers'/employer_members' SELECT policies passed
-- too), UPDATE their own row to status='active' directly (skipping
-- decide_employer_invite and its consent check), and INSERT/UPDATE/DELETE
-- other members' rows (add an accomplice as admin, remove real admins).

create or replace function is_employer_admin(p_employer_id uuid, check_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from employer_members
    where employer_id = p_employer_id and user_id = check_user_id and role = 'admin' and status = 'active'
  ) or is_platform_admin(check_user_id)
$$;

create or replace function is_employer_member(p_employer_id uuid, check_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from employer_members
    where employer_id = p_employer_id and user_id = check_user_id and status = 'active'
  ) or is_platform_admin(check_user_id)
$$;

-- Requiring status = 'active' above breaks a pending invitee's ability to
-- see their OWN pending row -- both employer_members' own select policy and
-- the /actions "Employer invitations" card (listMyPendingEmployerInvites)
-- depend on is_employer_member, which no longer matches a pending row.
-- Mirrors organisation_members' own equivalent fix (0070, "Users can view
-- their own organisation membership rows") exactly: any user can always see
-- their own membership row, whatever its status -- there's nothing private
-- about a person seeing that they themselves are a pending invitee.
create policy "Users can view their own employer_members rows"
  on employer_members for select
  to authenticated
  using (auth.uid() = user_id);

-- organisations' own SELECT policy is intentionally open to any
-- authenticated user ("any authenticated user can view" -- providers are a
-- public directory), which is why the equivalent problem never arose on the
-- org side: listMyPendingOrgInvites' organisations(id, name) join always
-- resolves regardless of membership status. employers is deliberately NOT
-- open like that (private company entities, select scoped to members via
-- is_employer_member) -- so tightening is_employer_member above would
-- otherwise silently break listMyPendingEmployerInvites' own
-- employers(id, name) join for a pending invitee (the employer row itself
-- would no longer resolve, even though their own employer_members row
-- still does via the policy just above). Narrow, explicit fix: let a user
-- see the name of any employer they have ANY employer_members row for
-- (pending or active) -- not employer membership generally, just enough to
-- resolve the employer's own name/id for their invitation card. Platform
-- admins and active members remain covered by the existing
-- is_employer_member-gated "Employer members can view their employer"
-- policy (its is_platform_admin bypass is unaffected by the status
-- tightening above).
create policy "Invitees can view the employer they're invited to"
  on employers for select
  to authenticated
  using (
    exists (
      select 1 from employer_members
      where employer_members.employer_id = employers.id
        and employer_members.user_id = auth.uid()
    )
  );



-- =============================================================================
-- 20260902180000_course_assignments.sql
-- =============================================================================

-- Phase 3 of the employer domain concept (follows 20260902090000/150000/
-- 160000): lets an employer admin push/assign a course to specific
-- employer_members, rather than 100% learner-initiated discovery via the
-- catalogue browse page (courseCatalogue.js's listCatalogueCourses/
-- enrolInCatalogueCourse, both left completely untouched by this phase).
--
-- Deliberately a lighter trust boundary than Phase 2's employer_members
-- invite: assignment doesn't grant the employer any access to the learner's
-- data and doesn't create anything on their profile by itself, so an admin
-- can create a course_assignments row without the learner's prior consent
-- -- that's the whole point of "push". What it must NOT do is silently
-- enrol them: creating the real `courses` row that becomes part of the
-- learner's own record stays an action only the learner takes (clicking
-- "Start" on /actions, via respondToCourseAssignment ->
-- enrolInCatalogueCourse, unchanged). This table only ever tracks the
-- assignment's own lifecycle (assigned/enrolled/dismissed); it is never the
-- thing that shows up on a learner's profile.
create table course_assignments (
  id uuid primary key default gen_random_uuid(),
  employer_id uuid not null references employers(id) on delete cascade,
  catalogue_course_id uuid not null references course_catalogue(id) on delete cascade,
  assigned_to uuid not null references auth.users(id),
  assigned_by uuid not null references auth.users(id),
  status text not null default 'assigned' check (status in ('assigned', 'enrolled', 'dismissed')),
  created_at timestamptz not null default now(),
  unique (employer_id, catalogue_course_id, assigned_to)
);

create index course_assignments_assigned_to_idx on course_assignments (assigned_to);
create index course_assignments_employer_idx on course_assignments (employer_id);

alter table course_assignments enable row level security;

-- A learner sees their own assignments (whatever their status); an employer
-- admin sees every assignment they've made, for a roster/status view of
-- who's started/dismissed/still pending across their own employer.
create policy "Learners and employer admins can view course assignments"
  on course_assignments for select
  to authenticated
  using (
    assigned_to = (select auth.uid())
    or is_employer_admin(employer_id, (select auth.uid()))
  );

-- No insert policy -- creation only happens through
-- assign_course_to_employer_members() below (security definer, validates
-- admin status and catalogue eligibility server-side), same reasoning as
-- employers/employer_members having no open insert/creation path either.

-- The learner transitions their own row's status: 'enrolled' once they've
-- actually enrolled via the existing, unchanged enrolInCatalogueCourse flow
-- (respondToCourseAssignment, src/lib/courseCatalogue.js), or 'dismissed' if
-- they don't want it. Low-stakes self-service state on their own row, not a
-- security boundary -- not worth a transition-validity trigger for e.g.
-- dismissed -> assigned.
create policy "Learners can update their own assignment status"
  on course_assignments for update
  to authenticated
  using (assigned_to = (select auth.uid()))
  with check (assigned_to = (select auth.uid()));

-- Lets an admin retract an assignment (assigned the wrong course/person).
create policy "Employer admins can delete course assignments"
  on course_assignments for delete
  to authenticated
  using (is_employer_admin(employer_id, (select auth.uid())));

grant select, update, delete on table course_assignments to authenticated;

-- ----------------------------------------------------------------------------
-- assign_course_to_employer_members -- security definer, mirrors
-- assign_course_to_catalogue's (20260831121500) validated-insert-with-
-- on-conflict shape: check the caller's admin status and the course's
-- eligibility server-side, then do the insert. Grant execute to
-- authenticated (same convention as every other employer RPC) since the
-- internal is_employer_admin check is what actually enforces admin-only.
--
-- Eligibility is deliberately narrower than the platform-wide browse
-- catalogue (listCatalogueCourses): an employer admin may only assign a
-- course that is actually published in a catalogue belonging to their own
-- attached provider org (catalogues.organisation_id =
-- employers.provider_organisation_id) -- their own org's training, not
-- anything platform-wide approved elsewhere.
--
-- The insert/select/on-conflict is one statement doing double duty: it
-- filters p_user_ids down to actual active employer_members of this
-- employer (both roles -- admin or member -- assignable; nothing about
-- being an employer admin excludes you from also being assigned training),
-- and it dedupes against any existing assignment via the unique constraint.
-- returns setof course_assignments so the caller can tell exactly which of
-- the requested users actually got a new row, and report the rest as
-- skipped rather than claiming a uniform success.
create or replace function assign_course_to_employer_members(
  p_employer_id uuid,
  p_catalogue_course_id uuid,
  p_user_ids uuid[]
)
returns setof course_assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
  v_provider_organisation_id uuid;
begin
  if v_caller is null or not is_employer_admin(p_employer_id, v_caller) then
    raise exception 'Not authorized';
  end if;

  select provider_organisation_id into v_provider_organisation_id
  from employers
  where id = p_employer_id;

  if v_provider_organisation_id is null then
    raise exception 'Employer not found';
  end if;

  if not exists (
    select 1
    from course_catalogue_publications pub
    join catalogues c on c.id = pub.catalogue_id
    where pub.course_id = p_catalogue_course_id
      and pub.published_at is not null
      and c.organisation_id = v_provider_organisation_id
  ) then
    raise exception 'This course is not published in your organisation''s own catalogue';
  end if;

  return query
    insert into course_assignments (employer_id, catalogue_course_id, assigned_to, assigned_by)
    select p_employer_id, p_catalogue_course_id, uid.user_id, v_caller
    from unnest(p_user_ids) as uid(user_id)
    where exists (
      select 1 from employer_members
      where employer_id = p_employer_id
        and user_id = uid.user_id
        and status = 'active'
    )
    on conflict (employer_id, catalogue_course_id, assigned_to) do nothing
    returning *;
end;
$$;

revoke all on function assign_course_to_employer_members(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function assign_course_to_employer_members(uuid, uuid, uuid[]) to authenticated;



-- =============================================================================
-- 20260902190000_course_assignment_security_fixes.sql
-- =============================================================================

-- Security-review follow-up on 20260902180000 (course assignment Phase 3).
--
-- 1. HIGH: course_assignments' UPDATE policy ("Learners can update their own
-- assignment status") only pins assigned_to in USING/WITH CHECK -- RLS can't
-- do column-grain checks (same bug class already found and fixed once in
-- this same PR, see 20260902150000_employers_drop_update_policy.sql's own
-- comment), and the table-wide `grant ... update ... to authenticated` let
-- any user holding a legitimate course_assignments row rewrite that row's
-- employer_id, catalogue_course_id, or assigned_by via a direct PostgREST
-- call -- e.g. repointing employer_id to an employer they don't belong to
-- and status to 'enrolled', polluting a different employer's roster with a
-- fake "completed" assignment with no real courses enrolment behind it.
-- Unlike employers' equivalent bug (dropped the policy entirely -- no
-- legitimate self-service update existed there), course_assignments has a
-- real, intended self-service update: the learner flipping their own row's
-- status to 'enrolled'/'dismissed' (respondToCourseAssignment,
-- src/lib/courseCatalogue.js, only ever sends {status}). Postgres enforces
-- column-level UPDATE privileges independently of RLS, and PostgREST
-- respects them, so narrowing the grant to just the one self-service column
-- keeps the real flow working while closing the other three off entirely --
-- no application code change needed.
revoke update on table course_assignments from authenticated;
grant update (status) on table course_assignments to authenticated;

-- 2. MEDIUM: assign_course_to_employer_members' eligibility check only
-- required course_catalogue_publications.published_at is not null plus
-- catalogue-organisation ownership -- missing the course_catalogue.status =
-- 'approved' and is_current_published = true filter every other reader of
-- this data applies (listCatalogueCourses, listPublishedProviderCourses,
-- is_course_published_to_catalogue, etc). deactivate_course_publication
-- only flips those two flags and never clears published_at, so a
-- deactivated/superseded course version stayed "eligible" per this RPC's
-- own check indefinitely, even though the course-picker UI already filters
-- correctly (listEmployerCatalogueCourses -> listPublishedProviderCourses)
-- and so never surfaces one. The RPC is meant to be the actual authority on
-- eligibility per its own comment -- this closes the gap so it actually is,
-- matching listPublishedProviderCourses' filter exactly.
create or replace function assign_course_to_employer_members(
  p_employer_id uuid,
  p_catalogue_course_id uuid,
  p_user_ids uuid[]
)
returns setof course_assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
  v_provider_organisation_id uuid;
begin
  if v_caller is null or not is_employer_admin(p_employer_id, v_caller) then
    raise exception 'Not authorized';
  end if;

  select provider_organisation_id into v_provider_organisation_id
  from employers
  where id = p_employer_id;

  if v_provider_organisation_id is null then
    raise exception 'Employer not found';
  end if;

  if not exists (
    select 1
    from course_catalogue_publications pub
    join catalogues c on c.id = pub.catalogue_id
    join course_catalogue cc on cc.id = pub.course_id
    where pub.course_id = p_catalogue_course_id
      and pub.published_at is not null
      and c.organisation_id = v_provider_organisation_id
      and cc.status = 'approved'
      and cc.is_current_published = true
  ) then
    raise exception 'This course is not published in your organisation''s own catalogue';
  end if;

  return query
    insert into course_assignments (employer_id, catalogue_course_id, assigned_to, assigned_by)
    select p_employer_id, p_catalogue_course_id, uid.user_id, v_caller
    from unnest(p_user_ids) as uid(user_id)
    where exists (
      select 1 from employer_members
      where employer_id = p_employer_id
        and user_id = uid.user_id
        and status = 'active'
    )
    on conflict (employer_id, catalogue_course_id, assigned_to) do nothing
    returning *;
end;
$$;

revoke all on function assign_course_to_employer_members(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function assign_course_to_employer_members(uuid, uuid, uuid[]) to authenticated;



-- =============================================================================
-- 20260902200000_employer_data_access_requests.sql
-- =============================================================================

-- Phase 5 of the employer domain concept: explicit, learner-controlled
-- consent for an employer admin to see a member's skills profile, beyond
-- whatever the employer's own training already exposes automatically via
-- is_course_provider_admin (0105) -- that mechanism is untouched here. This
-- is purely additive: an employer admin can request access to a specific
-- active member's skills profile, the learner explicitly accepts or
-- declines, and an accepted grant can be revoked by the learner at any time.
-- A learner can also proactively share without being asked. Nothing here
-- lets an employer read a learner's skills/assessments without one of these
-- two explicit, learner-controlled acts having happened.
--
-- One row per (employer, learner) relationship -- re-requesting after a
-- decline, or re-sharing after a revoke, resets that same row rather than
-- erroring on the unique constraint or accumulating history rows. This
-- intentionally does NOT preserve a full audit trail of every past
-- request/grant/revoke cycle (unlike skill_validation_requests, which keeps
-- one row per ask) -- only the current relationship state matters for
-- access control, and CLAUDE.md's historical-accuracy principle is about
-- learner development data (skills, proficiency, achievements), not this
-- kind of access-grant bookkeeping.

create table employer_data_access_requests (
  id uuid primary key default gen_random_uuid(),
  employer_id uuid not null references employers(id) on delete cascade,
  learner_id uuid not null references auth.users(id),
  requested_by uuid references auth.users(id),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'revoked')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (employer_id, learner_id)
);

alter table employer_data_access_requests enable row level security;

create index employer_data_access_requests_learner_idx on employer_data_access_requests (learner_id);
create index employer_data_access_requests_employer_idx on employer_data_access_requests (employer_id);

-- No insert/update policy at all -- every write goes through the RPCs below,
-- so eligibility (active membership) and consent-state transitions are
-- always enforced server-side rather than relyable on client-side checks.
create policy "Learners can view their own data access requests"
  on employer_data_access_requests for select
  to authenticated
  using (learner_id = auth.uid());

create policy "Employer admins can view their employer's data access requests"
  on employer_data_access_requests for select
  to authenticated
  using (is_employer_admin(employer_id, auth.uid()));

-- ----------------------------------------------------------------------------
-- Helper -- mirrors is_connected's (0051) style: a plain boolean predicate
-- for RLS policies elsewhere. security definer (unlike is_connected, which
-- is invoker) because this needs to evaluate is_employer_admin for the
-- *checking* user against a row's employer_id regardless of whose RLS
-- context is asking -- the same reasoning is_employer_admin/is_employer_
-- member (20260902090000) already rely on for themselves.
-- ----------------------------------------------------------------------------

create or replace function has_employer_data_access(p_learner_id uuid, p_check_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from employer_data_access_requests r
    where r.learner_id = p_learner_id
      and r.status = 'approved'
      and is_employer_admin(r.employer_id, p_check_user_id)
  )
$$;

grant execute on function has_employer_data_access(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- RPCs -- security definer, mirroring decide_employer_invite's (20260902160000)
-- guard shape: row-lock with `for update`, explicit ownership/role check,
-- explicit status guard, raise a clear exception rather than silently no-op.
-- ----------------------------------------------------------------------------

-- Employer admin requests access to a specific active member's skills
-- profile. Idempotent: a live pending/approved row is returned unchanged
-- rather than reset, so a repeated request doesn't spam-reset an existing
-- pending ask or silently downgrade an existing approval back to pending.
create or replace function request_employer_data_access(p_employer_id uuid, p_learner_id uuid)
returns employer_data_access_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row employer_data_access_requests%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not is_employer_admin(p_employer_id, auth.uid()) then
    raise exception 'Not authorized';
  end if;
  if not exists (
    select 1 from employer_members
    where employer_id = p_employer_id and user_id = p_learner_id and status = 'active'
  ) then
    raise exception 'This person is not an active member of this employer.';
  end if;

  select * into v_row
  from employer_data_access_requests
  where employer_id = p_employer_id and learner_id = p_learner_id
  for update;

  if not found then
    insert into employer_data_access_requests (employer_id, learner_id, requested_by, status)
    values (p_employer_id, p_learner_id, auth.uid(), 'pending')
    returning * into v_row;
  elsif v_row.status in ('declined', 'revoked') then
    update employer_data_access_requests
    set status = 'pending', requested_by = auth.uid(), decided_at = null
    where id = v_row.id
    returning * into v_row;
  end if;
  -- status already 'pending' or 'approved': return the existing row as-is.

  return v_row;
end;
$$;

grant execute on function request_employer_data_access(uuid, uuid) to authenticated;

-- Learner accepts or declines a pending request.
create or replace function decide_employer_data_access_request(p_request_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row employer_data_access_requests%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_row from employer_data_access_requests where id = p_request_id for update;
  if not found then
    raise exception 'Request not found';
  end if;
  if v_row.learner_id != auth.uid() then
    raise exception 'Not authorized';
  end if;
  if v_row.status != 'pending' then
    raise exception 'This request has already been decided.';
  end if;

  update employer_data_access_requests
  set status = case when p_accept then 'approved' else 'declined' end,
      decided_at = now()
  where id = p_request_id;
end;
$$;

grant execute on function decide_employer_data_access_request(uuid, boolean) to authenticated;

-- Learner-initiated proactive share -- no request needed. Caller must
-- actually be an active member of the employer they're sharing with.
create or replace function share_data_with_employer(p_employer_id uuid)
returns employer_data_access_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row employer_data_access_requests%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not exists (
    select 1 from employer_members
    where employer_id = p_employer_id and user_id = auth.uid() and status = 'active'
  ) then
    raise exception 'You are not an active member of this employer.';
  end if;

  insert into employer_data_access_requests (employer_id, learner_id, requested_by, status, decided_at)
  values (p_employer_id, auth.uid(), null, 'approved', now())
  on conflict (employer_id, learner_id) do update
    set status = 'approved', requested_by = null, decided_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function share_data_with_employer(uuid) to authenticated;

-- Learner revokes a live grant, whether it came from an accepted request or
-- a proactive share.
create or replace function revoke_employer_data_access(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row employer_data_access_requests%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_row from employer_data_access_requests where id = p_request_id for update;
  if not found then
    raise exception 'Request not found';
  end if;
  if v_row.learner_id != auth.uid() then
    raise exception 'Not authorized';
  end if;
  if v_row.status != 'approved' then
    raise exception 'This access grant is not currently active.';
  end if;

  update employer_data_access_requests
  set status = 'revoked', decided_at = now()
  where id = p_request_id;
end;
$$;

grant execute on function revoke_employer_data_access(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- New additive RLS policies -- layer on top of each table's existing
-- owner-only policy, mirroring exactly how "Connections can view visible
-- skills profiles" (0051) layers on top of skills' own
-- "Users manage their own skills" policy. Scope is deliberately just these
-- two tables (a learner's skills + the assessments/evidence behind them)
-- for this phase.
-- ----------------------------------------------------------------------------

create policy "Employers with granted access can view skills"
  on skills for select
  using (has_employer_data_access(skills.user_id, auth.uid()));

create policy "Employers with granted access can view skill assessments"
  on skill_assessments for select
  using (has_employer_data_access(skill_assessments.user_id, auth.uid()));



-- =============================================================================
-- 20260902210000_fix_has_employer_data_access_membership.sql
-- =============================================================================

-- Security fix found by review of Phase 5 (employer_data_access_requests,
-- 20260902200000): has_employer_data_access only checked that the request
-- row was 'approved' and that the checking user was an active admin of that
-- employer -- it never re-verified the LEARNER was still an active member of
-- that employer. removeEmployerMember (src/lib/admin/employers.js) just
-- deletes the employer_members row; it doesn't touch
-- employer_data_access_requests. So a learner who shared/approved access
-- and later left (or was removed from) the employer kept being visible to
-- that employer's admins indefinitely, until they manually revoked from
-- Profile Privacy themselves -- a residual-access gap against CLAUDE.md's
-- learner-ownership/privacy-by-design principle.
--
-- Same fix shape as 20260902170000's tightening of is_employer_admin/
-- is_employer_member: add the missing membership-status check to the one
-- function everything else already depends on, rather than trying to hunt
-- down and patch every place that removes an employer_members row.
-- is_employer_member (20260902090000, hardened in 20260902170000) already
-- requires status = 'active', so this one-line addition is sufficient.

create or replace function has_employer_data_access(p_learner_id uuid, p_check_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from employer_data_access_requests r
    where r.learner_id = p_learner_id
      and r.status = 'approved'
      and is_employer_admin(r.employer_id, p_check_user_id)
      and is_employer_member(r.employer_id, r.learner_id)
  )
$$;



-- =============================================================================
-- 20260902220000_employer_data_access_shared_skills.sql
-- =============================================================================

-- Refines Phase 5 (employer_data_access_requests, 20260902200000/210000) from
-- an all-or-nothing grant to per-skill sharing. Previously, once a request
-- reached 'approved', has_employer_data_access made the learner's ENTIRE
-- skills/skill_assessments visible to that employer's admins. This migration
-- adds an explicit join table of which skills the learner actually chose to
-- share, and re-points the two additive SELECT policies at a per-skill check
-- instead. request_employer_data_access is untouched -- skill selection now
-- happens at accept/share time (decide_employer_data_access_request,
-- share_data_with_employer) or any time after via the new
-- update_shared_employer_skills, not at request time.

-- ----------------------------------------------------------------------------
-- employer_data_access_shared_skills -- one row per skill actually shared
-- under a given employer_data_access_requests row. Select-only RLS: every
-- write goes through the security definer RPCs below, mirroring
-- employer_data_access_requests' own "no insert/update policy at all" shape.
-- ----------------------------------------------------------------------------

create table employer_data_access_shared_skills (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references employer_data_access_requests(id) on delete cascade,
  skill_id uuid not null references skills(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (request_id, skill_id)
);

alter table employer_data_access_shared_skills enable row level security;

create index employer_data_access_shared_skills_request_idx on employer_data_access_shared_skills (request_id);
create index employer_data_access_shared_skills_skill_idx on employer_data_access_shared_skills (skill_id);

create policy "Parties to a data access request can view its shared skills"
  on employer_data_access_shared_skills for select
  to authenticated
  using (
    exists (
      select 1 from employer_data_access_requests r
      where r.id = request_id and r.learner_id = auth.uid()
    )
    or exists (
      select 1 from employer_data_access_requests r
      where r.id = request_id and is_employer_admin(r.employer_id, auth.uid())
    )
  );

-- ----------------------------------------------------------------------------
-- Helper -- replaces has_employer_data_access as the predicate the skills/
-- skill_assessments RLS policies rely on. Preserves the exact fix from
-- 20260902210000 (the is_employer_member re-check) so a shared skill stops
-- being visible the moment the learner leaves/is removed from the employer,
-- not just when they revoke.
-- ----------------------------------------------------------------------------

create or replace function is_skill_shared_with_employer(p_skill_id uuid, p_check_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from employer_data_access_shared_skills eas
    join employer_data_access_requests r on r.id = eas.request_id
    where eas.skill_id = p_skill_id
      and r.status = 'approved'
      and is_employer_admin(r.employer_id, p_check_user_id)
      and is_employer_member(r.employer_id, r.learner_id)
  )
$$;

grant execute on function is_skill_shared_with_employer(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Internal helper, not granted to authenticated -- called only from the
-- security definer RPCs below, which already establish p_request_id belongs
-- to the caller before delegating here. Validates every id in p_skill_ids
-- actually belongs to a skills row owned by the caller (defense in depth --
-- the UI never constructs a call with someone else's skill id, but the RPCs
-- shouldn't trust that), then replaces the request's shared-skill set
-- wholesale. `distinct` guards against a duplicate id in the input array
-- tripping the (request_id, skill_id) unique constraint.
-- ----------------------------------------------------------------------------

create or replace function set_employer_data_access_shared_skills(p_request_id uuid, p_skill_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from unnest(p_skill_ids) as sid
    where not exists (select 1 from skills where id = sid and user_id = auth.uid())
  ) then
    raise exception 'One or more selected skills do not belong to you.';
  end if;

  delete from employer_data_access_shared_skills where request_id = p_request_id;

  insert into employer_data_access_shared_skills (request_id, skill_id)
  select distinct p_request_id, sid from unnest(p_skill_ids) as sid;
end;
$$;

-- ----------------------------------------------------------------------------
-- decide_employer_data_access_request -- adds p_skill_ids (defaulted, so
-- existing callers passing just 2 args would fail to resolve now that the
-- signature has changed identity; drop the old 2-arg overload explicitly
-- rather than leaving a dangling stale signature behind).
-- ----------------------------------------------------------------------------

drop function if exists decide_employer_data_access_request(uuid, boolean);

create or replace function decide_employer_data_access_request(
  p_request_id uuid,
  p_accept boolean,
  p_skill_ids uuid[] default array[]::uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row employer_data_access_requests%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_row from employer_data_access_requests where id = p_request_id for update;
  if not found then
    raise exception 'Request not found';
  end if;
  if v_row.learner_id != auth.uid() then
    raise exception 'Not authorized';
  end if;
  if v_row.status != 'pending' then
    raise exception 'This request has already been decided.';
  end if;

  update employer_data_access_requests
  set status = case when p_accept then 'approved' else 'declined' end,
      decided_at = now()
  where id = p_request_id;

  -- Decline needs no skill-set change -- there shouldn't be any yet.
  if p_accept then
    perform set_employer_data_access_shared_skills(p_request_id, p_skill_ids);
  end if;
end;
$$;

grant execute on function decide_employer_data_access_request(uuid, boolean, uuid[]) to authenticated;

-- ----------------------------------------------------------------------------
-- share_data_with_employer -- same shape change as above.
-- ----------------------------------------------------------------------------

drop function if exists share_data_with_employer(uuid);

create or replace function share_data_with_employer(p_employer_id uuid, p_skill_ids uuid[] default array[]::uuid[])
returns employer_data_access_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row employer_data_access_requests%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not exists (
    select 1 from employer_members
    where employer_id = p_employer_id and user_id = auth.uid() and status = 'active'
  ) then
    raise exception 'You are not an active member of this employer.';
  end if;

  insert into employer_data_access_requests (employer_id, learner_id, requested_by, status, decided_at)
  values (p_employer_id, auth.uid(), null, 'approved', now())
  on conflict (employer_id, learner_id) do update
    set status = 'approved', requested_by = null, decided_at = now()
  returning * into v_row;

  perform set_employer_data_access_shared_skills(v_row.id, p_skill_ids);

  return v_row;
end;
$$;

grant execute on function share_data_with_employer(uuid, uuid[]) to authenticated;

-- ----------------------------------------------------------------------------
-- New: update_shared_employer_skills -- lets a learner change their mind
-- about which skills are shared with an already-approved employer, without
-- having to revoke and re-share from scratch. Only edits a live grant.
-- ----------------------------------------------------------------------------

create or replace function update_shared_employer_skills(p_request_id uuid, p_skill_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row employer_data_access_requests%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_row from employer_data_access_requests where id = p_request_id for update;
  if not found then
    raise exception 'Request not found';
  end if;
  if v_row.learner_id != auth.uid() then
    raise exception 'Not authorized';
  end if;
  if v_row.status != 'approved' then
    raise exception 'This access grant is not currently active.';
  end if;

  perform set_employer_data_access_shared_skills(p_request_id, p_skill_ids);
end;
$$;

grant execute on function update_shared_employer_skills(uuid, uuid[]) to authenticated;

-- ----------------------------------------------------------------------------
-- revoke_employer_data_access -- same signature, now also clears the shared-
-- skill set so a future share_data_with_employer/accept for the same
-- (employer, learner) pair starts clean rather than silently reactivating
-- stale selections.
-- ----------------------------------------------------------------------------

create or replace function revoke_employer_data_access(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row employer_data_access_requests%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_row from employer_data_access_requests where id = p_request_id for update;
  if not found then
    raise exception 'Request not found';
  end if;
  if v_row.learner_id != auth.uid() then
    raise exception 'Not authorized';
  end if;
  if v_row.status != 'approved' then
    raise exception 'This access grant is not currently active.';
  end if;

  update employer_data_access_requests
  set status = 'revoked', decided_at = now()
  where id = p_request_id;

  delete from employer_data_access_shared_skills where request_id = p_request_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Re-point the two additive RLS policies (20260902200000) at the new
-- per-skill predicate, then drop has_employer_data_access -- nothing else
-- references it (confirmed by grep across supabase/migrations).
-- ----------------------------------------------------------------------------

drop policy "Employers with granted access can view skills" on skills;
drop policy "Employers with granted access can view skill assessments" on skill_assessments;

create policy "Employers with granted access can view skills"
  on skills for select
  using (is_skill_shared_with_employer(skills.id, auth.uid()));

create policy "Employers with granted access can view skill assessments"
  on skill_assessments for select
  using (is_skill_shared_with_employer(skill_assessments.skill_id, auth.uid()));

drop function if exists has_employer_data_access(uuid, uuid);



-- =============================================================================
-- 20260902230000_employer_skill_suggestions.sql
-- =============================================================================

-- Phase 4 of the employer domain concept (follows 20260902090000/150000/
-- 160000/170000, and Phase 3's 20260902180000/190000 course_assignments):
-- lets an employer admin push/suggest a skill (with an optional target
-- level/date) to specific employer_members, mirroring course assignment's
-- "push, don't force" shape exactly.
--
-- Same trust boundary as course_assignments: suggesting doesn't grant the
-- employer any access to the learner's data and doesn't touch their actual
-- record by itself, so an admin can create a suggestion without the
-- learner's prior consent -- that's the point of "push". What it must NOT
-- do is silently create or modify the learner's own skills/skill_targets
-- rows -- that stays an action only the learner takes (clicking "Add to my
-- skills" on /actions, via adoptSkillSuggestion ->
-- findOrCreatePersonalSkill, the same unmodified function every other
-- learner-initiated skill-add path already uses -- and a skill_targets
-- insert shaped exactly like SetTargetModal's own, editable before saving,
-- not a silent copy of the employer's suggested values). This table only
-- ever tracks the suggestion's own lifecycle (suggested/adopted/dismissed);
-- it is never itself the thing that shows up on a learner's skills profile.
create table employer_skill_suggestions (
  id uuid primary key default gen_random_uuid(),
  employer_id uuid not null references employers(id) on delete cascade,
  learner_id uuid not null references auth.users(id),
  skill_library_id uuid not null references skill_library(id),
  -- Denormalized copy of the library skill's name at suggestion time, so
  -- adoptSkillSuggestion can call findOrCreatePersonalSkill(userId,
  -- skill_name) directly without an extra join/lookup -- the same shape
  -- findOrCreatePersonalSkill already expects (name-based resolve-or-
  -- create), and consistent with course_assignments denormalizing nothing
  -- further than a foreign key only because course_catalogue rows aren't
  -- looked up by name anywhere.
  skill_name text not null,
  suggested_target_level int check (suggested_target_level between 1 and 5),
  target_date date,
  comments text,
  assigned_by uuid references auth.users(id),
  status text not null default 'suggested' check (status in ('suggested', 'adopted', 'dismissed')),
  created_at timestamptz not null default now(),
  unique (employer_id, learner_id, skill_library_id)
);

create index employer_skill_suggestions_learner_idx on employer_skill_suggestions (learner_id);
create index employer_skill_suggestions_employer_idx on employer_skill_suggestions (employer_id);

alter table employer_skill_suggestions enable row level security;

-- A learner sees their own suggestions (whatever their status); an employer
-- admin sees every suggestion they've made, for a roster/status view --
-- mirrors course_assignments' select policy exactly.
create policy "Learners and employer admins can view skill suggestions"
  on employer_skill_suggestions for select
  to authenticated
  using (
    learner_id = (select auth.uid())
    or is_employer_admin(employer_id, (select auth.uid()))
  );

-- No insert policy -- creation only happens through
-- suggest_skill_to_employer_members() below (security definer, validates
-- admin status server-side), same reasoning as course_assignments having
-- none either.

-- The learner transitions their own row's status: 'adopted' once they've
-- actually added the skill via the existing, unchanged
-- findOrCreatePersonalSkill flow (adoptSkillSuggestion,
-- src/lib/skillSuggestions.js), or 'dismissed' if they don't want it.
--
-- RLS alone can't restrict this to just the status column -- USING/WITH
-- CHECK only gate which rows are touched, not which columns change within
-- them. That exact bug class (an unrestricted `grant update` on a table
-- with a legitimate self-service column update, letting a learner rewrite
-- the row's other columns via direct PostgREST) was already found and
-- fixed twice in this domain: once on employers
-- (20260902150000_employers_drop_update_policy.sql, which had no
-- legitimate self-service update at all so the fix was to drop the policy
-- entirely) and once on course_assignments itself
-- (20260902190000_course_assignment_security_fixes.sql, which -- like this
-- table -- has a real self-service status flip, so the fix was narrowing
-- the grant to just that column). Applying that column-grain grant here
-- from the start rather than reintroducing the bug a third time.
create policy "Learners can update their own suggestion status"
  on employer_skill_suggestions for update
  to authenticated
  using (learner_id = (select auth.uid()))
  with check (learner_id = (select auth.uid()));

-- Lets an admin retract a suggestion (wrong skill/person).
create policy "Employer admins can delete skill suggestions"
  on employer_skill_suggestions for delete
  to authenticated
  using (is_employer_admin(employer_id, (select auth.uid())));

grant select, delete on table employer_skill_suggestions to authenticated;
-- Column-grain: only the learner-facing status transition is allowed via
-- direct table grant; employer_id/learner_id/skill_library_id/skill_name/
-- suggested_target_level/target_date/comments/assigned_by all stay
-- unwritable by a direct PostgREST update, no matter what the RLS USING/
-- WITH CHECK clause above would otherwise allow through.
grant update (status) on table employer_skill_suggestions to authenticated;

-- ----------------------------------------------------------------------------
-- suggest_skill_to_employer_members -- security definer, mirrors
-- assign_course_to_employer_members's (20260902180000) validated-insert-
-- with-on-conflict shape: check the caller's admin status server-side, then
-- do the insert. Grant execute to authenticated (same convention as every
-- other employer RPC) since the internal is_employer_admin check is what
-- actually enforces admin-only.
--
-- The insert/select/on-conflict is one statement doing double duty: it
-- filters p_user_ids down to actual active employer_members of this
-- employer (same shape as the course-assignment RPC -- both roles
-- assignable), and it dedupes against any existing suggestion via the
-- unique constraint. On conflict, only resets a previously-'dismissed'
-- row back to a fresh 'suggested' one (re-suggesting after a dismiss);
-- an already-'suggested' or already-'adopted' row is left completely
-- untouched -- don't silently reset something the learner already adopted,
-- and don't spam-reset an already-pending ask. Returns setof
-- employer_skill_suggestions so the caller can tell exactly which of the
-- requested users actually got a new/reset row, and report the rest as
-- skipped rather than claiming a uniform success (note: unlike the course-
-- assignment RPC's plain "do nothing", an already-'suggested' target here
-- still returns no row from `returning *` since the update is filtered out
-- by the `where` clause, so it's correctly reported as skipped too).
-- ----------------------------------------------------------------------------
create or replace function suggest_skill_to_employer_members(
  p_employer_id uuid,
  p_skill_library_id uuid,
  p_skill_name text,
  p_user_ids uuid[],
  p_target_level int default null,
  p_target_date date default null,
  p_comments text default null
)
returns setof employer_skill_suggestions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
begin
  if v_caller is null or not is_employer_admin(p_employer_id, v_caller) then
    raise exception 'Not authorized';
  end if;

  if p_target_level is not null and (p_target_level < 1 or p_target_level > 5) then
    raise exception 'Target level must be between 1 and 5';
  end if;

  return query
    insert into employer_skill_suggestions
      (employer_id, learner_id, skill_library_id, skill_name, suggested_target_level, target_date, comments, assigned_by)
    select p_employer_id, uid.user_id, p_skill_library_id, p_skill_name, p_target_level, p_target_date, p_comments, v_caller
    from unnest(p_user_ids) as uid(user_id)
    where exists (
      select 1 from employer_members
      where employer_id = p_employer_id
        and user_id = uid.user_id
        and status = 'active'
    )
    on conflict (employer_id, learner_id, skill_library_id) do update
      set status = 'suggested',
          suggested_target_level = excluded.suggested_target_level,
          target_date = excluded.target_date,
          comments = excluded.comments,
          assigned_by = excluded.assigned_by,
          created_at = now()
      where employer_skill_suggestions.status = 'dismissed'
    returning *;
end;
$$;

revoke all on function suggest_skill_to_employer_members(uuid, uuid, text, uuid[], int, date, text) from public, anon, authenticated;
grant execute on function suggest_skill_to_employer_members(uuid, uuid, text, uuid[], int, date, text) to authenticated;



-- =============================================================================
-- 20260902240000_critical_employer_grant_fixes.sql
-- =============================================================================

-- CRITICAL security fixes, found by independent security review of
-- 20260902220000 (per-skill employer data sharing) and 20260902230000
-- (employer skill suggestions), both already live on Staging before this
-- fix. Two real, exploitable gaps -- Supabase auto-grants ALL on every new
-- table/function to anon/authenticated by default, and both migrations
-- assumed (in comments, incorrectly) that omitting an explicit grant meant
-- no access existed. It doesn't; an explicit revoke is required.

-- ----------------------------------------------------------------------------
-- 1. set_employer_data_access_shared_skills was directly callable by ANYONE,
-- including unauthenticated (anon) callers, with no auth check and no
-- ownership check on p_request_id -- only p_skill_ids' ownership was
-- validated, which trivially passes for an empty array. Any caller could
-- pass any learner's employer_data_access_requests.id and silently wipe
-- their shared-skill set. Fixed with both a revoke (the actual fix -- this
-- function is only ever meant to be called internally by the security
-- definer RPCs below it, which already establish ownership) and, as
-- defense in depth, explicit auth/ownership checks inside the function
-- itself rather than trusting callers alone.
-- ----------------------------------------------------------------------------

create or replace function set_employer_data_access_shared_skills(p_request_id uuid, p_skill_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from employer_data_access_requests
    where id = p_request_id and learner_id = auth.uid()
  ) then
    raise exception 'Not authorized';
  end if;

  if exists (
    select 1 from unnest(p_skill_ids) as sid
    where not exists (select 1 from skills where id = sid and user_id = auth.uid())
  ) then
    raise exception 'One or more selected skills do not belong to you.';
  end if;

  delete from employer_data_access_shared_skills where request_id = p_request_id;

  insert into employer_data_access_shared_skills (request_id, skill_id)
  select distinct p_request_id, sid from unnest(p_skill_ids) as sid;
end;
$$;

revoke all on function set_employer_data_access_shared_skills(uuid, uuid[]) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. employer_skill_suggestions' column-grain `grant update (status)` never
-- actually narrowed anything -- the table's default GRANT ALL to
-- authenticated (applied automatically on creation) was never revoked, so
-- a learner could rewrite any column on their own row (employer_id,
-- skill_library_id, suggested_target_level, target_date, comments,
-- assigned_by), not just status. Mirrors the exact fix already applied to
-- course_assignments in 20260902190000 -- revoke the blanket grant first.
-- ----------------------------------------------------------------------------

revoke update on table employer_skill_suggestions from authenticated;
grant update (status) on table employer_skill_suggestions to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Defense-in-depth: the remaining employer-data-access RPCs each have
-- correct internal auth.uid()/ownership checks (so this isn't currently
-- exploitable, unlike #1 above), but were left reachable by anon due to the
-- same missing-revoke root cause. Close them off explicitly, consistent
-- with suggest_skill_to_employer_members's own pattern in the same batch
-- of work.
-- ----------------------------------------------------------------------------

revoke all on function decide_employer_data_access_request(uuid, boolean, uuid[]) from public, anon, authenticated;
grant execute on function decide_employer_data_access_request(uuid, boolean, uuid[]) to authenticated;

revoke all on function share_data_with_employer(uuid, uuid[]) from public, anon, authenticated;
grant execute on function share_data_with_employer(uuid, uuid[]) to authenticated;

revoke all on function update_shared_employer_skills(uuid, uuid[]) from public, anon, authenticated;
grant execute on function update_shared_employer_skills(uuid, uuid[]) to authenticated;

revoke all on function revoke_employer_data_access(uuid) from public, anon, authenticated;
grant execute on function revoke_employer_data_access(uuid) to authenticated;

revoke all on function is_skill_shared_with_employer(uuid, uuid) from public, anon, authenticated;
grant execute on function is_skill_shared_with_employer(uuid, uuid) to authenticated;



-- =============================================================================
-- 20260902250000_tag_codes.sql
-- =============================================================================

-- Tags never got the admin-facing reference code every other shared
-- object has (ORG-00001/SKL-00001/CRS-00001/USR-00001/RES-00001/
-- EMP-00001, all via 0113_unique_reference_codes.sql and its later
-- extensions) -- AdminTags.jsx's "ID" column falls back to a raw UUID
-- slice instead. Mirrors 0113's set_organisation_code shape exactly:
-- one new sequence, a generate_*_code() function, a before-insert
-- trigger that only sets it if null, and a one-time backfill.

create sequence tag_code_seq;

create or replace function generate_tag_code()
returns text
language sql
as $$
  select 'TAG-' || lpad(nextval('tag_code_seq')::text, 5, '0')
$$;

alter table tags add column tag_code text;

create or replace function set_tag_code()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.tag_code is null then
    new.tag_code := generate_tag_code();
  end if;
  return new;
end;
$$;

create trigger set_tag_code_trigger
  before insert on tags
  for each row execute procedure set_tag_code();

update tags set tag_code = generate_tag_code() where tag_code is null;

alter table tags alter column tag_code set not null;

create unique index tags_tag_code_unique_idx on tags (tag_code);



-- =============================================================================
-- 20260902260000_course_catalogue_price.sql
-- =============================================================================

-- Informational course pricing (0113): a provider admin can record what a
-- course costs so it can be displayed to learners browsing the catalogue.
-- This is purely informational -- LearnScope has no payment/checkout
-- mechanism anywhere today and this doesn't add one. price_amount null
-- means "not specified"; 0 means free; anything higher is an actual price.
-- price_currency is only meaningful once price_amount is set. Deliberately
-- a free 3-letter ISO 4217-shaped code rather than a fixed-list check
-- constraint -- actual payment processing (and any currency validation it
-- would need) is a future concern, not this one.
alter table course_catalogue add column price_amount numeric(10,2);
alter table course_catalogue add column price_currency text;

-- Keep create_course_draft_version (0107, last redefined 0108) in sync so a
-- new draft version carries its price forward instead of silently resetting
-- it to null, matching how duration/synopsis already carry forward.
create or replace function create_course_draft_version(p_course_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source course_catalogue%rowtype;
  v_existing_id uuid;
  v_new_id uuid := gen_random_uuid();
  v_new_version integer;
  v_section record;
  v_new_section_id uuid;
begin
  select * into v_source
  from course_catalogue
  where id = p_course_id and status = 'approved';

  if not found then
    raise exception 'Only an approved course can be versioned';
  end if;

  if not (
    is_platform_admin((select auth.uid()))
    or (
      v_source.organisation_id is not null
      and is_org_member(v_source.organisation_id, (select auth.uid()))
    )
  ) then
    raise exception 'Not authorized';
  end if;

  select id into v_existing_id
  from course_catalogue
  where version_group_id = v_source.version_group_id
    and status in ('draft', 'pending_approval', 'rejected')
  order by version_number desc
  limit 1;

  if v_existing_id is not null then
    return v_existing_id;
  end if;

  select coalesce(max(version_number), 0) + 1 into v_new_version
  from course_catalogue
  where version_group_id = v_source.version_group_id;

  insert into course_catalogue (
    id, name, provider, course_type, duration, synopsis, organisation_id,
    status, created_by, image_url, course_code, version_group_id,
    version_number, is_current_published, price_amount, price_currency
  ) values (
    v_new_id, v_source.name, v_source.provider, v_source.course_type,
    v_source.duration, v_source.synopsis, v_source.organisation_id,
    'draft', (select auth.uid()), v_source.image_url, v_source.course_code,
    v_source.version_group_id, v_new_version, false,
    v_source.price_amount, v_source.price_currency
  );

  insert into course_catalogue_skills (course_catalogue_id, skill_library_id, level)
  select v_new_id, skill_library_id, level
  from course_catalogue_skills
  where course_catalogue_id = p_course_id;

  insert into course_catalogue_tags (course_catalogue_id, tag_id)
  select v_new_id, tag_id
  from course_catalogue_tags
  where course_catalogue_id = p_course_id;

  for v_section in
    select id, title, instructions, position
    from course_sections
    where course_id = p_course_id
    order by position, created_at
  loop
    v_new_section_id := gen_random_uuid();
    insert into course_sections (id, course_id, title, instructions, position)
    values (v_new_section_id, v_new_id, v_section.title, v_section.instructions, v_section.position);

    insert into course_content_links (course_id, resource_id, position, section_id)
    select v_new_id, resource_id, position, v_new_section_id
    from course_content_links
    where course_id = p_course_id and section_id = v_section.id;
  end loop;

  insert into course_content_links (course_id, resource_id, position, section_id)
  select v_new_id, resource_id, position, null
  from course_content_links
  where course_id = p_course_id and section_id is null;

  return v_new_id;
end;
$$;

revoke all on function create_course_draft_version(uuid) from public;
grant execute on function create_course_draft_version(uuid) to authenticated;



-- =============================================================================
-- 20260902270000_course_cohorts.sql
-- =============================================================================

-- Cohorts: a specific scheduled run of a course_catalogue entry (e.g. "Jan
-- 2026 intake"), with one or more live sessions of its own. Purely additive
-- to the existing catalogue -- a course with no cohorts behaves exactly as
-- before (enrolInCatalogueCourse, src/lib/courseCatalogue.js, is completely
-- untouched), and a learner enrolling into a cohort still ends up with a
-- normal `courses` row, just with `cohort_id` set so their own record shows
-- which run (and which live sessions) they actually signed up for.
create table course_cohorts (
  id uuid primary key default gen_random_uuid(),
  course_catalogue_id uuid not null references course_catalogue(id) on delete cascade,
  name text not null,
  start_date date,
  -- null = unlimited seats.
  capacity int,
  -- Lets a provider manually stop taking enrolments before it's full (e.g.
  -- past a registration deadline) without having to set capacity at all.
  enrolment_open boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index course_cohorts_course_catalogue_id_idx on course_cohorts (course_catalogue_id);

create table course_cohort_sessions (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references course_cohorts(id) on delete cascade,
  title text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  -- e.g. a meeting URL or a physical location -- free text, deliberately
  -- not modelled further (no separate "format" concept) since a provider
  -- may run one cohort with a mix of the two across its own sessions.
  location_or_link text,
  created_at timestamptz not null default now()
);

create index course_cohort_sessions_cohort_id_idx on course_cohort_sessions (cohort_id);

-- Nullable -- most enrolments (any course with no cohorts, or a cohort-less
-- enrolment into a course that has some) never set this at all.
alter table courses add column cohort_id uuid references course_cohorts(id) on delete set null;
create index courses_cohort_id_idx on courses (cohort_id);

alter table course_cohorts enable row level security;
alter table course_cohort_sessions enable row level security;

-- Same visibility as the parent course_catalogue row itself (0088's current
-- select policy: approved, platform admin, the owning org's own members, or
-- a learner already enrolled in that course) -- a learner needs to see a
-- course's cohorts/sessions to pick one before enrolling, including a
-- course they aren't enrolled in yet, so "already enrolled" is deliberately
-- not the only non-approved branch here (mirrors course_catalogue's own
-- policy, not a narrower one).
create policy "View cohorts for viewable courses"
  on course_cohorts for select
  to authenticated
  using (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_cohorts.course_catalogue_id
        and (
          cc.status = 'approved'
          or is_platform_admin(auth.uid())
          or (cc.organisation_id is not null and is_org_member(cc.organisation_id, auth.uid()))
          or exists (select 1 from courses c where c.catalogue_course_id = cc.id and c.user_id = auth.uid())
        )
    )
  );

create policy "View sessions for viewable cohorts"
  on course_cohort_sessions for select
  to authenticated
  using (
    exists (
      select 1 from course_cohorts cch
      join course_catalogue cc on cc.id = cch.course_catalogue_id
      where cch.id = course_cohort_sessions.cohort_id
        and (
          cc.status = 'approved'
          or is_platform_admin(auth.uid())
          or (cc.organisation_id is not null and is_org_member(cc.organisation_id, auth.uid()))
          or exists (select 1 from courses c where c.catalogue_course_id = cc.id and c.user_id = auth.uid())
        )
    )
  );

-- Manage bar matches course editing's own authorization (ProviderConsole.jsx:
-- "any org member (admin or trainer) can create training into their own
-- organisation_id") -- deliberately NOT course_catalogue's own org-member
-- update policy, which additionally requires status in ('draft','rejected')
-- for editing the course record itself. That restriction exists so a
-- published version's core details can't be silently rewritten -- it
-- doesn't apply here: a cohort is a scheduled run *of* an already-approved,
-- already-published course, so cohort management has to keep working once
-- the course is 'approved', not just while it's still a draft.
create policy "Org members manage cohorts for their own courses"
  on course_cohorts for all
  to authenticated
  using (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_cohorts.course_catalogue_id
        and (
          is_platform_admin(auth.uid())
          or (cc.organisation_id is not null and is_org_member(cc.organisation_id, auth.uid()))
        )
    )
  )
  with check (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_cohorts.course_catalogue_id
        and (
          is_platform_admin(auth.uid())
          or (cc.organisation_id is not null and is_org_member(cc.organisation_id, auth.uid()))
        )
    )
  );

create policy "Org members manage sessions for their own courses' cohorts"
  on course_cohort_sessions for all
  to authenticated
  using (
    exists (
      select 1 from course_cohorts cch
      join course_catalogue cc on cc.id = cch.course_catalogue_id
      where cch.id = course_cohort_sessions.cohort_id
        and (
          is_platform_admin(auth.uid())
          or (cc.organisation_id is not null and is_org_member(cc.organisation_id, auth.uid()))
        )
    )
  )
  with check (
    exists (
      select 1 from course_cohorts cch
      join course_catalogue cc on cc.id = cch.course_catalogue_id
      where cch.id = course_cohort_sessions.cohort_id
        and (
          is_platform_admin(auth.uid())
          or (cc.organisation_id is not null and is_org_member(cc.organisation_id, auth.uid()))
        )
    )
  );

-- Full CRUD table grants, same as 0111's catalogues/course_catalogue_
-- publications -- these are managed by direct RLS-gated statements from the
-- client (not RPC-only), unlike course_assignments' insert-only-via-RPC
-- shape.
grant select, insert, update, delete on table course_cohorts to authenticated;
grant select, insert, update, delete on table course_cohort_sessions to authenticated;

-- ----------------------------------------------------------------------------
-- enrol_in_course_cohort -- capacity-safe enrolment into a specific cohort.
-- security definer so it can lock the cohort row and count existing
-- enrolments atomically, serializing concurrent attempts on the same
-- cohort rather than racing two check-then-insert client calls past a
-- capacity limit. Performs the same insert enrolInCatalogueCourse already
-- does (src/lib/courseCatalogue.js) -- same columns, same optional
-- skill_course_links row -- plus cohort_id, so this is additive to that
-- flow rather than a parallel enrolment mechanism.
create or replace function enrol_in_course_cohort(p_cohort_id uuid, p_skill_id uuid default null)
returns courses
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
  v_cohort course_cohorts%rowtype;
  v_course course_catalogue%rowtype;
  v_existing_count int;
  v_course_row courses%rowtype;
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_cohort from course_cohorts where id = p_cohort_id for update;
  if not found then
    raise exception 'Cohort not found';
  end if;

  if not v_cohort.enrolment_open then
    raise exception 'Enrolment for this cohort is closed';
  end if;

  -- Still holding the row lock above, so a concurrent enrolment on this
  -- same cohort can't slip in between this count and the insert below.
  select count(*) into v_existing_count from courses where cohort_id = p_cohort_id;
  if v_cohort.capacity is not null and v_existing_count >= v_cohort.capacity then
    raise exception 'This cohort is full';
  end if;

  select * into v_course from course_catalogue where id = v_cohort.course_catalogue_id;
  if not found then
    raise exception 'Course not found';
  end if;

  insert into courses (user_id, name, provider, course_type, duration, catalogue_course_id, cohort_id)
  values (v_caller, v_course.name, v_course.provider, v_course.course_type, v_course.duration, v_course.id, v_cohort.id)
  returning * into v_course_row;

  if p_skill_id is not null then
    insert into skill_course_links (user_id, skill_id, course_id, relationship)
    values (v_caller, p_skill_id, v_course_row.id, 'developed');
  end if;

  return v_course_row;
end;
$$;

-- Explicit revoke-then-grant: Supabase auto-grants execute on a new
-- function to public/anon/authenticated by default, which would let an
-- unauthenticated (anon) caller invoke a security-definer function that
-- writes to `courses`. Matches every RPC added this session (e.g.
-- 20260902240000's fixes) -- revoke from all three, then grant execute to
-- authenticated only.
revoke all on function enrol_in_course_cohort(uuid, uuid) from public, anon, authenticated;
grant execute on function enrol_in_course_cohort(uuid, uuid) to authenticated;



-- =============================================================================
-- 20260902280000_course_cohort_seat_counts.sql
-- =============================================================================

-- Seats-remaining needs an aggregate count of `courses` rows per cohort,
-- but courses' own RLS restricts a learner to their own rows only (0003) --
-- a provider org admin already sees every row for their own catalogue
-- course (0105's is_course_provider_admin), but an ordinary learner
-- browsing cohorts to pick one does not, so a plain client-side count
-- would silently undercount capacity for anyone but that admin. This
-- returns only aggregate counts (never individual enrolment rows), which
-- is the same "read past RLS for an operational aggregate, not identity"
-- reasoning enrol_in_course_cohort's own capacity check already relies on.
-- Only counts cohorts the caller is actually allowed to see (same
-- visibility rule as course_cohorts' own select policy, 20260902270000) --
-- being security definer bypasses that RLS policy entirely, so the
-- visibility check has to be re-stated here rather than relied on.
create or replace function get_cohort_seat_counts(p_cohort_ids uuid[])
returns table (cohort_id uuid, enrolled_count bigint)
language sql
security definer
set search_path = public
stable
as $$
  select c.cohort_id, count(*) as enrolled_count
  from courses c
  where c.cohort_id = any (p_cohort_ids)
    and exists (
      select 1 from course_cohorts cch
      join course_catalogue cc on cc.id = cch.course_catalogue_id
      where cch.id = c.cohort_id
        and (
          cc.status = 'approved'
          or is_platform_admin(auth.uid())
          or (cc.organisation_id is not null and is_org_member(cc.organisation_id, auth.uid()))
          or exists (select 1 from courses c2 where c2.catalogue_course_id = cc.id and c2.user_id = auth.uid())
        )
    )
  group by c.cohort_id
$$;

revoke all on function get_cohort_seat_counts(uuid[]) from public, anon, authenticated;
grant execute on function get_cohort_seat_counts(uuid[]) to authenticated;



-- =============================================================================
-- 20260902290000_course_cohort_security_fixes.sql
-- =============================================================================

-- Security review fixes for the cohorts feature (20260902270000,
-- 20260902280000), before it ships. Three issues:
--
-- 1. course_cohorts/course_cohort_sessions' own SELECT policies (and
--    get_cohort_seat_counts' internal re-check) gated their public branch on
--    `cc.status = 'approved'` alone. course_catalogue's own *actual current*
--    select policy (0111, post 20260901100000) additionally requires
--    `is_current_published and is_course_published_to_catalogue(id)` -- a
--    course can be 'approved' with zero catalogues selected, deliberately
--    kept private to its own organisation (20260901100000's own comment:
--    "never distributed anywhere outside its own organisation"). Omitting
--    those two conditions let any authenticated learner platform-wide see
--    cohort names/dates/capacity and full session schedules (including
--    location_or_link, which may hold internal meeting URLs) for courses
--    meant to stay org-private.
--
-- 2. courses.cohort_id was directly writable by any authenticated learner
--    via the existing blanket "Users manage their own courses" policy
--    (0003, `for all using/with check auth.uid() = user_id`, no column
--    restriction) -- a direct API insert/update could set/switch cohort_id
--    on an owned courses row with no capacity/enrolment_open check at all,
--    bypassing enrol_in_course_cohort entirely. RLS can't express "only
--    this function may set this column", so this needs a trigger: reject
--    any attempt to set cohort_id to a new non-null value unless a
--    transaction-local guard (set by enrol_in_course_cohort itself, right
--    after its capacity check passes) is present. A transition *to* null
--    (unenrolling, or course_cohorts' own "on delete set null" cascade) is
--    always allowed -- only claiming a cohort is guarded.
--
-- 3. enrol_in_course_cohort's optional skill_course_links insert is
--    security definer, bypassing that table's own INSERT policy (0018:
--    `exists (select 1 from skills where id = skill_id and user_id =
--    auth.uid())`) -- a caller could pass an arbitrary p_skill_id belonging
--    to a different learner and the insert would succeed (the FK only
--    requires the skill to exist, not be owned by the caller). Restated
--    explicitly since security definer skips the RLS check that would
--    normally catch this.

-- ----------------------------------------------------------------------------
-- Fix 1: SELECT policy visibility, matching course_catalogue's own current
-- select policy exactly (0111).

drop policy "View cohorts for viewable courses" on course_cohorts;
create policy "View cohorts for viewable courses"
  on course_cohorts for select
  to authenticated
  using (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_cohorts.course_catalogue_id
        and (
          (cc.status = 'approved' and cc.is_current_published and is_course_published_to_catalogue(cc.id))
          or is_platform_admin(auth.uid())
          or (cc.organisation_id is not null and is_org_member(cc.organisation_id, auth.uid()))
          or exists (select 1 from courses c where c.catalogue_course_id = cc.id and c.user_id = auth.uid())
        )
    )
  );

drop policy "View sessions for viewable cohorts" on course_cohort_sessions;
create policy "View sessions for viewable cohorts"
  on course_cohort_sessions for select
  to authenticated
  using (
    exists (
      select 1 from course_cohorts cch
      join course_catalogue cc on cc.id = cch.course_catalogue_id
      where cch.id = course_cohort_sessions.cohort_id
        and (
          (cc.status = 'approved' and cc.is_current_published and is_course_published_to_catalogue(cc.id))
          or is_platform_admin(auth.uid())
          or (cc.organisation_id is not null and is_org_member(cc.organisation_id, auth.uid()))
          or exists (select 1 from courses c where c.catalogue_course_id = cc.id and c.user_id = auth.uid())
        )
    )
  );

-- Same fix inside get_cohort_seat_counts' own visibility re-check (it's
-- security definer, bypassing the policies above entirely, so this has to
-- be restated here too).
create or replace function get_cohort_seat_counts(p_cohort_ids uuid[])
returns table (cohort_id uuid, enrolled_count bigint)
language sql
security definer
set search_path = public
stable
as $$
  select c.cohort_id, count(*) as enrolled_count
  from courses c
  where c.cohort_id = any (p_cohort_ids)
    and exists (
      select 1 from course_cohorts cch
      join course_catalogue cc on cc.id = cch.course_catalogue_id
      where cch.id = c.cohort_id
        and (
          (cc.status = 'approved' and cc.is_current_published and is_course_published_to_catalogue(cc.id))
          or is_platform_admin(auth.uid())
          or (cc.organisation_id is not null and is_org_member(cc.organisation_id, auth.uid()))
          or exists (select 1 from courses c2 where c2.catalogue_course_id = cc.id and c2.user_id = auth.uid())
        )
    )
  group by c.cohort_id
$$;

revoke all on function get_cohort_seat_counts(uuid[]) from public, anon, authenticated;
grant execute on function get_cohort_seat_counts(uuid[]) to authenticated;

-- ----------------------------------------------------------------------------
-- Fix 2: cohort_id can only ever become (or change to) a non-null value via
-- a successful enrol_in_course_cohort call. set_config's third arg (true)
-- makes the guard transaction-local -- it resets automatically at the end
-- of the transaction/RPC call, so it can never leak across separate
-- requests (each PostgREST call is its own transaction) and there's no
-- cleanup to forget.
create or replace function guard_courses_cohort_id()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.cohort_id is not null and (tg_op = 'INSERT' or new.cohort_id is distinct from old.cohort_id) then
    if current_setting('app.enrolling_via_rpc', true) is distinct from 'true' then
      raise exception 'cohort_id can only be set by enrolling through enrol_in_course_cohort';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_courses_cohort_id_trigger on courses;
create trigger guard_courses_cohort_id_trigger
  before insert or update on courses
  for each row
  execute function guard_courses_cohort_id();

-- ----------------------------------------------------------------------------
-- Fix 3 (+ sets the Fix 2 guard before its own insert): re-declare
-- enrol_in_course_cohort with the ownership check restated (mirrors the RLS
-- check on skill_course_links this security-definer function otherwise
-- bypasses) and the transaction-local guard set right after the capacity
-- check passes, immediately before the insert it protects.
create or replace function enrol_in_course_cohort(p_cohort_id uuid, p_skill_id uuid default null)
returns courses
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
  v_cohort course_cohorts%rowtype;
  v_course course_catalogue%rowtype;
  v_existing_count int;
  v_course_row courses%rowtype;
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_cohort from course_cohorts where id = p_cohort_id for update;
  if not found then
    raise exception 'Cohort not found';
  end if;

  if not v_cohort.enrolment_open then
    raise exception 'Enrolment for this cohort is closed';
  end if;

  -- Still holding the row lock above, so a concurrent enrolment on this
  -- same cohort can't slip in between this count and the insert below.
  select count(*) into v_existing_count from courses where cohort_id = p_cohort_id;
  if v_cohort.capacity is not null and v_existing_count >= v_cohort.capacity then
    raise exception 'This cohort is full';
  end if;

  select * into v_course from course_catalogue where id = v_cohort.course_catalogue_id;
  if not found then
    raise exception 'Course not found';
  end if;

  if p_skill_id is not null and not exists (
    select 1 from skills where id = p_skill_id and user_id = v_caller
  ) then
    raise exception 'Skill not found or not owned by the caller';
  end if;

  -- Transaction-local: cleared automatically once this call's transaction
  -- ends, so it can never carry over to a later, unrelated request.
  perform set_config('app.enrolling_via_rpc', 'true', true);

  insert into courses (user_id, name, provider, course_type, duration, catalogue_course_id, cohort_id)
  values (v_caller, v_course.name, v_course.provider, v_course.course_type, v_course.duration, v_course.id, v_cohort.id)
  returning * into v_course_row;

  if p_skill_id is not null then
    insert into skill_course_links (user_id, skill_id, course_id, relationship)
    values (v_caller, p_skill_id, v_course_row.id, 'developed');
  end if;

  return v_course_row;
end;
$$;

revoke all on function enrol_in_course_cohort(uuid, uuid) from public, anon, authenticated;
grant execute on function enrol_in_course_cohort(uuid, uuid) to authenticated;



-- =============================================================================
-- 20260902300000_profile_share_links.sql
-- =============================================================================

-- Learner-initiated, short-lived, token-based profile share link -- lets a
-- learner proactively generate a URL (/shared/:token) they can send to
-- anyone, no LearnScope account required to view it. Mirrors the existing
-- public token-access pattern (connection_invites.share_code +
-- get_invite_preview, 0010_connections.sql): a random unique token as the
-- lookup key, and a single narrow, explicit, security definer RPC as the
-- sole gateway that reads across the public/private boundary. Every
-- underlying table stays fully RLS-protected and owner-only; anon never
-- gets table-level access.
--
-- Grant hygiene: this session has already shipped two CRITICAL
-- vulnerabilities (20260902240000) from relying on Supabase's default
-- GRANT ALL to every role on a new function, rather than explicitly
-- revoking first. Every function below does
-- `revoke all ... from public, anon, authenticated` before granting exactly
-- what's intended -- `authenticated` only for the two write RPCs, and
-- `anon, authenticated` for the one deliberately-public read RPC
-- (get_shared_profile), matching get_invite_preview's own grant shape.

-- ----------------------------------------------------------------------------
-- profile_share_links -- one row per share link a learner has created.
-- Select-only RLS (owner-scoped); every write goes through the RPCs below,
-- mirroring employer_data_access_requests' "no insert/update policy at all"
-- shape (20260902200000) exactly. Revocation sets revoked_at rather than
-- deleting the row, so there's no delete policy either.
-- ----------------------------------------------------------------------------

create table profile_share_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  label text,
  share_skills boolean not null default false,
  share_experience boolean not null default false,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

alter table profile_share_links enable row level security;

create index profile_share_links_user_id_idx on profile_share_links (user_id);
create index profile_share_links_token_idx on profile_share_links (token);

create policy "Learners can view their own share links"
  on profile_share_links for select
  to authenticated
  using (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- profile_share_link_skills -- one row per skill actually shared under a
-- given profile_share_links row (only meaningful when share_skills is true).
-- Select-only RLS scoped to the owning learner, mirroring
-- employer_data_access_shared_skills' exact shape (20260902220000). RPC-only
-- writes.
-- ----------------------------------------------------------------------------

create table profile_share_link_skills (
  id uuid primary key default gen_random_uuid(),
  share_link_id uuid not null references profile_share_links(id) on delete cascade,
  skill_id uuid not null references skills(id) on delete cascade,
  unique (share_link_id, skill_id)
);

alter table profile_share_link_skills enable row level security;

create index profile_share_link_skills_link_idx on profile_share_link_skills (share_link_id);
create index profile_share_link_skills_skill_idx on profile_share_link_skills (skill_id);

create policy "Learners can view their own share links' skills"
  on profile_share_link_skills for select
  to authenticated
  using (
    exists (
      select 1 from profile_share_links l
      where l.id = share_link_id and l.user_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- create_profile_share_link -- creates a new share link for the caller.
-- Validates auth, that at least one of share_skills/share_experience is
-- requested, that the expiry is in the future and capped at 90 days (defense
-- in depth server-side, even though the UI only offers short presets, so a
-- manipulated direct call can't mint a years-long-lived link), and -- when
-- sharing skills -- that every requested skill id actually belongs to the
-- caller. Mirrors set_employer_data_access_shared_skills' exact validation
-- shape, including its CRITICAL-bug lesson (20260902240000): that function
-- was directly callable by anyone because its revoke was missing. The
-- revoke below is the actual fix; the in-body auth/ownership checks are
-- defense in depth on top of it, not a substitute for it.
-- ----------------------------------------------------------------------------

create or replace function create_profile_share_link(
  p_share_skills boolean,
  p_share_experience boolean,
  p_skill_ids uuid[],
  p_expires_at timestamptz,
  p_label text default null
)
returns profile_share_links
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row profile_share_links%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not p_share_skills and not p_share_experience then
    raise exception 'Choose at least one thing to share.';
  end if;

  if p_expires_at is null or p_expires_at <= now() then
    raise exception 'Expiry must be in the future.';
  end if;
  if p_expires_at > now() + interval '90 days' then
    raise exception 'Share links can be valid for at most 90 days.';
  end if;

  if p_share_skills and p_skill_ids is not null and array_length(p_skill_ids, 1) > 0 then
    if exists (
      select 1 from unnest(p_skill_ids) as sid
      where not exists (select 1 from skills where id = sid and user_id = auth.uid())
    ) then
      raise exception 'One or more selected skills do not belong to you.';
    end if;
  end if;

  insert into profile_share_links (user_id, label, share_skills, share_experience, expires_at)
  values (auth.uid(), nullif(p_label, ''), p_share_skills, p_share_experience, p_expires_at)
  returning * into v_row;

  if p_share_skills and p_skill_ids is not null and array_length(p_skill_ids, 1) > 0 then
    insert into profile_share_link_skills (share_link_id, skill_id)
    select distinct v_row.id, sid from unnest(p_skill_ids) as sid;
  end if;

  return v_row;
end;
$$;

revoke all on function create_profile_share_link(boolean, boolean, uuid[], timestamptz, text) from public, anon, authenticated;
grant execute on function create_profile_share_link(boolean, boolean, uuid[], timestamptz, text) to authenticated;

-- ----------------------------------------------------------------------------
-- revoke_profile_share_link -- learner revokes a live link at any time.
-- ----------------------------------------------------------------------------

create or replace function revoke_profile_share_link(p_share_link_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row profile_share_links%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_row from profile_share_links where id = p_share_link_id for update;
  if not found or v_row.user_id != auth.uid() then
    raise exception 'Not authorized';
  end if;
  if v_row.revoked_at is not null then
    raise exception 'This link has already been revoked.';
  end if;

  update profile_share_links set revoked_at = now() where id = p_share_link_id;
end;
$$;

revoke all on function revoke_profile_share_link(uuid) from public, anon, authenticated;
grant execute on function revoke_profile_share_link(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- get_shared_profile -- the ONE deliberately-public gateway, mirroring
-- get_invite_preview (0010_connections.sql) exactly: security definer,
-- returns only a narrow, explicit set of fields (never `select *`), granted
-- to anon and authenticated. A link that's missing, revoked, or expired all
-- return the same null -- a recipient (or anyone probing tokens) gets no
-- signal about *why* a given token doesn't work.
--
-- Skills subset matches SkillsProfile.jsx's external-viewer shape (name,
-- level) plus category, per this feature's brief -- not the full skills row
-- (no notes, no tracking_reason, no evidence). Experience fields match
-- TimelineItem.jsx, the learner's own experience list rendering (type/
-- other_type, title, organization, organization_url, dates, description) --
-- deliberately all rows for the owner when share_experience is true, no
-- per-item selection, per product spec.
-- ----------------------------------------------------------------------------

create or replace function get_shared_profile(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link profile_share_links%rowtype;
  v_owner_name text;
  v_result jsonb;
  v_skills jsonb;
  v_experience jsonb;
begin
  select * into v_link from profile_share_links where token = p_token;

  if not found or v_link.revoked_at is not null or v_link.expires_at <= now() then
    return null;
  end if;

  select full_name into v_owner_name from profiles where id = v_link.user_id;

  v_result := jsonb_build_object(
    'owner_name', coalesce(v_owner_name, ''),
    'label', v_link.label,
    'expires_at', v_link.expires_at
  );

  if v_link.share_skills then
    select coalesce(jsonb_agg(
      jsonb_build_object('id', s.id, 'name', s.name, 'level', s.level, 'category', s.category)
      order by s.name
    ), '[]'::jsonb)
    into v_skills
    from profile_share_link_skills pls
    join skills s on s.id = pls.skill_id
    where pls.share_link_id = v_link.id;

    v_result := v_result || jsonb_build_object('skills', v_skills);
  end if;

  if v_link.share_experience then
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', e.id,
        'type', e.type,
        'other_type', e.other_type,
        'title', e.title,
        'organization', e.organization,
        'organization_url', e.organization_url,
        'start_date', e.start_date,
        'end_date', e.end_date,
        'description', e.description
      )
      order by e.start_date desc
    ), '[]'::jsonb)
    into v_experience
    from experience e
    where e.user_id = v_link.user_id;

    v_result := v_result || jsonb_build_object('experience', v_experience);
  end if;

  return v_result;
end;
$$;

revoke all on function get_shared_profile(text) from public, anon, authenticated;
grant execute on function get_shared_profile(text) to anon, authenticated;



-- =============================================================================
-- 20260902310000_employer_linked_providers.sql
-- =============================================================================

-- Employer console "Providers" tab (foundation only): lets an employer admin
-- record additional provider organisations linked to their employer, beyond
-- the one auto-provisioned/attached provider org every employer already gets
-- (employers.provider_organisation_id, create_employer -- 20260902090000).
--
-- Deliberately narrow: this is purely a listing/linking mechanism for now.
-- Linking a provider has NO functional effect elsewhere yet -- it doesn't
-- widen course-assignment eligibility (assign_course_to_employer_members,
-- 20260902180000/190000, is untouched), doesn't grant the linked provider
-- any access to the employer or its members, and needs no consent from the
-- linked provider organisation. organisations is already an openly browsable
-- directory to any authenticated user ("Authenticated users can view
-- organisations", 0065) -- an employer admin linking any existing provider
-- org unilaterally is consistent with that existing openness, not a new
-- exposure. A later phase can build real functionality (and, if ever
-- needed, provider-side consent) on top of this association without
-- changing its shape.
create table employer_linked_providers (
  id uuid primary key default gen_random_uuid(),
  employer_id uuid not null references employers(id) on delete cascade,
  provider_organisation_id uuid not null references organisations(id) on delete cascade,
  linked_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (employer_id, provider_organisation_id)
);

create index employer_linked_providers_employer_idx on employer_linked_providers (employer_id);
create index employer_linked_providers_provider_idx on employer_linked_providers (provider_organisation_id);

alter table employer_linked_providers enable row level security;

-- Any active member of the employer can see which providers it has linked --
-- mirrors employer_skill_suggestions'/course_assignments' own admin-facing
-- roster read, just extended to any active member (not just admins) since
-- this is informational, not a privileged view.
create policy "Employer members can view linked providers"
  on employer_linked_providers for select
  to authenticated
  using (is_employer_member(employer_id, (select auth.uid())));

-- Only an employer admin can link a provider. Any existing organisations row
-- is linkable -- the foreign key alone ensures it's a real provider org;
-- application code additionally filters out the employer's own attached
-- provider_organisation_id and already-linked rows for a sane picker, but
-- that's a UI convenience, not a security boundary (linking the employer's
-- own attached org here would be inert, not unsafe).
create policy "Employer admins can link providers"
  on employer_linked_providers for insert
  to authenticated
  with check (is_employer_admin(employer_id, (select auth.uid())));

-- Only an employer admin can unlink. No update policy -- a link is either
-- present or absent, nothing about an existing row is ever edited in place.
create policy "Employer admins can unlink providers"
  on employer_linked_providers for delete
  to authenticated
  using (is_employer_admin(employer_id, (select auth.uid())));

grant select, insert, delete on table employer_linked_providers to authenticated;



-- =============================================================================
-- 20260903090000_admin_activity_log.sql
-- =============================================================================

-- ----------------------------------------------------------------------------
-- Console overhaul Phase 5 ("Guidance and activity history"): a curated
-- platform-admin activity log. Proposed, reviewed and approved (event
-- boundaries, platform-admin-only visibility for v1, and a 7-year
-- retention policy -- see PR/session history for the full written
-- proposal covering event boundaries, RLS reasoning, personal-data and
-- retention discussion, migration/rollback plan).
--
-- Purely additive: one new table (admin_activity_log), plus a curated set
-- of existing security-definer functions and admin-API handlers each gain
-- one extra `insert` after an already-successful transition or delete
-- (user.deleted in api/admin/actions.js logs only after auth.admin.
-- deleteUser succeeds, precisely so a delete that fails leaves no false
-- entry in a 7-year-retention log; the *_removed trigger functions below
-- fire AFTER DELETE within the same transaction as the row's own removal).
-- No existing table, column, row, or RLS policy is touched. Fully
-- reversible by
-- dropping the functions this migration redefines and re-applying their
-- prior bodies (0112 for the course-catalogue ones; 0112/0065/0066/0111
-- etc. for the others, per git history), then `drop table
-- admin_activity_log;`.
--
-- Full curated action list wired here or in api/admin/actions.js:
--   course.approved / course.rejected / course.deactivated
--   user.blocked / user.unblocked / user.deleted
--   skill.activated / skill.deactivated
--   tag.blacklisted / tag.unblacklisted
--   organisation.activated / organisation.suspended
--   catalogue_approver.added / catalogue_approver.removed
--   employer_member.added / employer_member.removed
--   org_member.removed
-- ----------------------------------------------------------------------------

create table admin_activity_log (
  id uuid primary key default gen_random_uuid(),
  -- SET NULL, not CASCADE: a log entry records that something happened and
  -- who did it -- it must outlive the actor's own account being deleted
  -- later, same reasoning tags.created_by/skill_library.created_by already
  -- use for shared-catalog attribution (0064).
  actor_id uuid references auth.users(id) on delete set null,
  -- Denormalized "who" snapshot captured at write time. Without this,
  -- actor_id going null after an account deletion (or a later name change)
  -- would make an old entry anonymous with no record of who it originally
  -- was -- the same snapshot-before-scrub reasoning as skill_peer_ratings.
  -- rater_name/rater_email (0064's delete_own_account_scrub).
  actor_label text not null,
  -- Dot-namespaced action identifier, e.g. 'course.approved',
  -- 'user.blocked'. Deliberately NOT a check-constrained enum: the curated
  -- set is documented and enforced at the call site (the RPC or admin API
  -- action that performs the underlying change), not the schema, so adding
  -- a new logged action is a normal application change rather than a
  -- migration. See the proposal for the full recommended action list.
  action text not null check (length(trim(action)) > 0),
  -- What kind of record the action targeted, e.g. 'course_catalogue',
  -- 'profile'. No FK on purpose -- this is intentionally polymorphic
  -- (points at a different table depending on entity_type). See the
  -- proposal's RLS section for why a general provider-visible policy over
  -- this polymorphic shape is deferred rather than built now.
  entity_type text not null check (length(trim(entity_type)) > 0),
  entity_id uuid not null,
  -- Denormalized "what" snapshot (e.g. the course name at the moment it was
  -- approved) -- survives the entity later being renamed, reassigned, or
  -- deleted, same reasoning as actor_label above.
  entity_label text,
  -- Free-text detail an admin/approver supplied for the action, e.g. a
  -- rejection reason. Null when the action carries none.
  reason text,
  -- Small structured extras that don't warrant their own column (e.g. a
  -- previous/new value pair). Never intended to hold anything not already
  -- safe to show a platform admin -- see the proposal's personal-data
  -- section.
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index admin_activity_log_created_at_idx on admin_activity_log (created_at desc);
create index admin_activity_log_entity_idx on admin_activity_log (entity_type, entity_id);
create index admin_activity_log_actor_idx on admin_activity_log (actor_id);

comment on table admin_activity_log is
  'Curated log of high-impact platform-admin/provider-moderation actions -- not a general audit trail of every mutation. Written only by security-definer RPCs and the service-role admin API, never directly by client code. Retention: 7 years from created_at (approved product/compliance policy) -- no automated purge job exists yet; enforcing that window is follow-up work once a scheduled-job mechanism exists in this codebase. See migration 20260903090000 for full rationale.';

alter table admin_activity_log enable row level security;

-- Platform-admin-only for this first version. A fully general
-- provider-visible policy (e.g. "a provider admin can see log entries
-- about their own organisation's courses/staff") can't cleanly express
-- "does this entity belong to an org the caller administers" once
-- entity_type/entity_id are polymorphic -- course_catalogue rows resolve
-- an org via organisation_id, profile rows have no org at all, an
-- employer_members row resolves via employers.provider_organisation_id,
-- and so on. Doing that generically inside one RLS policy means either a
-- large per-entity-type CASE/UNION (fragile -- silently wrong for any
-- entity_type the policy autor forgot) or a per-row denormalized org_id
-- column that has to be kept in sync by every writer. Recommendation:
-- ship platform-admin-only now, and revisit a scoped provider-visible
-- policy (most likely a small, explicit per-entity-type mapping, or a
-- denormalized organisation_id column populated only for the entity types
-- that need it) once a specific provider-facing use case justifies the
-- added complexity, rather than generalizing speculatively today.
create policy "Platform admins can view the activity log"
  on admin_activity_log for select
  to authenticated
  using (is_platform_admin(auth.uid()));

-- No insert/update/delete policy for `authenticated` at all -- same
-- convention as employer_data_access_requests (20260902200000) and the
-- catalogue moderation RPCs (0112): every write goes through a
-- security-definer function (whose owner bypasses RLS) or the
-- service-role admin API (which bypasses RLS by design), never a plain
-- client-side insert. Explicit select-only grant below documents that
-- boundary; Supabase's schema-level defaults would otherwise imply
-- broader table privileges than RLS actually allows.
grant select on admin_activity_log to authenticated;

-- Shared denormalized-actor-label lookup, used by every writer below
-- (RPCs and triggers alike) instead of repeating the same join. Security
-- definer for the same reason as is_platform_admin/is_catalogue_approver:
-- callers other than a platform admin have no read access to auth.users
-- or to other people's profiles rows.
create or replace function admin_activity_actor_label(p_user_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(p.full_name, u.email, p_user_id::text)
  from auth.users u
  left join profiles p on p.id = u.id
  where u.id = p_user_id
$$;

-- No grant to authenticated either -- this is purely an internal helper for
-- the security-definer writers below (their own definer privileges are what
-- let them call it, not a grant), never meant to be called directly by any
-- end user. Confirmed live: a signed-in non-admin could otherwise call this
-- RPC themselves and resolve an arbitrary UUID to a name/email -- a narrower
-- version of the same anon-oracle bug this revoke already closes below.
revoke all on function admin_activity_actor_label(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Instrumentation: course approve/reject/deactivate. Reproduces
-- publish_course_version/reject_course_submission's bodies from 0112 and
-- deactivate_course_publication's body from 20260901100000 unchanged,
-- plus one insert each at the end of an already-successful transition
-- (after every authorization/state check, so a rejected attempt never
-- reaches the log).
-- ----------------------------------------------------------------------------

create or replace function publish_course_version(p_course_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_caller uuid := (select auth.uid());
  v_is_admin boolean := is_platform_admin(v_caller);
  v_has_publications boolean;
  v_approved_for_all boolean;
  v_course_name text;
begin
  select version_group_id into v_group_id
  from course_catalogue
  where id = p_course_id
  for update;

  v_has_publications := v_group_id is not null and exists (
    select 1 from course_catalogue_publications where course_id = p_course_id
  );

  v_approved_for_all := v_group_id is not null and not exists (
    select 1
    from course_catalogue_publications ccp
    where ccp.course_id = p_course_id
      and not is_catalogue_approver(ccp.catalogue_id, v_caller)
  );

  if not v_is_admin and (v_group_id is null or not v_has_publications or not v_approved_for_all) then
    raise exception 'Not authorized';
  end if;

  if v_is_admin and v_group_id is null then
    raise exception 'Course not found';
  end if;

  if not v_has_publications then
    raise exception 'Choose at least one publication catalogue';
  end if;

  update course_catalogue
  set status = 'inactive', is_current_published = false
  where version_group_id = v_group_id
    and is_current_published
    and id <> p_course_id;

  update course_catalogue
  set status = 'approved',
      is_current_published = true,
      approved_by = v_caller,
      approved_at = now(),
      rejection_reason = null
  where id = p_course_id
  returning name into v_course_name;

  update course_catalogue_publications
  set published_at = now()
  where course_id = p_course_id;

  insert into admin_activity_log (actor_id, actor_label, action, entity_type, entity_id, entity_label)
  values (v_caller, admin_activity_actor_label(v_caller), 'course.approved', 'course_catalogue', p_course_id, v_course_name);
end;
$$;

revoke all on function publish_course_version(uuid) from public;
grant execute on function publish_course_version(uuid) to authenticated;

create or replace function reject_course_submission(p_course_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
  v_is_admin boolean := is_platform_admin(v_caller);
  v_status text;
  v_found boolean;
  v_has_publications boolean;
  v_approved_for_all boolean;
  v_course_name text;
begin
  select status, name into v_status, v_course_name
  from course_catalogue
  where id = p_course_id
  for update;

  v_found := found;

  v_has_publications := v_found and exists (
    select 1 from course_catalogue_publications where course_id = p_course_id
  );

  v_approved_for_all := v_found and not exists (
    select 1
    from course_catalogue_publications ccp
    where ccp.course_id = p_course_id
      and not is_catalogue_approver(ccp.catalogue_id, v_caller)
  );

  if not v_is_admin and (not v_found or not v_has_publications or not v_approved_for_all) then
    raise exception 'Not authorized';
  end if;

  if not v_found then
    raise exception 'Course not found';
  end if;

  if v_status <> 'pending_approval' then
    raise exception 'Only a pending submission can be rejected';
  end if;

  update course_catalogue
  set status = 'rejected',
      rejection_reason = p_reason,
      approved_by = null,
      approved_at = null,
      is_current_published = false
  where id = p_course_id;

  insert into admin_activity_log (actor_id, actor_label, action, entity_type, entity_id, entity_label, reason)
  values (v_caller, admin_activity_actor_label(v_caller), 'course.rejected', 'course_catalogue', p_course_id, v_course_name, p_reason);
end;
$$;

revoke all on function reject_course_submission(uuid, text) from public;
grant execute on function reject_course_submission(uuid, text) to authenticated;

-- deactivate_course_publication: reproduces 20260901100000's body (the
-- latest -- supersedes 0112's, adding the catalogue-less/org-member path)
-- unchanged, plus one insert at the end.
create or replace function deactivate_course_publication(p_course_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
  v_is_admin boolean := is_platform_admin(v_caller);
  v_status text;
  v_organisation_id uuid;
  v_found boolean;
  v_has_publications boolean;
  v_approved_for_all boolean;
  v_is_org_member boolean;
  v_course_name text;
begin
  select status, organisation_id, name into v_status, v_organisation_id, v_course_name
  from course_catalogue
  where id = p_course_id
  for update;

  v_found := found;

  v_has_publications := v_found and exists (
    select 1 from course_catalogue_publications where course_id = p_course_id
  );

  v_approved_for_all := v_found and not exists (
    select 1
    from course_catalogue_publications ccp
    where ccp.course_id = p_course_id
      and not is_catalogue_approver(ccp.catalogue_id, v_caller)
  );

  v_is_org_member := v_found and v_organisation_id is not null and is_org_member(v_organisation_id, v_caller);

  if not v_is_admin
    and not (v_has_publications and v_approved_for_all)
    and not (not v_has_publications and v_is_org_member)
  then
    raise exception 'Not authorized';
  end if;

  if not v_found then
    raise exception 'Course not found';
  end if;

  if v_status <> 'approved' then
    raise exception 'Only an approved course can be deactivated';
  end if;

  update course_catalogue
  set status = 'inactive', is_current_published = false
  where id = p_course_id;

  insert into admin_activity_log (actor_id, actor_label, action, entity_type, entity_id, entity_label)
  values (v_caller, admin_activity_actor_label(v_caller), 'course.deactivated', 'course_catalogue', p_course_id, v_course_name);
end;
$$;

revoke all on function deactivate_course_publication(uuid) from public;
grant execute on function deactivate_course_publication(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Instrumentation: the remaining curated actions. Each of these is a plain
-- RLS-gated client-side table write (update or delete), not a
-- security-definer RPC, so there's no existing function body to extend --
-- an AFTER trigger is the mechanical equivalent: it fires on every write
-- to the table regardless of call site, the same "can't be silently
-- skipped" property the manual inserts above get from being the very
-- last statement in an already-authorized function. This is the same
-- security-definer-trigger shape 0112's own
-- revoke_catalogue_approver_on_membership_removal_trigger already uses to
-- write a side effect RLS wouldn't otherwise allow the row's own
-- policies to produce.
--
-- Guard: every trigger below skips logging when auth.uid() is null. This
-- matters because several of these tables cascade-delete from auth.users
-- (organisation_members.user_id, catalogue_approvers.user_id both
-- ON DELETE CASCADE) -- when api/admin/actions.js's deleteUser removes an
-- account via the service-role client, those cascades fire with no JWT
-- context, so auth.uid() is null. Without this guard, actor_label's NOT
-- NULL constraint would abort the entire account deletion. A
-- system-cascaded removal isn't a distinct admin decision worth logging
-- on its own anyway -- user.deleted (logged separately, see
-- api/admin/actions.js) already captures that the account is gone.
-- ----------------------------------------------------------------------------

create or replace function log_skill_library_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
begin
  if v_caller is not null and new.status is distinct from old.status then
    insert into admin_activity_log (actor_id, actor_label, action, entity_type, entity_id, entity_label)
    values (
      v_caller,
      admin_activity_actor_label(v_caller),
      case when new.status = 'active' then 'skill.activated' else 'skill.deactivated' end,
      'skill_library',
      new.id,
      new.name
    );
  end if;
  return new;
end;
$$;

-- Not currently reachable by anon/authenticated directly (Postgres refuses
-- to invoke a `returns trigger` function outside trigger context), but
-- revoked anyway for consistency with every other function in this file
-- and as defense-in-depth against that assumption changing.
revoke all on function log_skill_library_activity() from public;

create trigger log_skill_library_activity_trigger
  after update on skill_library
  for each row execute procedure log_skill_library_activity();

create or replace function log_tag_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
begin
  if v_caller is not null and new.is_blacklisted is distinct from old.is_blacklisted then
    insert into admin_activity_log (actor_id, actor_label, action, entity_type, entity_id, entity_label)
    values (
      v_caller,
      admin_activity_actor_label(v_caller),
      case when new.is_blacklisted then 'tag.blacklisted' else 'tag.unblacklisted' end,
      'tag',
      new.id,
      new.name
    );
  end if;
  return new;
end;
$$;

revoke all on function log_tag_activity() from public;

create trigger log_tag_activity_trigger
  after update on tags
  for each row execute procedure log_tag_activity();

create or replace function log_organisation_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
begin
  if v_caller is not null and new.status is distinct from old.status then
    insert into admin_activity_log (actor_id, actor_label, action, entity_type, entity_id, entity_label)
    values (
      v_caller,
      admin_activity_actor_label(v_caller),
      case when new.status = 'active' then 'organisation.activated' else 'organisation.suspended' end,
      'organisation',
      new.id,
      new.name
    );
  end if;
  return new;
end;
$$;

revoke all on function log_organisation_activity() from public;

create trigger log_organisation_activity_trigger
  after update on organisations
  for each row execute procedure log_organisation_activity();

create or replace function log_catalogue_approver_added()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
begin
  if v_caller is not null then
    insert into admin_activity_log (actor_id, actor_label, action, entity_type, entity_id, entity_label, metadata)
    values (
      v_caller,
      admin_activity_actor_label(v_caller),
      'catalogue_approver.added',
      'catalogue_approver',
      new.id,
      admin_activity_actor_label(new.user_id),
      jsonb_build_object('catalogue_id', new.catalogue_id)
    );
  end if;
  return new;
end;
$$;

revoke all on function log_catalogue_approver_added() from public;

create trigger log_catalogue_approver_added_trigger
  after insert on catalogue_approvers
  for each row execute procedure log_catalogue_approver_added();

create or replace function log_catalogue_approver_removed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
begin
  if v_caller is not null then
    insert into admin_activity_log (actor_id, actor_label, action, entity_type, entity_id, entity_label, metadata)
    values (
      v_caller,
      admin_activity_actor_label(v_caller),
      'catalogue_approver.removed',
      'catalogue_approver',
      old.id,
      admin_activity_actor_label(old.user_id),
      jsonb_build_object('catalogue_id', old.catalogue_id)
    );
  end if;
  return old;
end;
$$;

revoke all on function log_catalogue_approver_removed() from public;

create trigger log_catalogue_approver_removed_trigger
  after delete on catalogue_approvers
  for each row execute procedure log_catalogue_approver_removed();

create or replace function log_organisation_member_removed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
begin
  if v_caller is not null then
    insert into admin_activity_log (actor_id, actor_label, action, entity_type, entity_id, entity_label, metadata)
    values (
      v_caller,
      admin_activity_actor_label(v_caller),
      'org_member.removed',
      'organisation_member',
      old.id,
      admin_activity_actor_label(old.user_id),
      jsonb_build_object('organisation_id', old.organisation_id, 'role', old.role)
    );
  end if;
  return old;
end;
$$;

revoke all on function log_organisation_member_removed() from public;

create trigger log_organisation_member_removed_trigger
  after delete on organisation_members
  for each row execute procedure log_organisation_member_removed();

-- employer_member.added is logged from api/admin/actions.js's
-- addEmployerMember instead of a mirroring AFTER INSERT trigger here --
-- that insert runs via the service-role client (no authenticated session,
-- so no auth.uid() for a trigger to attribute it to), but the handler
-- already has the verified caller's id from its own auth check, so
-- logging explicitly there is strictly more accurate than a trigger could
-- be. employer_member.removed (below) goes through the user's own
-- authenticated session (removeOrganisationMember's employer-console
-- equivalent), where auth.uid() is available, so a trigger works there.
create or replace function log_employer_member_removed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
begin
  if v_caller is not null then
    insert into admin_activity_log (actor_id, actor_label, action, entity_type, entity_id, entity_label, metadata)
    values (
      v_caller,
      admin_activity_actor_label(v_caller),
      'employer_member.removed',
      'employer_member',
      old.id,
      admin_activity_actor_label(old.user_id),
      jsonb_build_object('employer_id', old.employer_id, 'role', old.role)
    );
  end if;
  return old;
end;
$$;

revoke all on function log_employer_member_removed() from public;

create trigger log_employer_member_removed_trigger
  after delete on employer_members
  for each row execute procedure log_employer_member_removed();



-- =============================================================================
-- 20260903100000_tighten_admin_activity_log_grants.sql
-- =============================================================================

-- Hygiene follow-up, not a live vulnerability fix: 20260903090000 only ever
-- added `grant select on admin_activity_log to authenticated`, never
-- explicitly revoking Supabase's default GRANT ALL to anon/authenticated
-- that a new table gets automatically. RLS already made this safe in
-- practice -- confirmed live against Staging: an unauthenticated INSERT is
-- rejected ("new row violates row-level security policy", no INSERT policy
-- exists for any role) and an unauthenticated SELECT returns [] (the one
-- SELECT policy requires is_platform_admin(auth.uid()), null for anon).
-- Tightening anyway for consistency with every other table's explicit
-- revoke-then-grant convention established this session, and as defense in
-- depth against a future policy change ever combining with this leftover
-- grant to create a real gap.
revoke all on admin_activity_log from anon, authenticated;
grant select on admin_activity_log to authenticated;



-- =============================================================================
-- 20260903110000_person_account_workspace_foundation.sql
-- =============================================================================

-- Additive identity/workspace foundation for multi-context accounts.
--
-- This migration deliberately leaves every existing learner-owned table and
-- query on auth.users/user_id. It creates an application-level person and
-- workspace mapping alongside that model, backfills one personal context per
-- current user, and keeps future ordinary signups in sync through a trigger on
-- profiles. Work SSO classification, account linking, organisation work
-- profiles and domain ownership migration are later, separately reviewable
-- changes.

create schema if not exists private;
revoke all on schema private from public;

create table people (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'active' check (status in ('active', 'restricted', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table person_auth_accounts (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id) on delete restrict,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  account_type text not null default 'personal'
    check (account_type in ('personal', 'work_sso', 'work_managed')),
  employer_id uuid references employers(id) on delete set null,
  sso_provider_id uuid,
  status text not null default 'active'
    check (status in ('active', 'suspended', 'disconnected')),
  verified_at timestamptz not null default now(),
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (auth_user_id),
  check (
    (account_type = 'personal' and employer_id is null)
    or (account_type in ('work_sso', 'work_managed') and employer_id is not null)
  )
);

create index person_auth_accounts_person_idx
  on person_auth_accounts (person_id, status);
create index person_auth_accounts_employer_idx
  on person_auth_accounts (employer_id, status)
  where employer_id is not null;

-- A learning profile is an ownership context, not another copy of the
-- existing profiles row. legacy_user_id is the compatibility bridge for the
-- current personal domain. Organisation profiles can exist before login and
-- therefore need neither person_id nor legacy_user_id initially.
create table learning_profiles (
  id uuid primary key default gen_random_uuid(),
  profile_type text not null check (profile_type in ('personal', 'organisation')),
  person_id uuid references people(id) on delete restrict,
  employer_id uuid references employers(id) on delete cascade,
  legacy_user_id uuid references profiles(id) on delete cascade,
  status text not null default 'active'
    check (status in ('invited', 'active', 'suspended', 'ended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (profile_type = 'personal' and person_id is not null and employer_id is null and legacy_user_id is not null)
    or (profile_type = 'organisation' and employer_id is not null and legacy_user_id is null)
  )
);

create unique index learning_profiles_personal_person_unique_idx
  on learning_profiles (person_id)
  where profile_type = 'personal';
create unique index learning_profiles_legacy_user_unique_idx
  on learning_profiles (legacy_user_id)
  where legacy_user_id is not null;
create index learning_profiles_employer_idx
  on learning_profiles (employer_id, status)
  where employer_id is not null;

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  workspace_type text not null check (workspace_type in ('personal', 'manager', 'organisation')),
  name text not null,
  personal_profile_id uuid references learning_profiles(id) on delete cascade,
  owner_person_id uuid references people(id) on delete restrict,
  employer_id uuid references employers(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'suspended', 'ended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (workspace_type = 'personal' and personal_profile_id is not null and owner_person_id is not null and employer_id is null)
    or (workspace_type = 'manager' and personal_profile_id is null and owner_person_id is not null and employer_id is null)
    or (workspace_type = 'organisation' and personal_profile_id is null and owner_person_id is null and employer_id is not null)
  )
);

create unique index workspaces_personal_profile_unique_idx
  on workspaces (personal_profile_id)
  where personal_profile_id is not null;
create index workspaces_owner_person_idx
  on workspaces (owner_person_id, status)
  where owner_person_id is not null;
create index workspaces_employer_idx
  on workspaces (employer_id, status)
  where employer_id is not null;

create table workspace_access (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  auth_account_id uuid not null references person_auth_accounts(id) on delete cascade,
  access_role text not null
    check (access_role in ('owner', 'employee', 'manager', 'lms_admin', 'provider')),
  status text not null default 'active' check (status in ('active', 'revoked')),
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (workspace_id, auth_account_id, access_role),
  check (
    (status = 'active' and revoked_at is null)
    or (status = 'revoked' and revoked_at is not null)
  )
);

create index workspace_access_account_idx
  on workspace_access (auth_account_id, status);
create index workspace_access_workspace_idx
  on workspace_access (workspace_id, status);

-- Use each legacy auth UUID as the initial UUID in the new one-to-one rows.
-- This makes the backfill deterministic and idempotent while keeping the
-- tables logically separate. A later verified-link operation may associate
-- another auth account with the same person without changing either auth UUID.
insert into people (id)
select id from auth.users
on conflict (id) do nothing;

insert into person_auth_accounts (id, person_id, auth_user_id, account_type)
select id, id, id, 'personal' from auth.users
on conflict (auth_user_id) do nothing;

insert into learning_profiles (id, profile_type, person_id, legacy_user_id)
select p.id, 'personal', p.id, p.id
from profiles p
join people person_row on person_row.id = p.id
on conflict (id) do nothing;

insert into workspaces (id, workspace_type, name, personal_profile_id, owner_person_id)
select lp.id, 'personal', 'My personal profile', lp.id, lp.person_id
from learning_profiles lp
where lp.profile_type = 'personal'
on conflict (id) do nothing;

insert into workspace_access (workspace_id, auth_account_id, access_role)
select w.id, paa.id, 'owner'
from workspaces w
join person_auth_accounts paa on paa.person_id = w.owner_person_id
where w.workspace_type = 'personal'
  and paa.account_type = 'personal'
on conflict (workspace_id, auth_account_id, access_role) do nothing;

-- Keep ordinary future signups in the same one-person/one-personal-workspace
-- compatibility shape. Enterprise SSO provisioning will use a separate flow
-- before it is enabled, so an SSO login is never silently classified here.
create or replace function private.bootstrap_personal_context()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.people (id) values (new.id)
  on conflict (id) do nothing;

  insert into public.person_auth_accounts (id, person_id, auth_user_id, account_type)
  values (new.id, new.id, new.id, 'personal')
  on conflict (auth_user_id) do nothing;

  insert into public.learning_profiles (id, profile_type, person_id, legacy_user_id)
  values (new.id, 'personal', new.id, new.id)
  on conflict (id) do nothing;

  insert into public.workspaces (id, workspace_type, name, personal_profile_id, owner_person_id)
  values (new.id, 'personal', 'My personal profile', new.id, new.id)
  on conflict (id) do nothing;

  insert into public.workspace_access (workspace_id, auth_account_id, access_role)
  values (new.id, new.id, 'owner')
  on conflict (workspace_id, auth_account_id, access_role) do nothing;

  return new;
end;
$$;

revoke all on function private.bootstrap_personal_context() from public, anon, authenticated;

create trigger bootstrap_personal_context_trigger
  after insert on profiles
  for each row execute procedure private.bootstrap_personal_context();

-- Read-only client surface for this foundation. Mutations arrive through
-- narrowly scoped functions in later phases; no authenticated role receives a
-- blanket INSERT/UPDATE/DELETE grant.
grant select on people, person_auth_accounts, learning_profiles, workspaces, workspace_access to authenticated;

alter table people enable row level security;
alter table person_auth_accounts enable row level security;
alter table learning_profiles enable row level security;
alter table workspaces enable row level security;
alter table workspace_access enable row level security;

create policy "Authentication accounts can view their person"
  on people for select
  to authenticated
  using (
    exists (
      select 1 from person_auth_accounts paa
      where paa.person_id = people.id
        and paa.auth_user_id = (select auth.uid())
        and paa.status = 'active'
    )
  );

create policy "Users can view their current authentication account"
  on person_auth_accounts for select
  to authenticated
  using (auth_user_id = (select auth.uid()));

-- Work authentication accounts deliberately fail this personal-profile
-- policy even after a future account link maps them to the same person.
create policy "Personal accounts can view their personal learning profile"
  on learning_profiles for select
  to authenticated
  using (
    profile_type = 'personal'
    and exists (
      select 1 from person_auth_accounts paa
      where paa.person_id = learning_profiles.person_id
        and paa.auth_user_id = (select auth.uid())
        and paa.account_type = 'personal'
        and paa.status = 'active'
    )
  );

create policy "Authentication accounts can view their workspace access"
  on workspace_access for select
  to authenticated
  using (
    exists (
      select 1 from person_auth_accounts paa
      where paa.id = workspace_access.auth_account_id
        and paa.auth_user_id = (select auth.uid())
        and paa.status = 'active'
    )
  );

create policy "Authentication accounts can view accessible workspaces"
  on workspaces for select
  to authenticated
  using (
    exists (
      select 1
      from workspace_access wa
      join person_auth_accounts paa on paa.id = wa.auth_account_id
      where wa.workspace_id = workspaces.id
        and wa.status = 'active'
        and paa.auth_user_id = (select auth.uid())
        and paa.status = 'active'
    )
  );



-- =============================================================================
-- 20260903120000_distinct_workspace_types.sql
-- =============================================================================

-- Clarify that workspace is an access/navigation abstraction above the
-- existing employer and provider domains. `organisations` continues to mean
-- training-provider organisations; `employers` continues to mean company LMS
-- tenants. No third organisation-like business entity is introduced.

alter table workspaces drop constraint workspaces_check;
alter table workspaces drop constraint workspaces_workspace_type_check;

alter table workspaces
  add column provider_organisation_id uuid references organisations(id) on delete cascade;

-- No non-personal workspaces exist yet, but retain this conversion so the
-- migration is safe if an integration environment created one early.
update workspaces
set workspace_type = 'employer'
where workspace_type = 'organisation';

alter table workspaces
  add constraint workspaces_workspace_type_check
  check (workspace_type in ('personal', 'manager', 'employer', 'provider', 'platform_admin'));

alter table workspaces
  add constraint workspaces_owner_shape_check
  check (
    (workspace_type = 'personal'
      and personal_profile_id is not null
      and owner_person_id is not null
      and employer_id is null
      and provider_organisation_id is null)
    or (workspace_type = 'manager'
      and personal_profile_id is null
      and owner_person_id is not null
      and employer_id is null
      and provider_organisation_id is null)
    or (workspace_type = 'employer'
      and personal_profile_id is null
      and owner_person_id is null
      and employer_id is not null
      and provider_organisation_id is null)
    or (workspace_type = 'provider'
      and personal_profile_id is null
      and owner_person_id is null
      and employer_id is null
      and provider_organisation_id is not null)
    or (workspace_type = 'platform_admin'
      and personal_profile_id is null
      and owner_person_id is null
      and employer_id is null
      and provider_organisation_id is null)
  );

create index workspaces_provider_organisation_idx
  on workspaces (provider_organisation_id, status)
  where provider_organisation_id is not null;



-- =============================================================================
-- 20260903130000_manager_team_foundation.sql
-- =============================================================================

-- Independent manager workspaces and consent-based collaborative teams.
--
-- A manager is an individual, not an employer tenant. Membership never grants
-- access to a learner's profile tables. The only learner-owned data exposed to
-- the manager domain is the explicit skill allow-list projected by
-- list_manager_team_shared_skills().

create table manager_teams (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  description text,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index manager_teams_workspace_idx on manager_teams (workspace_id, status);

create table manager_team_memberships (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references manager_teams(id) on delete cascade,
  member_user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('manager', 'member')),
  status text not null default 'pending' check (status in ('pending', 'active', 'declined', 'left', 'removed')),
  invited_by uuid references auth.users(id) on delete set null,
  invited_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (team_id, member_user_id)
);

create index manager_team_memberships_user_idx
  on manager_team_memberships (member_user_id, status);

create table manager_team_shared_skills (
  membership_id uuid not null references manager_team_memberships(id) on delete cascade,
  skill_id uuid not null references skills(id) on delete cascade,
  shared_at timestamptz not null default now(),
  primary key (membership_id, skill_id)
);

create table manager_team_learning_activities (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references manager_teams(id) on delete cascade,
  catalogue_course_id uuid references course_catalogue(id) on delete restrict,
  title text not null check (char_length(trim(title)) between 1 and 160),
  instructions text,
  due_at timestamptz,
  status text not null default 'active' check (status in ('active', 'closed', 'cancelled')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index manager_team_learning_activities_team_idx
  on manager_team_learning_activities (team_id, status);

create table manager_team_activity_participants (
  activity_id uuid not null references manager_team_learning_activities(id) on delete cascade,
  membership_id uuid not null references manager_team_memberships(id) on delete cascade,
  status text not null default 'invited'
    check (status in ('invited', 'accepted', 'started', 'completed', 'declined')),
  updated_at timestamptz not null default now(),
  primary key (activity_id, membership_id)
);

create schema if not exists private;
grant usage on schema private to authenticated;

create or replace function private.can_manage_manager_workspace(p_workspace_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.workspace_access wa
    join public.person_auth_accounts paa on paa.id = wa.auth_account_id
    join public.workspaces w on w.id = wa.workspace_id
    where wa.workspace_id = p_workspace_id
      and paa.auth_user_id = p_user_id
      and paa.status = 'active' and wa.status = 'active'
      and wa.access_role in ('owner', 'manager')
      and w.workspace_type = 'manager' and w.status = 'active'
  )
$$;

create or replace function private.can_manage_manager_team(p_team_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.manager_teams mt
    where mt.id = p_team_id
      and private.can_manage_manager_workspace(mt.workspace_id, p_user_id)
  )
$$;

revoke all on function private.can_manage_manager_workspace(uuid, uuid) from public;
revoke all on function private.can_manage_manager_team(uuid, uuid) from public;
grant execute on function private.can_manage_manager_workspace(uuid, uuid) to authenticated;
grant execute on function private.can_manage_manager_team(uuid, uuid) to authenticated;

create or replace function create_manager_workspace(p_name text default 'My manager workspace')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_person_id uuid; v_account_id uuid; v_workspace_id uuid;
begin
  if nullif(trim(p_name), '') is null then raise exception 'Workspace name is required'; end if;
  select paa.person_id, paa.id into v_person_id, v_account_id
  from public.person_auth_accounts paa
  where paa.auth_user_id = auth.uid() and paa.status = 'active';
  if v_person_id is null then raise exception 'No active person account'; end if;

  select id into v_workspace_id from public.workspaces
  where workspace_type = 'manager' and owner_person_id = v_person_id and status = 'active'
  order by created_at limit 1;
  if v_workspace_id is not null then return v_workspace_id; end if;

  insert into public.workspaces (workspace_type, name, owner_person_id)
  values ('manager', trim(p_name), v_person_id) returning id into v_workspace_id;
  insert into public.workspace_access (workspace_id, auth_account_id, access_role, granted_by)
  values (v_workspace_id, v_account_id, 'owner', auth.uid());
  return v_workspace_id;
end $$;

create or replace function create_manager_team(p_workspace_id uuid, p_name text, p_description text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_team_id uuid;
begin
  if not private.can_manage_manager_workspace(p_workspace_id, auth.uid()) then raise exception 'Not authorised'; end if;
  insert into public.manager_teams (workspace_id, name, description, created_by)
  values (p_workspace_id, trim(p_name), nullif(trim(p_description), ''), auth.uid()) returning id into v_team_id;
  insert into public.manager_team_memberships (team_id, member_user_id, role, status, invited_by, decided_at)
  values (v_team_id, auth.uid(), 'manager', 'active', auth.uid(), now());
  return v_team_id;
end $$;

create or replace function invite_connection_to_manager_team(p_team_id uuid, p_member_user_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_membership_id uuid;
begin
  if not private.can_manage_manager_team(p_team_id, auth.uid()) then raise exception 'Not authorised'; end if;
  if p_member_user_id = auth.uid() or not exists (
    select 1 from public.connections c
    where c.user_a_id = least(auth.uid(), p_member_user_id)
      and c.user_b_id = greatest(auth.uid(), p_member_user_id)
  ) then
    raise exception 'Team invitations are limited to existing connections';
  end if;
  insert into public.manager_team_memberships (team_id, member_user_id, invited_by)
  values (p_team_id, p_member_user_id, auth.uid())
  on conflict (team_id, member_user_id) do update
    set status = 'pending', role = 'member', invited_by = auth.uid(), invited_at = now(), decided_at = null
    where manager_team_memberships.status in ('declined', 'left', 'removed')
  returning id into v_membership_id;
  if v_membership_id is null then raise exception 'This person already has a live team membership'; end if;
  return v_membership_id;
end $$;

create or replace function decide_manager_team_invite(p_membership_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.manager_team_memberships
  set status = case when p_accept then 'active' else 'declined' end, decided_at = now()
  where id = p_membership_id and member_user_id = auth.uid() and role = 'member' and status = 'pending';
  if not found then raise exception 'Pending invitation not found'; end if;
end $$;

create or replace function set_manager_team_shared_skills(p_membership_id uuid, p_skill_ids uuid[] default '{}')
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.manager_team_memberships m where m.id = p_membership_id and m.member_user_id = auth.uid() and m.status = 'active') then
    raise exception 'Active membership not found';
  end if;
  if exists (select 1 from unnest(p_skill_ids) x where not exists (select 1 from public.skills s where s.id = x and s.user_id = auth.uid())) then
    raise exception 'Only your own skills can be shared';
  end if;
  delete from public.manager_team_shared_skills where membership_id = p_membership_id;
  insert into public.manager_team_shared_skills (membership_id, skill_id)
  select p_membership_id, x from unnest(p_skill_ids) x on conflict do nothing;
end $$;

create or replace function create_manager_team_activity(
  p_team_id uuid, p_title text, p_catalogue_course_id uuid default null,
  p_instructions text default null, p_due_at timestamptz default null, p_membership_ids uuid[] default '{}'
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_activity_id uuid;
begin
  if not private.can_manage_manager_team(p_team_id, auth.uid()) then raise exception 'Not authorised'; end if;
  insert into public.manager_team_learning_activities (team_id, catalogue_course_id, title, instructions, due_at, created_by)
  values (p_team_id, p_catalogue_course_id, trim(p_title), nullif(trim(p_instructions), ''), p_due_at, auth.uid()) returning id into v_activity_id;
  insert into public.manager_team_activity_participants (activity_id, membership_id)
  select v_activity_id, m.id from public.manager_team_memberships m
  where m.team_id = p_team_id and m.status = 'active' and m.id = any(p_membership_ids)
  on conflict do nothing;
  return v_activity_id;
end $$;

create or replace function list_manager_team_shared_skills(p_team_id uuid)
returns table (membership_id uuid, member_user_id uuid, skill_id uuid, name text, category text, practical_level integer, knowledge_level integer)
language sql stable security definer set search_path = '' as $$
  select m.id, m.member_user_id, s.id, s.name, s.category, s.level, s.knowledge_level
  from public.manager_team_memberships m
  join public.manager_team_shared_skills ss on ss.membership_id = m.id
  join public.skills s on s.id = ss.skill_id and s.user_id = m.member_user_id
  where m.team_id = p_team_id and m.status = 'active'
    and (m.member_user_id = auth.uid() or private.can_manage_manager_team(p_team_id, auth.uid()))
$$;

revoke all on function create_manager_workspace(text), create_manager_team(uuid,text,text), invite_connection_to_manager_team(uuid,uuid), decide_manager_team_invite(uuid,boolean), set_manager_team_shared_skills(uuid,uuid[]), create_manager_team_activity(uuid,text,uuid,text,timestamptz,uuid[]), list_manager_team_shared_skills(uuid) from public, anon;
grant execute on function create_manager_workspace(text), create_manager_team(uuid,text,text), invite_connection_to_manager_team(uuid,uuid), decide_manager_team_invite(uuid,boolean), set_manager_team_shared_skills(uuid,uuid[]), create_manager_team_activity(uuid,text,uuid,text,timestamptz,uuid[]), list_manager_team_shared_skills(uuid) to authenticated;

grant select on manager_teams, manager_team_memberships, manager_team_shared_skills, manager_team_learning_activities, manager_team_activity_participants to authenticated;
alter table manager_teams enable row level security;
alter table manager_team_memberships enable row level security;
alter table manager_team_shared_skills enable row level security;
alter table manager_team_learning_activities enable row level security;
alter table manager_team_activity_participants enable row level security;

create policy "Managers and invited members can view teams" on manager_teams for select to authenticated using (
  private.can_manage_manager_workspace(workspace_id, (select auth.uid())) or exists (
    select 1 from manager_team_memberships m where m.team_id = manager_teams.id and m.member_user_id = (select auth.uid()) and m.status in ('pending','active')
  )
);
create policy "Managers and members can view scoped memberships" on manager_team_memberships for select to authenticated using (
  member_user_id = (select auth.uid()) or private.can_manage_manager_team(team_id, (select auth.uid()))
);
create policy "Owners and team managers can view shared skill links" on manager_team_shared_skills for select to authenticated using (
  exists (select 1 from manager_team_memberships m where m.id = membership_id and (m.member_user_id = (select auth.uid()) or private.can_manage_manager_team(m.team_id, (select auth.uid()))))
);
create policy "Active team participants can view collaborative activities" on manager_team_learning_activities for select to authenticated using (
  private.can_manage_manager_team(team_id, (select auth.uid())) or exists (select 1 from manager_team_memberships m where m.team_id = manager_team_learning_activities.team_id and m.member_user_id = (select auth.uid()) and m.status = 'active')
);
create policy "Participants can view team activity invitations" on manager_team_activity_participants for select to authenticated using (
  exists (select 1 from manager_team_memberships m join manager_team_learning_activities a on a.team_id = m.team_id where m.id = membership_id and a.id = activity_id and (m.member_user_id = (select auth.uid()) or private.can_manage_manager_team(a.team_id, (select auth.uid()))))
);



-- =============================================================================
-- 20260903140000_manager_console_integration.sql
-- =============================================================================

-- Complete the manager console's read model and manager-authored records.

alter table manager_team_memberships add column invited_email text;

update manager_team_memberships m
set invited_email = lower(u.email)
from auth.users u
where u.id = m.member_user_id;

create table manager_collaboration_records (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references manager_teams(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 160),
  note text not null check (char_length(trim(note)) between 1 and 5000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index manager_collaboration_records_team_idx
  on manager_collaboration_records (team_id, created_at desc);

create table manager_collaboration_record_members (
  record_id uuid not null references manager_collaboration_records(id) on delete cascade,
  membership_id uuid not null references manager_team_memberships(id) on delete cascade,
  primary key (record_id, membership_id)
);

create index manager_collaboration_record_members_membership_idx
  on manager_collaboration_record_members (membership_id);

grant select on manager_collaboration_records, manager_collaboration_record_members to authenticated;
alter table manager_collaboration_records enable row level security;
alter table manager_collaboration_record_members enable row level security;

create policy "Managers can view their collaboration records"
  on manager_collaboration_records for select to authenticated
  using (private.can_manage_manager_team(team_id, (select auth.uid())));

create policy "Managers can view collaboration record members"
  on manager_collaboration_record_members for select to authenticated
  using (
    exists (
      select 1
      from manager_collaboration_records r
      where r.id = record_id
        and private.can_manage_manager_team(r.team_id, (select auth.uid()))
    )
  );

create or replace function invite_connection_to_manager_team_by_email(p_team_id uuid, p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member_user_id uuid;
  v_membership_id uuid;
  v_email text := lower(trim(p_email));
begin
  if not private.can_manage_manager_team(p_team_id, auth.uid()) then
    raise exception 'Not authorised';
  end if;
  if v_email = '' then raise exception 'Email is required'; end if;

  select u.id into v_member_user_id
  from auth.users u
  where lower(u.email) = v_email;

  if v_member_user_id is null or v_member_user_id = auth.uid() or not exists (
    select 1 from public.connections c
    where c.user_a_id = least(auth.uid(), v_member_user_id)
      and c.user_b_id = greatest(auth.uid(), v_member_user_id)
  ) then
    -- Deliberately identical for unknown and non-connected addresses.
    raise exception 'No existing connection was found for that email';
  end if;

  insert into public.manager_team_memberships
    (team_id, member_user_id, invited_email, invited_by)
  values (p_team_id, v_member_user_id, v_email, auth.uid())
  on conflict (team_id, member_user_id) do update
    set status = 'pending', role = 'member', invited_email = excluded.invited_email,
        invited_by = auth.uid(), invited_at = now(), decided_at = null
    where manager_team_memberships.status in ('declined', 'left', 'removed')
  returning id into v_membership_id;

  if v_membership_id is null then
    raise exception 'This person already has a live team membership';
  end if;
  return v_membership_id;
end
$$;

create or replace function create_manager_collaboration_record(
  p_team_id uuid,
  p_title text,
  p_note text,
  p_membership_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_record_id uuid;
begin
  if not private.can_manage_manager_team(p_team_id, auth.uid()) then
    raise exception 'Not authorised';
  end if;
  if coalesce(array_length(p_membership_ids, 1), 0) = 0 then
    raise exception 'Choose at least one team member';
  end if;
  if exists (
    select 1 from unnest(p_membership_ids) id
    where not exists (
      select 1 from public.manager_team_memberships m
      where m.id = id and m.team_id = p_team_id
        and m.role = 'member' and m.status = 'active'
    )
  ) then raise exception 'Every selected person must be an active team member'; end if;

  insert into public.manager_collaboration_records (team_id, title, note, created_by)
  values (p_team_id, trim(p_title), trim(p_note), auth.uid())
  returning id into v_record_id;

  insert into public.manager_collaboration_record_members (record_id, membership_id)
  select v_record_id, id from unnest(p_membership_ids) id;
  return v_record_id;
end
$$;

create or replace function list_manager_team_member_summaries(p_team_id uuid)
returns table (
  id uuid, name text, avatar_url text, team_since timestamptz,
  shared_skills jsonb, collaborative_learning_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.id,
    coalesce(nullif(trim(p.full_name), ''), 'Team member'),
    p.avatar_url,
    coalesce(m.decided_at, m.invited_at),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'level', s.level,
        'sharedAt', ss.shared_at,
        'evidenceCount', coalesce((
          select sum(coalesce(cardinality(sa.evidence_paths), 0))
          from public.skill_assessments sa where sa.skill_id = s.id
        ), 0)
      ) order by s.name)
      from public.manager_team_shared_skills ss
      join public.skills s on s.id = ss.skill_id and s.user_id = m.member_user_id
      where ss.membership_id = m.id
    ), '[]'::jsonb),
    (select count(*) from public.manager_team_activity_participants ap where ap.membership_id = m.id)
  from public.manager_team_memberships m
  join public.profiles p on p.id = m.member_user_id
  where m.team_id = p_team_id and m.role = 'member' and m.status = 'active'
    and private.can_manage_manager_team(p_team_id, auth.uid())
  order by p.full_name nulls last, m.invited_at
$$;

create or replace function list_manager_team_learning_records(p_team_id uuid)
returns table (
  id uuid, title text, kind text, status text,
  member_ids uuid[], member_names text[], occurred_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select a.id, a.title,
    case when a.catalogue_course_id is null then 'session' else 'course' end,
    case a.status when 'active' then 'in_progress' else 'completed' end,
    coalesce(array_agg(m.id order by p.full_name) filter (where m.role = 'member'), '{}'),
    coalesce(array_agg(coalesce(nullif(trim(p.full_name), ''), 'Team member') order by p.full_name) filter (where m.role = 'member'), '{}'),
    coalesce(a.due_at, a.created_at)
  from public.manager_team_learning_activities a
  left join public.manager_team_activity_participants ap on ap.activity_id = a.id
  left join public.manager_team_memberships m on m.id = ap.membership_id
  left join public.profiles p on p.id = m.member_user_id
  where a.team_id = p_team_id and a.status <> 'cancelled'
    and private.can_manage_manager_team(p_team_id, auth.uid())
  group by a.id
  order by coalesce(a.due_at, a.created_at) desc
$$;

create or replace function list_manager_collaboration_records(p_team_id uuid)
returns table (
  id uuid, title text, note text, member_ids uuid[],
  member_names text[], created_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select r.id, r.title, r.note,
    array_agg(m.id order by p.full_name),
    array_agg(coalesce(nullif(trim(p.full_name), ''), 'Team member') order by p.full_name),
    r.created_at
  from public.manager_collaboration_records r
  join public.manager_collaboration_record_members rm on rm.record_id = r.id
  join public.manager_team_memberships m on m.id = rm.membership_id
  join public.profiles p on p.id = m.member_user_id
  where r.team_id = p_team_id
    and private.can_manage_manager_team(p_team_id, auth.uid())
  group by r.id
  order by r.created_at desc
$$;

revoke all on function invite_connection_to_manager_team_by_email(uuid,text),
  create_manager_collaboration_record(uuid,text,text,uuid[]),
  list_manager_team_member_summaries(uuid),
  list_manager_team_learning_records(uuid),
  list_manager_collaboration_records(uuid)
from public, anon;

grant execute on function invite_connection_to_manager_team_by_email(uuid,text),
  create_manager_collaboration_record(uuid,text,text,uuid[]),
  list_manager_team_member_summaries(uuid),
  list_manager_team_learning_records(uuid),
  list_manager_collaboration_records(uuid)
to authenticated;



-- =============================================================================
-- 20260903150000_manager_learner_consent.sql
-- =============================================================================

-- Learner-facing consent lifecycle for independent manager teams.
-- These APIs expose only the caller's own memberships and explicit shared-
-- skill ids. Leaving a team removes the share links immediately while
-- retaining the historical membership row as ended relationship metadata.

create or replace function list_my_manager_team_relationships()
returns table (
  id uuid,
  status text,
  team_id uuid,
  team_name text,
  manager_name text,
  invited_at timestamptz,
  joined_at timestamptz,
  shared_skill_ids uuid[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.id,
    m.status,
    t.id,
    t.name,
    coalesce(nullif(trim(manager_profile.full_name), ''), 'Your manager'),
    m.invited_at,
    m.decided_at,
    coalesce(array_agg(ss.skill_id order by ss.shared_at)
      filter (where ss.skill_id is not null), '{}')
  from public.manager_team_memberships m
  join public.manager_teams t on t.id = m.team_id
  join public.profiles manager_profile on manager_profile.id = t.created_by
  left join public.manager_team_shared_skills ss on ss.membership_id = m.id
  where m.member_user_id = auth.uid()
    and m.role = 'member'
    and m.status in ('pending', 'active')
    and t.status = 'active'
  group by m.id, t.id, manager_profile.full_name
  order by m.invited_at desc
$$;

create or replace function leave_manager_team(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.manager_team_memberships m
    where m.id = p_membership_id
      and m.member_user_id = auth.uid()
      and m.role = 'member'
      and m.status = 'active'
  ) then
    raise exception 'Active team membership not found';
  end if;

  delete from public.manager_team_shared_skills
  where membership_id = p_membership_id;

  update public.manager_team_memberships
  set status = 'left', decided_at = now()
  where id = p_membership_id;
end
$$;

revoke all on function list_my_manager_team_relationships(), leave_manager_team(uuid)
from public, anon;
grant execute on function list_my_manager_team_relationships(), leave_manager_team(uuid)
to authenticated;



-- =============================================================================
-- 20260903160000_restore_learner_action_read_grants.sql
-- =============================================================================

-- Restore the authenticated read privileges required by the learner Actions
-- surface. Row visibility remains constrained by each table's existing RLS
-- policies; these grants only allow PostgreSQL to reach those policies.

grant select on table
  public.connection_requests,
  public.skill_validation_requests,
  public.organisation_members,
  public.organisations,
  public.employer_members,
  public.employers,
  public.employer_data_access_requests,
  public.course_assignments,
  public.course_catalogue,
  public.employer_skill_suggestions,
  public.profiles,
  public.skills
to authenticated;



-- =============================================================================
-- 20260903170000_employer_role_profiles.sql
-- =============================================================================

-- Employer-owned role templates linked, with learner consent, to a learner-
-- owned current employment record. Linking never transfers ownership of the
-- learner's experience or grants general access to their profile.

create table public.employer_role_profiles (
  id uuid primary key default gen_random_uuid(),
  employer_id uuid not null references public.employers(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 160),
  description text check (description is null or char_length(description) <= 5000),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index employer_role_profiles_employer_idx
  on public.employer_role_profiles (employer_id, status, name);
create index employer_role_profiles_created_by_idx
  on public.employer_role_profiles (created_by);

create table public.employer_role_profile_skills (
  role_profile_id uuid not null references public.employer_role_profiles(id) on delete cascade,
  library_skill_id uuid not null references public.skill_library(id) on delete restrict,
  target_level integer not null check (target_level between 1 and 5),
  requirement text not null default 'required' check (requirement in ('required', 'recommended')),
  created_at timestamptz not null default now(),
  primary key (role_profile_id, library_skill_id)
);

create index employer_role_profile_skills_library_idx
  on public.employer_role_profile_skills (library_skill_id);

create table public.employer_role_profile_training (
  role_profile_id uuid not null references public.employer_role_profiles(id) on delete cascade,
  catalogue_course_id uuid not null references public.course_catalogue(id) on delete restrict,
  requirement text not null default 'required' check (requirement in ('required', 'recommended')),
  created_at timestamptz not null default now(),
  primary key (role_profile_id, catalogue_course_id)
);

create index employer_role_profile_training_course_idx
  on public.employer_role_profile_training (catalogue_course_id);

create table public.employer_role_assignments (
  id uuid primary key default gen_random_uuid(),
  role_profile_id uuid not null references public.employer_role_profiles(id) on delete cascade,
  employer_member_id uuid not null references public.employer_members(id) on delete cascade,
  learner_experience_id uuid references public.experience(id) on delete set null,
  status text not null default 'proposed'
    check (status in ('proposed', 'linked', 'declined', 'disconnected', 'withdrawn')),
  proposed_by uuid not null references auth.users(id) on delete restrict,
  proposed_at timestamptz not null default now(),
  decided_at timestamptz,
  disconnected_at timestamptz,
  unique (role_profile_id, employer_member_id)
);

create index employer_role_assignments_member_idx
  on public.employer_role_assignments (employer_member_id, status);
create index employer_role_assignments_experience_idx
  on public.employer_role_assignments (learner_experience_id)
  where learner_experience_id is not null;
create index employer_role_assignments_proposed_by_idx
  on public.employer_role_assignments (proposed_by);

create or replace function private.can_view_employer_role_profile(
  p_role_profile_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.employer_role_profiles rp
    join public.employer_members em on em.employer_id = rp.employer_id
    where rp.id = p_role_profile_id
      and em.user_id = p_user_id
      and em.status = 'active'
  ) or public.is_platform_admin(p_user_id)
$$;

revoke all on function private.can_view_employer_role_profile(uuid, uuid) from public;
grant execute on function private.can_view_employer_role_profile(uuid, uuid) to authenticated;

alter table public.employer_role_profiles enable row level security;
alter table public.employer_role_profile_skills enable row level security;
alter table public.employer_role_profile_training enable row level security;
alter table public.employer_role_assignments enable row level security;

create policy "Active employer members can view role profiles"
  on public.employer_role_profiles for select to authenticated
  using (private.can_view_employer_role_profile(id, (select auth.uid())));

create policy "Employer admins can create role profiles"
  on public.employer_role_profiles for insert to authenticated
  with check (
    public.is_employer_admin(employer_id, (select auth.uid()))
    and created_by = (select auth.uid())
  );

create policy "Employer admins can update role profiles"
  on public.employer_role_profiles for update to authenticated
  using (public.is_employer_admin(employer_id, (select auth.uid())))
  with check (public.is_employer_admin(employer_id, (select auth.uid())));

create policy "Employer admins can remove role profiles"
  on public.employer_role_profiles for delete to authenticated
  using (public.is_employer_admin(employer_id, (select auth.uid())));

create policy "Employer members can view role skill requirements"
  on public.employer_role_profile_skills for select to authenticated
  using (private.can_view_employer_role_profile(role_profile_id, (select auth.uid())));

create policy "Employer admins can add role skill requirements"
  on public.employer_role_profile_skills for insert to authenticated
  with check (
    exists (
      select 1 from public.employer_role_profiles rp
      where rp.id = role_profile_id
        and public.is_employer_admin(rp.employer_id, (select auth.uid()))
    )
  );

create policy "Employer admins can update role skill requirements"
  on public.employer_role_profile_skills for update to authenticated
  using (
    exists (
      select 1 from public.employer_role_profiles rp
      where rp.id = role_profile_id
        and public.is_employer_admin(rp.employer_id, (select auth.uid()))
    )
  )
  with check (
    exists (
      select 1 from public.employer_role_profiles rp
      where rp.id = role_profile_id
        and public.is_employer_admin(rp.employer_id, (select auth.uid()))
    )
  );

create policy "Employer admins can remove role skill requirements"
  on public.employer_role_profile_skills for delete to authenticated
  using (
    exists (
      select 1 from public.employer_role_profiles rp
      where rp.id = role_profile_id
        and public.is_employer_admin(rp.employer_id, (select auth.uid()))
    )
  );

create policy "Employer members can view role training requirements"
  on public.employer_role_profile_training for select to authenticated
  using (private.can_view_employer_role_profile(role_profile_id, (select auth.uid())));

create policy "Employer admins can add role training requirements"
  on public.employer_role_profile_training for insert to authenticated
  with check (
    exists (
      select 1 from public.employer_role_profiles rp
      where rp.id = role_profile_id
        and public.is_employer_admin(rp.employer_id, (select auth.uid()))
    )
  );

create policy "Employer admins can update role training requirements"
  on public.employer_role_profile_training for update to authenticated
  using (
    exists (
      select 1 from public.employer_role_profiles rp
      where rp.id = role_profile_id
        and public.is_employer_admin(rp.employer_id, (select auth.uid()))
    )
  )
  with check (
    exists (
      select 1 from public.employer_role_profiles rp
      where rp.id = role_profile_id
        and public.is_employer_admin(rp.employer_id, (select auth.uid()))
    )
  );

create policy "Employer admins can remove role training requirements"
  on public.employer_role_profile_training for delete to authenticated
  using (
    exists (
      select 1 from public.employer_role_profiles rp
      where rp.id = role_profile_id
        and public.is_employer_admin(rp.employer_id, (select auth.uid()))
    )
  );

create policy "Employers and assigned learners can view role assignments"
  on public.employer_role_assignments for select to authenticated
  using (
    exists (
      select 1
      from public.employer_members em
      join public.employer_role_profiles rp
        on rp.id = employer_role_assignments.role_profile_id
      where em.id = employer_role_assignments.employer_member_id
        and em.employer_id = rp.employer_id
        and (
          em.user_id = (select auth.uid())
          or public.is_employer_admin(rp.employer_id, (select auth.uid()))
        )
    )
  );

-- Assignment mutations are RPC-only so neither party can change the other
-- party's fields through the Data API.
grant select, insert, delete on public.employer_role_profiles,
  public.employer_role_profile_skills, public.employer_role_profile_training to authenticated;
grant update (name, description, status, updated_at)
  on public.employer_role_profiles to authenticated;
grant update (target_level, requirement)
  on public.employer_role_profile_skills to authenticated;
grant update (requirement)
  on public.employer_role_profile_training to authenticated;
grant select on public.employer_role_assignments to authenticated;
grant select on public.skill_library, public.course_catalogue, public.experience to authenticated;

create or replace function public.assign_employer_role_profile(
  p_role_profile_id uuid,
  p_employer_member_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employer_id uuid;
  v_assignment_id uuid;
begin
  select rp.employer_id into v_employer_id
  from public.employer_role_profiles rp
  where rp.id = p_role_profile_id and rp.status = 'active';

  if v_employer_id is null
     or not public.is_employer_admin(v_employer_id, auth.uid()) then
    raise exception 'Not authorised';
  end if;
  if not exists (
    select 1 from public.employer_members em
    where em.id = p_employer_member_id
      and em.employer_id = v_employer_id
      and em.role = 'member'
      and em.status = 'active'
  ) then
    raise exception 'Choose an active learner from this employer';
  end if;

  insert into public.employer_role_assignments
    (role_profile_id, employer_member_id, proposed_by)
  values (p_role_profile_id, p_employer_member_id, auth.uid())
  on conflict (role_profile_id, employer_member_id) do update
    set status = 'proposed', learner_experience_id = null,
        proposed_by = auth.uid(), proposed_at = now(), decided_at = null,
        disconnected_at = null
    where public.employer_role_assignments.status in ('declined', 'disconnected', 'withdrawn')
  returning id into v_assignment_id;

  if v_assignment_id is null then
    raise exception 'This learner already has a live assignment for this role';
  end if;
  return v_assignment_id;
end
$$;

create or replace function public.decide_employer_role_assignment(
  p_assignment_id uuid,
  p_accept boolean,
  p_learner_experience_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid;
begin
  select em.user_id into v_user_id
  from public.employer_role_assignments a
  join public.employer_members em on em.id = a.employer_member_id
  where a.id = p_assignment_id and a.status = 'proposed';

  if v_user_id is distinct from auth.uid() then
    raise exception 'Pending role assignment not found';
  end if;
  if p_accept and not exists (
    select 1 from public.experience e
    where e.id = p_learner_experience_id
      and e.user_id = auth.uid()
      and e.type = 'employment'
      and e.end_date is null
  ) then
    raise exception 'Choose one of your current employment roles';
  end if;

  update public.employer_role_assignments
  set status = case when p_accept then 'linked' else 'declined' end,
      learner_experience_id = case when p_accept then p_learner_experience_id else null end,
      decided_at = now(), disconnected_at = null
  where id = p_assignment_id;
end
$$;

create or replace function public.disconnect_employer_role_assignment(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.employer_role_assignments a
  set status = 'disconnected', learner_experience_id = null, disconnected_at = now()
  from public.employer_members em
  where a.id = p_assignment_id
    and em.id = a.employer_member_id
    and em.user_id = auth.uid()
    and a.status = 'linked';
  if not found then raise exception 'Linked role assignment not found'; end if;
end
$$;

create or replace function public.withdraw_employer_role_assignment(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.employer_role_assignments a
  set status = 'withdrawn', learner_experience_id = null, disconnected_at = now()
  from public.employer_role_profiles rp
  where a.id = p_assignment_id
    and rp.id = a.role_profile_id
    and public.is_employer_admin(rp.employer_id, auth.uid())
    and a.status in ('proposed', 'linked');
  if not found then raise exception 'Live role assignment not found'; end if;
end
$$;

revoke all on function public.assign_employer_role_profile(uuid, uuid),
  public.decide_employer_role_assignment(uuid, boolean, uuid),
  public.disconnect_employer_role_assignment(uuid),
  public.withdraw_employer_role_assignment(uuid)
from public, anon;
grant execute on function public.assign_employer_role_profile(uuid, uuid),
  public.decide_employer_role_assignment(uuid, boolean, uuid),
  public.disconnect_employer_role_assignment(uuid),
  public.withdraw_employer_role_assignment(uuid)
to authenticated;



-- =============================================================================
-- 20260903180000_atomic_role_profile_requirements.sql
-- =============================================================================

-- Replace a role profile's requirement sets atomically. Keeping delete and
-- insert in one transaction prevents a transient API failure from leaving a
-- valid role profile with its requirements unintentionally erased.

create or replace function public.replace_employer_role_profile_skills(
  p_role_profile_id uuid,
  p_requirements jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_employer_id uuid;
begin
  if jsonb_typeof(p_requirements) <> 'array' then
    raise exception 'Skill requirements must be an array';
  end if;
  select rp.employer_id into v_employer_id
  from public.employer_role_profiles rp
  where rp.id = p_role_profile_id;
  if v_employer_id is null
     or not public.is_employer_admin(v_employer_id, auth.uid()) then
    raise exception 'Not authorised';
  end if;

  delete from public.employer_role_profile_skills
  where role_profile_id = p_role_profile_id;

  insert into public.employer_role_profile_skills
    (role_profile_id, library_skill_id, target_level, requirement)
  select
    p_role_profile_id,
    (item->>'skillId')::uuid,
    (item->>'targetLevel')::integer,
    coalesce(nullif(item->>'requirement', ''), 'required')
  from jsonb_array_elements(p_requirements) item;
end
$$;

create or replace function public.replace_employer_role_profile_training(
  p_role_profile_id uuid,
  p_requirements jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_employer_id uuid;
begin
  if jsonb_typeof(p_requirements) <> 'array' then
    raise exception 'Training requirements must be an array';
  end if;
  select rp.employer_id into v_employer_id
  from public.employer_role_profiles rp
  where rp.id = p_role_profile_id;
  if v_employer_id is null
     or not public.is_employer_admin(v_employer_id, auth.uid()) then
    raise exception 'Not authorised';
  end if;

  delete from public.employer_role_profile_training
  where role_profile_id = p_role_profile_id;

  insert into public.employer_role_profile_training
    (role_profile_id, catalogue_course_id, requirement)
  select
    p_role_profile_id,
    (item->>'courseId')::uuid,
    coalesce(nullif(item->>'requirement', ''), 'required')
  from jsonb_array_elements(p_requirements) item;
end
$$;

revoke all on function public.replace_employer_role_profile_skills(uuid, jsonb),
  public.replace_employer_role_profile_training(uuid, jsonb)
from public, anon;
grant execute on function public.replace_employer_role_profile_skills(uuid, jsonb),
  public.replace_employer_role_profile_training(uuid, jsonb)
to authenticated;

-- Narrow employer projection: only the learner-selected current role is
-- exposed. No other experience, skills, or personal learning are returned.
create or replace function public.list_employer_role_assignments(p_role_profile_id uuid)
returns table (
  id uuid,
  employer_member_id uuid,
  learner_user_id uuid,
  learner_name text,
  status text,
  proposed_at timestamptz,
  decided_at timestamptz,
  learner_experience_id uuid,
  current_role_title text,
  current_role_organization text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_employer_id uuid;
begin
  select rp.employer_id into v_employer_id
  from public.employer_role_profiles rp
  where rp.id = p_role_profile_id;
  if v_employer_id is null
     or not public.is_employer_admin(v_employer_id, auth.uid()) then
    raise exception 'Not authorised';
  end if;

  return query
  select
    a.id,
    em.id,
    em.user_id,
    coalesce(nullif(trim(p.full_name), ''), 'Employee'),
    a.status,
    a.proposed_at,
    a.decided_at,
    case when a.status = 'linked' then e.id else null end,
    case when a.status = 'linked' then e.title else null end,
    case when a.status = 'linked' then e.organization else null end
  from public.employer_role_assignments a
  join public.employer_members em on em.id = a.employer_member_id
  left join public.profiles p on p.id = em.user_id
  left join public.experience e on e.id = a.learner_experience_id
  where a.role_profile_id = p_role_profile_id
  order by a.proposed_at desc;
end
$$;

revoke all on function public.list_employer_role_assignments(uuid) from public, anon;
grant execute on function public.list_employer_role_assignments(uuid) to authenticated;



-- =============================================================================
-- 20260903190000_verified_account_links.sql
-- =============================================================================

-- Proof-of-control foundation for linking two distinct authentication accounts.
-- This is intentionally separate from Supabase Auth identity linking because
-- SAML SSO identities cannot participate in Supabase's manual linking flow.
-- Redeeming a link verifies that both accounts belong to the same person, but
-- does not merge people, move learner records, or grant workspace access.

create table public.account_link_invitations (
  id uuid primary key default gen_random_uuid(),
  requesting_auth_account_id uuid not null references public.person_auth_accounts(id) on delete cascade,
  target_email text not null,
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'cancelled', 'expired')),
  expires_at timestamptz not null,
  accepted_by_auth_account_id uuid references public.person_auth_accounts(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  check (target_email = lower(trim(target_email))),
  check (expires_at > created_at),
  check (
    (status = 'accepted' and accepted_by_auth_account_id is not null and accepted_at is not null)
    or (status <> 'accepted' and accepted_by_auth_account_id is null and accepted_at is null)
  )
);

create index account_link_invitations_requester_idx
  on public.account_link_invitations (requesting_auth_account_id, status, created_at desc);
create index account_link_invitations_pending_expiry_idx
  on public.account_link_invitations (expires_at)
  where status = 'pending';

create table public.verified_account_links (
  id uuid primary key default gen_random_uuid(),
  auth_account_a_id uuid not null references public.person_auth_accounts(id) on delete cascade,
  auth_account_b_id uuid not null references public.person_auth_accounts(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'revoked')),
  verified_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_from_invitation_id uuid references public.account_link_invitations(id) on delete set null,
  check (auth_account_a_id < auth_account_b_id),
  check (
    (status = 'active' and revoked_at is null)
    or (status = 'revoked' and revoked_at is not null)
  ),
  unique (auth_account_a_id, auth_account_b_id)
);

create index verified_account_links_a_idx
  on public.verified_account_links (auth_account_a_id, status);
create index verified_account_links_b_idx
  on public.verified_account_links (auth_account_b_id, status);

alter table public.account_link_invitations enable row level security;
alter table public.verified_account_links enable row level security;

grant select on public.account_link_invitations, public.verified_account_links to authenticated;

create policy "Accounts can view link invitations they created or accepted"
  on public.account_link_invitations for select
  to authenticated
  using (
    exists (
      select 1 from public.person_auth_accounts paa
      where paa.auth_user_id = (select auth.uid())
        and paa.status = 'active'
        and paa.id in (requesting_auth_account_id, accepted_by_auth_account_id)
    )
  );

create policy "Accounts can view their verified links"
  on public.verified_account_links for select
  to authenticated
  using (
    exists (
      select 1 from public.person_auth_accounts paa
      where paa.auth_user_id = (select auth.uid())
        and paa.status = 'active'
        and paa.id in (auth_account_a_id, auth_account_b_id)
    )
  );

create or replace function public.create_account_link_invitation(p_target_email text)
returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requester public.person_auth_accounts;
  v_email text := lower(trim(p_target_email));
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_invitation public.account_link_invitations;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if v_email = '' or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid email address';
  end if;

  select * into v_requester
  from public.person_auth_accounts
  where auth_user_id = auth.uid() and status = 'active';
  if v_requester.id is null then raise exception 'Active authentication account not found'; end if;

  if exists (select 1 from auth.users where id = auth.uid() and lower(email) = v_email) then
    raise exception 'Use a different account email';
  end if;

  update public.account_link_invitations
  set status = 'cancelled'
  where requesting_auth_account_id = v_requester.id and status = 'pending';

  insert into public.account_link_invitations (
    requesting_auth_account_id, target_email, token_hash, expires_at
  ) values (
    v_requester.id, v_email, encode(extensions.digest(v_token, 'sha256'), 'hex'), now() + interval '30 minutes'
  ) returning * into v_invitation;

  return query select v_invitation.id, v_token, v_invitation.expires_at;
end
$$;

create or replace function public.redeem_account_link_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_redeemer public.person_auth_accounts;
  v_invitation public.account_link_invitations;
  v_email text;
  v_a uuid;
  v_b uuid;
  v_link_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into v_redeemer
  from public.person_auth_accounts
  where auth_user_id = auth.uid() and status = 'active';
  if v_redeemer.id is null then raise exception 'Active authentication account not found'; end if;

  select lower(email) into v_email from auth.users where id = auth.uid() and email_confirmed_at is not null;
  if v_email is null then raise exception 'A verified email address is required'; end if;

  select * into v_invitation
  from public.account_link_invitations
  where token_hash = encode(extensions.digest(trim(p_token), 'sha256'), 'hex')
  for update;

  if v_invitation.id is null or v_invitation.status <> 'pending' then
    raise exception 'Link invitation is invalid or no longer available';
  end if;
  if v_invitation.expires_at <= now() then
    update public.account_link_invitations set status = 'expired' where id = v_invitation.id;
    raise exception 'Link invitation has expired';
  end if;
  if v_invitation.target_email <> v_email then
    raise exception 'Sign in with the invited email address';
  end if;
  if v_invitation.requesting_auth_account_id = v_redeemer.id then
    raise exception 'An account cannot link to itself';
  end if;

  v_a := least(v_invitation.requesting_auth_account_id, v_redeemer.id);
  v_b := greatest(v_invitation.requesting_auth_account_id, v_redeemer.id);

  insert into public.verified_account_links (
    auth_account_a_id, auth_account_b_id, created_from_invitation_id
  ) values (v_a, v_b, v_invitation.id)
  on conflict (auth_account_a_id, auth_account_b_id) do update
    set status = 'active', revoked_at = null, verified_at = now(),
        created_from_invitation_id = excluded.created_from_invitation_id
  returning id into v_link_id;

  update public.account_link_invitations
  set status = 'accepted', accepted_by_auth_account_id = v_redeemer.id, accepted_at = now()
  where id = v_invitation.id;

  return v_link_id;
end
$$;

create or replace function public.revoke_verified_account_link(p_link_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.verified_account_links link
  set status = 'revoked', revoked_at = now()
  where link.id = p_link_id
    and link.status = 'active'
    and exists (
      select 1 from public.person_auth_accounts paa
      where paa.auth_user_id = auth.uid()
        and paa.status = 'active'
        and paa.id in (link.auth_account_a_id, link.auth_account_b_id)
    );
  if not found then raise exception 'Active verified account link not found'; end if;
end
$$;

create or replace function public.list_my_verified_account_links()
returns table (
  link_id uuid,
  other_email text,
  other_account_type text,
  direction text,
  status text,
  verified_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select id from public.person_auth_accounts
    where auth_user_id = auth.uid() and status = 'active'
  )
  select
    link.id,
    other_user.email,
    other_account.account_type,
    case
      when invitation.requesting_auth_account_id = mine.id then 'sent'
      else 'received'
    end,
    link.status,
    link.verified_at
  from public.verified_account_links link
  join mine on mine.id in (link.auth_account_a_id, link.auth_account_b_id)
  join public.person_auth_accounts other_account
    on other_account.id = case
      when link.auth_account_a_id = mine.id then link.auth_account_b_id
      else link.auth_account_a_id
    end
  join auth.users other_user on other_user.id = other_account.auth_user_id
  left join public.account_link_invitations invitation on invitation.id = link.created_from_invitation_id
  order by link.verified_at desc
$$;

revoke all on function public.create_account_link_invitation(text),
  public.redeem_account_link_invitation(text), public.revoke_verified_account_link(uuid),
  public.list_my_verified_account_links()
from public, anon;
grant execute on function public.create_account_link_invitation(text),
  public.redeem_account_link_invitation(text), public.revoke_verified_account_link(uuid),
  public.list_my_verified_account_links()
to authenticated;



-- =============================================================================
-- 20260903200000_profile_transfer_preview_consent.sql
-- =============================================================================

-- Two-party consent gate for comparing separately owned learner profiles.
-- This migration is read-only with respect to learner data: it never moves,
-- merges, deletes, or reassigns any profile-owned record.

create table public.profile_transfer_previews (
  id uuid primary key default gen_random_uuid(),
  verified_account_link_id uuid not null references public.verified_account_links(id) on delete cascade,
  requested_by_auth_account_id uuid not null references public.person_auth_accounts(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'cancelled', 'expired')),
  expires_at timestamptz not null default (now() + interval '7 days'),
  approved_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > created_at),
  check ((status = 'approved') = (approved_at is not null)),
  check ((status = 'cancelled') = (cancelled_at is not null))
);

create unique index profile_transfer_previews_open_link_idx
  on public.profile_transfer_previews (verified_account_link_id)
  where status in ('pending', 'approved');

create table public.profile_transfer_preview_approvals (
  preview_id uuid not null references public.profile_transfer_previews(id) on delete cascade,
  auth_account_id uuid not null references public.person_auth_accounts(id) on delete cascade,
  approved_at timestamptz not null default now(),
  primary key (preview_id, auth_account_id)
);

create index profile_transfer_preview_approvals_account_idx
  on public.profile_transfer_preview_approvals (auth_account_id, preview_id);

alter table public.profile_transfer_previews enable row level security;
alter table public.profile_transfer_preview_approvals enable row level security;
grant select on public.profile_transfer_previews, public.profile_transfer_preview_approvals to authenticated;

create policy "Linked accounts can view their transfer previews"
  on public.profile_transfer_previews for select to authenticated
  using (
    exists (
      select 1
      from public.verified_account_links link
      join public.person_auth_accounts account
        on account.id in (link.auth_account_a_id, link.auth_account_b_id)
      where link.id = profile_transfer_previews.verified_account_link_id
        and account.auth_user_id = (select auth.uid())
        and account.status = 'active'
    )
  );

create policy "Linked accounts can view preview approvals"
  on public.profile_transfer_preview_approvals for select to authenticated
  using (
    exists (
      select 1
      from public.profile_transfer_previews preview
      join public.verified_account_links link on link.id = preview.verified_account_link_id
      join public.person_auth_accounts account
        on account.id in (link.auth_account_a_id, link.auth_account_b_id)
      where preview.id = profile_transfer_preview_approvals.preview_id
        and account.auth_user_id = (select auth.uid())
        and account.status = 'active'
    )
  );

create or replace function private.current_link_account(p_link_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select account.id
  from public.verified_account_links link
  join public.person_auth_accounts account
    on account.id in (link.auth_account_a_id, link.auth_account_b_id)
  where link.id = p_link_id
    and link.status = 'active'
    and account.auth_user_id = auth.uid()
    and account.status = 'active'
$$;

revoke all on function private.current_link_account(uuid) from public, anon, authenticated;

create or replace function public.request_profile_transfer_preview(p_link_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid := private.current_link_account(p_link_id);
  v_preview_id uuid;
begin
  if v_account_id is null then raise exception 'Active verified account link not found'; end if;

  update public.profile_transfer_previews
  set status = 'expired', approved_at = null, updated_at = now()
  where verified_account_link_id = p_link_id
    and status in ('pending', 'approved')
    and expires_at <= now();

  select id into v_preview_id
  from public.profile_transfer_previews
  where verified_account_link_id = p_link_id and status in ('pending', 'approved');

  if v_preview_id is null then
    insert into public.profile_transfer_previews (
      verified_account_link_id, requested_by_auth_account_id
    ) values (p_link_id, v_account_id)
    returning id into v_preview_id;
  end if;

  insert into public.profile_transfer_preview_approvals (preview_id, auth_account_id)
  values (v_preview_id, v_account_id)
  on conflict do nothing;
  return v_preview_id;
end
$$;

create or replace function public.approve_profile_transfer_preview(p_preview_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_preview public.profile_transfer_previews;
  v_account_id uuid;
begin
  select * into v_preview from public.profile_transfer_previews where id = p_preview_id for update;
  if v_preview.id is null or v_preview.status <> 'pending' then raise exception 'Pending preview not found'; end if;
  if v_preview.expires_at <= now() then
    update public.profile_transfer_previews set status = 'expired', updated_at = now() where id = p_preview_id;
    return;
  end if;

  v_account_id := private.current_link_account(v_preview.verified_account_link_id);
  if v_account_id is null then raise exception 'Active verified account link not found'; end if;
  insert into public.profile_transfer_preview_approvals (preview_id, auth_account_id)
  values (p_preview_id, v_account_id) on conflict do nothing;

  if (select count(*) from public.profile_transfer_preview_approvals where preview_id = p_preview_id) = 2 then
    update public.profile_transfer_previews
    set status = 'approved', approved_at = now(), updated_at = now()
    where id = p_preview_id;
  end if;
end
$$;

create or replace function public.cancel_profile_transfer_preview(p_preview_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profile_transfer_previews preview
  set status = 'cancelled', cancelled_at = now(), approved_at = null, updated_at = now()
  where preview.id = p_preview_id
    and preview.status in ('pending', 'approved')
    and private.current_link_account(preview.verified_account_link_id) is not null;
  if not found then raise exception 'Active preview not found'; end if;
end
$$;

create or replace function public.list_my_profile_transfer_previews()
returns table (
  preview_id uuid,
  link_id uuid,
  other_email text,
  status text,
  requested_by_me boolean,
  approved_by_me boolean,
  approval_count integer,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    preview.id,
    link.id,
    other_user.email,
    case when preview.status = 'pending' and preview.expires_at <= now() then 'expired' else preview.status end,
    preview.requested_by_auth_account_id = mine.id,
    exists (select 1 from public.profile_transfer_preview_approvals approval where approval.preview_id = preview.id and approval.auth_account_id = mine.id),
    (select count(*)::integer from public.profile_transfer_preview_approvals approval where approval.preview_id = preview.id),
    preview.expires_at
  from public.profile_transfer_previews preview
  join public.verified_account_links link on link.id = preview.verified_account_link_id
  join public.person_auth_accounts mine
    on mine.id in (link.auth_account_a_id, link.auth_account_b_id)
   and mine.auth_user_id = auth.uid() and mine.status = 'active'
  join public.person_auth_accounts other_account
    on other_account.id = case when link.auth_account_a_id = mine.id then link.auth_account_b_id else link.auth_account_a_id end
  join auth.users other_user on other_user.id = other_account.auth_user_id
  order by preview.created_at desc
$$;

create or replace function public.get_profile_transfer_comparison(p_preview_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_preview public.profile_transfer_previews;
  v_link public.verified_account_links;
  v_user_a uuid;
  v_user_b uuid;
begin
  select * into v_preview from public.profile_transfer_previews where id = p_preview_id;
  if v_preview.id is null or v_preview.status <> 'approved' or v_preview.expires_at <= now() then
    raise exception 'Approved transfer preview not found';
  end if;
  if private.current_link_account(v_preview.verified_account_link_id) is null then
    raise exception 'Active verified account link not found';
  end if;
  select * into v_link from public.verified_account_links where id = v_preview.verified_account_link_id;
  select auth_user_id into v_user_a from public.person_auth_accounts where id = v_link.auth_account_a_id;
  select auth_user_id into v_user_b from public.person_auth_accounts where id = v_link.auth_account_b_id;

  return jsonb_build_object(
    'profiles', jsonb_build_array(
      private.profile_transfer_summary(v_user_a),
      private.profile_transfer_summary(v_user_b)
    ),
    'conflicts', jsonb_build_object(
      'skills', coalesce((
        select jsonb_agg(jsonb_build_object('name', pairs.name, 'levelA', pairs.level_a, 'levelB', pairs.level_b) order by pairs.name)
        from (
          select distinct on (lower(trim(a.name))) a.name, a.level as level_a, b.level as level_b
          from public.skills a
          join public.skills b on lower(trim(a.name)) = lower(trim(b.name))
          where a.user_id = v_user_a and b.user_id = v_user_b
          order by lower(trim(a.name)), a.date_added desc, b.date_added desc
        ) pairs
      ), '[]'::jsonb),
      'courses', coalesce((
        select jsonb_agg(jsonb_build_object('title', pairs.name) order by pairs.name)
        from (
          select distinct on (lower(trim(a.name))) a.name
          from public.courses a
          join public.courses b on lower(trim(a.name)) = lower(trim(b.name))
          where a.user_id = v_user_a and b.user_id = v_user_b
          order by lower(trim(a.name)), a.created_at desc, b.created_at desc
        ) pairs
      ), '[]'::jsonb),
      'experience', coalesce((
        select jsonb_agg(jsonb_build_object(
          'titleA', pairs.title_a, 'organizationA', pairs.organization_a,
          'titleB', pairs.title_b, 'organizationB', pairs.organization_b
        ) order by pairs.title_a)
        from (
          select distinct on (lower(trim(a.title)), lower(trim(coalesce(a.organization, ''))))
            a.title as title_a, a.organization as organization_a,
            b.title as title_b, b.organization as organization_b
          from public.experience a
          join public.experience b
            on lower(trim(a.title)) = lower(trim(b.title))
           and lower(trim(coalesce(a.organization, ''))) = lower(trim(coalesce(b.organization, '')))
          where a.user_id = v_user_a and b.user_id = v_user_b
          order by lower(trim(a.title)), lower(trim(coalesce(a.organization, ''))), a.start_date desc, b.start_date desc
        ) pairs
      ), '[]'::jsonb)
    )
  );
end
$$;

create or replace function private.profile_transfer_summary(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'profileId', learning_profile.id,
    'email', auth_user.email,
    'accountType', account.account_type,
    'counts', jsonb_build_object(
      'skills', (select count(*) from public.skills where user_id = p_user_id),
      'experience', (select count(*) from public.experience where user_id = p_user_id),
      'courses', (select count(*) from public.courses where user_id = p_user_id),
      'evidence', (select count(*) from public.skill_assessments where user_id = p_user_id and (evidence_url is not null or evidence_path is not null or coalesce(cardinality(evidence_paths), 0) > 0)),
      'connections', (select count(*) from public.connections where user_a_id = p_user_id or user_b_id = p_user_id),
      'integrations', (select count(*) from public.external_connections where user_id = p_user_id)
    )
  )
  from public.person_auth_accounts account
  join auth.users auth_user on auth_user.id = account.auth_user_id
  join public.learning_profiles learning_profile on learning_profile.legacy_user_id = auth_user.id
  where account.auth_user_id = p_user_id
$$;

revoke all on function private.profile_transfer_summary(uuid) from public, anon, authenticated;
revoke all on function public.request_profile_transfer_preview(uuid),
  public.approve_profile_transfer_preview(uuid), public.cancel_profile_transfer_preview(uuid),
  public.list_my_profile_transfer_previews(), public.get_profile_transfer_comparison(uuid)
from public, anon;
grant execute on function public.request_profile_transfer_preview(uuid),
  public.approve_profile_transfer_preview(uuid), public.cancel_profile_transfer_preview(uuid),
  public.list_my_profile_transfer_previews(), public.get_profile_transfer_comparison(uuid)
to authenticated;



-- =============================================================================
-- 20260903210000_profile_transfer_plans.sql
-- =============================================================================

-- Immutable, two-party-approved transfer plans. This phase records intent only:
-- no learner-owned row is moved, merged, deleted, or reassigned here.

create table public.profile_transfer_plans (
  id uuid primary key default gen_random_uuid(),
  preview_id uuid not null references public.profile_transfer_previews(id) on delete restrict,
  verified_account_link_id uuid not null references public.verified_account_links(id) on delete restrict,
  source_profile_id uuid not null references public.learning_profiles(id) on delete restrict,
  durable_profile_id uuid not null references public.learning_profiles(id) on delete restrict,
  created_by_auth_account_id uuid not null references public.person_auth_accounts(id) on delete restrict,
  status text not null default 'draft'
    check (status in ('draft', 'pending_approval', 'approved', 'cancelled', 'expired', 'executed')),
  version_hash text,
  expires_at timestamptz not null default (now() + interval '7 days'),
  submitted_at timestamptz,
  approved_at timestamptz,
  cancelled_at timestamptz,
  executed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_profile_id <> durable_profile_id),
  check (expires_at > created_at),
  check (
    (status = 'draft' and submitted_at is null)
    or status in ('cancelled', 'expired')
    or (status in ('pending_approval', 'approved', 'executed') and submitted_at is not null)
  ),
  check ((status in ('approved', 'executed')) = (approved_at is not null)),
  check ((status = 'cancelled') = (cancelled_at is not null)),
  check ((status = 'executed') = (executed_at is not null)),
  check ((status = 'draft') or version_hash is not null)
);

create unique index profile_transfer_plans_open_link_idx
  on public.profile_transfer_plans (verified_account_link_id)
  where status in ('draft', 'pending_approval', 'approved');
create index profile_transfer_plans_preview_idx on public.profile_transfer_plans (preview_id);

create table public.profile_transfer_plan_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.profile_transfer_plans(id) on delete cascade,
  domain text not null check (domain in ('skills', 'courses', 'experience')),
  source_record_id uuid not null,
  durable_record_id uuid,
  record_label text not null,
  action text not null check (action in ('move', 'keep_durable', 'use_source', 'unresolved')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (plan_id, domain, source_record_id),
  check ((durable_record_id is null) = (action = 'move')),
  check ((action <> 'unresolved') or durable_record_id is not null)
);

create index profile_transfer_plan_items_plan_idx
  on public.profile_transfer_plan_items (plan_id, domain, action);

create table public.profile_transfer_plan_approvals (
  plan_id uuid not null references public.profile_transfer_plans(id) on delete cascade,
  auth_account_id uuid not null references public.person_auth_accounts(id) on delete restrict,
  version_hash text not null,
  approved_at timestamptz not null default now(),
  primary key (plan_id, auth_account_id)
);

create table public.profile_transfer_plan_events (
  id bigint generated always as identity primary key,
  plan_id uuid not null references public.profile_transfer_plans(id) on delete restrict,
  actor_auth_account_id uuid references public.person_auth_accounts(id) on delete set null,
  event_type text not null check (event_type in (
    'created', 'conflict_resolved', 'submitted', 'approved',
    'approval_withdrawn', 'cancelled', 'expired', 'executed'
  )),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index profile_transfer_plan_events_plan_idx
  on public.profile_transfer_plan_events (plan_id, created_at);

alter table public.profile_transfer_plans enable row level security;
alter table public.profile_transfer_plan_items enable row level security;
alter table public.profile_transfer_plan_approvals enable row level security;
alter table public.profile_transfer_plan_events enable row level security;

revoke all on public.profile_transfer_plans, public.profile_transfer_plan_items,
  public.profile_transfer_plan_approvals from anon, authenticated;
revoke all on public.profile_transfer_plan_events from anon, authenticated;
grant select on public.profile_transfer_plans, public.profile_transfer_plan_items,
  public.profile_transfer_plan_approvals to authenticated;
grant select on public.profile_transfer_plan_events to authenticated;

-- The ownership helper is used inside the policies below. Its body only
-- returns the caller's own active account for the supplied active link.
grant execute on function private.current_link_account(uuid) to authenticated;

create policy "Linked accounts can view their transfer plans"
  on public.profile_transfer_plans for select to authenticated
  using (private.current_link_account(verified_account_link_id) is not null);

create policy "Linked accounts can view their transfer plan items"
  on public.profile_transfer_plan_items for select to authenticated
  using (exists (
    select 1 from public.profile_transfer_plans plan
    where plan.id = profile_transfer_plan_items.plan_id
      and private.current_link_account(plan.verified_account_link_id) is not null
  ));

create policy "Linked accounts can view their transfer plan approvals"
  on public.profile_transfer_plan_approvals for select to authenticated
  using (exists (
    select 1 from public.profile_transfer_plans plan
    where plan.id = profile_transfer_plan_approvals.plan_id
      and private.current_link_account(plan.verified_account_link_id) is not null
  ));

create policy "Linked accounts can view their transfer plan audit events"
  on public.profile_transfer_plan_events for select to authenticated
  using (exists (
    select 1 from public.profile_transfer_plans plan
    where plan.id = profile_transfer_plan_events.plan_id
      and private.current_link_account(plan.verified_account_link_id) is not null
  ));

create or replace function private.profile_transfer_plan_hash(p_plan_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select encode(extensions.digest(
    convert_to(jsonb_build_object(
      'planId', plan.id,
      'previewId', plan.preview_id,
      'sourceProfileId', plan.source_profile_id,
      'durableProfileId', plan.durable_profile_id,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', item.id, 'domain', item.domain,
          'sourceRecordId', item.source_record_id,
          'durableRecordId', item.durable_record_id,
          'action', item.action, 'metadata', item.metadata
        ) order by item.domain, item.source_record_id)
        from public.profile_transfer_plan_items item where item.plan_id = plan.id
      ), '[]'::jsonb)
    )::text, 'utf8'), 'sha256'), 'hex')
  from public.profile_transfer_plans plan where plan.id = p_plan_id
$$;
revoke all on function private.profile_transfer_plan_hash(uuid) from public, anon, authenticated;

create or replace function public.create_profile_transfer_plan(
  p_preview_id uuid,
  p_durable_profile_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_preview public.profile_transfer_previews;
  v_link public.verified_account_links;
  v_account_id uuid;
  v_profile_a uuid;
  v_profile_b uuid;
  v_source_profile_id uuid;
  v_source_user_id uuid;
  v_durable_user_id uuid;
  v_plan_id uuid;
begin
  select * into v_preview from public.profile_transfer_previews where id = p_preview_id for update;
  if v_preview.id is null or v_preview.status <> 'approved' or v_preview.expires_at <= now() then
    raise exception 'Approved transfer preview not found';
  end if;
  v_account_id := private.current_link_account(v_preview.verified_account_link_id);
  if v_account_id is null then raise exception 'Active verified account link not found'; end if;
  select * into v_link from public.verified_account_links where id = v_preview.verified_account_link_id;

  select learning_profile.id into v_profile_a
  from public.person_auth_accounts account
  join public.learning_profiles learning_profile on learning_profile.legacy_user_id = account.auth_user_id
  where account.id = v_link.auth_account_a_id and learning_profile.profile_type = 'personal';
  select learning_profile.id into v_profile_b
  from public.person_auth_accounts account
  join public.learning_profiles learning_profile on learning_profile.legacy_user_id = account.auth_user_id
  where account.id = v_link.auth_account_b_id and learning_profile.profile_type = 'personal';

  if p_durable_profile_id not in (v_profile_a, v_profile_b) then
    raise exception 'Durable profile must belong to the verified account link';
  end if;
  v_source_profile_id := case when p_durable_profile_id = v_profile_a then v_profile_b else v_profile_a end;
  select legacy_user_id into v_source_user_id from public.learning_profiles where id = v_source_profile_id;
  select legacy_user_id into v_durable_user_id from public.learning_profiles where id = p_durable_profile_id;

  update public.profile_transfer_plans set status = 'expired', approved_at = null, updated_at = now()
  where verified_account_link_id = v_link.id
    and status in ('draft', 'pending_approval', 'approved') and expires_at <= now();
  if exists (select 1 from public.profile_transfer_plans where verified_account_link_id = v_link.id and status in ('draft', 'pending_approval', 'approved')) then
    raise exception 'An active transfer plan already exists';
  end if;

  insert into public.profile_transfer_plans (
    preview_id, verified_account_link_id, source_profile_id, durable_profile_id,
    created_by_auth_account_id
  ) values (p_preview_id, v_link.id, v_source_profile_id, p_durable_profile_id, v_account_id)
  returning id into v_plan_id;

  insert into public.profile_transfer_plan_items
    (plan_id, domain, source_record_id, durable_record_id, record_label, action, metadata)
  select v_plan_id, 'skills', source.id, durable.id, source.name,
    case when durable.id is null then 'move' else 'unresolved' end,
    jsonb_build_object(
      'sourceLevel', source.level, 'durableLevel', durable.level,
      'sourceFingerprint', encode(extensions.digest(convert_to(to_jsonb(source)::text, 'utf8'), 'sha256'), 'hex'),
      'durableFingerprint', durable.fingerprint
    )
  from public.skills source
  left join lateral (
    select target.id, target.level,
      encode(extensions.digest(convert_to(to_jsonb(target)::text, 'utf8'), 'sha256'), 'hex') as fingerprint
    from public.skills target
    where target.user_id = v_durable_user_id and lower(trim(target.name)) = lower(trim(source.name))
    order by target.date_added desc limit 1
  ) durable on true
  where source.user_id = v_source_user_id;

  insert into public.profile_transfer_plan_items
    (plan_id, domain, source_record_id, durable_record_id, record_label, action, metadata)
  select v_plan_id, 'courses', source.id, durable.id, source.name,
    case when durable.id is null then 'move' else 'unresolved' end,
    jsonb_build_object(
      'sourceProvider', source.provider, 'durableProvider', durable.provider,
      'sourceFingerprint', encode(extensions.digest(convert_to(to_jsonb(source)::text, 'utf8'), 'sha256'), 'hex'),
      'durableFingerprint', durable.fingerprint
    )
  from public.courses source
  left join lateral (
    select target.id, target.provider,
      encode(extensions.digest(convert_to(to_jsonb(target)::text, 'utf8'), 'sha256'), 'hex') as fingerprint
    from public.courses target
    where target.user_id = v_durable_user_id and lower(trim(target.name)) = lower(trim(source.name))
    order by target.created_at desc limit 1
  ) durable on true
  where source.user_id = v_source_user_id;

  insert into public.profile_transfer_plan_items
    (plan_id, domain, source_record_id, durable_record_id, record_label, action, metadata)
  select v_plan_id, 'experience', source.id, durable.id, source.title,
    case when durable.id is null then 'move' else 'unresolved' end,
    jsonb_build_object(
      'sourceOrganization', source.organization, 'durableOrganization', durable.organization,
      'sourceFingerprint', encode(extensions.digest(convert_to(to_jsonb(source)::text, 'utf8'), 'sha256'), 'hex'),
      'durableFingerprint', durable.fingerprint
    )
  from public.experience source
  left join lateral (
    select target.id, target.organization,
      encode(extensions.digest(convert_to(to_jsonb(target)::text, 'utf8'), 'sha256'), 'hex') as fingerprint
    from public.experience target
    where target.user_id = v_durable_user_id
      and lower(trim(target.title)) = lower(trim(source.title))
      and lower(trim(coalesce(target.organization, ''))) = lower(trim(coalesce(source.organization, '')))
    order by target.created_at desc limit 1
  ) durable on true
  where source.user_id = v_source_user_id;
  insert into public.profile_transfer_plan_events (plan_id, actor_auth_account_id, event_type, details)
  values (v_plan_id, v_account_id, 'created', jsonb_build_object('durableProfileId', p_durable_profile_id));
  return v_plan_id;
end
$$;

create or replace function public.resolve_profile_transfer_plan_item(
  p_plan_id uuid, p_item_id uuid, p_action text
) returns void language plpgsql security definer set search_path = '' as $$
declare v_plan public.profile_transfer_plans;
begin
  select * into v_plan from public.profile_transfer_plans where id = p_plan_id for update;
  if v_plan.id is null or v_plan.status <> 'draft' or v_plan.expires_at <= now()
     or private.current_link_account(v_plan.verified_account_link_id) is null then
    raise exception 'Editable transfer plan not found';
  end if;
  if p_action not in ('keep_durable', 'use_source') then raise exception 'Invalid conflict resolution'; end if;
  update public.profile_transfer_plan_items
  set action = p_action
  where id = p_item_id and plan_id = p_plan_id and durable_record_id is not null;
  if not found then raise exception 'Conflict item not found'; end if;
  insert into public.profile_transfer_plan_events (plan_id, actor_auth_account_id, event_type, details)
  values (p_plan_id, private.current_link_account(v_plan.verified_account_link_id), 'conflict_resolved',
    jsonb_build_object('itemId', p_item_id, 'action', p_action));
end
$$;

create or replace function public.submit_profile_transfer_plan(p_plan_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_plan public.profile_transfer_plans; v_account_id uuid; v_hash text;
begin
  select * into v_plan from public.profile_transfer_plans where id = p_plan_id for update;
  v_account_id := private.current_link_account(v_plan.verified_account_link_id);
  if v_plan.id is null or v_plan.status <> 'draft' or v_plan.expires_at <= now() or v_account_id is null then
    raise exception 'Editable transfer plan not found';
  end if;
  if exists (select 1 from public.profile_transfer_plan_items where plan_id = p_plan_id and action = 'unresolved') then
    raise exception 'Resolve every conflict before requesting approval';
  end if;
  v_hash := private.profile_transfer_plan_hash(p_plan_id);
  update public.profile_transfer_plans set status = 'pending_approval', version_hash = v_hash,
    submitted_at = now(), updated_at = now() where id = p_plan_id;
  insert into public.profile_transfer_plan_approvals (plan_id, auth_account_id, version_hash)
  values (p_plan_id, v_account_id, v_hash);
  insert into public.profile_transfer_plan_events (plan_id, actor_auth_account_id, event_type, details)
  values (p_plan_id, v_account_id, 'submitted', jsonb_build_object('versionHash', v_hash));
  return v_hash;
end
$$;

create or replace function public.approve_profile_transfer_plan(p_plan_id uuid, p_version_hash text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_plan public.profile_transfer_plans; v_account_id uuid;
begin
  select * into v_plan from public.profile_transfer_plans where id = p_plan_id for update;
  v_account_id := private.current_link_account(v_plan.verified_account_link_id);
  if v_plan.id is null or v_plan.status <> 'pending_approval' or v_plan.expires_at <= now() or v_account_id is null then
    raise exception 'Transfer plan awaiting approval not found';
  end if;
  if p_version_hash is distinct from v_plan.version_hash
     or private.profile_transfer_plan_hash(p_plan_id) is distinct from v_plan.version_hash then
    raise exception 'Transfer plan version has changed';
  end if;
  insert into public.profile_transfer_plan_approvals (plan_id, auth_account_id, version_hash)
  values (p_plan_id, v_account_id, v_plan.version_hash) on conflict do nothing;
  insert into public.profile_transfer_plan_events (plan_id, actor_auth_account_id, event_type, details)
  select p_plan_id, v_account_id, 'approved', jsonb_build_object('versionHash', v_plan.version_hash)
  where not exists (
    select 1 from public.profile_transfer_plan_events event
    where event.plan_id = p_plan_id and event.actor_auth_account_id = v_account_id
      and event.event_type = 'approved' and event.details ->> 'versionHash' = v_plan.version_hash
  );
  if (select count(*) from public.profile_transfer_plan_approvals where plan_id = p_plan_id and version_hash = v_plan.version_hash) = 2 then
    update public.profile_transfer_plans set status = 'approved', approved_at = now(), updated_at = now()
    where id = p_plan_id;
  end if;
end
$$;

create or replace function public.withdraw_profile_transfer_plan_approval(p_plan_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_plan public.profile_transfer_plans; v_account_id uuid;
begin
  select * into v_plan from public.profile_transfer_plans where id = p_plan_id for update;
  v_account_id := private.current_link_account(v_plan.verified_account_link_id);
  if v_plan.id is null or v_plan.status not in ('pending_approval', 'approved') or v_account_id is null then
    raise exception 'Active submitted transfer plan not found';
  end if;
  delete from public.profile_transfer_plan_approvals where plan_id = p_plan_id and auth_account_id = v_account_id;
  if not found then raise exception 'Approval not found'; end if;
  update public.profile_transfer_plans set status = 'pending_approval', approved_at = null, updated_at = now()
  where id = p_plan_id;
  insert into public.profile_transfer_plan_events (plan_id, actor_auth_account_id, event_type, details)
  values (p_plan_id, v_account_id, 'approval_withdrawn', jsonb_build_object('versionHash', v_plan.version_hash));
end
$$;

create or replace function public.cancel_profile_transfer_plan(p_plan_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.profile_transfer_plans plan set status = 'cancelled', cancelled_at = now(),
    approved_at = null, updated_at = now()
  where plan.id = p_plan_id and plan.status in ('draft', 'pending_approval', 'approved')
    and private.current_link_account(plan.verified_account_link_id) is not null;
  if not found then raise exception 'Active transfer plan not found'; end if;
  insert into public.profile_transfer_plan_events (plan_id, actor_auth_account_id, event_type)
  values (p_plan_id, private.current_link_account((select verified_account_link_id from public.profile_transfer_plans where id = p_plan_id)), 'cancelled');
end
$$;

create or replace function public.list_my_profile_transfer_plans()
returns table (
  plan_id uuid, preview_id uuid, link_id uuid, status text, version_hash text,
  source_profile_id uuid, source_email text, durable_profile_id uuid, durable_email text,
  approved_by_me boolean, approval_count integer, expires_at timestamptz
) language sql stable security definer set search_path = '' as $$
  select plan.id, plan.preview_id, plan.verified_account_link_id,
    case when plan.status in ('draft', 'pending_approval', 'approved') and plan.expires_at <= now() then 'expired' else plan.status end,
    plan.version_hash, plan.source_profile_id, source_user.email,
    plan.durable_profile_id, durable_user.email,
    exists (select 1 from public.profile_transfer_plan_approvals approval
      where approval.plan_id = plan.id and approval.auth_account_id = mine.id
        and approval.version_hash = plan.version_hash),
    (select count(*)::integer from public.profile_transfer_plan_approvals approval
      where approval.plan_id = plan.id and approval.version_hash = plan.version_hash),
    plan.expires_at
  from public.profile_transfer_plans plan
  join public.person_auth_accounts mine on mine.id = private.current_link_account(plan.verified_account_link_id)
  join public.learning_profiles source_profile on source_profile.id = plan.source_profile_id
  join auth.users source_user on source_user.id = source_profile.legacy_user_id
  join public.learning_profiles durable_profile on durable_profile.id = plan.durable_profile_id
  join auth.users durable_user on durable_user.id = durable_profile.legacy_user_id
  order by plan.created_at desc
$$;

create or replace function public.get_profile_transfer_plan(p_plan_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_plan public.profile_transfer_plans;
begin
  select * into v_plan from public.profile_transfer_plans where id = p_plan_id;
  if v_plan.id is null or private.current_link_account(v_plan.verified_account_link_id) is null then
    raise exception 'Transfer plan not found';
  end if;
  return jsonb_build_object(
    'id', v_plan.id, 'status', case when v_plan.status in ('draft', 'pending_approval', 'approved') and v_plan.expires_at <= now() then 'expired' else v_plan.status end,
    'versionHash', v_plan.version_hash, 'sourceProfileId', v_plan.source_profile_id,
    'durableProfileId', v_plan.durable_profile_id, 'expiresAt', v_plan.expires_at,
    'approvedByMe', exists (select 1 from public.profile_transfer_plan_approvals approval
      where approval.plan_id = v_plan.id and approval.auth_account_id = private.current_link_account(v_plan.verified_account_link_id)
        and approval.version_hash = v_plan.version_hash),
    'approvalCount', (select count(*) from public.profile_transfer_plan_approvals approval
      where approval.plan_id = v_plan.id and approval.version_hash = v_plan.version_hash),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'id', item.id, 'domain', item.domain, 'sourceRecordId', item.source_record_id,
      'durableRecordId', item.durable_record_id, 'label', item.record_label,
      'action', item.action, 'metadata', item.metadata
    ) order by item.domain, item.record_label) from public.profile_transfer_plan_items item where item.plan_id = v_plan.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object(
      'type', event.event_type, 'details', event.details, 'createdAt', event.created_at
    ) order by event.created_at) from public.profile_transfer_plan_events event where event.plan_id = v_plan.id), '[]'::jsonb)
  );
end
$$;

revoke all on function public.create_profile_transfer_plan(uuid, uuid),
  public.resolve_profile_transfer_plan_item(uuid, uuid, text), public.submit_profile_transfer_plan(uuid),
  public.approve_profile_transfer_plan(uuid, text), public.withdraw_profile_transfer_plan_approval(uuid),
  public.cancel_profile_transfer_plan(uuid), public.list_my_profile_transfer_plans(),
  public.get_profile_transfer_plan(uuid) from public, anon;
grant execute on function public.create_profile_transfer_plan(uuid, uuid),
  public.resolve_profile_transfer_plan_item(uuid, uuid, text), public.submit_profile_transfer_plan(uuid),
  public.approve_profile_transfer_plan(uuid, text), public.withdraw_profile_transfer_plan_approval(uuid),
  public.cancel_profile_transfer_plan(uuid), public.list_my_profile_transfer_plans(),
  public.get_profile_transfer_plan(uuid) to authenticated;
