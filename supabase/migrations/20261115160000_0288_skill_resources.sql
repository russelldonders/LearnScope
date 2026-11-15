-- Learner resources on a skill: documents, videos and links a learner keeps
-- for learning the skill. Distinct from evidence (proof of ability, on
-- skill_assessments / xapi_statements) and from content_resources (an
-- organisation's course content). The learner owns each one and chooses who
-- sees it:
--   private      -- only them
--   selected     -- chosen connections (skill_resource_recipients)
--   connections  -- all their connections
--   skill_public -- everyone tracking the same library skill; links only,
--                   never uploaded files
-- Sharing with a connection lapses if the two disconnect.

create table public.skill_resources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  skill_id uuid not null references public.skills(id) on delete cascade,
  kind text not null check (kind in ('link', 'video', 'file')),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  url text check (url is null or (url ~* '^https?://' and char_length(url) <= 2000)),
  file_path text,
  file_name text check (file_name is null or char_length(file_name) <= 255),
  file_size bigint check (file_size is null or file_size >= 0),
  mime_type text check (mime_type is null or char_length(mime_type) <= 255),
  note text check (note is null or char_length(note) <= 2000),
  audience text not null default 'private'
    check (audience in ('private', 'selected', 'connections', 'skill_public')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A file is stored in the owner's own folder; a link or video has a URL.
  check (
    (kind = 'file' and file_path is not null and url is null
      and split_part(file_path, '/', 1) = user_id::text)
    or (kind <> 'file' and url is not null and file_path is null)
  ),
  check (not (kind = 'file' and audience = 'skill_public'))
);

create index skill_resources_user_skill_idx on public.skill_resources (user_id, skill_id);
create index skill_resources_skill_idx on public.skill_resources (skill_id);
create index skill_resources_public_idx on public.skill_resources (skill_id) where audience = 'skill_public';
create index skill_resources_file_path_idx on public.skill_resources (file_path) where file_path is not null;

create table public.skill_resource_recipients (
  resource_id uuid not null references public.skill_resources(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (resource_id, recipient_id)
);

create index skill_resource_recipients_recipient_idx on public.skill_resource_recipients (recipient_id);

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
  return new;
end;
$$;

create trigger skill_resources_set_updated_at
  before update on public.skill_resources
  for each row execute function public.set_skill_resource_updated_at();

-- Whether p_viewer may see a resource. SECURITY DEFINER so it can read the
-- owner's skill (for its library skill) and the viewer's own skills without
-- going back through these tables' policies. Private and not callable by
-- learners: with a viewer of their choosing it would reveal who else tracks
-- a skill or was chosen to receive a resource. The public functions below
-- call it only ever with the caller's own id.
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
        or (r.audience = 'connections' and public.is_connected(r.user_id, p_viewer))
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
$$;

revoke all on function private.can_view_skill_resource(uuid, uuid) from public, anon, authenticated;

alter table public.skill_resources enable row level security;
alter table public.skill_resource_recipients enable row level security;

create policy "Learners manage their own skill resources"
  on public.skill_resources for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.skills s
      where s.id = skill_resources.skill_id and s.user_id = (select auth.uid())
    )
  );

-- Others never read this table directly (it holds the sharer's ids and file
-- details); what's shared with them comes through list_shared_skill_resources.

create policy "Owners manage who a resource is shared with"
  on public.skill_resource_recipients for all
  to authenticated
  using (
    exists (
      select 1 from public.skill_resources r
      where r.id = skill_resource_recipients.resource_id and r.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.skill_resources r
      where r.id = skill_resource_recipients.resource_id and r.user_id = (select auth.uid())
    )
    and public.is_connected((select auth.uid()), recipient_id)
  );

grant select, insert, update, delete on table public.skill_resources to authenticated;
grant select, insert, delete on table public.skill_resource_recipients to authenticated;

-- Resources others have shared that apply to one of the caller's own skills:
-- on the same library skill, and visible to the caller. With the sharer's
-- name, which the caller may not otherwise be able to read.
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
  created_at timestamptz,
  sharer_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.kind, r.title, r.url, r.file_path, r.file_name, r.note, r.audience, r.created_at,
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
  order by r.created_at desc
  limit 200
$$;

revoke all on function public.list_shared_skill_resources(uuid) from public, anon;
grant execute on function public.list_shared_skill_resources(uuid) to authenticated;

-- Uploaded files: a private bucket, each learner writing only to their own
-- folder. Reading a file follows the resource's own sharing.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('skill-resources', 'skill-resources', false, 52428800, array[
  -- Documents, images, audio and video. Not HTML or SVG, which a browser
  -- would run as a page from the storage address.
  'application/pdf', 'text/plain', 'text/markdown', 'text/csv',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text', 'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation', 'application/rtf', 'application/epub+zip', 'application/zip',
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/heic',
  'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg', 'audio/webm',
  'video/mp4', 'video/webm', 'video/quicktime'
])
on conflict (id) do nothing;

create policy "Learners upload skill resource files to their own folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'skill-resources'
    and (storage.foldername(storage.objects.name))[1] = (select auth.uid())::text
  );

create policy "Learners remove their own skill resource files"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'skill-resources'
    and (storage.foldername(storage.objects.name))[1] = (select auth.uid())::text
  );

-- Whether the caller may open a stored file: their own, or the file of a
-- resource shared with them. Takes no viewer, so it can't be used to ask
-- about anyone else.
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
      and private.can_view_skill_resource(r.id, (select auth.uid()))
  )
$$;

revoke all on function public.can_read_skill_resource_file(text) from public, anon;
grant execute on function public.can_read_skill_resource_file(text) to authenticated;

create policy "Learners read skill resource files they can see"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'skill-resources'
    and (
      (storage.foldername(storage.objects.name))[1] = (select auth.uid())::text
      or public.can_read_skill_resource_file(storage.objects.name)
    )
  );
