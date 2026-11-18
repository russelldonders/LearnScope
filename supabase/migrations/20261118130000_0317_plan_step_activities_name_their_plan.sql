-- Activities recorded by ticking off a plan step or resource now name the
-- plan and step they came from (the 'plan' context extension, { id, title,
-- itemId }, see src/lib/xapiStatement.js), so the activity timeline can say
-- which plan and lead back to the step. New ticks record it as they're made
-- (setItemDone); this gives activities ticked off before now the same, from
-- the link the tick already keeps (learner_plan_item_progress
-- .completion_statement_id).
--
-- Additive only: the extension is added to activities that a plan item's
-- progress points at and that don't have it yet; nothing else in the
-- activity changes. The plan's title is as it is now -- these were recorded
-- before titles were kept on the activity.

update public.xapi_statements s
set statement = jsonb_set(
  s.statement,
  '{context}',
  coalesce(s.statement -> 'context', '{}'::jsonb)
    || jsonb_build_object(
      'extensions',
      coalesce(s.statement -> 'context' -> 'extensions', '{}'::jsonb)
        || jsonb_build_object(
          'https://learnscope.app/xapi/extensions/plan',
          jsonb_build_object('id', p.id, 'title', p.title, 'itemId', i.id)
        )
    )
)
from public.learner_plan_item_progress progress
join public.learner_plan_items i on i.id = progress.item_id
join public.learner_plans p on p.id = i.plan_id
where progress.completion_statement_id = s.id
  and progress.user_id = s.user_id
  and not coalesce(s.statement -> 'context' -> 'extensions' ? 'https://learnscope.app/xapi/extensions/plan', false);
