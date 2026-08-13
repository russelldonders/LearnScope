-- Recognizes "Evaluate Skill" (an always-available AI re-assessment,
-- distinct from the one-time "Assess baseline" done while identified) as
-- another skill_assessments source.
alter table skill_assessments drop constraint skill_assessments_source_check;
alter table skill_assessments add constraint skill_assessments_source_check
  check (source in ('self', 'course', 'ai_baseline', 'ai_evaluation'));
