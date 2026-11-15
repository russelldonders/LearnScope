import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SkillsSection from './SkillsSection'
import { listTargetsSetByOthers } from '../lib/managerSkillActions'

let inserted = []

function makeSupabaseMock(resultsByTable = {}) {
  return {
    from: vi.fn((table) => {
      const result = resultsByTable[table] ?? { data: [], error: null }
      const builder = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        in: vi.fn(() => builder),
        is: vi.fn(() => builder),
        order: vi.fn(() => builder),
        limit: vi.fn(() => builder),
        maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
        single: vi.fn(() => Promise.resolve({ data: { id: 'new-skill', name: 'Coaching' }, error: null })),
        insert: vi.fn((row) => {
          inserted.push({ table, row })
          return builder
        }),
        then: (resolve) => Promise.resolve(result).then(resolve),
      }
      return builder
    }),
  }
}

// SQL has a target (4) above its level (none yet), so it's a skill gap.
function defaultSupabaseMock() {
  return makeSupabaseMock({
    skills: { data: [{ id: 'skill-1', name: 'SQL', lifecycle_stage: 'developing', library_skill_id: null, level: null }], error: null },
    skill_targets: { data: [{ skill_id: 'skill-1', target_level: 4, created_at: '2027-01-01' }], error: null },
  })
}

let supabaseMock = defaultSupabaseMock()

vi.mock('../lib/supabaseClient', () => ({ supabase: { from: (...args) => supabaseMock.from(...args) } }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../context/LanguageContext', () => ({ useLanguage: () => ({ t: (key) => key }) }))
vi.mock('../lib/managerSkillActions', async (importOriginal) => ({
  ...(await importOriginal()),
  listTargetsSetByOthers: vi.fn().mockResolvedValue([]),
  listLatestManagerRatings: vi.fn().mockResolvedValue(new Map()),
}))
beforeEach(() => {
  supabaseMock = defaultSupabaseMock()
  inserted = []
})

afterEach(cleanup)

function renderSection() {
  return render(<MemoryRouter><SkillsSection /></MemoryRouter>)
}

describe('SkillsSection views', () => {
  it('has no separate targets panel: skills below their target are found under the skill gaps view', async () => {
    renderSection()

    expect((await screen.findAllByText('SQL')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('heading', { name: 'skills.skillTargets' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'skills.setNewTarget' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'skills.views.developing' }))
    expect(screen.getAllByText('SQL').length).toBeGreaterThan(0)
  })
})

describe('skills set for you by someone else', () => {
  function withEmployerTarget() {
    vi.mocked(listTargetsSetByOthers).mockResolvedValueOnce([
      { libraryId: 'lib-coaching', skillId: null, level: 4, contextType: 'organisation', contextKey: 'organisation:acme', contextName: 'Acme' },
    ])
    supabaseMock = makeSupabaseMock({
      skills: { data: [{ id: 'skill-1', name: 'SQL', lifecycle_stage: 'developing', library_skill_id: null, level: null }], error: null },
      skill_library: { data: [{ id: 'lib-coaching', name: 'Coaching' }], error: null },
    })
  }

  it('lists a skill an employer set a target on that you do not track, under All and Skill gaps', async () => {
    withEmployerTarget()
    renderSection()

    expect(await screen.findByRole('heading', { name: 'Coaching' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'skills.setForYou.add' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'skills.views.developing' }))
    expect(screen.getByRole('heading', { name: 'Coaching' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'skills.views.current' }))
    expect(screen.queryByRole('heading', { name: 'Coaching' })).not.toBeInTheDocument()
  })

  it('adds it to your skills, linked to the same library skill, only when you choose to', async () => {
    withEmployerTarget()
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: 'skills.setForYou.add' }))
    await waitFor(() => expect(inserted).toHaveLength(1))
    expect(inserted[0]).toEqual({
      table: 'skills',
      row: expect.objectContaining({ name: 'Coaching', library_skill_id: 'lib-coaching', user_id: 'user-1' }),
    })
  })
})
