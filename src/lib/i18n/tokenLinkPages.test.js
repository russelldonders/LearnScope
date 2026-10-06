import { describe, expect, it } from 'vitest'
import { INTERFACE_LANGUAGES, loadTranslations } from './translations'
import rateSource from '../../pages/Rate.jsx?raw'
import recommendSource from '../../pages/Recommend.jsx?raw'
import sharedProfileSource from '../../pages/SharedProfile.jsx?raw'
import validateRequestSource from '../../pages/ValidateRequest.jsx?raw'

// The public token-link pages (and ValidateRequest, reached from the same
// kind of notification link) are often a visitor's first sight of
// LearnScope, so every key they use should be translated in every language
// rather than silently falling back to English.
const SOURCES = [rateSource, recommendSource, sharedProfileSource, validateRequestSource]

const staticKeys = [
  ...new Set(SOURCES.flatMap((source) => [...source.matchAll(/\bt\('([\w.]+)'/g)].map((m) => m[1]))),
]
// ValidateRequest builds these two families with template literals.
const dynamicKeys = [
  ...['pending', 'confirmed', 'declined'].map((s) => `validateRequest.status.${s}`),
  ...['self', 'course', 'ai_baseline', 'ai_evaluation'].map((s) => `validateRequest.sources.${s}`),
]

function resolve(dictionary, key) {
  return key.split('.').reduce((value, part) => value?.[part], dictionary)
}

describe('token-link page translations', () => {
  it('finds the keys the pages use', () => {
    expect(staticKeys.length).toBeGreaterThan(50)
  })

  it.each(INTERFACE_LANGUAGES.map((l) => l.value))('has every key in %s', async (language) => {
    const dictionary = await loadTranslations(language)
    const missing = [...staticKeys, ...dynamicKeys].filter((key) => typeof resolve(dictionary, key) !== 'string')
    expect(missing).toEqual([])
  })
})
