-- A skill on a learner plan describes what that plan is intended to build,
-- independently of the learner's current self-assessed or confirmed levels.
-- Either axis may be used on its own. Existing skill items remain valid with
-- no plan levels so the UI can ask the learner to add them when next edited.
alter table public.learner_plan_items
  add column plan_knowledge_level smallint,
  add column plan_practical_level smallint,
  add constraint learner_plan_items_plan_knowledge_level_check
    check (plan_knowledge_level is null or plan_knowledge_level between 1 and 5),
  add constraint learner_plan_items_plan_practical_level_check
    check (plan_practical_level is null or plan_practical_level between 1 and 5),
  add constraint learner_plan_items_plan_skill_levels_type_check
    check (
      (plan_knowledge_level is null and plan_practical_level is null)
      or item_type = 'skill'
    );
