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
        gte: vi.fn(() => builder),
        range: vi.fn(() => builder),
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
vi.mock('../lib/skillGoals', () => ({ listActiveGoalsForAttention: vi.fn().mockResolvedValue([]) }))
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

describe('sections at the top of the list', () => {
  it('shows skills with something due first, then recent activity, then the rest', async () => {
    const recent = new Date(Date.now() - 2 * 86400000).toISOString()
    supabaseMock = makeSupabaseMock({
      skills: {
        data: [
          { id: 'quiet', name: 'Quiet skill', lifecycle_stage: 'developing', library_skill_id: null, level: 2, date_added: new Date().toISOString() },
          { id: 'active', name: 'Active skill', lifecycle_stage: 'developing', library_skill_id: null, level: 2, date_added: '2026-01-02' },
          { id: 'due', name: 'Due skill', lifecycle_stage: 'developing', library_skill_id: null, level: 2, next_checkin_date: '2020-01-01', date_added: '2026-01-01' },
        ],
        error: null,
      },
      xapi_statements: { data: [{ id: 'st-1', skill_id: 'active', recorded_at: recent }], error: null },
    })
    renderSection()

    const dueHeading = await screen.findByRole('heading', { name: 'skills.sections.due.heading' })
    const recentHeading = await screen.findByRole('heading', { name: 'skills.sections.recent.heading' })
    const othersHeading = screen.getByRole('heading', { name: 'skills.sections.others' })
    const dueSection = dueHeading.closest('section')
    const recentSection = recentHeading.closest('section')
    expect(dueSection).toHaveTextContent('Due skill')
    expect(dueSection).toHaveTextContent('skills.sections.reasons.checkinOverdue')
    expect(dueSection).not.toHaveTextContent('Active skill')
    expect(recentSection).toHaveTextContent('Active skill')
    expect(recentSection).toHaveTextContent('skills.sections.lastActivity.daysAgo')
    expect(recentSection).not.toHaveTextContent('Quiet skill')
    // Sections come in that order, each skill once.
    expect(dueHeading.compareDocumentPosition(recentHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(recentHeading.compareDocumentPosition(othersHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getAllByText('Quiet skill')).toHaveLength(1)
  })

  it('shows one list under another sort', async () => {
    supabaseMock = makeSupabaseMock({
      skills: { data: [{ id: 'due', name: 'Due skill', lifecycle_stage: 'developing', library_skill_id: null, level: 2, next_checkin_date: '2020-01-01' }], error: null },
    })
    renderSection()
    await screen.findByRole('heading', { name: 'skills.sections.due.heading' })

    fireEvent.click(screen.getByRole('button', { name: 'skills.filters' }))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'name' } })
    expect(screen.queryByRole('heading', { name: 'skills.sections.due.heading' })).not.toBeInTheDocument()
    expect(screen.getAllByText('Due skill').length).toBeGreaterThan(0)
  })
})

describe('a long top section', () => {
  it('shows the first four, with the rest behind Show all', async () => {
    const recent = new Date(Date.now() - 86400000).toISOString()
    const ids = ['a', 'b', 'c', 'd', 'e']
    supabaseMock = makeSupabaseMock({
      skills: { data: ids.map((id) => ({ id, name: `Skill ${id}`, lifecycle_stage: 'developing', library_skill_id: null, level: 2 })), error: null },
      xapi_statements: { data: ids.map((id) => ({ id: `st-${id}`, skill_id: id, recorded_at: recent })), error: null },
    })
    renderSection()

    const section = (await screen.findByRole('heading', { name: 'skills.sections.recent.heading' })).closest('section')
    expect(section.querySelectorAll('li')).toHaveLength(4)
    const toggle = screen.getByRole('button', { name: 'skills.sections.showAll' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(section.querySelectorAll('li')).toHaveLength(5)
    expect(screen.getByRole('button', { name: 'skills.sections.showFewer' })).toHaveAttribute('aria-expanded', 'true')
  })
})

describe('neglected skills and last activity on each card', () => {
  it('lists skills with no activity for two months as neglected, saying so inside the card', async () => {
    const longAgo = new Date(Date.now() - 120 * 86400000).toISOString()
    const lastWeek = new Date(Date.now() - 20 * 86400000).toISOString()
    supabaseMock = makeSupabaseMock({
      skills: {
        data: [
          { id: 'old', name: 'Old skill', lifecycle_stage: 'developing', library_skill_id: null, level: 2, date_added: '2025-01-01' },
          { id: 'never', name: 'Never used', lifecycle_stage: 'developing', library_skill_id: null, level: 2, date_added: '2025-06-01' },
          { id: 'fresh', name: 'Fresh skill', lifecycle_stage: 'developing', library_skill_id: null, level: 2, date_added: new Date().toISOString() },
          { id: 'middling', name: 'Middling skill', lifecycle_stage: 'developing', library_skill_id: null, level: 2, date_added: '2025-01-01' },
        ],
        error: null,
      },
      xapi_statements: { data: [{ skill_id: 'old', recorded_at: longAgo }, { skill_id: 'middling', recorded_at: lastWeek }], error: null },
    })
    renderSection()

    const neglected = (await screen.findByRole('heading', { name: 'skills.sections.neglected.heading' })).closest('section')
    expect(neglected).toHaveTextContent('Old skill')
    expect(neglected).toHaveTextContent('Never used')
    expect(neglected).not.toHaveTextContent('Fresh skill')
    expect(neglected).not.toHaveTextContent('Middling skill')
    // The last activity sits inside the card itself, which is its button.
    expect(screen.getByRole('button', { name: /Old skill.*skills\.sections\.lastActivity\.monthsAgo/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Never used.*skills\.sections\.lastActivity\.none/ })).toBeInTheDocument()
    // Cards in the rest of the list show their last activity too.
    expect(screen.getByRole('button', { name: /Middling skill.*skills\.sections\.lastActivity\.weeksAgo/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Fresh skill/ })).not.toHaveTextContent('skills.sections.lastActivity')
  })
})