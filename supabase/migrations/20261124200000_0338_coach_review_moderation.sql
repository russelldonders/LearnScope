-- Reporting and moderating coach reviews (after 0337), as shared resources
-- are moderated (0292).
--
-- Anyone who can see a review -- the coach included, but not whoever wrote
-- it -- can report it with a reason. Platform admins see reported reviews,
-- with what was reported beside what the review says now, and either remove
-- one (no one but its author sees it again, it no longer counts towards the
-- coach's stars, and that coaching can't be reviewed again -- even after the
-- author deletes it) or dismiss the reports (it stays as it is). Both are
-- written to the admin activity log. A review changed after its reports were
-- settled can be reported again. Reports on a review its author deletes are
-- closed as withdrawn.
--
-- Not destructive: columns added (empty), one new table, a trigger and
-- functions; latest_coach_reviews, list_coach_reviews,
-- list_my_recent_coach_reviews, save_coach_review (0337) and
-- list_my_coaching (0335) are replaced. Rollback: drop the new table,
-- functions, trigger and columns, and restore those five.

alter table public.coach_reviews
  add column moderation_removed_at timestamptz,
  add column moderation_removed_by uuid references auth.users(id) on delete set null;

-- When moderators removed a review of this coaching: kept on the coaching
-- itself, so deleting the review doesn't make room for a new one.
alter table public.coaching_relationships
  add column review_removed_at timestamptz;

-- The author reads their own review, but not which admin removed it (the
-- admin activity log has that).
revoke select on public.coach_reviews from authenticated;
grant select (
  id, relationship_id, learner_id, coach_id, library_skill_id, rating, comment,
  created_at, updated_at, moderation_removed_at
) on public.coach_reviews to authenticated;

-- Reports. Written and read only through the functions below. What was
-- reported is copied in, so the record survives the review being changed or
-- deleted.
create table public.coach_review_reports (
  id uuid primary key default gen_random_uuid(),
  review_id uuid references public.coach_reviews(id) on delete set null,
  relationship_id uuid references public.coaching_relationships(id) on delete set null,
  coach_id uuid references auth.users(id) on delete set null,
  reviewer_id uuid references auth.users(id) on delete set null,
  review_rating smallint,
  review_comment text,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (reason in ('spam', 'inappropriate', 'misleading', 'other')),
  details text check (details is null or char_length(details) <= 1000),
  -- withdrawn: the author deleted the review before anyone looked at it.
  status text not null default 'open' check (status in ('open', 'removed', 'dismissed', 'withdrawn')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (review_id, reporter_id),
  check ((status = 'open') = (reviewed_at is null))
);

create index coach_review_reports_open_idx on public.coach_review_reports (review_id) where status = 'open';

alter table public.coach_review_reports enable row level security;
revoke all on table public.coach_review_reports from public, anon, authenticated;

-- A review deleted while reported: its open reports are closed, not left
-- open with nothing to look at.
create function private.withdraw_coach_review_reports()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.coach_review_reports
  set status = 'withdrawn', reviewed_at = now()
  where review_id = old.id and status = 'open';
  return old;
end;
$$;

create trigger coach_reviews_withdraw_reports
  before delete on public.coach_reviews
  for each row execute function private.withdraw_coach_review_reports();

-- Reviews others can see leave out removed ones.
create or replace function private.latest_coach_reviews(p_library_skill_id uuid)
returns setof public.coach_reviews
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (r.coach_id, r.learner_id) r.*
  from public.coach_reviews r
  where r.library_skill_id = p_library_skill_id
    and r.moderation_removed_at is null
  order by r.coach_id, r.learner_id, r.updated_at desc
$$;

-- As in 0337, plus whether it's the caller's own and whether they've already
-- reported it as it is now (a report settled before the review last changed
-- doesn't count, so the new version can be reported).
drop function public.list_coach_reviews(uuid, uuid);

create function public.list_coach_reviews(p_coach_id uuid, p_library_skill_id uuid)
returns table (
  id uuid,
  rating smallint,
  comment text,
  reviewer_name text,
  reviewer_avatar_url text,
  created_at timestamptz,
  updated_at timestamptz,
  is_mine boolean,
  reported_by_me boolean
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
    r.updated_at,
    r.learner_id = (select auth.uid()),
    exists (
      select 1 from public.coach_review_reports rep
      where rep.review_id = r.id and rep.reporter_id = (select auth.uid())
        and (rep.status = 'open' or rep.reviewed_at >= r.updated_at)
    )
  from private.latest_coach_reviews(p_library_skill_id) r
  join public.profiles p on p.id = r.learner_id
  where r.coach_id = p_coach_id
    and private.can_see_coach_reviews(p_coach_id, p_library_skill_id)
  order by r.updated_at desc
  limit 200
$$;

revoke all on function public.list_coach_reviews(uuid, uuid) from public, anon;
grant execute on function public.list_coach_reviews(uuid, uuid) to authenticated;

create or replace function public.list_my_recent_coach_reviews()
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
    and r.moderation_removed_at is null
    and r.updated_at > now() - interval '30 days'
  order by r.updated_at desc
$$;

-- As in 0337, but coaching whose review moderators removed can't be
-- reviewed again, whether or not the removed review was deleted since.
create or replace function public.save_coach_review(p_relationship_id uuid, p_rating integer, p_comment text default null)
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
  if v_relationship.review_removed_at is not null then
    raise exception 'LearnScope moderators removed your review of this coaching, so it can''t be reviewed again.';
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

-- As in 0335, plus whether moderators removed the learner's review of it.
drop function public.list_my_coaching();

create function public.list_my_coaching()
returns table (
  id uuid,
  role text,
  status text,
  other_user_id uuid,
  other_name text,
  other_avatar_url text,
  learner_skill_id uuid,
  coach_skill_id uuid,
  library_skill_id uuid,
  skill_name text,
  message text,
  requested_at timestamptz,
  responded_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  ended_by_me boolean,
  review_removed boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.id,
    case when r.learner_id = (select auth.uid()) then 'learner' else 'coach' end,
    r.status,
    other.id,
    coalesce(nullif(btrim(other.full_name), ''), 'A LearnScope learner'),
    other.avatar_url,
    r.learner_skill_id,
    r.coach_skill_id,
    r.library_skill_id,
    r.skill_name,
    r.message,
    r.requested_at,
    r.responded_at,
    r.started_at,
    r.ended_at,
    r.ended_by = (select auth.uid()),
    r.review_removed_at is not null
  from public.coaching_relationships r
  join public.profiles other
    on other.id = case when r.learner_id = (select auth.uid()) then r.coach_id else r.learner_id end
  where (select auth.uid()) in (r.learner_id, r.coach_id)
  order by r.requested_at desc
$$;

revoke all on function public.list_my_coaching() from public, anon;
grant execute on function public.list_my_coaching() to authenticated;

-- Report a review the caller can see (not their own). Reporting again
-- updates a report still waiting for review, or reopens a settled one if the
-- review has changed since.
create function public.report_coach_review(p_review_id uuid, p_reason text, p_details text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_review public.coach_reviews%rowtype;
begin
  if v_caller is null then
    raise insufficient_privilege using message = 'Sign in to report a review';
  end if;
  if p_reason is null or p_reason not in ('spam', 'inappropriate', 'misleading', 'other') then
    raise exception 'Choose a reason for the report';
  end if;
  -- Locked, so a report can't land on a review being removed at that moment.
  select * into v_review from public.coach_reviews where id = p_review_id for share;
  -- The same answer whether it doesn't exist, can't be seen, was removed or
  -- is the caller's own.
  if not found
     or v_review.moderation_removed_at is not null
     or v_review.learner_id = v_caller
     or not private.can_see_coach_reviews(v_review.coach_id, v_review.library_skill_id) then
    raise exception 'Review not found';
  end if;

  insert into public.coach_review_reports (review_id, relationship_id, coach_id, reviewer_id, review_rating, review_comment, reporter_id, reason, details)
  values (v_review.id, v_review.relationship_id, v_review.coach_id, v_review.learner_id, v_review.rating, v_review.comment,
    v_caller, p_reason, nullif(btrim(left(p_details, 1000)), ''))
  on conflict (review_id, reporter_id) do update
    set reason = excluded.reason,
        details = excluded.details,
        review_rating = excluded.review_rating,
        review_comment = excluded.review_comment,
        status = 'open',
        reviewed_by = null,
        reviewed_at = null,
        created_at = case when public.coach_review_reports.status = 'open' then public.coach_review_reports.created_at else now() end
    where public.coach_review_reports.status = 'open'
       or (public.coach_review_reports.status = 'dismissed' and public.coach_review_reports.reviewed_at < v_review.updated_at);
end;
$$;

-- Platform admins: reviews with open reports, most reported first -- what
-- the review says now, and what it said when last reported, if different.
create function public.admin_list_coach_review_reports()
returns table (
  review_id uuid,
  rating smallint,
  comment text,
  reported_rating smallint,
  reported_comment text,
  changed_since_reported boolean,
  skill_name text,
  reviewer_label text,
  coach_label text,
  review_updated_at timestamptz,
  report_count bigint,
  reasons text[],
  details text[],
  reporter_is_coach boolean,
  first_reported_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin((select auth.uid())) then
    raise insufficient_privilege using message = 'Platform administrator access required';
  end if;
  return query
  with open_reports as (
    select rep.* from public.coach_review_reports rep where rep.status = 'open'
  ),
  last_reported as (
    select distinct on (rep.review_id) rep.review_id, rep.review_rating, rep.review_comment
    from open_reports rep
    order by rep.review_id, rep.created_at desc
  )
  select r.id, r.rating, r.comment,
         lr.review_rating, lr.review_comment,
         (lr.review_rating is distinct from r.rating or lr.review_comment is distinct from r.comment),
         c.skill_name,
         public.admin_activity_actor_label(r.learner_id),
         public.admin_activity_actor_label(r.coach_id),
         r.updated_at,
         count(rep.id),
         array_agg(distinct rep.reason),
         array_remove(array_agg(rep.details order by rep.created_at), null),
         bool_or(rep.reporter_id = r.coach_id),
         min(rep.created_at)
  from open_reports rep
  join public.coach_reviews r on r.id = rep.review_id
  join public.coaching_relationships c on c.id = r.relationship_id
  join last_reported lr on lr.review_id = r.id
  where r.moderation_removed_at is null
  group by r.id, c.skill_name, lr.review_rating, lr.review_comment
  order by count(rep.id) desc, min(rep.created_at);
end;
$$;

-- Platform admins: settle a review's open reports. 'remove' hides it from
-- everyone but its author, stops it counting and stops that coaching being
-- reviewed again; 'dismiss' leaves it. Logged either way.
create function public.admin_resolve_coach_review_reports(p_review_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_review public.coach_reviews%rowtype;
  v_label text;
  v_open int;
begin
  if not public.is_platform_admin(v_caller) then
    raise insufficient_privilege using message = 'Platform administrator access required';
  end if;
  if p_action is null or p_action not in ('remove', 'dismiss') then
    raise exception 'Unknown action';
  end if;

  select * into v_review from public.coach_reviews where id = p_review_id for update;
  if not found then
    raise exception 'Review not found';
  end if;
  v_label := 'Review of ' || public.admin_activity_actor_label(v_review.coach_id)
    || ' by ' || public.admin_activity_actor_label(v_review.learner_id);

  update public.coach_review_reports
  set status = case when p_action = 'remove' then 'removed' else 'dismissed' end,
      reviewed_by = v_caller,
      reviewed_at = now()
  where review_id = p_review_id and status = 'open';
  get diagnostics v_open = row_count;
  if v_open = 0 then
    raise exception 'This review has no open reports';
  end if;

  if p_action = 'remove' then
    update public.coach_reviews
    set moderation_removed_at = now(), moderation_removed_by = v_caller
    where id = p_review_id;
    update public.coaching_relationships
    set review_removed_at = now()
    where id = v_review.relationship_id;
  end if;

  insert into public.admin_activity_log (actor_id, actor_label, action, entity_type, entity_id, entity_label)
  values (
    v_caller,
    public.admin_activity_actor_label(v_caller),
    case when p_action = 'remove' then 'coach_review.removed' else 'coach_review.reports_dismissed' end,
    'coach_review',
    p_review_id,
    v_label
  );
end;
$$;

revoke all on function private.withdraw_coach_review_reports() from public, anon, authenticated;
revoke all on function public.report_coach_review(uuid, text, text) from public, anon;
revoke all on function public.admin_list_coach_review_reports() from public, anon;
revoke all on function public.admin_resolve_coach_review_reports(uuid, text) from public, anon;
grant execute on function public.report_coach_review(uuid, text, text) to authenticated;
grant execute on function public.admin_list_coach_review_reports() to authenticated;
grant execute on function public.admin_resolve_coach_review_reports(uuid, text) to authenticated;
