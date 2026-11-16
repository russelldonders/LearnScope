import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSkillRelatedData } from './useSkillDetailData'
import { LanguageProvider } from '../context/LanguageContext'

const catalogue = vi.hoisted(() => ({ listCalls: 0 }))

vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'learner-1' } }) }))
vi.mock('../lib/courseCatalogue', () => ({
  listCatalogueCourses: () => {
    catalogue.listCalls += 1
    return Promise.resolve([
      { id: 'advanced', skillEntries: [{ skillId: 'lib-1', level: 4 }] },
      { id: 'taken', skillEntries: [{ skillId: 'lib-1', level: 1 }] },
      { id: 'intro', skillEntries: [{ skillId: 'lib-1', level: 2 }] },
      { id: 'other-skill', skillEntries: [{ skillId: 'lib-2', level: 1 }] },
    ])
  },
  listMyCatalogueCourseIds: () => Promise.resolve(new Set(['taken'])),
  startedCatalogueCourseIds: () => Promise.resolve(new Set()),
}))
vi.mock('../lib/skillStats', () => ({
  countSkillTrackers: () => Promise.resolve(7),
  listConnectionsWithSkill: () => Promise.resolve([]),
}))
vi.mock('../lib/connections', () => ({ getProfiles: () => Promise.resolve({}), listConnections: () => Promise.resolve([]) }))
vi.mock('../lib/skillComposites', () => ({
  getLearnerCompositeProgress: () => Promise.resolve(null),
  getParentCompositesForSkill: () => Promise.resolve([]),
}))
vi.mock('../lib/managerSkillActions', () => ({
  listTargetsSetByOthers: () => Promise.resolve([]),
  listLatestManagerRatings: () => Promise.resolve([]),
  pickTargetSetByOthers: () => null,
}))

afterEach(() => {
  cleanup()
  catalogue.listCalls = 0
})

const ownLibrarySkill = { id: 'skill-1', user_id: 'learner-1', library_skill_id: 'lib-1' }

function renderRelated(skill) {
  return renderHook(() => useSkillRelatedData(skill, []), { wrapper: LanguageProvider })
}

describe('useSkillRelatedData', () => {
  it('recommends catalogue courses for this skill the learner has no record of, easiest first', async () => {
    const { result } = renderRelated(ownLibrarySkill)
    await waitFor(() => expect(result.current.availableCourses).not.toBeNull())
    expect(result.current.availableCourses.map((entry) => [entry.course.id, entry.level])).toEqual([
      ['intro', 2],
      ['advanced', 4],
    ])
    await waitFor(() => expect(result.current.totalTrackersCount).toBe(7))
  })

  it('reloads the recommendations when asked', async () => {
    const { result } = renderRelated(ownLibrarySkill)
    await waitFor(() => expect(catalogue.listCalls).toBe(1))
    act(() => result.current.refreshAvailableCourses())
    await waitFor(() => expect(catalogue.listCalls).toBe(2))
  })

  it('recommends nothing for a skill outside the shared library', async () => {
    const { result } = renderRelated({ ...ownLibrarySkill, library_skill_id: null })
    await waitFor(() => expect(result.current.totalTrackersCount).toBe(0))
    expect(result.current.availableCourses).toBeNull()
    expect(catalogue.listCalls).toBe(0)
  })
})
