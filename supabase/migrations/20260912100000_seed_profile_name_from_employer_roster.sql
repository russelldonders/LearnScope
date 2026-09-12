-- An employer admin entering a member's name via the roster fields
-- (employer_member_field_values, 20260911150000) never touched that
-- learner's own profiles.first_name/last_name -- deliberately, per that
-- migration's own comment, since the roster is the employer's separate
-- HR-style record, not the learner's profile. But ProtectedRoute's
-- needsName gate (src/components/ProtectedRoute.jsx) reads profiles
-- directly, so an employer-invited account with no self-entered name stayed
-- stuck on /profile forever no matter what the employer recorded about
-- them -- there was no path for that name to ever reach the field
-- ProtectedRoute actually checks.
--
-- This seeds it, but only ever fills a blank -- it never overwrites a name
-- the learner has already set themselves, the same "fill blanks, never
-- clobber" rule Onboarding.jsx's persistProfileFields already applies to
-- CV-imported profile fields. A trigger (rather than an app-code call at
-- each write site) covers every path that can write a first_name/last_name
-- roster value uniformly -- the "Edit details" modal, the add-user flow,
-- and CSV import (once built) all funnel through the same
-- employer_member_field_values upsert, so one rule here is enough for all
-- three rather than three call sites that each have to remember it.
--
-- security definer is required here the same way create_employer/
-- decide_employer_invite already need it: profiles' own RLS ("Users manage
-- their own profile", 0002) only lets a learner update their own row, but
-- this update is initiated by whichever employer admin wrote the roster
-- value, not by the learner themselves.
create or replace function sync_employer_field_value_to_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_user_id uuid;
begin
  select key into v_key from employer_field_definitions where id = new.field_definition_id;
  if v_key not in ('first_name', 'last_name') or new.value is null or btrim(new.value) = '' then
    return new;
  end if;

  select user_id into v_user_id from employer_members where id = new.employer_member_id;

  if v_key = 'first_name' then
    update profiles set first_name = new.value, updated_at = now()
      where id = v_user_id and (first_name is null or btrim(first_name) = '');
  else
    update profiles set last_name = new.value, updated_at = now()
      where id = v_user_id and (last_name is null or btrim(last_name) = '');
  end if;

  return new;
end;
$$;

create trigger sync_employer_field_value_to_profile_trigger
  after insert or update of value on employer_member_field_values
  for each row execute procedure sync_employer_field_value_to_profile();

-- One-off backfill for rows already saved before this trigger existed --
-- without this, a name entered via "Edit details" prior to this migration
-- would stay invisible to ProtectedRoute until that same field happened to
-- be re-saved.
do $$
declare
  r record;
begin
  for r in
    select v.id, v.field_definition_id, v.value, v.employer_member_id
    from employer_member_field_values v
    join employer_field_definitions d on d.id = v.field_definition_id
    where d.key in ('first_name', 'last_name')
      and v.value is not null and btrim(v.value) <> ''
  loop
    update employer_member_field_values set value = value where id = r.id;
  end loop;
end $$;
