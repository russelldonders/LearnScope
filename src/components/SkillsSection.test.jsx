import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SkillsSection from './SkillsSection'

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
