-- 0058's "Skill-search matches can view opted-in profiles" policy on
-- skills checks `exists (select 1 from skills my_skills where
-- my_skills.user_id = auth.uid() and my_skills.library_skill_id =
-- skills.library_skill_id)` directly inside its own USING clause -- since
-- that subquery targets skills itself, evaluating it re-applies skills'
-- own SELECT policies (including this one), which Postgres reports as
-- "infinite recursion detected in policy for relation skills". Hit on any
-- read of the skills table (e.g. loading /skills at all).
--
-- Same shape of bug as 0052 (skill_course_links <-> courses), fixed the
-- same way: move the self-referencing check into a SECURITY DEFINER
-- function so it bypasses RLS internally instead of re-entering skills'
-- policies while skills' own policy is still being evaluated.
create or replace function has_matching_library_skill(p_viewer_id uuid, p_library_skill_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from skills
    where user_id = p_viewer_id and library_skill_id = p_library_skill_id
  )
$$;

grant execute on function has_matching_library_skill(uuid, uuid) to authenticated;

drop policy "Skill-search matches can view opted-in profiles" on skills;
create policy "Skill-search matches can view opted-in profiles"
  on skills for select
  using (
    exists (
      select 1 from profiles p
      where p.id = skills.user_id and p.profile_visible_to_skill_matches = true
    )
    and skills.library_skill_id is not null
    and has_matching_library_skill(auth.uid(), skills.library_skill_id)
  );
