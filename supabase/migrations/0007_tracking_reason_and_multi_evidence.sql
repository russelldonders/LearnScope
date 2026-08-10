alter table skills add column tracking_reason text
  check (tracking_reason in ('lifestyle', 'work', 'personal_interest', 'career_development'));

alter table skill_assessments add column evidence_paths text[];

update skill_assessments
set evidence_paths = array[evidence_path]
where evidence_path is not null and evidence_paths is null;
