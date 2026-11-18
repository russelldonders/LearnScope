import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabaseClient', () => ({ supabase: {} }))

const { nameFinalTestPages } = await import('./courseGeneration')

const draft = {
  name: 'Coaching basics',
  sections: [
    { title: 'Getting started', pages: [{ title: 'Why coaching works', blocks: [] }] },
    { title: 'Final test', pages: [{ title: 'Final test', blocks: [{ type: 'test_question' }] }] },
  ],
}

describe('nameFinalTestPages', () => {
  it('names the final test page after its course, leaving everything else alone', () => {
    const named = nameFinalTestPages(draft)
    expect(named.sections[1].pages[0].title).toBe('Final test – Coaching basics')
    expect(named.sections[1].title).toBe('Final test')
    expect(named.sections[0].pages[0].title).toBe('Why coaching works')
    expect(named.sections[1].pages[0].blocks).toEqual([{ type: 'test_question' }])
  })

  it('does not change the draft it was given', () => {
    nameFinalTestPages(draft)
    expect(draft.sections[1].pages[0].title).toBe('Final test')
  })

  it('keeps titles within the 200-character limit', () => {
    const long = nameFinalTestPages({ ...draft, name: 'x'.repeat(250) })
    expect(long.sections[1].pages[0].title).toHaveLength(200)
  })

  it('leaves drafts without a course name or sections as they are', () => {
    expect(nameFinalTestPages({ sections: draft.sections })).toEqual({ sections: draft.sections })
    expect(nameFinalTestPages(null)).toBeNull()
  })
})
