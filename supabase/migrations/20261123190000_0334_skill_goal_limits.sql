-- Goals can be limits: a repeating total that should stay at or under its
-- target ("no more than 2 coffees a day", "fewer than 3 takeaways a week").
--
-- Until now every total had to be direction 'higher'. A total may now be
-- 'lower' when it repeats (a period is set) and isn't done in sets: each
-- period is then met when it ends at or under the target.
--
-- Not destructive: the rule only widens, so every existing goal still
-- satisfies it and no data changes. Rollback: drop skill_goals_total_direction
-- and re-add skill_goals_total_is_higher (only possible once no limit goals
-- remain).

alter table public.skill_goals drop constraint skill_goals_total_is_higher;

alter table public.skill_goals add constraint skill_goals_total_direction check (
  aggregation = 'best'
  or direction = 'higher'
  or (
    period is not null
    and per_set is null
    and sets_per_session is null
    and sessions_per_period is null
  )
);
