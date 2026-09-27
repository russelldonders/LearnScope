-- Security hardening from the 2026-09-27 review, part 3. No schema or data
-- changes.

-- 1. set_skill_library_level_guide (0089) let any signed-in user write the
-- shared level-guide text on any library skill whose guide was still empty,
-- which every learner tracking that skill then sees. api/generate-level-guide
-- now generates guides from the library entry's own name and writes the
-- cache with the service role, so learners no longer need this at all.
revoke execute on function public.set_skill_library_level_guide(uuid, text, jsonb) from public, anon, authenticated;

-- 2. Employer evidence access (20260921075057) matched any storage path a
-- learner listed in their own assessment's evidence_paths -- including a
-- path in someone else's folder. Evidence is stored at
-- {owner_user_id}/{skill_id}/..., so also require the file to sit in the
-- assessment owner's own folder.
drop policy "Scoped managers can read explicitly shared skill evidence files" on storage.objects;

create policy "Scoped managers can read explicitly shared skill evidence files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'skill-evidence'
    and exists (
      select 1
      from public.skill_assessments assessment
      where name = any(coalesce(assessment.evidence_paths, array[]::text[]))
        and (storage.foldername(name))[1] = assessment.user_id::text
        and public.is_skill_evidence_shared_with_employer(
          assessment.skill_id,
          (select auth.uid())
        )
    )
  );
