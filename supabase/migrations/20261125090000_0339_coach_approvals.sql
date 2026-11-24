-- Coaches approved by LearnScope (after 0335-0338).
--
-- Until now the only way to offer coaching on a skill was to have it
-- validated by another person who has the skill. A platform admin can now
-- also approve someone as a coach for a library skill they have -- say, a
-- professional coach vetted outside the app. An approval only lets them
-- offer coaching: it doesn't validate the skill or change its level, and
-- others see the coach as "Approved by LearnScope", not as validated. An
-- admin can withdraw it; coaching then stops unless the person also
-- qualifies through validation. Both are logged, and nothing is deleted. An
-- approval is for the person and library skill, so it carries on if they
-- delete the skill and add it again. Nobody approves themselves.
--
-- Not destructive: one new table and functions; the coaching guard (0335)
-- and list_skill_matches (0335) are replaced. Rollback: drop the new table
-- and functions, and restore those two from 0335.

create table public.coach_approvals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  library_skill_id uuid not null references public.skill_library(id) on delete cascade,
  note text check (note is null or char_length(note) <= 500),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz not null default now(),
  revoked_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  -- When coaching was last started through this approval (for the 30-day
  -- "a coach is now available" rule, which a skill deleted and added again
  -- would otherwise reset).
  last_offered_at timestamptz,
  check (revoked_at is not null or revoked_by is null)
);

-- One approval in force per person and skill.
create unique index coach_approvals_active_idx
  on public.coach_approvals (user_id, library_skill_id) where revoked_at is null;

alter table public.coach_approvals enable row level security;
revoke all on public.coach_approvals from anon, authenticated;
-- People read their own approvals through list_my_coach_approvals; admins
-- through admin_list_coach_approvals. No direct access.

-- Whether someone is approved as a coach for a library skill right now.
create function private.is_approved_coach(p_user_id uuid, p_library_skill_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.coach_approvals a
    where a.user_id = p_user_id and a.library_skill_id = p_library_skill_id and a.revoked_at is null
  )
$$;

revoke all on function private.is_approved_coach(uuid, uuid) from public, anon, authenticated;

-- Whether a skill qualifies for coaching through validation, as in 0335:
-- validated or maintained, with a confirmed validation from someone who has
-- the same library skill. Shared by the guard and by withdrawing an
-- approval, so the two can't drift apart.
create function private.coach_validation_ok(p_skill_id uuid, p_library_skill_id uuid, p_lifecycle_stage text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_library_skill_id is not null
    and p_lifecycle_stage in ('validated', 'maintained')
    and exists (
      select 1
      from public.skill_validation_requests v
      join public.skills validator_skill
        on validator_skill.user_id = v.validator_id
       and validator_skill.library_skill_id = p_library_skill_id
      where v.skill_id = p_skill_id and v.status = 'confirmed'
    )
$$;

revoke all on function private.coach_validation_ok(uuid, uuid, text) from public, anon, authenticated;

-- As in 0335, but a LearnScope approval for the skill also qualifies.
create or replace function private.guard_skill_coaching_offer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was_offered_at timestamptz := case when tg_op = 'UPDATE' then old.coaching_offered_at end;
  v_approval_id uuid;
  v_approval_offered_at timestamptz;
begin
  new.coaching_offered_at := v_was_offered_at;

  if not new.offer_coaching then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.library_skill_id is distinct from old.library_skill_id then
    if old.offer_coaching then
      new.offer_coaching := false;
      return new;
    end if;
    raise exception 'You can offer coaching on a skill once another person has validated it'
      using errcode = 'check_violation';
  end if;

  -- An approval in force, locked so it can't be withdrawn while this check
  -- is deciding on it (withdrawing then waits, and re-checks after).
  if new.library_skill_id is not null then
    select a.id, a.last_offered_at into v_approval_id, v_approval_offered_at
    from public.coach_approvals a
    where a.user_id = new.user_id and a.library_skill_id = new.library_skill_id and a.revoked_at is null
    for share;
  end if;

  if not (
    new.library_skill_id is not null
    and (
      v_approval_id is not null
      or private.coach_validation_ok(new.id, new.library_skill_id, new.lifecycle_stage)
    )
  ) then
    if tg_op = 'UPDATE' and old.offer_coaching then
      new.offer_coaching := false;
      return new;
    end if;
    raise exception 'You can offer coaching on a skill once another person has validated it'
      using errcode = 'check_violation';
  end if;

  if not (tg_op = 'UPDATE' and old.offer_coaching) then
    -- Through an approval, the approval's own last start counts too, so a
    -- skill deleted and added again doesn't announce it afresh.
    v_was_offered_at := greatest(v_was_offered_at, v_approval_offered_at);
    if v_was_offered_at is null or v_was_offered_at < now() - interval '30 days' then
      new.coaching_offered_at := now();
    else
      new.coaching_offered_at := v_was_offered_at;
    end if;
    if v_approval_id is not null then
      update public.coach_approvals set last_offered_at = new.coaching_offered_at where id = v_approval_id;
    end if;
  end if;
  return new;
end;
$$;

-- The caller's approvals, in force or withdrawn, each with their own skill
-- for it (to open its settings).
create function public.list_my_coach_approvals()
returns table (
  id uuid,
  library_skill_id uuid,
  skill_name text,
  skill_id uuid,
  approved_at timestamptz,
  revoked_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.library_skill_id, sl.name,
         (select s.id from public.skills s
          where s.user_id = a.user_id and s.library_skill_id = a.library_skill_id
          order by s.date_added limit 1),
         a.approved_at, a.revoked_at
  from public.coach_approvals a
  join public.skill_library sl on sl.id = a.library_skill_id
  where a.user_id = (select auth.uid())
  order by a.approved_at desc
$$;

-- Platform admins: a person's approvals, newest first.
create function public.admin_list_coach_approvals(p_user_id uuid)
returns table (
  id uuid,
  library_skill_id uuid,
  skill_name text,
  note text,
  approved_at timestamptz,
  approved_by_label text,
  revoked_at timestamptz,
  revoked_by_label text
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
  select a.id, a.library_skill_id, sl.name, a.note, a.approved_at,
         case when a.approved_by is null then null else public.admin_activity_actor_label(a.approved_by) end,
         a.revoked_at,
         case when a.revoked_by is null then null else public.admin_activity_actor_label(a.revoked_by) end
  from public.coach_approvals a
  join public.skill_library sl on sl.id = a.library_skill_id
  where a.user_id = p_user_id
  order by a.approved_at desc;
end;
$$;

-- Platform admins: approve a person as a coach for a library skill they
-- have. Logged.
create function public.admin_approve_coach(p_user_id uuid, p_library_skill_id uuid, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_skill_name text;
  v_id uuid;
begin
  if not public.is_platform_admin(v_caller) then
    raise insufficient_privilege using message = 'Platform administrator access required';
  end if;
  -- As nobody validates their own skill: another administrator approves.
  if p_user_id = v_caller then
    raise insufficient_privilege using message = 'You can''t approve yourself as a coach. Ask another administrator.';
  end if;
  if not exists (
    select 1 from public.skills s where s.user_id = p_user_id and s.library_skill_id = p_library_skill_id
  ) then
    raise exception 'This person doesn''t have that skill';
  end if;
  if private.is_approved_coach(p_user_id, p_library_skill_id) then
    raise exception 'This person is already approved as a coach for that skill';
  end if;
  select name into v_skill_name from public.skill_library where id = p_library_skill_id;

  insert into public.coach_approvals (user_id, library_skill_id, note, approved_by)
  values (p_user_id, p_library_skill_id, nullif(btrim(left(p_note, 500)), ''), v_caller)
  returning id into v_id;

  insert into public.admin_activity_log (actor_id, actor_label, action, entity_type, entity_id, entity_label)
  values (v_caller, public.admin_activity_actor_label(v_caller), 'coach_approval.granted', 'coach_approval', v_id,
    public.admin_activity_actor_label(p_user_id) || ' as a coach in ' || coalesce(v_skill_name, 'a skill'));
  return v_id;
end;
$$;

-- Platform admins: withdraw an approval. Coaching on that skill stops unless
-- the person also qualifies through validation. Logged.
create function public.admin_revoke_coach_approval(p_approval_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_approval public.coach_approvals%rowtype;
  v_skill_name text;
begin
  if not public.is_platform_admin(v_caller) then
    raise insufficient_privilege using message = 'Platform administrator access required';
  end if;
  update public.coach_approvals
  set revoked_at = now(), revoked_by = v_caller
  where id = p_approval_id and revoked_at is null
  returning * into v_approval;
  if not found then
    raise exception 'Approval not found';
  end if;

  -- Coaching on it stops unless the skill qualifies through validation.
  update public.skills s
  set offer_coaching = false
  where s.user_id = v_approval.user_id and s.library_skill_id = v_approval.library_skill_id and s.offer_coaching
    and not private.coach_validation_ok(s.id, s.library_skill_id, s.lifecycle_stage);

  select name into v_skill_name from public.skill_library where id = v_approval.library_skill_id;
  insert into public.admin_activity_log (actor_id, actor_label, action, entity_type, entity_id, entity_label)
  values (v_caller, public.admin_activity_actor_label(v_caller), 'coach_approval.revoked', 'coach_approval', v_approval.id,
    public.admin_activity_actor_label(v_approval.user_id) || ' as a coach in ' || coalesce(v_skill_name, 'a skill'));
end;
$$;

revoke all on function public.list_my_coach_approvals() from public, anon;
revoke all on function public.admin_list_coach_approvals(uuid) from public, anon;
revoke all on function public.admin_approve_coach(uuid, uuid, text) from public, anon;
revoke all on function public.admin_revoke_coach_approval(uuid) from public, anon;
grant execute on function public.list_my_coach_approvals() to authenticated;
grant execute on function public.admin_list_coach_approvals(uuid) to authenticated;
grant execute on function public.admin_approve_coach(uuid, uuid, text) to authenticated;
grant execute on function public.admin_revoke_coach_approval(uuid) to authenticated;

-- Find an expert: as in 0335, plus whether a coach is approved by LearnScope
-- (shown as such, not as validated).
drop function public.list_skill_matches(uuid);

create function public.list_skill_matches(p_library_skill_id uuid)
returns table (
  user_id uuid,
  full_name text,
  avatar_url text,
  level int,
  lifecycle_stage text,
  is_connection boolean,
  profile_viewable boolean,
  has_pending_request boolean,
  is_coach boolean,
  coach_skill_id uuid,
  my_coaching_status text,
  coach_approved boolean
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select
    s.user_id,
    p.full_name,
    p.avatar_url,
    s.level,
    s.lifecycle_stage,
    public.is_connected(auth.uid(), s.user_id) as is_connection,
    (p.profile_visible_to_skill_matches or public.is_connected(auth.uid(), s.user_id)) as profile_viewable,
    exists (
      select 1 from public.connection_requests cr
      where cr.status = 'pending'
        and ((cr.requester_id = auth.uid() and cr.recipient_id = s.user_id)
          or (cr.requester_id = s.user_id and cr.recipient_id = auth.uid()))
    ) as has_pending_request,
    s.offer_coaching as is_coach,
    case when s.offer_coaching then s.id end as coach_skill_id,
    (
      select r.status from public.coaching_relationships r
      where r.learner_id = auth.uid() and r.coach_id = s.user_id
        and r.library_skill_id = p_library_skill_id
        and r.status in ('requested', 'active')
      order by r.requested_at desc
      limit 1
    ) as my_coaching_status,
    s.offer_coaching and private.is_approved_coach(s.user_id, p_library_skill_id) as coach_approved
  from public.skills s
  join public.profiles p on p.id = s.user_id
  where s.library_skill_id = p_library_skill_id
    and s.user_id <> auth.uid()
    and (
      s.offer_coaching
      or p.skill_search_visibility = 'all'
      or (
        p.skill_search_visibility = 'selective'
        and exists (
          select 1 from public.profile_searchable_skills pss
          where pss.profile_id = s.user_id and pss.skill_id = s.id
        )
      )
    )
  order by p.full_name nulls last;
$$;

revoke all on function public.list_skill_matches(uuid) from public, anon;
grant execute on function public.list_skill_matches(uuid) to authenticated;
