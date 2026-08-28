// Practical/demonstrated-capability scale -- the primary proficiency
// measure. Deliberately describes what a learner can reliably *do*, not
// what they understand (see KNOWLEDGE_LEVEL_LABELS) -- knowledge alone
// never implies a practical level. Five plain adjectives naming the rung,
// not describing it, mirroring KNOWLEDGE_LEVEL_LABELS' economy -- and
// deliberately skill-agnostic (no "edge cases" or "the tricky stuff"
// language that assumes a troubleshooting-style skill), so it reads the same
// for a musical skill, a technical one, or a soft skill. The AI-generated
// per-skill guide is what actually carries skill-specific nuance (see
// ensurePracticalLevelGuide / SelfAssessSection).
export const LEVEL_LABELS = {
  1: 'Beginner',
  2: 'Developing',
  3: 'Capable',
  4: 'Skilled',
  5: 'Expert',
}

// Longer, skill-agnostic explanations of each practical level, shown when a
// learner wants to know what a level actually means before self-assessing.
// Unlike the knowledge axis (see knowledgeLevelGuide.js), these aren't
// generated per-skill -- the practical scale describes demonstrated ability
// in general terms that hold regardless of the specific skill.
export const LEVEL_DESCRIPTIONS = {
  1: "You've observed this being done, but haven't tried it yourself yet.",
  2: "You can attempt this with guidance, supervision, or a reference to follow.",
  3: "You can complete this on your own, without needing help.",
  4: "You can handle harder or less familiar situations with confidence, not just the routine ones.",
  5: "Others turn to you on this -- you're pushing quality or improving how it's done.",
}

// A separate scale for the knowledge/understanding axis -- kept distinct
// from LEVEL_LABELS' growth metaphor since it describes what a learner
// understands, not the practical ability tracked by skills.level.
export const KNOWLEDGE_LEVEL_LABELS = {
  1: 'Unfamiliar',
  2: 'Aware',
  3: 'Familiar',
  4: 'Knowledgeable',
  5: 'Deep understanding',
}

export const LEVELS = [1, 2, 3, 4, 5]
