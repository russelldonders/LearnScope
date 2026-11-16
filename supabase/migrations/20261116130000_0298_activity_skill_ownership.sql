-- An activity can only be linked to skills that belong to the person whose
-- activity it is: its main skill (xapi_statements.skill_id) and every
-- further skill link (xapi_statement_skills). Until now nothing stopped a
-- learner writing directly to the API from linking one of their own
-- activities to someone else's skill id. That added nothing to the other
-- person's skill and they never saw it, but people validating that skill
-- could see the stranger's activity mixed in with its evidence.
--
-- Checked, as the existing activity guards are (20261107100000), for direct
-- writes by a signed-in user. Database functions run as their owner and
-- already write matching pairs (rate_connection_skill records the skill
-- owner's own activity; account transfers move skills and activities
-- between a person's own accounts in steps). Only a link being set or
-- changed is checked, so clearing one when its skill is deleted never is.
-- Staging had no activity linked to another person's skill when this was
-- written, so nothing existing is affected.

-- Runs as the caller (not security definer), like the guards it sits beside:
-- current_user must still say who is writing. Reading skills as the caller is
-- enough -- their own skill is always visible to them, and a skill that
-- isn't theirs fails the check whether or not they can see it.
-- search_path is public, not empty: reading skills as the caller runs that
-- table's policies, whose helpers name tables without a schema.
create or replace function private.check_activity_skill_owner()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user <> 'authenticated' or new.skill_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.skill_id is not distinct from old.skill_id
     and new.user_id is not distinct from old.user_id then
    return new;
  end if;
  if not exists (
    select 1 from public.skills s
    where s.id = new.skill_id and s.user_id = new.user_id
  ) then
    raise exception 'An activity can only be linked to your own skills.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.check_activity_skill_owner() from public, anon, authenticated;

create trigger check_xapi_statement_skill_owner
before insert or update of skill_id, user_id on public.xapi_statements
for each row execute function private.check_activity_skill_owner();

create trigger check_xapi_statement_skill_link_owner
before insert or update of skill_id, user_id on public.xapi_statement_skills
for each row execute function private.check_activity_skill_owner();
