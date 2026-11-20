import { ensureLevelGuide, generateLevelGuide } from './levelGuide'

// Knowledge-axis entry points -- see levelGuide.js for how definitions are
// generated once and shared.
export function generateKnowledgeLevelGuide(skillName, librarySkillId = null) {
  return generateLevelGuide('knowledge', skillName, librarySkillId)
}

export function ensureKnowledgeLevelGuide(skill) {
  return ensureLevelGuide(skill, 'knowledge')
}
