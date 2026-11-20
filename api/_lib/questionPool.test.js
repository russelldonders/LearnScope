import { describe, expect, it } from 'vitest'
import { pickQuestions, questionsToGenerate } from './questionPool.js'

const rows = (n, prefix = 'q') => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}` }))

describe('questionsToGenerate', () => {
  it('generates the first 10 the first time a level is launched', () => {
    expect(questionsToGenerate({ activeCount: 0, unseenCount: 0 })).toBe(10)
  })
  it('serves from the pool while the learner still has 10 unseen', () => {
    expect(questionsToGenerate({ activeCount: 30, unseenCount: 10 })).toBe(0)
  })
  it('adds 10 more when a returning learner has run out', () => {
    expect(questionsToGenerate({ activeCount: 30, unseenCount: 4 })).toBe(10)
  })
  it('never grows the pool past 100', () => {
    expect(questionsToGenerate({ activeCount: 95, unseenCount: 0 })).toBe(5)
    expect(questionsToGenerate({ activeCount: 100, unseenCount: 0 })).toBe(0)
    expect(questionsToGenerate({ activeCount: 130, unseenCount: 0 })).toBe(0)
  })
})

describe('pickQuestions', () => {
  it('gives a new learner 10 from the pool', () => {
    const picked = pickQuestions({ active: rows(100), servedIds: new Set() })
    expect(picked).toHaveLength(10)
    expect(new Set(picked.map((r) => r.id)).size).toBe(10)
  })

  it('prefers questions the learner has not seen, then fills from seen ones', () => {
    const active = rows(14)
    const servedIds = new Set(active.slice(0, 8).map((r) => r.id))
    const picked = pickQuestions({ active, servedIds }).map((r) => r.id)
    expect(picked).toHaveLength(10)
    for (const id of active.slice(8).map((r) => r.id)) expect(picked).toContain(id)
  })

  it('puts freshly generated questions in the set first', () => {
    const old = rows(20, 'old')
    const fresh = rows(10, 'new')
    const picked = pickQuestions({ active: [...old, ...fresh], servedIds: new Set(), freshIds: new Set(fresh.map((r) => r.id)) })
    expect(picked.map((r) => r.id).sort()).toEqual(fresh.map((r) => r.id).sort())
  })
})
