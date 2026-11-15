import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ tables: {}, deleted: [], removed: {}, deleteError: null }))

vi.mock('./supabaseClient', () => {
  function query(table) {
    let lookup = false
    const chain = {
      in: () => { lookup = true; return chain },
      select: () => chain,
      eq: () => chain,
      not: () => chain,
      overlaps: () => chain,
      delete: () => ({
        eq: (_column, id) => {
          if (state.deleteError) return Promise.resolve({ error: state.deleteError })
          state.deleted.push([table, id])
          return Promise.resolve({ error: null })
        },
      }),
      // .in() is the after-delete check for resources still using a file.
      then: (resolve) => resolve({ data: (lookup ? state.tables[`${table}_after`] : state.tables[table]) ?? [], error: null }),
    }
    return chain
  }
  return {
    supabase: {
      from: query,
      storage: {
        from: (bucket) => ({
          remove: (paths) => {
            state.removed[bucket] = paths
            return Promise.resolve({ error: null })
          },
        }),
      },
    },
  }
})

const { deleteSkillWithFiles } = await import('./skillDeletion')

beforeEach(() => {
  state.tables = {}
  state.deleted = []
  state.removed = {}
  state.deleteError = null
})

describe('deleteSkillWithFiles', () => {
  it('deletes the skill, then its resource files and assessment evidence', async () => {
    state.tables = {
      skill_resources: [{ file_path: 'me/s1/a.pdf' }],
      skill_assessments: [{ evidence_paths: ['me/s1/x-0.png', 'me/s1/x-1.png'] }, { evidence_paths: null }],
      xapi_statements: [],
    }
    await deleteSkillWithFiles({ id: 's1' }, 'me')
    expect(state.deleted).toEqual([['skills', 's1']])
    expect(state.removed['skill-resources']).toEqual(['me/s1/a.pdf'])
    expect(state.removed['skill-evidence']).toEqual(['me/s1/x-0.png', 'me/s1/x-1.png'])
  })

  it('keeps evidence still listed on a kept activity, and never touches other people\'s folders', async () => {
    state.tables = {
      skill_resources: [{ file_path: 'someone-else/s1/a.pdf' }],
      skill_assessments: [{ evidence_paths: ['me/s1/x-0.png', 'me/s1/shared.png', 'rater/s1/r.png'] }],
      xapi_statements: [{ evidence_paths: ['me/s1/shared.png'] }],
    }
    await deleteSkillWithFiles({ id: 's1' }, 'me')
    expect(state.removed['skill-resources']).toBeUndefined()
    expect(state.removed['skill-evidence']).toEqual(['me/s1/x-0.png'])
  })

  it('keeps a resource file another resource still uses', async () => {
    state.tables = {
      skill_resources: [{ file_path: 'me/s1/a.pdf' }, { file_path: 'me/s1/b.pdf' }],
      skill_resources_after: [{ file_path: 'me/s1/b.pdf' }],
      skill_assessments: [],
    }
    await deleteSkillWithFiles({ id: 's1' }, 'me')
    expect(state.removed['skill-resources']).toEqual(['me/s1/a.pdf'])
  })

  it('removes no files when the skill could not be deleted', async () => {
    state.tables = { skill_resources: [{ file_path: 'me/s1/a.pdf' }], skill_assessments: [] }
    state.deleteError = new Error('denied')
    await expect(deleteSkillWithFiles({ id: 's1' }, 'me')).rejects.toThrow('denied')
    expect(state.removed).toEqual({})
  })
})
