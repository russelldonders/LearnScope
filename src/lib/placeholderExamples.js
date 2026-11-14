import { useState } from 'react'

// One example from a translated list of them (a plain string passes through),
// chosen by a number in [0, 1). Placeholders hold a mix of examples -- work,
// study, hobbies, fitness -- so not everyone sees running and push-ups.
export function pickExample(value, seed) {
  if (!Array.isArray(value)) return value
  if (value.length === 0) return ''
  return value[Math.min(value.length - 1, Math.floor(seed * value.length))]
}

// A seed fixed for as long as the component is open, so the example doesn't
// change on every keystroke but does vary from one visit to the next.
export function useExampleSeed() {
  const [seed] = useState(Math.random)
  return seed
}
