-- Caches the AI-generated per-level practical-ability guidance (5
-- statements, one per level) for the practical axis, the same way
-- 0047 caches knowledge_level_guide for the knowledge axis -- generated
-- once (lazily, the first time it's needed) and reused after that.
alter table skills add column practical_level_guide jsonb;
