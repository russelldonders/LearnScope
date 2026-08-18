-- Inserts a new lifecycle stage, "Confirming Baseline", between
-- "Establishing Baseline" (identified) and "Target Setting"
-- (baseline_assessed) -- once a skill's baseline is AI-assessed it now
-- needs a level-calibrated knowledge check before advancing to target
-- setting, rather than moving straight there.
alter table skills drop constraint skills_lifecycle_stage_check;
alter table skills add constraint skills_lifecycle_stage_check
  check (lifecycle_stage in (
    'identified',
    'confirming_baseline',
    'baseline_assessed',
    'target_set',
    'developing',
    'demonstrated',
    'validated',
    'maintained',
    'at_risk',
    'archived'
  ));

alter table skills drop constraint skills_highest_lifecycle_stage_check;
alter table skills add constraint skills_highest_lifecycle_stage_check
  check (highest_lifecycle_stage in (
    'identified',
    'confirming_baseline',
    'baseline_assessed',
    'target_set',
    'developing',
    'demonstrated',
    'validated',
    'maintained',
    'at_risk',
    'archived'
  ));

-- Re-defined with confirming_baseline inserted into the ranked flow, so the
-- high-water-mark trigger (0045) ranks it correctly relative to the stages
-- on either side of it.
create or replace function sync_skill_highest_lifecycle_stage()
returns trigger
language plpgsql
as $$
declare
  flow_stages text[] := array['identified', 'confirming_baseline', 'baseline_assessed', 'target_set', 'developing', 'demonstrated', 'validated', 'maintained'];
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
