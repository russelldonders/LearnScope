-- A resource can say which level of the skill it's for, on either or both of
-- the skill's two axes: knowledge (1 Unfamiliar .. 5 Deep understanding) and
-- application (1 Beginner .. 5 Expert), the same scales as skills and
-- skill_assessments. Both optional; existing resources keep neither.

alter table public.skill_resources
  add column knowledge_level smallint check (knowledge_level between 1 and 5),
  add column practical_level smallint check (practical_level between 1 and 5);

-- Its result gains the two levels, so it is dropped and created again rather
-- than replaced. Otherwise unchanged from 0288.
drop function public.list_shared_skill_resources(uuid);

create function public.list_shared_skill_resources(p_skill_id uuid)
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
  order by r.created_at desc
  limit 200
$$;

revoke all on function public.list_shared_skill_resources(uuid) from public, anon;
grant execute on function public.list_shared_skill_resources(uuid) to authenticated;
