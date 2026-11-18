-- Run 0310. AI-generated courses end in a "Final test" section whose single
-- page was also titled just "Final test", so an organisation's Resources
-- library could hold several identical "Final test" pages with nothing to
-- tell which course each belonged to. New generated courses now name the
-- page after the course (src/lib/courseGeneration.js, and the skill-course
-- job in api/_lib/skillCourseGenerationJobHandler.js); this renames the
-- existing ones the same way.
--
-- Affected: content_resources rows of type 'page' titled exactly
-- 'Final test' whose course links all point at courses with one and the
-- same name (a page shared by differently named courses is left alone, as
-- is any page not linked to a course). Only the title changes -- content,
-- version, status and timestamps are untouched. Published pages can't be
-- edited through the app (only drafts can), hence a migration.
--
-- Data loss risk: none. Rollback: every renamed page's previous title was
-- exactly 'Final test', so
--   update public.content_resources set title = 'Final test'
--   where type = 'page' and title like 'Final test – %';
-- restores it (it would also revert any page later created with that
-- prefix, so run it promptly if needed).

with page_course_names as (
  select l.resource_id, min(c.name) as course_name
  from public.course_content_links l
  join public.course_catalogue c on c.id = l.course_id
  group by l.resource_id
  having count(distinct c.name) = 1
)
update public.content_resources r
set title = left('Final test – ' || trim(p.course_name), 200)
from page_course_names p
where r.id = p.resource_id
  and r.type = 'page'
  and r.title = 'Final test'
  and nullif(trim(p.course_name), '') is not null;
