import { beforeEach, describe, expect, it, vi } from 'vitest'

// Records every call so each test can check the exact sequence of writes.
const state = vi.hoisted(() => ({ calls: [], rpcError: null, relinkedRows: [{ id: 'link-1' }] }))

vi.mock('./supabaseClient', () => {
  function from(table) {
    const call = { table, op: null, values: null, filters: [] }
    state.calls.push(call)
    const chain = {
      update(values) { call.op = 'update'; call.values = values; return chain },
      eq(column, value) { call.filters.push([column, value]); return chain },
      select() { return chain },
      single() {
        return Promise.resolve({ data: { id: call.filters.find(([c]) => c === 'id')?.[1], ...call.values, status: 'draft' }, error: null })
      },
      then(resolve) {
        return Promise.resolve({ data: table === 'course_content_links' ? state.relinkedRows : [], error: null }).then(resolve)
      },
    }
    return chain
  }
  return {
    supabase: {
      from: vi.fn(from),
      rpc: vi.fn((name, args) => {
        state.calls.push({ rpc: name, args })
        if (state.rpcError && name === 'create_resource_draft_version') return Promise.resolve({ data: null, error: state.rpcError })
        return Promise.resolve({ data: name === 'create_resource_draft_version' ? 'page-v2' : null, error: null })
      }),
    },
  }
})

import { saveCoursePageEdit } from './courseContent'

const doc = { blocks: [] }

beforeEach(() => {
  state.calls.splice(0)
  state.rpcError = null
  state.relinkedRows = [{ id: 'link-1' }]
})

describe('saveCoursePageEdit', () => {
  it('updates a draft page in place', async () => {
    await saveCoursePageEdit({ id: 'page-1', linkId: 'link-1', status: 'draft' }, 'Final test – Coaching', doc)
    expect(state.calls).toHaveLength(1)
    expect(state.calls[0]).toMatchObject({ table: 'content_resources', op: 'update', filters: [['id', 'page-1'], ['type', 'page']] })
  })

  it('saves a published page as a new version linked into this course only, then publishes it', async () => {
    const saved = await saveCoursePageEdit(
      { id: 'page-1', linkId: 'link-1', status: 'published', is_current_published: true },
      'Final test – Coaching',
      doc
    )
    expect(state.calls.map((c) => c.rpc ?? `${c.op}:${c.table}`)).toEqual([
      'create_resource_draft_version',
      'update:content_resources',
      'update:course_content_links',
      'publish_resource_version',
    ])
    expect(state.calls[1].filters[0]).toEqual(['id', 'page-v2'])
    expect(state.calls[2]).toMatchObject({ values: { resource_id: 'page-v2' }, filters: [['id', 'link-1']] })
    expect(state.calls[3].args).toEqual({ p_resource_id: 'page-v2' })
    expect(saved).toMatchObject({ id: 'page-v2', status: 'published', is_current_published: true })
  })

  it('refuses to edit an older page version the course still uses', async () => {
    await expect(saveCoursePageEdit({ id: 'page-1', linkId: 'link-1', status: 'inactive', is_current_published: false }, 'T', doc))
      .rejects.toThrow('older version of this page')
    expect(state.calls).toHaveLength(0)
  })

  it('explains when the page already has a draft in the Resources library', async () => {
    state.rpcError = { message: 'This resource already has a draft version' }
    await expect(saveCoursePageEdit({ id: 'page-1', linkId: 'link-1', status: 'published', is_current_published: true }, 'T', doc))
      .rejects.toThrow('already has an unpublished draft')
  })

  it("fails loudly if the course's link couldn't be moved to the new version", async () => {
    state.relinkedRows = []
    await expect(saveCoursePageEdit({ id: 'page-1', linkId: 'link-1', status: 'published', is_current_published: true }, 'T', doc))
      .rejects.toThrow("Couldn't attach the new page version")
    expect(state.calls.some((c) => c.rpc === 'publish_resource_version')).toBe(false)
  })
})
