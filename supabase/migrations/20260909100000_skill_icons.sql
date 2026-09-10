-- Custom skill icon, overtaking SkillIcon's generated gradient+initial
-- placeholder once set -- same "0093_course_catalogue_image" shape (image_url
-- column + public bucket + folder-scoped storage policies), applied to
-- skill_library instead of course_catalogue.
alter table skill_library add column icon_url text;

insert into storage.buckets (id, name, public)
values ('skill-icons', 'skill-icons', true)
on conflict (id) do nothing;

-- Reuses can_manage_skill_composite (20260905100000) as the authorization
-- check rather than inventing a parallel "who owns this skill" rule: it
-- already encodes exactly "platform admin, or org admin of this skill's own
-- organisation, or (for a global skill) org admin of the system-provider
-- org" -- the same "platform admin or skill owner" boundary this feature
-- needs, and it already excludes private/personal skills (no icon-editing
-- surface exists for those; see set_skill_icon below).
create policy "Skill managers can upload their skill's icon"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'skill-icons'
    and exists (
      select 1 from skill_library sl
      where sl.id::text = (storage.foldername(name))[1]
        and can_manage_skill_composite(sl.id, (select auth.uid()))
    )
  );

create policy "Skill managers can replace their skill's icon"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'skill-icons'
    and exists (
      select 1 from skill_library sl
      where sl.id::text = (storage.foldername(name))[1]
        and can_manage_skill_composite(sl.id, (select auth.uid()))
    )
  )
  with check (
    bucket_id = 'skill-icons'
    and exists (
      select 1 from skill_library sl
      where sl.id::text = (storage.foldername(name))[1]
        and can_manage_skill_composite(sl.id, (select auth.uid()))
    )
  );

create policy "Skill managers can remove their skill's icon"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'skill-icons'
    and exists (
      select 1 from skill_library sl
      where sl.id::text = (storage.foldername(name))[1]
        and can_manage_skill_composite(sl.id, (select auth.uid()))
    )
  );

-- skill_library itself has no update policy for org members (only platform
-- admins, see 3655's "Platform admins can update skill library entries") --
-- an RPC scoped to just this one column keeps a provider org admin's write
-- access no broader than "their own skill's icon", rather than opening a
-- general row-level UPDATE grant to grant this one field.
create or replace function set_skill_icon(p_skill_id uuid, p_icon_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not can_manage_skill_composite(p_skill_id, (select auth.uid())) then
    raise exception 'Not authorized to update this skill''s icon';
  end if;

  update skill_library set icon_url = p_icon_url where id = p_skill_id;
end;
$$;

revoke all on function set_skill_icon(uuid, text) from public;
grant execute on function set_skill_icon(uuid, text) to authenticated;
