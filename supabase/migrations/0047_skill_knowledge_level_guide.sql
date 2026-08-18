-- Caches the AI-generated per-level knowledge guidance (5 statements, one
-- per level) so opening the knowledge self-assessment doesn't call the LLM
-- every time -- generated once (at skill creation, or lazily the first time
-- it's needed) and reused after that.
alter table skills add column knowledge_level_guide jsonb;
