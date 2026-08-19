// Practical/demonstrated-capability scale -- the primary proficiency
// measure. Deliberately describes what a learner can reliably *do*, not
// what they understand (see KNOWLEDGE_LEVEL_LABELS) -- knowledge alone
// never implies a practical level.
export const LEVEL_LABELS = {
  1: 'Watching and learning',
  2: 'Trying it with support',
  3: 'Doing it independently',
  4: 'Handling the tricky stuff',
  5: 'Raising the standard',
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
