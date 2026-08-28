-- AI-generated level guide text (knowledge_level_guide/practical_level_guide,
-- 0047/0057) only ever depends on the skill *name*, so it was wasteful to
-- cache it per learner instance on `skills` -- every learner tracking, say,
-- "Python" was independently generating and paying for an identical guide.
-- Moves the cache onto the shared `skill_library` row instead, so the first
-- learner to need a guide for a given library skill generates it for
-- everyone. Custom skills with no library_skill_id (0013) still fall back to
-- the existing per-instance columns on `skills`, which stay as-is.
--
-- A private library entry (is_private, 0028) is only ever readable by its
-- creator anyway, so caching there is already correctly scoped to just that
-- one person -- no special-casing needed between public/private entries.
alter table skill_library add column knowledge_level_guide jsonb;
alter table skill_library add column practical_level_guide jsonb;

-- skill_library intentionally has no update policy (0013) -- entries are
-- immutable once created, by design. Rather than opening a general UPDATE
-- policy (which would also let any authenticated user rewrite name/category/
-- description), this narrow security-definer function is the only write
-- path: it only ever touches the two guide columns, and only when a column
-- is still null, so a slower concurrent generation can never clobber one
-- that already landed. Same pattern as the read-only skill_level_guide_sample
-- (0083).
create or replace function set_skill_library_level_guide(p_skill_library_id uuid, p_axis text, p_statements jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_axis = 'knowledge' then
    update skill_library
    set knowledge_level_guide = coalesce(knowledge_level_guide, p_statements)
    where id = p_skill_library_id;
  elsif p_axis = 'practical' then
    update skill_library
    set practical_level_guide = coalesce(practical_level_guide, p_statements)
    where id = p_skill_library_id;
  else
    raise exception 'invalid axis: %', p_axis;
  end if;
end;
$$;

grant execute on function set_skill_library_level_guide(uuid, text, jsonb) to authenticated;
