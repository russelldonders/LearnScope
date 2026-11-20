import { ensureLevelGuide, generateLevelGuide } from './levelGuide'

// Practical-axis entry points -- see levelGuide.js for how definitions are
// generated once and shared.
export function generatePracticalLevelGuide(skillName, librarySkillId = null) {
  return generateLevelGuide('practical', skillName, librarySkillId)
}

export function ensurePracticalLevelGuide(skill) {
  return ensureLevelGuide(skill, 'practical')
}
