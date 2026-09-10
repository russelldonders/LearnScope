-- Security review follow-up on 20260909100000: set_skill_icon re-checked
-- can_manage_skill_composite before writing, but never validated
-- p_icon_url's shape -- an authorized skill manager could call the RPC
-- directly (bypassing the app's own upload flow) with an arbitrary external
-- URL for a skill they legitimately manage, e.g. a tracking pixel that
-- fires whenever any learner views that skill's icon. Constrain it to the
-- same skill-icons/<skill_id>/... path uploadSkillIcon actually produces
-- (still allowing null, to keep icon removal working).
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

  if p_icon_url is not null and p_icon_url !~ ('/skill-icons/' || p_skill_id::text || '/') then
    raise exception 'icon_url must point at this skill''s own storage folder';
  end if;

  update skill_library set icon_url = p_icon_url where id = p_skill_id;
end;
$$;
