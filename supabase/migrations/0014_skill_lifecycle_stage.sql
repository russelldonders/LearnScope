-- Lifecycle stage: where a tracked skill currently sits in its own
-- progression, distinct from its proficiency level (which stays on
-- skill_assessments history). Selected once when the skill is added;
-- nullable so existing skills predating this feature aren't force-fit
-- into a stage nobody chose for them.
alter table skills add column lifecycle_stage text
  check (lifecycle_stage in (
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
