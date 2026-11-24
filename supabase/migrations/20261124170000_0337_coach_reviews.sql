-- Reviews of a coach (phase 4 of coaching on a skill, after 0335 and 0336).
--
-- Once at least one session has been marked done, the learner can review
-- their coach: 1-5 stars and an optional comment, one review per coaching
-- relationship, which they can change or delete. Reviews are named -- shown
-- with the learner's name and picture -- to anyone looking at that coach
-- for that skill while the coach offers coaching on it (the learner is told
-- this before saving). The coach always sees reviews about them, and can't
-- change or delete them.
--
-- Not destructive: one new table and its functions. Rollback: drop them.

create table public.coach_reviews (
  id uuid primary key default gen_random_uuid(),
  relationship_id uuid not null unique references public.coaching_relationships(id) on delete cascade,
  learner_id uuid not null references auth.users(id) on delete cascade,
  coach_id uuid not null references auth.users(id) on delete cascade,
  library_skill_id uuid references public.skill_library(id) on delete set null,
  rating smallint not null check (rating between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index coach_reviews_coach_idx on public.coach_reviews (coach_id, library_skill_id);
create index coach_reviews_learner_idx on public.coach_reviews (learner_id);

alter table public.coach_reviews enable row level security;

-- The learner reads their own reviews directly; everyone else goes through
-- the functions below. All changes go through the functions too.
create policy "Learners see the reviews they wrote"
  on public.coach_reviews for select
  to authenticated
  using (learner_id = (select auth.uid()));

revoke all on public.coach_reviews from anon, authenticated;
grant select on public.coach_reviews to authenticated;

-- Write or change the learner's review of their coach.
create function public.save_coach_review(p_relationship_id uuid, p_rating integer, p_comment text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_relationship public.coaching_relationships%rowtype;
  v_id uuid;
begin
  select * into v_relationship from public.coaching_relationships
  where id = p_relationship_id and learner_id = (select auth.uid());
  if not found then
    raise exception 'Coaching not found';
  end if;
  if v_relationship.status not in ('active', 'ended') then
    raise exception 'You can review coaching once it has started';
  end if;
  if not exists (
    select 1 from public.coaching_sessions s
    where s.relationship_id = v_relationship.id and s.status = 'done'
  ) then
    raise exception 'You can review your coach after a session you''ve marked done';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception 'Choose from 1 to 5 stars';
  end if;

  insert into public.coach_reviews (relationship_id, learner_id, coach_id, library_skill_id, rating, comment)
  values (v_relationship.id, v_relationship.learner_id, v_relationship.coach_id, v_relationship.library_skill_id,
    p_rating, nullif(btrim(p_comment), ''))
  on conflict (relationship_id) do update
    set rating = excluded.rating, comment = excluded.comment, updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

create function public.delete_coach_review(p_relationship_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.coach_reviews
  where relationship_id = p_relationship_id and learner_id = (select auth.uid());
  if not found then
    raise exception 'Review not found';
  end if;
end;
$$;

-- Whether a coach's reviews in a library skill can be shown to the caller:
-- always to the coach, and to anyone while the coach offers coaching on it.
create function private.can_see_coach_reviews(p_coach_id uuid, p_library_skill_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_coach_id = (select auth.uid())
    or exists (
      select 1 from public.skills s
      where s.user_id = p_coach_id and s.library_skill_id = p_library_skill_id and s.offer_coaching
    )
$$;

-- Each learner's latest review of a coach on a library skill: someone
-- coached more than once by the same coach counts once, not once a time.
create function private.latest_coach_reviews(p_library_skill_id uuid)
returns setof public.coach_reviews
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (r.coach_id, r.learner_id) r.*
  from public.coach_reviews r
  where r.library_skill_id = p_library_skill_id
  order by r.coach_id, r.learner_id, r.updated_at desc
$$;

-- Average stars and how many reviews, for each coach on a library skill
-- (for Find an expert).
create function public.list_coach_ratings(p_library_skill_id uuid)
returns table (coach_id uuid, average_rating numeric, review_count integer)
language sql
stable
security definer
set search_path = ''
as $$
  select r.coach_id, round(avg(r.rating), 1), count(*)::integer
  from private.latest_coach_reviews(p_library_skill_id) r
  where private.can_see_coach_reviews(r.coach_id, p_library_skill_id)
  group by r.coach_id
$$;

-- A coach's reviews on a library skill, newest first, each with the
-- reviewer's name and picture.
create function public.list_coach_reviews(p_coach_id uuid, p_library_skill_id uuid)
returns table (
  id uuid,
  rating smallint,
  comment text,
  reviewer_name text,
  reviewer_avatar_url text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.id,
    r.rating,
    r.comment,
    coalesce(nullif(btrim(p.full_name), ''), 'A LearnScope learner'),
    p.avatar_url,
    r.created_at,
    r.updated_at
  from private.latest_coach_reviews(p_library_skill_id) r
  join public.profiles p on p.id = r.learner_id
  where r.coach_id = p_coach_id
    and private.can_see_coach_reviews(p_coach_id, p_library_skill_id)
  order by r.updated_at desc
  limit 200
$$;

-- Reviews about the caller as a coach, from the last 30 days (for
-- notifications).
create function public.list_my_recent_coach_reviews()
returns table (
  id uuid,
  relationship_id uuid,
  rating smallint,
  reviewer_name text,
  skill_name text,
  coach_skill_id uuid,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.id,
    r.relationship_id,
    r.rating,
    coalesce(nullif(btrim(p.full_name), ''), 'A LearnScope learner'),
    c.skill_name,
    c.coach_skill_id,
    r.updated_at
  from public.coach_reviews r
  join public.coaching_relationships c on c.id = r.relationship_id
  join public.profiles p on p.id = r.learner_id
  where r.coach_id = (select auth.uid())
    and r.updated_at > now() - interval '30 days'
  order by r.updated_at desc
$$;

revoke all on function private.can_see_coach_reviews(uuid, uuid) from public, anon, authenticated;
revoke all on function private.latest_coach_reviews(uuid) from public, anon, authenticated;
revoke all on function public.save_coach_review(uuid, integer, text) from public, anon;
revoke all on function public.delete_coach_review(uuid) from public, anon;
revoke all on function public.list_coach_ratings(uuid) from public, anon;
revoke all on function public.list_coach_reviews(uuid, uuid) from public, anon;
revoke all on function public.list_my_recent_coach_reviews() from public, anon;
grant execute on function public.save_coach_review(uuid, integer, text) to authenticated;
grant execute on function public.delete_coach_review(uuid) to authenticated;
grant execute on function public.list_coach_ratings(uuid) to authenticated;
grant execute on function public.list_coach_reviews(uuid, uuid) to authenticated;
grant execute on function public.list_my_recent_coach_reviews() to authenticated;
