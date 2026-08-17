-- Tracks the furthest a skill has ever gotten through its lifecycle,
-- separate from `lifecycle_stage` (the current/active stage), now that a
-- learner can click an earlier stage on the timeline to move the skill back
-- to it -- without this, doing so would look identical to never having
-- reached the later stage at all.
alter table skills add column highest_lifecycle_stage text
  check (highest_lifecycle_stage in (
    'identified',
    'baseline_assessed',
    'target_set',
    'developing',
    'demonstrated',
    'validated',
    'maintained',
    'at_risk',
    'archived'
  ));

-- An existing skill's current stage is, by definition, at least as far as
-- it's ever knowingly reached -- there's no historical trail to
-- reconstruct anything better than that for rows that already exist.
update skills set highest_lifecycle_stage = lifecycle_stage where lifecycle_stage is not null;

-- Keeps highest_lifecycle_stage monotonically non-decreasing regardless of
-- which code path moves lifecycle_stage -- the click-to-revert UI, the
-- forward stage-advance actions, or the decide_validation_request RPC
-- (0041). A trigger is used instead of repeating "take the max" logic at
-- every one of those call sites, so it can't drift out of sync at a call
-- site added later.
--
-- Fires on every insert/update (not scoped to "update of lifecycle_stage")
-- and always compares against OLD, not the client-submitted NEW, so a
-- client can't forge or erase the high-water mark by including
-- highest_lifecycle_stage directly in the same UPDATE -- whatever value
-- they send for that column is discarded and recomputed here. This is the
-- one column deliberately not owner-writable in practice, even though RLS
-- only checks user_id, not individual columns.
-- at_risk/archived are exception states outside the normal forward flow,
-- so they neither advance nor reset the high-water mark.
create or replace function sync_skill_highest_lifecycle_stage()
returns trigger
language plpgsql
as $$
declare
  flow_stages text[] := array['identified', 'baseline_assessed', 'target_set', 'developing', 'demonstrated', 'validated', 'maintained'];
  new_rank int;
  highest_rank int;
  prior_highest text;
begin
  prior_highest := case when tg_op = 'UPDATE' then old.highest_lifecycle_stage else null end;
  new.highest_lifecycle_stage := prior_highest;

  if new.lifecycle_stage is null then
    return new;
  end if;

  new_rank := array_position(flow_stages, new.lifecycle_stage);
  if new_rank is null then
    return new;
  end if;

  highest_rank := array_position(flow_stages, prior_highest);
  if highest_rank is null or new_rank > highest_rank then
    new.highest_lifecycle_stage := new.lifecycle_stage;
  end if;

  return new;
end;
$$;

create trigger skills_sync_highest_lifecycle_stage
  before insert or update on skills
  for each row
  execute function sync_skill_highest_lifecycle_stage();
