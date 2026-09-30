import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpcCalls = vi.hoisted(() => [])

vi.mock('./supabaseClient', () => ({
  supabase: {
    rpc: vi.fn((name, args) => {
      rpcCalls.push({ name, args })
      return Promise.resolve({ error: null })
    }),
  },
}))

import { reorderContentLinks, reorderCourseSections } from './courseContent'

// Which rows actually change (section moves, renumbering from 0) is decided
// in one statement by the database functions -- see
// supabase/tests/course_reorder_functions.sql. The client just sends the order.
describe('course reordering', () => {
  beforeEach(() => rpcCalls.splice(0))

  it('sends a section list and its destination in a single call', async () => {
    await reorderContentLinks([
      { linkId: 'link-a', sectionId: 'section-old', position: 0 },
      { linkId: 'link-b', sectionId: 'section-new', position: 1 },
    ], 'section-new')

    expect(rpcCalls).toEqual([
      { name: 'reorder_course_content_links', args: { p_section_id: 'section-new', p_link_ids: ['link-a', 'link-b'] } },
    ])
  })

  it('keeps ungrouped resources ungrouped and skips an empty list', async () => {
    await reorderContentLinks([{ linkId: 'link-a', sectionId: null, position: 4 }], null)
    await reorderContentLinks([], null)

    expect(rpcCalls).toEqual([
      { name: 'reorder_course_content_links', args: { p_section_id: null, p_link_ids: ['link-a'] } },
    ])
  })

  it('sends the full section order in a single call', async () => {
    await reorderCourseSections([{ id: 's2', position: 1 }, { id: 's1', position: 0 }])
    expect(rpcCalls).toEqual([{ name: 'reorder_course_sections', args: { p_section_ids: ['s2', 's1'] } }])
  })
})
