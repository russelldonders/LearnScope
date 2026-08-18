-- Recognizes the Confirming Baseline knowledge-check quiz's confirm step as
-- another skill_assessments source, distinct from 'ai_baseline' (a
-- multi-source AI synthesis) since this is a single, MCQ-based, explicitly
-- learner-confirmed evidence type.
alter table skill_assessments drop constraint skill_assessments_source_check;
alter table skill_assessments add constraint skill_assessments_source_check
  check (source in ('self', 'course', 'ai_baseline', 'ai_evaluation', 'diagnostic_confirmed'));
