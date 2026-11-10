-- Goals with a shape: "3 sets of 100 sit-ups, 4 times a week". Until now a
-- goal held one number per period, so this was saved as "1200 sit-ups a
-- week", which loses what the learner is aiming for and would be met by
-- doing all 1200 on one day.
--
-- per_set (100), sets_per_session (3) and sessions_per_period (4) describe
-- it. A session is a day whose logged total reaches per_set x
-- sets_per_session; the period is met with sessions_per_period such days.
-- target_value keeps the period's total (1200) so anything reading only the
-- total still has a sensible number.
--
-- Additive and nullable: existing goals are untouched, and RLS is unchanged
-- (the existing owner-only policy covers the new columns).
alter table public.skill_goals
  add column per_set numeric check (per_set is null or per_set > 0),
  add column sets_per_session integer check (sets_per_session is null or sets_per_session between 1 and 50),
  add column sessions_per_period integer check (sessions_per_period is null or sessions_per_period >= 1);

-- All three or none, only on a counted total that repeats, and no more
-- sessions than the period has days.
alter table public.skill_goals
  add constraint skill_goals_sets_shape check (
    (per_set is null and sets_per_session is null and sessions_per_period is null)
    or (
      per_set is not null and sets_per_session is not null and sessions_per_period is not null
      and measure_kind = 'count' and aggregation = 'total' and period is not null
      and sessions_per_period <= case period when 'day' then 1 when 'week' then 7 when 'month' then 31 else 366 end
    )
  );
