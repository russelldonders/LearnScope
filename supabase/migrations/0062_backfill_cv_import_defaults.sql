-- CV-imported skills never had lifecycle_stage or tracking_reason set
-- (unlike FindSkillModal's manual add path, which always sets both), so
-- every imported skill fell through every branch of computeUpNextItems and
-- never appeared in the Up Next checklist, showed no lifecycle badge on the
-- Skills grid, and had no "why are you tracking this" reason. The app-side
-- fixes (ResumeImportReviewModal.jsx) only cover imports going forward --
-- this backfills existing rows the same way.
update skills
set lifecycle_stage = 'identified'
where source = 'cv_import'
  and lifecycle_stage is null;

update skills
set tracking_reason = 'work'
where source = 'cv_import'
  and tracking_reason is null;
