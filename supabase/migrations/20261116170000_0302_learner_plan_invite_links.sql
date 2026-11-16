-- Plans can be shared like skills: by email, or with a link (also sent via
-- WhatsApp), as well as with connections. Whoever accepts gets their own
-- copy, exactly as with a connection invitation, and need not be a
-- connection of the owner, either to join or to appear on the owner's list.
--
-- * A share link is reusable: any number of people can join with it until
--   the owner replaces it with a new one. Joining with it records an accepted
--   invitation for that person, so everyone who joined is in one place.
-- * An email invitation is an invitation row with no recipient yet and its
--   own code; whoever opens the emailed link and accepts becomes the
--   recipient. It can be used once.
-- * Progress sharing no longer depends on being connected (0301): it lasts
--   until the recipient deletes their copy, which clears it (0301 trigger).
--   Disconnecting no longer affects plan sharing.

-- ---------------------------------------------------------------------------
-- Share links
-- ---------------------------------------------------------------------------

create table public.learner_plan_share_links (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.learner_plans(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  share_code text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- One working link per plan at a time.
create unique index learner_plan_share_links_active_idx
  on public.learner_plan_share_links (plan_id)
  where revoked_at is null;

alter table public.learner_plan_share_links enable row level security;

create policy "Owners view their plans' share links"
  on public.learner_plan_share_links for select
  to authenticated
  using (owner_id = (select auth.uid()));

revoke all on table public.learner_plan_share_links from public, anon, authenticated;
grant select on table public.learner_plan_share_links to authenticated;

-- ---------------------------------------------------------------------------
-- Invitations by email or link
-- ---------------------------------------------------------------------------

alter table public.learner_plan_invitations
  alter column recipient_id drop not null,
  add column via text not null default 'connection'
    check (via in ('connection', 'email', 'link')),
  add column invitee_email text,
  add column share_code text unique,
  add column share_link_id uuid references public.learner_plan_share_links(id) on delete set null,
  -- Only an email invitation waits without a recipient; it gets one when
  -- someone accepts it.
  add constraint learner_plan_invitations_recipient_check check (
    recipient_id is not null
    or (via = 'email' and status in ('pending', 'revoked'))
  ),
  add constraint learner_plan_invitations_email_check check (
    via <> 'email' or (invitee_email is not null and share_code is not null)
  );

create unique index learner_plan_invitations_pending_email_idx
  on public.learner_plan_invitations (source_plan_id, lower(invitee_email))
  where status = 'pending' and via = 'email';

-- ---------------------------------------------------------------------------
-- Copying a plan for a recipient (moved out of 0300's
-- respond_to_learner_plan_invitation, unchanged, so every way of accepting
-- copies a plan the same way)
-- ---------------------------------------------------------------------------

create or replace function private.copy_learner_plan_for(
  p_source_plan_id uuid,
  p_recipient uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_plan public.learner_plans%rowtype;
  v_new_plan_id uuid;
  v_new_section_id uuid;
  v_section_map jsonb := '{}'::jsonb;
  v_new_skill_id uuid;
  v_new_course_id uuid;
  v_new_goal_id uuid;
  v_new_resource_id uuid;
  v_source_course public.courses%rowtype;
  v_source_goal public.skill_goals%rowtype;
  v_source_resource public.skill_resources%rowtype;
  v_step_title text;
  v_step_note text;
  section_row public.learner_plan_sections%rowtype;
  item_row public.learner_plan_items%rowtype;
begin
  select * into strict v_source_plan
  from public.learner_plans
  where id = p_source_plan_id;

  insert into public.learner_plans (
    user_id, title, description, starts_on, target_on, status
  ) values (
    p_recipient, v_source_plan.title, v_source_plan.description,
    v_source_plan.starts_on, v_source_plan.target_on, 'planning'
  )
  returning id into v_new_plan_id;

  for section_row in
    select * from public.learner_plan_sections
    where plan_id = v_source_plan.id
    order by position, created_at
  loop
    insert into public.learner_plan_sections (plan_id, title, position, target_on)
    values (v_new_plan_id, section_row.title, section_row.position, section_row.target_on)
    returning id into v_new_section_id;
    v_section_map := v_section_map || jsonb_build_object(section_row.id::text, v_new_section_id::text);
  end loop;

  for item_row in
    select * from public.learner_plan_items
    where plan_id = v_source_plan.id
    order by position, created_at
  loop
    -- Records retain their previous value after a SELECT that finds no row,
    -- so clear optional source records on every iteration before fallbacks
    -- inspect them.
    v_source_resource := null;
    v_new_section_id := case
      when item_row.section_id is null then null
      else (v_section_map ->> item_row.section_id::text)::uuid
    end;

    if item_row.item_type = 'skill' and item_row.skill_id is not null then
      v_new_skill_id := private.resolve_invited_plan_skill(item_row.skill_id, p_recipient);
      if v_new_skill_id is not null then
        insert into public.learner_plan_items (
          plan_id, section_id, position, item_type, skill_id, note, target_on,
          plan_knowledge_level, plan_practical_level
        ) values (
          v_new_plan_id, null, item_row.position, 'skill', v_new_skill_id,
          item_row.note, item_row.target_on,
          item_row.plan_knowledge_level, item_row.plan_practical_level
        );
        continue;
      end if;
    end if;

    if item_row.item_type = 'course' and item_row.course_id is not null then
      select * into v_source_course from public.courses where id = item_row.course_id;
      if found then
        v_new_course_id := null;
        if v_source_course.catalogue_course_id is not null then
          select id into v_new_course_id
          from public.courses
          where user_id = p_recipient
            and catalogue_course_id = v_source_course.catalogue_course_id
          order by created_at desc
          limit 1;
        end if;
        if v_new_course_id is null then
          insert into public.courses (
            user_id, name, provider, duration, course_type,
            catalogue_course_id, status, planned_at
          ) values (
            p_recipient, v_source_course.name, v_source_course.provider,
            v_source_course.duration, v_source_course.course_type,
            v_source_course.catalogue_course_id, 'planned', now()
          )
          returning id into v_new_course_id;
        end if;
        insert into public.learner_plan_items (
          plan_id, section_id, position, item_type, course_id, note, target_on
        ) values (
          v_new_plan_id, v_new_section_id, item_row.position, 'course',
          v_new_course_id, item_row.note, item_row.target_on
        );
        continue;
      end if;
    end if;

    if item_row.item_type = 'skill_goal' and item_row.skill_goal_id is not null then
      select * into v_source_goal from public.skill_goals where id = item_row.skill_goal_id;
      if found then
        v_new_skill_id := private.resolve_invited_plan_skill(v_source_goal.skill_id, p_recipient);
        if v_new_skill_id is not null then
          insert into public.skill_goals (
            skill_id, original_text, title, metric, measure_kind, unit,
            direction, aggregation, period, target_value, target_date,
            started_on, tracker_question, log_every_days
          ) values (
            v_new_skill_id, v_source_goal.original_text, v_source_goal.title,
            v_source_goal.metric, v_source_goal.measure_kind, v_source_goal.unit,
            v_source_goal.direction, v_source_goal.aggregation, v_source_goal.period,
            v_source_goal.target_value, v_source_goal.target_date, current_date,
            v_source_goal.tracker_question, v_source_goal.log_every_days
          )
          returning id into v_new_goal_id;
          insert into public.learner_plan_items (
            plan_id, section_id, position, item_type, skill_goal_id, note, target_on
          ) values (
            v_new_plan_id, v_new_section_id, item_row.position, 'skill_goal',
            v_new_goal_id, item_row.note, item_row.target_on
          );
          continue;
        end if;
      end if;
    end if;

    if item_row.item_type = 'skill_resource' and item_row.skill_resource_id is not null then
      select * into v_source_resource from public.skill_resources where id = item_row.skill_resource_id;
      if found and v_source_resource.kind in ('link', 'video') then
        v_new_skill_id := private.resolve_invited_plan_skill(v_source_resource.skill_id, p_recipient);
        if v_new_skill_id is not null then
          insert into public.skill_resources (
            user_id, skill_id, kind, title, url, note, audience
          ) values (
            p_recipient, v_new_skill_id, v_source_resource.kind,
            v_source_resource.title, v_source_resource.url,
            v_source_resource.note, 'private'
          )
          returning id into v_new_resource_id;
          insert into public.learner_plan_items (
            plan_id, section_id, position, item_type, skill_resource_id, note, target_on
          ) values (
            v_new_plan_id, v_new_section_id, item_row.position, 'skill_resource',
            v_new_resource_id, item_row.note, item_row.target_on
          );
          continue;
        end if;
      end if;
    end if;

    -- Plain steps copy directly. Deleted references, private file resources,
    -- or an unresolvable skill/goal become a descriptive step rather than
    -- disappearing from the recipient's plan.
    v_step_title := case item_row.item_type
      when 'step' then item_row.step_title
      when 'skill' then coalesce(
        (select 'Develop ' || name from public.skills where id = item_row.skill_id),
        'Develop this skill'
      )
      when 'course' then coalesce(
        (select 'Complete ' || name from public.courses where id = item_row.course_id),
        'Complete this course'
      )
      when 'skill_goal' then coalesce(
        (select title from public.skill_goals where id = item_row.skill_goal_id),
        'Work towards this goal'
      )
      when 'skill_resource' then coalesce(
        (select 'Review ' || title from public.skill_resources where id = item_row.skill_resource_id),
        'Review this resource'
      )
      else 'Complete this plan item'
    end;
    v_step_note := item_row.note;
    if item_row.item_type = 'skill_resource' and v_source_resource.kind = 'file' then
      v_step_note := concat_ws(E'\n', v_step_note, 'Ask the inviter to share the private file separately.');
    end if;

    insert into public.learner_plan_items (
      plan_id, section_id, position, item_type, step_title, note, target_on,
      step_skill_id
    ) values (
      v_new_plan_id, v_new_section_id, item_row.position, 'step',
      left(v_step_title, 200), left(v_step_note, 1000), item_row.target_on,
      private.resolve_invited_plan_skill(item_row.step_skill_id, p_recipient)
    );
  end loop;

  return v_new_plan_id;
end;
$$;

revoke all on function private.copy_learner_plan_for(uuid, uuid) from public, anon, authenticated;

-- Accepting or declining a connection invitation, as in 0300, now copying
-- through the shared helper.
create or replace function public.respond_to_learner_plan_invitation(
  p_invitation_id uuid,
  p_accept boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_invitation public.learner_plan_invitations%rowtype;
  v_new_plan_id uuid;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  select * into v_invitation
  from public.learner_plan_invitations
  where id = p_invitation_id
  for update;

  if not found or v_invitation.recipient_id is distinct from v_caller then
    raise exception 'Invitation not found' using errcode = 'insufficient_privilege';
  end if;
  if v_invitation.status <> 'pending' then
    raise exception 'Invitation has already been decided' using errcode = 'check_violation';
  end if;

  if not p_accept then
    update public.learner_plan_invitations
    set status = 'declined', decided_at = now()
    where id = v_invitation.id;
    return null;
  end if;

  v_new_plan_id := private.copy_learner_plan_for(v_invitation.source_plan_id, v_caller);

  update public.learner_plan_invitations
  set status = 'accepted', decided_at = now(), copied_plan_id = v_new_plan_id
  where id = v_invitation.id;

  return v_new_plan_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Owner: the plan's share link, and email invitations
-- ---------------------------------------------------------------------------

create or replace function private.assert_plan_owner(p_plan_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if not exists (
    select 1 from public.learner_plans where id = p_plan_id and user_id = v_caller
  ) then
    raise exception 'Plan not found or not owned by you' using errcode = 'insufficient_privilege';
  end if;
  return v_caller;
end;
$$;

revoke all on function private.assert_plan_owner(uuid) from public, anon, authenticated;

-- The plan's working share link, made the first time it's asked for.
create or replace function public.get_learner_plan_share_link(p_plan_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := private.assert_plan_owner(p_plan_id);
  v_code text;
begin
  select share_code into v_code
  from public.learner_plan_share_links
  where plan_id = p_plan_id and revoked_at is null;
  if v_code is null then
    insert into public.learner_plan_share_links (plan_id, owner_id)
    values (p_plan_id, v_owner)
    on conflict (plan_id) where revoked_at is null do nothing;
    select share_code into v_code
    from public.learner_plan_share_links
    where plan_id = p_plan_id and revoked_at is null;
  end if;
  return v_code;
end;
$$;

-- A new link in place of the old one, which stops working. People who
-- already joined keep their copies.
create or replace function public.replace_learner_plan_share_link(p_plan_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := private.assert_plan_owner(p_plan_id);
  v_code text;
begin
  update public.learner_plan_share_links
  set revoked_at = now()
  where plan_id = p_plan_id and revoked_at is null;
  insert into public.learner_plan_share_links (plan_id, owner_id)
  values (p_plan_id, v_owner)
  returning share_code into v_code;
  return v_code;
end;
$$;

-- One invitation per address, each with its own code for the emailed link.
-- An address with an invitation still waiting gets that one back.
create or replace function public.invite_emails_to_learner_plan(
  p_plan_id uuid,
  p_emails text[]
)
returns table (email text, share_code text, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_owner uuid := private.assert_plan_owner(p_plan_id);
  v_email text;
begin
  if coalesce(cardinality(p_emails), 0) = 0 then
    raise exception 'Enter at least one email address' using errcode = 'check_violation';
  end if;
  if cardinality(p_emails) > 50 then
    raise exception 'Too many email addresses at once' using errcode = 'check_violation';
  end if;
  if (
    select count(*) from public.learner_plan_invitations invitation
    where invitation.source_plan_id = p_plan_id and invitation.via = 'email' and invitation.status = 'pending'
  ) + cardinality(p_emails) > 200 then
    raise exception 'Too many email invitations waiting for this plan. Withdraw some first.' using errcode = 'check_violation';
  end if;

  for v_email in
    select distinct lower(btrim(value)) from unnest(p_emails) as emails(value)
  loop
    if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or length(v_email) > 320 then
      raise exception 'Invalid email address: %', v_email using errcode = 'check_violation';
    end if;

    email := v_email;
    select invitation.share_code into share_code
    from public.learner_plan_invitations invitation
    where invitation.source_plan_id = p_plan_id
      and invitation.via = 'email'
      and invitation.status = 'pending'
      and lower(invitation.invitee_email) = v_email;
    created := share_code is null;

    if created then
      insert into public.learner_plan_invitations (
        source_plan_id, inviter_id, via, invitee_email, share_code
      ) values (
        p_plan_id, v_owner, 'email', v_email, replace(gen_random_uuid()::text, '-', '')
      )
      returning learner_plan_invitations.share_code into share_code;
    end if;
    return next;
  end loop;
end;
$$;

-- The owner withdraws an invitation still waiting (by email or to a
-- connection), e.g. a wrong address or someone they no longer want to
-- invite. It can't be accepted afterwards; people who joined are unaffected.
create or replace function public.withdraw_learner_plan_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation public.learner_plan_invitations%rowtype;
begin
  select * into v_invitation
  from public.learner_plan_invitations
  where id = p_invitation_id
  for update;
  if not found then
    raise exception 'Invitation not found' using errcode = 'insufficient_privilege';
  end if;
  perform private.assert_plan_owner(v_invitation.source_plan_id);
  if v_invitation.inviter_id <> (select auth.uid()) then
    raise exception 'Invitation not found' using errcode = 'insufficient_privilege';
  end if;
  if v_invitation.status <> 'pending' then
    raise exception 'Only an invitation still waiting can be withdrawn' using errcode = 'check_violation';
  end if;
  update public.learner_plan_invitations
  set status = 'revoked', decided_at = now()
  where id = v_invitation.id;
end;
$$;

revoke all on function public.withdraw_learner_plan_invitation(uuid) from public, anon;
grant execute on function public.withdraw_learner_plan_invitation(uuid) to authenticated;

-- Someone who accepted a forwarded emailed invitation can read their own
-- invitation row (0300's policy), but not the address it was sent to or its
-- code: those are only the owner's, and the owner reads them through
-- list_learner_plan_members. Reads of the table are limited to these columns.
revoke select on table public.learner_plan_invitations from authenticated;
grant select (
  id, source_plan_id, inviter_id, recipient_id, status, copied_plan_id,
  created_at, decided_at, via, share_link_id,
  progress_done, progress_total, progress_updated_at
) on table public.learner_plan_invitations to authenticated;

-- ---------------------------------------------------------------------------
-- Anyone with a link: preview it, and join
-- ---------------------------------------------------------------------------

-- What an invitation link is for, before signing in or accepting: the plan's
-- title, description and size, and who shared it. Nothing else of the plan.
-- For a signed-in caller it also says whether they've already joined.
--   status: open | used | revoked | own_plan | joined
create or replace function public.get_learner_plan_invite_preview(p_code text)
returns table (
  kind text,
  status text,
  plan_title text,
  plan_description text,
  item_count integer,
  inviter_name text,
  joined_plan_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_caller uuid := (select auth.uid());
  v_plan_id uuid;
  v_owner uuid;
  v_kind text;
  v_status text;
begin
  select 'email', invitation.source_plan_id, invitation.inviter_id,
    case invitation.status when 'pending' then 'open' when 'revoked' then 'revoked' else 'used' end
  into v_kind, v_plan_id, v_owner, v_status
  from public.learner_plan_invitations invitation
  where invitation.share_code = p_code and invitation.via = 'email';

  if v_plan_id is null then
    select 'link', link.plan_id, link.owner_id,
      case when link.revoked_at is null then 'open' else 'revoked' end
    into v_kind, v_plan_id, v_owner, v_status
    from public.learner_plan_share_links link
    where link.share_code = p_code;
  end if;

  if v_plan_id is null then
    return;
  end if;

  kind := v_kind;
  status := v_status;
  joined_plan_id := null;
  if v_caller is not null then
    if v_caller = v_owner then
      status := 'own_plan';
    else
      select invitation.copied_plan_id into joined_plan_id
      from public.learner_plan_invitations invitation
      where invitation.source_plan_id = v_plan_id
        and invitation.recipient_id = v_caller
        and invitation.status = 'accepted'
        and invitation.copied_plan_id is not null
      order by invitation.decided_at desc
      limit 1;
      if joined_plan_id is not null then
        status := 'joined';
      end if;
    end if;
  end if;

  -- A used or replaced code says only that: a link replaced because it
  -- leaked shouldn't keep showing the plan.
  if status in ('used', 'revoked') then
    return next;
    return;
  end if;

  select plan.title, plan.description,
    (select count(*)::integer from public.learner_plan_items item where item.plan_id = plan.id),
    coalesce(nullif(btrim(profile.full_name), ''), 'A LearnScope user')
  into plan_title, plan_description, item_count, inviter_name
  from public.learner_plans plan
  left join public.profiles profile on profile.id = v_owner
  where plan.id = v_plan_id;

  return next;
end;
$$;

-- Join a plan from an emailed invitation or its share link: copies it for
-- the caller, as accepting a connection invitation does, and shares their
-- progress with the owner. Someone who has already joined gets their copy
-- back rather than a second one.
create or replace function public.accept_learner_plan_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_invitation public.learner_plan_invitations%rowtype;
  v_link public.learner_plan_share_links%rowtype;
  v_plan_id uuid;
  v_owner uuid;
  v_existing uuid;
  v_new_plan_id uuid;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  select * into v_invitation
  from public.learner_plan_invitations
  where share_code = p_code and via = 'email'
  for update;

  if found then
    v_plan_id := v_invitation.source_plan_id;
    v_owner := v_invitation.inviter_id;
  else
    select * into v_link
    from public.learner_plan_share_links
    where share_code = p_code
    for update;
    if not found then
      raise exception 'Invitation not found' using errcode = 'insufficient_privilege';
    end if;
    v_plan_id := v_link.plan_id;
    v_owner := v_link.owner_id;
  end if;

  if v_owner = v_caller then
    raise exception 'This is your own plan' using errcode = 'check_violation';
  end if;

  select invitation.copied_plan_id into v_existing
  from public.learner_plan_invitations invitation
  where invitation.source_plan_id = v_plan_id
    and invitation.recipient_id = v_caller
    and invitation.status = 'accepted'
    and invitation.copied_plan_id is not null
  order by invitation.decided_at desc
  limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  if v_invitation.id is not null then
    if v_invitation.status <> 'pending' then
      raise exception 'This invitation has already been used' using errcode = 'check_violation';
    end if;
  elsif v_link.revoked_at is not null then
    raise exception 'This link has been replaced and no longer works' using errcode = 'check_violation';
  end if;

  v_new_plan_id := private.copy_learner_plan_for(v_plan_id, v_caller);

  if v_invitation.id is not null then
    update public.learner_plan_invitations
    set recipient_id = v_caller, status = 'accepted', decided_at = now(), copied_plan_id = v_new_plan_id
    where id = v_invitation.id;
  else
    insert into public.learner_plan_invitations (
      source_plan_id, inviter_id, recipient_id, via, share_link_id,
      status, decided_at, copied_plan_id
    ) values (
      v_plan_id, v_owner, v_caller, 'link', v_link.id,
      'accepted', now(), v_new_plan_id
    );
  end if;

  -- A connection invitation still waiting for the same plan is answered by
  -- this too, so it doesn't linger in their actions.
  update public.learner_plan_invitations
  set status = 'accepted', decided_at = now(), copied_plan_id = v_new_plan_id
  where source_plan_id = v_plan_id
    and recipient_id = v_caller
    and status = 'pending';

  return v_new_plan_id;
end;
$$;

revoke all on function public.get_learner_plan_share_link(uuid) from public, anon;
revoke all on function public.replace_learner_plan_share_link(uuid) from public, anon;
revoke all on function public.invite_emails_to_learner_plan(uuid, text[]) from public, anon;
revoke all on function public.accept_learner_plan_invite(text) from public, anon;
revoke all on function public.get_learner_plan_invite_preview(text) from public;
grant execute on function public.get_learner_plan_share_link(uuid) to authenticated;
grant execute on function public.replace_learner_plan_share_link(uuid) to authenticated;
grant execute on function public.invite_emails_to_learner_plan(uuid, text[]) to authenticated;
grant execute on function public.accept_learner_plan_invite(text) to authenticated;
-- The invitation page shows what the link is for before someone signs in.
grant execute on function public.get_learner_plan_invite_preview(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Sharing no longer depends on being connected
-- ---------------------------------------------------------------------------

drop trigger connections_stop_plan_sharing on public.connections;
drop function private.stop_plan_sharing_on_disconnect();

create or replace function public.record_learner_plan_progress(p_progress jsonb)
returns setof uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_entry jsonb;
  v_plan_id uuid;
  v_invitation_id uuid;
  v_done integer;
  v_total integer;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(p_progress) <> 'array' then
    raise exception 'Progress must be a list' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p_progress) > 500 then
    raise exception 'Too many plans at once' using errcode = 'check_violation';
  end if;

  for v_entry in select value from jsonb_array_elements(p_progress)
  loop
    v_plan_id := (v_entry ->> 'plan_id')::uuid;
    v_done := (v_entry ->> 'done')::integer;
    v_total := (v_entry ->> 'total')::integer;
    if v_plan_id is null or v_done is null or v_total is null
      or v_total < 0 or v_done < 0 or v_done > v_total then
      raise exception 'Invalid plan progress' using errcode = 'check_violation';
    end if;

    -- Only the caller's own accepted invitations for their own copy (more
    -- than one if they accepted the same plan two ways).
    v_invitation_id := null;
    select invitation.id into v_invitation_id
    from public.learner_plan_invitations invitation
    join public.learner_plans plan
      on plan.id = invitation.copied_plan_id and plan.user_id = v_caller
    where invitation.copied_plan_id = v_plan_id
      and invitation.recipient_id = v_caller
      and invitation.status = 'accepted'
    limit 1;

    if v_invitation_id is not null then
      update public.learner_plan_invitations
      set progress_done = v_done,
          progress_total = v_total,
          progress_updated_at = now()
      where copied_plan_id = v_plan_id
        and recipient_id = v_caller
        and status = 'accepted'
        and (progress_done, progress_total) is distinct from (v_done, v_total);
      return next v_plan_id;
    end if;
  end loop;
end;
$$;

-- Everyone on a plan, however they were invited or joined: the latest
-- invitation per person (an email invitation not yet accepted is listed
-- under its address), where it stands, and their shared progress.
drop function public.list_learner_plan_members(uuid);
drop function private.are_connected(uuid, uuid);

create function public.list_learner_plan_members(p_plan_id uuid)
returns table (
  invitation_id uuid,
  recipient_id uuid,
  recipient_name text,
  via text,
  status text,
  invited_at timestamptz,
  decided_at timestamptz,
  plan_removed boolean,
  progress_done integer,
  progress_total integer,
  progress_updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := private.assert_plan_owner(p_plan_id);
begin
  return query
  select distinct on (coalesce(invitation.recipient_id::text, 'email:' || lower(invitation.invitee_email)))
    invitation.id,
    invitation.recipient_id,
    case
      when invitation.recipient_id is null then invitation.invitee_email
      else coalesce(nullif(btrim(profile.full_name), ''), 'A LearnScope user')
    end,
    invitation.via,
    invitation.status,
    invitation.created_at,
    invitation.decided_at,
    invitation.status = 'accepted' and invitation.copied_plan_id is null,
    invitation.progress_done,
    invitation.progress_total,
    invitation.progress_updated_at
  from public.learner_plan_invitations invitation
  left join public.profiles profile on profile.id = invitation.recipient_id
  where invitation.source_plan_id = p_plan_id
    and invitation.inviter_id = v_caller
  order by coalesce(invitation.recipient_id::text, 'email:' || lower(invitation.invitee_email)),
    (invitation.status = 'accepted') desc,
    invitation.created_at desc;
end;
$$;

revoke all on function public.list_learner_plan_members(uuid) from public, anon;
grant execute on function public.list_learner_plan_members(uuid) to authenticated;

-- The email sent for an emailed invitation, editable in the admin console
-- like the other invitation emails (api/send-email.js has the same default).
insert into public.notification_templates (key, label, description, subject_template, body_template, placeholders) values (
  'plan_invite',
  'Plan invitation',
  'Sent when a learner invites someone, by email, to follow a copy of one of their plans.',
  '{{fromName}} invited you to follow the plan "{{planTitle}}"',
  E'<p>{{fromName}} has invited you to follow their plan <strong>{{planTitle}}</strong> on LearnScope.</p>\n<p>Accepting gives you your own copy of the plan to work through. {{fromName}} will see how many of its items you''ve done, but not your notes or evidence.</p>\n<p><a href="{{url}}">View the plan</a></p>\n<p style="color:#666;font-size:13px">If you don''t recognize this, you can safely ignore this email.</p>',
  array['fromName', 'planTitle', 'url']
)
on conflict (key) do nothing;
