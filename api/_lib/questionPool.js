// The rules for drawing a learner's knowledge check from a skill level's
// question pool (skill_questions, migration 0323). Pure, so they can be
// tested without a database.

export const QUIZ_LENGTH = 10
export const POOL_CAP = 100

// How many new questions to generate before serving: enough for a full set
// of unseen ones when the learner has run out, never past the cap.
export function questionsToGenerate({ activeCount, unseenCount, quizLength = QUIZ_LENGTH, cap = POOL_CAP }) {
  if (unseenCount >= quizLength || activeCount >= cap) return 0
  return Math.min(quizLength, cap - activeCount)
}

export function shuffle(values, random = Math.random) {
  const copy = [...values]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

// Up to quizLength questions: freshly generated ones first, then others the
// learner hasn't been served, then (only if still short) ones they have --
// each group in random order, and the final set shuffled.
export function pickQuestions({ active, servedIds, freshIds = new Set(), quizLength = QUIZ_LENGTH, random = Math.random }) {
  const unseen = active.filter((row) => !servedIds.has(row.id))
  const ordered = [
    ...shuffle(unseen.filter((row) => freshIds.has(row.id)), random),
    ...shuffle(unseen.filter((row) => !freshIds.has(row.id)), random),
    ...shuffle(active.filter((row) => servedIds.has(row.id)), random),
  ]
  return shuffle(ordered.slice(0, quizLength), random)
}
