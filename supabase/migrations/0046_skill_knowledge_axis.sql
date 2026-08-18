-- Splits the single proficiency scale into two parallel axes: the existing
-- skills.level (kept for practical/demonstrated ability) and a new
-- skills.knowledge_level (theoretical understanding). skill_assessments now
-- tags each row with which axis it's evidence for, defaulting existing rows
-- to 'practical' so nothing already recorded changes meaning.
alter table skill_assessments add column axis text not null default 'practical'
  check (axis in ('practical', 'knowledge'));

alter table skills add column knowledge_level int check (knowledge_level between 1 and 5);
