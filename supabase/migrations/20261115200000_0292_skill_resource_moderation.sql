-- Keeping shared skill resources in check (see 0288):
--   1. Hiding: anyone a resource is shared with can hide it from their own
--      list (skill_resource_hides).
--   2. Reporting: they can also report it (skill_resource_reports), which
--      hides it for them too. Platform admins review open reports and either
--      dismiss them or remove the resource from sharing: it stays with its
--      owner, privately, marked as removed, and can't be shared again.
--   3. Disconnecting drops the other person from every resource either of
--      them had shared with the other as a chosen contact, so reconnecting
--      doesn't silently share it again. (Staging had no such rows left over
--      when this was written, so nothing existing is cleaned up.)

-- 1. Moderation state on the resource itself.
alter table public.skill_resources
  add column moderation_removed_at timestamptz,
  add column moderation_removed_by uuid references auth.users(id) on delete set null;

-- Owners can edit title, note, levels and sharing, but never the moderation
-- state, and a removed resource stays private.
create or replace function public.set_skill_resource_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  -- Ownership never moves: a resource stays with the learner and skill it
  -- was added to.
  new.user_id := old.user_id;
  new.skill_id := old.skill_id;
  new.created_at := old.created_at;
  -- Nor does what it is: only its title, note and sharing change, so a file
  -- is never left behind by turning it into a link.
  new.kind := old.kind;
  new.url := old.url;
  new.file_path := old.file_path;
  new.file_name := old.file_name;
  new.file_size := old.file_size;
  new.mime_type := old.mime_type;
  -- Only moderation (admin_resolve_skill_resource_reports) sets these: it
  -- marks the change with app.moderating for its own transaction, and the
  -- caller must be a platform admin as well.
  if coalesce(current_setting('app.moderating', true), '') <> 'on'
     or not public.is_platform_admin((select auth.uid())) then
    new.moderation_removed_at := old.moderation_removed_at;
    new.moderation_removed_by := old.moderation_removed_by;
  end if;
  if new.moderation_removed_at is not null then
    new.audience := 'private';
  end if;
  return new;
end;
$$;

-- A new resource never starts out removed, nor with someone else's name on
-- a removal.
create or replace function public.clear_skill_resource_moderation_on_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.moderation_removed_at := null;
  new.moderation_removed_by := null;
  return new;
end;
$$;

create trigger skill_resources_clear_moderation
  before insert on public.skill_resources
  for each row execute function public.clear_skill_resource_moderation_on_insert();

-- Removal is for good: the same link or file, added again by the same
-- owner, can't be shared either. Runs after the triggers above (names sort
-- after them), on insert and on update.
create or replace function public.block_resharing_removed_resource()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.audience <> 'private' and exists (
    select 1 from public.skill_resources r
    where r.user_id = new.user_id
      and r.id <> new.id
      and r.moderation_removed_at is not null
      and ((new.url is not null and r.url = new.url) or (new.file_path is not null and r.file_path = new.file_path))
  ) then
    raise exception 'This resource was removed from sharing by LearnScope moderators and can''t be shared again.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.block_resharing_removed_resource() from public, anon, authenticated;

create trigger skill_resources_zz_block_resharing
  before insert or update on public.skill_resources
  for each row execute function public.block_resharing_removed_resource();

-- A removed resource is visible to its owner only.
create or replace function private.can_view_skill_resource(p_resource_id uuid, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_viewer is not null and exists (
    select 1
    from public.skill_resources r
    join public.skills s on s.id = r.skill_id
    where r.id = p_resource_id
      and (
        r.user_id = p_viewer
        or (
          r.moderation_removed_at is null
          and (
            (r.audience = 'connections' and public.is_connected(r.user_id, p_viewer))
            or (
              r.audience = 'selected'
              and public.is_connected(r.user_id, p_viewer)
              and exists (
                select 1 from public.skill_resource_recipients x
                where x.resource_id = r.id and x.recipient_id = p_viewer
              )
            )
            or (
              r.audience = 'skill_public'
              and r.kind <> 'file'
              and s.library_skill_id is not null
              and exists (
                select 1 from public.skills mine
                where mine.user_id = p_viewer and mine.library_skill_id = s.library_skill_id
              )
            )
          )
        )
      )
  )
$$;

revoke all on function private.can_view_skill_resource(uuid, uuid) from public, anon, authenticated;

-- 2. Hiding, per viewer.
create table public.skill_resource_hides (
  user_id uuid not null references auth.users(id) on delete cascade,
  resource_id uuid not null references public.skill_resources(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, resource_id)
);

create index skill_resource_hides_resource_idx on public.skill_resource_hides (resource_id);

alter table public.skill_resource_hides enable row level security;

create policy "Learners manage the resources they've hidden"
  on public.skill_resource_hides for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, delete on table public.skill_resource_hides to authenticated;

-- 3. Reports. Written and read only through the functions below.
create table public.skill_resource_reports (
  id uuid primary key default gen_random_uuid(),
  -- Kept if the owner deletes the resource, with what it was, so deleting a
  -- reported resource doesn't erase the record of it.
  resource_id uuid references public.skill_resources(id) on delete set null,
  resource_owner_id uuid references auth.users(id) on delete set null,
  resource_title text,
  resource_url text,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (reason in ('spam', 'inappropriate', 'misleading', 'other')),
  details text check (details is null or char_length(details) <= 1000),
  status text not null default 'open' check (status in ('open', 'removed', 'dismissed')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (resource_id, reporter_id),
  check ((status = 'open') = (reviewed_at is null))
);

create index skill_resource_reports_open_idx on public.skill_resource_reports (resource_id) where status = 'open';

alter table public.skill_resource_reports enable row level security;
revoke all on table public.skill_resource_reports from public, anon, authenticated;

-- The shared list, now leaving out what the caller has hidden (and, through
-- can_view, anything removed). Otherwise as in 0289.
create or replace function public.list_shared_skill_resources(p_skill_id uuid)
returns table (
  id uuid,
  kind text,
  title text,
  url text,
  file_path text,
  file_name text,
  note text,
  audience text,
  knowledge_level smallint,
  practical_level smallint,
  created_at timestamptz,
  sharer_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.kind, r.title, r.url, r.file_path, r.file_name, r.note, r.audience,
         r.knowledge_level, r.practical_level, r.created_at,
         coalesce(nullif(btrim(p.full_name), ''), 'A LearnScope learner') as sharer_name
  from public.skills mine
  join public.skills theirs
    on theirs.library_skill_id = mine.library_skill_id and theirs.user_id <> mine.user_id
  join public.skill_resources r on r.skill_id = theirs.id
  left join public.profiles p on p.id = r.user_id
  where mine.id = p_skill_id
    and mine.user_id = (select auth.uid())
    and mine.library_skill_id is not null
    and r.audience <> 'private'
    and private.can_view_skill_resource(r.id, (select auth.uid()))
    and not exists (
      select 1 from public.skill_resource_hides h
      where h.user_id = (select auth.uid()) and h.resource_id = r.id
    )
  order by r.created_at desc
  limit 200
$$;

revoke all on function public.list_shared_skill_resources(uuid) from public, anon;
grant execute on function public.list_shared_skill_resources(uuid) to authenticated;

-- Report a resource shared with the caller. Reporting also hides it for
-- them. Reporting again updates their report and reopens it.
create or replace function public.report_skill_resource(p_resource_id uuid, p_reason text, p_details text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
begin
  if v_caller is null then
    raise insufficient_privilege using message = 'Sign in to report a resource';
  end if;
  if p_reason is null or p_reason not in ('spam', 'inappropriate', 'misleading', 'other') then
    raise exception 'Choose a reason for the report';
  end if;
  -- The same answer whether it doesn't exist or isn't shared with the
  -- caller, and the owner can't report their own.
  if not private.can_view_skill_resource(p_resource_id, v_caller)
     or exists (select 1 from public.skill_resources r where r.id = p_resource_id and r.user_id = v_caller) then
    raise exception 'Resource not found';
  end if;

  insert into public.skill_resource_reports (resource_id, resource_owner_id, resource_title, resource_url, reporter_id, reason, details)
  select r.id, r.user_id, r.title, coalesce(r.url, r.file_name), v_caller, p_reason, nullif(btrim(left(p_details, 1000)), '')
  from public.skill_resources r
  where r.id = p_resource_id
  -- Reporting again only updates a report still waiting for review: one an
  -- admin has already settled isn't reopened.
  on conflict (resource_id, reporter_id) do update
    set reason = excluded.reason,
        details = excluded.details
    where public.skill_resource_reports.status = 'open';

  insert into public.skill_resource_hides (user_id, resource_id)
  values (v_caller, p_resource_id)
  on conflict do nothing;
end;
$$;

revoke all on function public.report_skill_resource(uuid, text, text) from public, anon;
grant execute on function public.report_skill_resource(uuid, text, text) to authenticated;

-- Platform admins: resources with open reports, most reported first.
create or replace function public.admin_list_skill_resource_reports()
returns table (
  resource_id uuid,
  kind text,
  title text,
  url text,
  file_path text,
  file_name text,
  note text,
  audience text,
  skill_name text,
  owner_id uuid,
  owner_label text,
  resource_created_at timestamptz,
  report_count bigint,
  reasons text[],
  details text[],
  first_reported_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin((select auth.uid())) then
    raise insufficient_privilege using message = 'Platform administrator access required';
  end if;
  return query
  select r.id, r.kind, r.title, r.url, r.file_path, r.file_name, r.note, r.audience,
         s.name, r.user_id, public.admin_activity_actor_label(r.user_id), r.created_at,
         count(rep.id),
         array_agg(distinct rep.reason),
         array_remove(array_agg(rep.details order by rep.created_at), null),
         min(rep.created_at)
  from public.skill_resource_reports rep
  join public.skill_resources r on r.id = rep.resource_id
  join public.skills s on s.id = r.skill_id
  where rep.status = 'open'
  group by r.id, s.name
  order by count(rep.id) desc, min(rep.created_at);
end;
$$;

revoke all on function public.admin_list_skill_resource_reports() from public, anon;
grant execute on function public.admin_list_skill_resource_reports() to authenticated;

-- Platform admins: settle a resource's open reports. 'remove' takes it out
-- of sharing for good (the owner keeps it, privately); 'dismiss' leaves it
-- as it is. Either way it's logged.
create or replace function public.admin_resolve_skill_resource_reports(p_resource_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
  v_title text;
  v_open int;
begin
  if not public.is_platform_admin(v_caller) then
    raise insufficient_privilege using message = 'Platform administrator access required';
  end if;
  if p_action is null or p_action not in ('remove', 'dismiss') then
    raise exception 'Unknown action';
  end if;

  select title into v_title from public.skill_resources where id = p_resource_id for update;
  if not found then
    raise exception 'Resource not found';
  end if;

  update public.skill_resource_reports
  set status = case when p_action = 'remove' then 'removed' else 'dismissed' end,
      reviewed_by = v_caller,
      reviewed_at = now()
  where resource_id = p_resource_id and status = 'open';
  get diagnostics v_open = row_count;
  if v_open = 0 then
    raise exception 'This resource has no open reports';
  end if;

  if p_action = 'remove' then
    perform set_config('app.moderating', 'on', true);
    update public.skill_resources
    set moderation_removed_at = now(),
        moderation_removed_by = v_caller,
        audience = 'private'
    where id = p_resource_id;
    perform set_config('app.moderating', 'off', true);
    delete from public.skill_resource_recipients where resource_id = p_resource_id;
  end if;

  insert into public.admin_activity_log (actor_id, actor_label, action, entity_type, entity_id, entity_label)
  values (
    v_caller,
    public.admin_activity_actor_label(v_caller),
    case when p_action = 'remove' then 'skill_resource.removed' else 'skill_resource.reports_dismissed' end,
    'skill_resource',
    p_resource_id,
    v_title
  );
end;
$$;

revoke all on function public.admin_resolve_skill_resource_reports(uuid, text) from public, anon;
grant execute on function public.admin_resolve_skill_resource_reports(uuid, text) to authenticated;

-- Files: as before, plus platform admins may open the file of a resource
-- with an open report, to judge it.
create or replace function public.can_read_skill_resource_file(p_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.skill_resources r
    where r.file_path = p_path
      and split_part(r.file_path, '/', 1) = r.user_id::text
      and (
        (
          private.can_view_skill_resource(r.id, (select auth.uid()))
          -- A file removed from sharing stays unshared, whichever resource
          -- points at it.
          and not exists (
            select 1 from public.skill_resources removed
            where removed.file_path = p_path and removed.moderation_removed_at is not null
          )
        )
        or (
          public.is_platform_admin((select auth.uid()))
          and exists (
            select 1 from public.skill_resource_reports rep
            where rep.resource_id = r.id and rep.status = 'open'
          )
        )
      )
  )
$$;

revoke all on function public.can_read_skill_resource_file(text) from public, anon;
grant execute on function public.can_read_skill_resource_file(text) to authenticated;

-- 4. Disconnecting drops each person from the other's chosen contacts.
create or replace function public.drop_resource_recipients_on_disconnect()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.skill_resource_recipients x
  using public.skill_resources r
  where x.resource_id = r.id
    and (
      (r.user_id = old.user_a_id and x.recipient_id = old.user_b_id)
      or (r.user_id = old.user_b_id and x.recipient_id = old.user_a_id)
    );
  return old;
end;
$$;

revoke all on function public.drop_resource_recipients_on_disconnect() from public, anon, authenticated;

create trigger connections_drop_resource_recipients
  after delete on public.connections
  for each row execute function public.drop_resource_recipients_on_disconnect();
