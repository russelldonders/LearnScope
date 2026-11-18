-- Moving a goal to another of the learner's skills, for one set on the
-- wrong skill by mistake.
--
-- A goal and the goals it replaced (when its target changed) are one effort
-- and must stay on one skill (skill_goals_replaces_same_skill), so the whole
-- chain moves together, in one statement. For a measured goal ("32
-- push-ups"), the entries logged for it -- activities on the old skill
-- carrying its measurement -- move with it, so its progress comes along; a
-- goal that counts activities or practice time has no entries of its own
-- (it counts whatever is on its skill), so nothing else moves. If another
-- goal left on the old skill measures the same thing, its entries can't be
-- told apart, so they stay where they are.
--
-- SECURITY INVOKER: every row it touches still has to pass the learner's own
-- row-level security -- their goal, their skills, their activities.

create or replace function public.move_skill_goal(p_goal_id uuid, p_skill_id uuid)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
  v_goal public.skill_goals%rowtype;
  v_old_skill uuid;
  v_new_skill public.skills%rowtype;
  v_chain uuid[];
  v_moved_entries integer := 0;
  v_entry_ids uuid[];
begin
  if v_caller is null then
    raise insufficient_privilege using message = 'Sign in to move a goal';
  end if;

  select * into v_goal from public.skill_goals where id = p_goal_id;
  if not found then
    raise exception 'Goal not found' using errcode = 'no_data_found';
  end if;
  v_old_skill := v_goal.skill_id;

  select * into v_new_skill from public.skills where id = p_skill_id and user_id = v_caller;
  if not found then
    raise exception 'Choose one of your own skills' using errcode = 'check_violation';
  end if;
  if p_skill_id = v_old_skill then
    return 0;
  end if;

  -- The goal and every goal linked to it by replacement, either way.
  with recursive chain(id) as (
    select p_goal_id
    union
    select g.id
    from public.skill_goals g
    join chain c on g.replaces_goal_id = c.id or g.id = (select replaces_goal_id from public.skill_goals where id = c.id)
  )
  select array_agg(id) into v_chain from chain;

  update public.skill_goals set skill_id = p_skill_id where id = any (v_chain);

  -- The goal's own entries, for a measured goal no other goal on the old
  -- skill measures the same way.
  if v_goal.measure_kind not in ('activities', 'practice_time')
     and not exists (
       select 1 from public.skill_goals other
       where other.skill_id = v_old_skill
         and other.metric = v_goal.metric
         and other.unit = v_goal.unit
     ) then
    select array_agg(s.id) into v_entry_ids
    from public.xapi_statements s
    where s.user_id = v_caller
      and s.skill_id = v_old_skill
      and s.statement -> 'result' -> 'extensions' -> 'https://learnscope.app/xapi/extensions/measurement'
          @> jsonb_build_array(jsonb_build_object('metric', v_goal.metric, 'unit', v_goal.unit));

    if v_entry_ids is not null then
      -- The skill named on each entry follows it too.
      update public.xapi_statements s
      set skill_id = p_skill_id,
          statement = case
            when jsonb_typeof(s.statement -> 'context' -> 'extensions' -> 'https://learnscope.app/xapi/extensions/skill') = 'array'
            then jsonb_set(
              s.statement,
              '{context,extensions,https://learnscope.app/xapi/extensions/skill}',
              (
                select coalesce(jsonb_agg(
                  case when element ->> 'id' = v_old_skill::text
                    then jsonb_build_object('id', v_new_skill.id, 'name', v_new_skill.name)
                    else element end
                ), '[]'::jsonb)
                from jsonb_array_elements(s.statement -> 'context' -> 'extensions' -> 'https://learnscope.app/xapi/extensions/skill') element
              )
            )
            else s.statement
          end
      where s.id = any (v_entry_ids);
      get diagnostics v_moved_entries = row_count;

      -- Their extra skill links, likewise (at most one per skill).
      insert into public.xapi_statement_skills (user_id, statement_id, skill_id)
      select x.user_id, x.statement_id, p_skill_id
      from public.xapi_statement_skills x
      where x.statement_id = any (v_entry_ids) and x.skill_id = v_old_skill
      on conflict do nothing;
      delete from public.xapi_statement_skills
      where statement_id = any (v_entry_ids) and skill_id = v_old_skill;
    end if;
  end if;

  return v_moved_entries;
end;
$$;

revoke all on function public.move_skill_goal(uuid, uuid) from public, anon;
grant execute on function public.move_skill_goal(uuid, uuid) to authenticated;
