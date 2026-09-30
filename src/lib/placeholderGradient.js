// Deterministic two-colour gradient for placeholder artwork (a course with no
// image, a skill with no icon): the same seed always picks the same pair, so
// it doesn't reshuffle between reloads, and it costs no image-generation call.
export const GRADIENT_PAIRS = [
  ['#4a6741', '#3d5a73'], // moss -> slate
  ['#b8912a', '#4a6741'], // gold -> moss
  ['#3d5a73', '#8fb885'], // slate -> evidence green
  ['#8fb885', '#b8912a'], // evidence green -> gold
  ['#4a6741', '#b8912a'], // moss -> gold
  ['#3d5a73', '#b8912a'], // slate -> gold
]

function hashString(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

export function gradientPairFor(seed) {
  return GRADIENT_PAIRS[hashString(seed ?? '') % GRADIENT_PAIRS.length]
}
