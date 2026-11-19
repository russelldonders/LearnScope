-- Invite someone to connect, from the People page, without it being about a
-- skill. Until now every way to form a connection started from a skill (a
-- rate or recommend invite, or a request to someone found through a
-- searchable skill), so there was no way to simply connect with someone, or
-- to bring a colleague onto LearnScope.
--
-- Reuses connection_invites (an invite addressed to an email or shared as a
-- link, redeemed once via share_code) as a third invite_type, 'connect',
-- rather than a parallel table -- the same reasoning as 'recommend' in 0095.
-- A connect invite has no skill. Accepting one connects the two people, with
-- consent on both sides: the inviter by sending it, the invitee by accepting.
-- Nothing here reveals whether an email address already has an account: the
-- invite works the same either way, and someone new signs up first.
--
-- Not destructive: existing rows are all rate/recommend invites with a skill,
-- which the new checks keep valid. Rollback: drop the three functions, the
-- policy and the index, restore the two check constraints, and set skill_id
-- back to not null once no connect invites remain.

-- 1. A connect invite carries no skill; every other kind still must.
alter table public.connection_invites alter column skill_id drop not null;

alter table public.connection_invites drop constraint connection_invites_invite_type_check;
alter table public.connection_invites add constraint connection_invites_invite_type_check
  check (invite_type in ('rate', 'recommend', 'connect'));

alter table public.connection_invites add constraint connection_invites_skill_matches_type
  check ((invite_type = 'connect') = (skill_id is null));

-- One waiting invite per person invited, like the per-skill index from 0095
-- (whose skill_id column is null here, so it can't dedupe these).
create unique index connection_invites_unique_pending_connect_idx
  on public.connection_invites (inviter_id, lower(invitee_email))
  where invite_type = 'connect' and status = 'pending' and invitee_email is not null;

-- 2. Anyone signed in may create a connect invite of their own. The existing
-- insert policy (0010) still covers skill invites and can't match a row
-- without a skill.
create policy "Inviters can create their own connect invites"
  on public.connection_invites for insert
  to authenticated
  with check (
    auth.uid() = inviter_id
    and invite_type = 'connect'
    and skill_id is null
    and status = 'pending'
    and accepted_by is null
    and accepted_at is null
    -- A link's age (below) runs from when it was really made.
    and created_at <= now()
    and created_at > now() - interval '1 minute'
  );

-- 3. Record how a connection came about.
alter table public.connections drop constraint connections_source_check;
alter table public.connections add constraint connections_source_check
  check (source in ('peer_rating', 'request', 'invite'));

-- A shared link (no email) works for 14 days, so a forgotten or widely
-- posted link can't connect the learner with a stranger months later. An
-- emailed invite is addressed to one person and, like the other invite types,
-- lasts until it's used or revoked.
create or replace function public.connect_invite_expired(p_invite public.connection_invites)
returns boolean
language sql
stable
set search_path = public
as $$
  select p_invite.invitee_email is null and p_invite.created_at < now() - interval '14 days'
$$;

-- 4. What the invite page shows before anyone accepts: who sent it and
-- whether it can still be used. Public, like get_invite_preview, since the
-- visitor may not have an account yet. Never returns the invitee's email.
create or replace function public.get_connect_invite_preview(p_code text)
returns table (inviter_name text, inviter_avatar_url text, status text)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(p.full_name, ''),
    p.avatar_url,
    case
      when ci.status = 'revoked' then 'revoked'
      when ci.status = 'accepted' then 'used'
      when connect_invite_expired(ci) then 'expired'
      when auth.uid() = ci.inviter_id then 'own_invite'
      when auth.uid() is not null and exists (
        select 1 from connections c
        where c.user_a_id = least(ci.inviter_id, auth.uid())
          and c.user_b_id = greatest(ci.inviter_id, auth.uid())
      ) then 'connected'
      else 'pending'
    end
  from connection_invites ci
  left join profiles p on p.id = ci.inviter_id
  where ci.share_code = p_code
    and ci.invite_type = 'connect'
$$;

revoke all on function public.get_connect_invite_preview(text) from public;
grant execute on function public.get_connect_invite_preview(text) to anon, authenticated;

-- 5. Accepting connects the two people and uses up the invite. Returns the
-- inviter's id so the page can open their profile. Someone already connected
-- simply uses up the invite.
create or replace function public.accept_connect_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite connection_invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_invite from connection_invites where share_code = p_code for update;
  if not found or v_invite.invite_type != 'connect' then
    raise exception 'Invite not found';
  end if;
  if v_invite.status != 'pending' then
    raise exception 'This invite has already been used.';
  end if;
  if connect_invite_expired(v_invite) then
    raise exception 'This invitation link has expired.';
  end if;
  if v_invite.inviter_id = auth.uid() then
    raise exception 'You can''t accept your own invite.';
  end if;

  perform upsert_connection(v_invite.inviter_id, auth.uid(), 'invite');

  update connection_invites
  set status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
  where id = v_invite.id;

  return v_invite.inviter_id;
end;
$$;

revoke all on function public.accept_connect_invite(text) from public, anon;
grant execute on function public.accept_connect_invite(text) to authenticated;

-- 6. The email, editable in the admin console like the other invitation
-- emails (api/send-email.js has the same default).
insert into public.notification_templates (key, label, description, subject_template, body_template, placeholders) values (
  'connection_invite',
  'Invitation to connect',
  'Sent when a learner invites someone, by email, to connect with them on LearnScope. The person may not have an account yet.',
  '{{fromName}} invited you to connect on LearnScope',
  E'<p>{{fromName}} would like to connect with you on LearnScope, where people record and develop their skills and learning over time.</p>\n<p>Once you''re connected you can follow each other''s progress, as far as each of you chooses to share, and ask each other for ratings and recommendations.</p>\n<p><a href="{{url}}">Accept the invitation</a></p>\n<p style="color:#666;font-size:13px">If you don''t recognize this, you can safely ignore this email.</p>',
  array['fromName', 'url']
)
on conflict (key) do nothing;
