-- Learners could write skills.lifecycle_stage = 'validated' directly through
-- "Users manage their own skills" (0001), making a skill look peer/AI
-- verified to connections and employers without any validation -- and also
-- making them eligible to act as a validator for others.
--
-- 'validated'/'maintained' are only ever reached through server paths:
--   * decide_validation_request (SECURITY DEFINER, runs as its owner)
--   * api/validate-skill's save action (service_role)
-- so this only blocks the learner-facing roles from *moving* a skill into
-- those stages. Other updates to an already-validated skill (level, notes,
-- archiving, restoring) are unaffected, and no existing data is changed.

create or replace function private.guard_verified_skill_stage()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
     and new.lifecycle_stage in ('validated', 'maintained')
     and (tg_op = 'INSERT' or old.lifecycle_stage is distinct from new.lifecycle_stage) then
    raise exception 'A skill can only be marked as validated through a validation.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- "skills_a_..." so it runs before skills_sync_highest_lifecycle_stage
-- (same-timing triggers fire in name order) -- nothing gets recorded as the
-- skill's highest stage for a write that is about to be rejected anyway.
create trigger skills_a_guard_verified_stage
  before insert or update of lifecycle_stage on public.skills
  for each row execute function private.guard_verified_skill_stage();
