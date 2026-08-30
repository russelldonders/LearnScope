import { beforeEach, describe, expect, it, vi } from 'vitest'

const updates = vi.hoisted(() => [])

vi.mock('./supabaseClient', () => ({
  supabase: {
    from: vi.fn((table) => ({
      update: (values) => ({
        eq: (column, id) => {
          updates.push({ table, values, column, id })
          return Promise.resolve({ error: null })
        },
      }),
    })),
  },
}))

import { reorderContentLinks } from './courseContent'

describe('reorderContentLinks', () => {
  beforeEach(() => updates.splice(0))

  it('persists the destination section even when the numeric position is unchanged', async () => {
    await reorderContentLinks([
      { linkId: 'link-a', sectionId: 'section-old', position: 0 },
      { linkId: 'link-b', sectionId: 'section-new', position: 1 },
    ], 'section-new')

    expect(updates).toEqual([
      {
        table: 'course_content_links',
        values: { section_id: 'section-new', position: 0 },
        column: 'id',
        id: 'link-a',
      },
    ])
  })

  it('normalizes positions while keeping ungrouped resources ungrouped', async () => {
    await reorderContentLinks([
      { linkId: 'link-a', sectionId: null, position: 4 },
      { linkId: 'link-b', sectionId: null, position: 7 },
    ], null)

    expect(updates.map(({ values, id }) => ({ values, id }))).toEqual([
      { values: { section_id: null, position: 0 }, id: 'link-a' },
      { values: { section_id: null, position: 1 }, id: 'link-b' },
    ])
  })
})
