-- Product versioning + "What's new" for the platform admin console. A
-- changelog entry starts unreleased (release_id null) as soon as it's
-- added -- this is the running "What's new" list that builds up on staging.
-- Confirming a release (confirm_platform_release below) bundles every
-- currently-unreleased entry into a new numbered version and stamps them
-- with it, which is what "restarts" the pending list: nothing is left with
-- release_id null until new entries are added for the next round. This
-- tracks version/changelog metadata only -- it does not perform the actual
-- staging->master merge or deploy, which stays the existing manual git
-- workflow (see CLAUDE.md's release checklist); the platform admin confirms
-- a release here around the same time as doing that merge.
create table public.platform_releases (
  id uuid primary key default gen_random_uuid(),
  version integer not null check (version > 0) unique,
  notes text check (notes is null or char_length(notes) <= 2000),
  released_by uuid references auth.users(id) on delete set null,
  released_at timestamptz not null default now()
);

create table public.platform_changelog_entries (
  id uuid primary key default gen_random_uuid(),
  summary text not null check (char_length(trim(summary)) between 1 and 500),
  release_id uuid references public.platform_releases(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index platform_changelog_entries_release_idx
  on public.platform_changelog_entries (release_id, created_at);

alter table public.platform_releases enable row level security;
alter table public.platform_changelog_entries enable row level security;

-- Platform-admin-only end to end -- this is an internal ops tool, not a
-- learner- or customer-facing changelog (the request was specifically for
-- the platform admin console). Plain "for all" policies, same shape as
-- platform_admins' own (0065), since every operation here already requires
-- the same single check.
create policy "Platform admins manage releases"
  on public.platform_releases for all to authenticated
  using (public.is_platform_admin(auth.uid()))
  with check (public.is_platform_admin(auth.uid()));

create policy "Platform admins manage changelog entries"
  on public.platform_changelog_entries for all to authenticated
  using (public.is_platform_admin(auth.uid()))
  with check (public.is_platform_admin(auth.uid()));

-- Once an entry is part of a shipped release it stays put -- historical
-- accuracy (CLAUDE.md section 9): editing or deleting what "version 4
-- included" after the fact would misrepresent what actually shipped. Only
-- still-pending entries (release_id is null) can be changed or removed;
-- reassigning an already-released entry to a different release, or back to
-- pending, is blocked the same way.
create or replace function public.prevent_released_changelog_entry_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if TG_OP = 'DELETE' then
    if old.release_id is not null then
      raise exception 'A changelog entry that is part of a released version cannot be deleted';
    end if;
    return old;
  end if;

  if old.release_id is not null then
    raise exception 'A changelog entry that is part of a released version cannot be edited';
  end if;
  return new;
end
$$;

create trigger prevent_released_changelog_entry_mutation_trigger
  before update or delete on public.platform_changelog_entries
  for each row execute procedure public.prevent_released_changelog_entry_mutation();

-- Bundles every currently-pending entry into one new release atomically --
-- a plain client-side insert-then-update would leave a race window where an
-- entry added between the two steps could end up silently attached to the
-- new release (or, on partial failure, an inconsistent mix of stamped and
-- unstamped entries).
create or replace function public.confirm_platform_release(p_version integer, p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_release_id uuid;
begin
  if not public.is_platform_admin(auth.uid()) then
    raise exception 'Not authorised';
  end if;

  insert into public.platform_releases (version, notes, released_by)
  values (p_version, p_notes, auth.uid())
  returning id into v_release_id;

  update public.platform_changelog_entries
  set release_id = v_release_id
  where release_id is null;

  return v_release_id;
end
$$;

revoke all on function public.confirm_platform_release(integer, text) from public, anon;
grant execute on function public.confirm_platform_release(integer, text) to authenticated;
