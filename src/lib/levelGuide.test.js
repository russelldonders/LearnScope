import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const LIB = ['L1', 'L2', 'L3', 'L4', 'L5']
const PERSONAL = ['P1', 'P2', 'P3', 'P4', 'P5']
const GENERATED = ['G1', 'G2', 'G3', 'G4', 'G5']

let libraryRow
const skillUpdates = []
vi.mock('./supabaseClient', () => ({
  supabase: {
    auth: { getSession: () => Promise.resolve({ data: { session: { access_token: 't' } } }) },
    from: (table) => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: libraryRow, error: null }) }),
      }),
      update: (row) => ({
        eq: (_col, id) => {
          skillUpdates.push({ table, id, row })
          return Promise.resolve({ error: null })
        },
      }),
    }),
  },
}))

const { ensureLevelGuide, prepareLibraryLevelGuides } = await import('./levelGuide')

let fetchMock
beforeEach(() => {
  libraryRow = null
  skillUpdates.length = 0
  fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ statements: GENERATED }) }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('ensureLevelGuide', () => {
  it('shows the shared library definitions, ignoring an older personal copy', async () => {
    libraryRow = { id: 'lib1', knowledge_level_guide: LIB }
    const skill = { id: 's1', name: 'Python', library_skill_id: 'lib1', knowledge_level_guide: PERSONAL }
    expect(await ensureLevelGuide(skill, 'knowledge')).toEqual(LIB)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('generates once through the server (which stores it on the library) when the library has none', async () => {
    libraryRow = { id: 'lib1', practical_level_guide: null }
    const skill = { id: 's1', name: 'Python', library_skill_id: 'lib1' }
    expect(await ensureLevelGuide(skill, 'practical')).toEqual(GENERATED)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ skillName: 'Python', axis: 'practical', librarySkillId: 'lib1' })
    // Never written to the learner's own row for a library skill.
    expect(skillUpdates).toEqual([])
  })

  it('shares one request when the same skill asks twice at once', async () => {
    libraryRow = { id: 'lib1', knowledge_level_guide: null }
    const skill = { id: 's1', name: 'Python', library_skill_id: 'lib1' }
    const [a, b] = await Promise.all([ensureLevelGuide(skill, 'knowledge'), ensureLevelGuide({ ...skill }, 'knowledge')])
    expect(a).toEqual(GENERATED)
    expect(b).toEqual(GENERATED)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps a custom skill’s own copy and only generates (and stores) it once', async () => {
    const cached = { id: 's2', name: 'Juggling', library_skill_id: null, knowledge_level_guide: PERSONAL }
    expect(await ensureLevelGuide(cached, 'knowledge')).toEqual(PERSONAL)
    expect(fetchMock).not.toHaveBeenCalled()

    const fresh = { id: 's3', name: 'Juggling', library_skill_id: null, knowledge_level_guide: null }
    expect(await ensureLevelGuide(fresh, 'knowledge')).toEqual(GENERATED)
    expect(skillUpdates).toEqual([{ table: 'skills', id: 's3', row: { knowledge_level_guide: GENERATED } }])
  })

  it('falls back to the skill’s own copy when its library entry can’t be read', async () => {
    libraryRow = null
    const skill = { id: 's4', name: 'Hidden', library_skill_id: 'gone', practical_level_guide: PERSONAL }
    expect(await ensureLevelGuide(skill, 'practical')).toEqual(PERSONAL)
  })
})

describe('prepareLibraryLevelGuides', () => {
  it('generates both axes for a new library entry', async () => {
    libraryRow = { id: 'lib9', knowledge_level_guide: null, practical_level_guide: null }
    prepareLibraryLevelGuides('lib9', 'Rust')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const axes = fetchMock.mock.calls.map((call) => JSON.parse(call[1].body).axis).sort()
    expect(axes).toEqual(['knowledge', 'practical'])
  })
})
