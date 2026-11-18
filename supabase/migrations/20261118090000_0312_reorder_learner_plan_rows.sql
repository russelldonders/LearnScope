-- Run 0312. Reordering a plan's sections or items sent one UPDATE request per
-- row (src/lib/learnerPlans.js savePositions), so a ten-item list cost ten
-- round trips and a failure part-way left the order half-saved. As with
-- reorder_course_sections / reorder_course_content_links (20260930090000),
-- each reorder is now a single statement: all rows move, or none do.
--
-- Positions follow the array order (0-based); rows already in place are
-- skipped. SECURITY INVOKER, so the existing row-level security on
-- learner_plan_sections / learner_plan_items decides who may move what,
-- exactly as for the per-row updates this replaces, and the existing
-- per-row triggers (touch_learner_plan, item checks) still fire.
--
-- New functions only; no data changes. Rollback: drop both functions (the
-- client change in the same commit would then need reverting too).

create function public.reorder_learner_plan_sections(p_section_ids uuid[])
returns void
language sql
security invoker
set search_path = public
as $$
  update public.learner_plan_sections s
  set position = (o.ordinal - 1)::int
  from unnest(p_section_ids) with ordinality as o(id, ordinal)
  where s.id = o.id and s.position is distinct from (o.ordinal - 1)::int
$$;

create function public.reorder_learner_plan_items(p_item_ids uuid[])
returns void
language sql
security invoker
set search_path = public
as $$
  update public.learner_plan_items i
  set position = (o.ordinal - 1)::int
  from unnest(p_item_ids) with ordinality as o(id, ordinal)
  where i.id = o.id and i.position is distinct from (o.ordinal - 1)::int
$$;

revoke all on function public.reorder_learner_plan_sections(uuid[]) from public, anon;
revoke all on function public.reorder_learner_plan_items(uuid[]) from public, anon;
grant execute on function public.reorder_learner_plan_sections(uuid[]) to authenticated;
grant execute on function public.reorder_learner_plan_items(uuid[]) to authenticated;
