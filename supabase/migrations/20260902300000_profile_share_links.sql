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
