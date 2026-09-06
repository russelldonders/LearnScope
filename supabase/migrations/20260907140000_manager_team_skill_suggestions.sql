-- Lets a team leader suggest a skill to a team member -- mirrors
-- employer_skill_suggestions (20260902230000) exactly, including its core
-- rule: suggesting never creates or modifies the member's own skills/
-- skill_targets rows by itself. What it must NOT do is let the leader
-- write directly onto a learner's own record (that would break learner
-- ownership) -- the member still has to explicitly adopt it via /actions
-- (adoptManagerTeamSkillSuggestion -> findOrCreatePersonalSkill, the same
-- unmodified function every other learner-initiated skill-add path uses)
-- or dismiss it. This table only ever tracks the suggestion's own
-- lifecycle (suggested/adopted/dismissed); it never itself shows up on a
-- learner's skills profile.
--
-- Keyed by membership_id rather than a bare user_id, unlike
-- employer_skill_suggestions -- every other manager-team record (shared
-- skills, ratings, targets) is already membership-scoped, since the same
-- person could belong to more than one team.
create table manager_team_skill_suggestions (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references manager_team_memberships(id) on delete cascade,
  skill_library_id uuid not null references skill_library(id),
  skill_name text not null,
  suggested_target_level int check (suggested_target_level between 1 and 5),
  target_date date,
  comments text,
  suggested_by uuid not null references auth.users(id),
  status text not null default 'suggested' check (status in ('suggested', 'adopted', 'dismissed')),
  created_at timestamptz not null default now(),
  unique (membership_id, skill_library_id)
);

create index manager_team_skill_suggestions_membership_idx on manager_team_skill_suggestions (membership_id);

alter table manager_team_skill_suggestions enable row level security;

create policy "Member and their team leader can view skill suggestions"
  on manager_team_skill_suggestions for select to authenticated using (
    exists (
      select 1 from manager_team_memberships m
      where m.id = membership_id
        and (m.member_user_id = (select auth.uid()) or private.can_manage_manager_team(m.team_id, (select auth.uid())))
    )
  );

-- Column-grain, same reasoning as employer_skill_suggestions' own update
-- policy: RLS USING/WITH CHECK only gates which rows are touched, not which
-- columns change within them, so the grant itself is narrowed to just the
-- learner-facing status transition.
create policy "Members can update their own suggestion status"
  on manager_team_skill_suggestions for update to authenticated
  using (exists (select 1 from manager_team_memberships m where m.id = membership_id and m.member_user_id = (select auth.uid())))
  with check (exists (select 1 from manager_team_memberships m where m.id = membership_id and m.member_user_id = (select auth.uid())));

create policy "Team leaders can delete a suggestion they made"
  on manager_team_skill_suggestions for delete to authenticated using (
    exists (select 1 from manager_team_memberships m where m.id = membership_id and private.can_manage_manager_team(m.team_id, (select auth.uid())))
  );

grant select, delete on table manager_team_skill_suggestions to authenticated;
grant update (status) on table manager_team_skill_suggestions to authenticated;

-- Validated-insert-with-on-conflict, mirroring suggest_skill_to_employer_
-- members' shape: only resets a previously-'dismissed' row back to a fresh
-- 'suggested' one (re-suggesting after a dismiss); an already-'suggested'
-- or 'adopted' row is left untouched (returning null from the insert,
-- surfaced below as a clear error rather than a silent no-op).
create or replace function public.suggest_manager_team_skill(
  p_membership_id uuid, p_skill_library_id uuid, p_skill_name text,
  p_target_level int default null, p_target_date date default null, p_comments text default null
)
returns public.manager_team_skill_suggestions
language plpgsql security definer set search_path = '' as $$
declare v_team_id uuid; v_result public.manager_team_skill_suggestions;
begin
  select team_id into v_team_id from public.manager_team_memberships
  where id = p_membership_id and role = 'member' and status = 'active';
  if v_team_id is null then raise exception 'Active team member not found'; end if;
  if not private.can_manage_manager_team(v_team_id, auth.uid()) then raise exception 'Not authorised'; end if;
  if not exists (select 1 from public.manager_teams where id = v_team_id and status = 'active') then
    raise exception 'This team has been archived and can no longer be changed';
  end if;
  if p_target_level is not null and (p_target_level < 1 or p_target_level > 5) then
    raise exception 'Target level must be between 1 and 5';
  end if;

  insert into public.manager_team_skill_suggestions
    (membership_id, skill_library_id, skill_name, suggested_target_level, target_date, comments, suggested_by)
  values (p_membership_id, p_skill_library_id, trim(p_skill_name), p_target_level, p_target_date, nullif(trim(p_comments), ''), auth.uid())
  on conflict (membership_id, skill_library_id) do update
    set suggested_target_level = excluded.suggested_target_level,
        target_date = excluded.target_date, comments = excluded.comments,
        suggested_by = excluded.suggested_by, created_at = now(), status = 'suggested'
    where manager_team_skill_suggestions.status = 'dismissed'
  returning * into v_result;

  if v_result.id is null then raise exception 'This skill has already been suggested to them'; end if;
  return v_result;
end;
$$;

revoke all on function public.suggest_manager_team_skill(uuid, uuid, text, int, date, text) from public, anon;
grant execute on function public.suggest_manager_team_skill(uuid, uuid, text, int, date, text) to authenticated;

-- Learner-side listing, joined for display (team/leader name) -- mirrors
-- list_my_manager_team_relationships' shape (a dedicated RPC rather than a
-- raw embedded-select, consistent with how every other learner-facing
-- manager-team read already works in this domain).
create or replace function public.list_my_manager_team_skill_suggestions()
returns table (
  id uuid, membership_id uuid, skill_name text, suggested_target_level int, target_date date,
  comments text, status text, created_at timestamptz, team_name text, suggested_by_name text
)
language sql stable security definer set search_path = '' as $$
  select s.id, s.membership_id, s.skill_name, s.suggested_target_level, s.target_date,
    s.comments, s.status, s.created_at, t.name, coalesce(nullif(trim(p.full_name), ''), 'Your team leader')
  from public.manager_team_skill_suggestions s
  join public.manager_team_memberships m on m.id = s.membership_id
  join public.manager_teams t on t.id = m.team_id
  left join public.profiles p on p.id = s.suggested_by
  where m.member_user_id = auth.uid() and s.status = 'suggested'
  order by s.created_at desc
$$;

revoke all on function public.list_my_manager_team_skill_suggestions() from public, anon;
grant execute on function public.list_my_manager_team_skill_suggestions() to authenticated;
