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
