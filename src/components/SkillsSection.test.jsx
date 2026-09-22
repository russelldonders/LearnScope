import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SkillsSection from './SkillsSection'
import { listMySkillDevelopmentTargets } from '../lib/skillDevelopmentTargets'

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

let supabaseMock = makeSupabaseMock()

vi.mock('../lib/supabaseClient', () => ({ supabase: { from: (...args) => supabaseMock.from(...args) } }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../context/LanguageContext', () => ({ useLanguage: () => ({ t: (key) => key }) }))
vi.mock('../lib/employerSkillTargets', () => ({
  getEmployerTargetsForUser: vi.fn().mockResolvedValue(new Map()),
  getLatestEmployerSkillConfirmations: vi.fn().mockResolvedValue(new Map()),
}))
vi.mock('../lib/skillDevelopmentTargets', () => ({
  listMySkillDevelopmentTargets: vi.fn().mockResolvedValue({
    personal: [{
      id: 'personal-1', ownership: 'personal', skillId: 'skill-1', skillName: 'SQL',
      targetLevel: 4, targetDate: '2027-01-01', notes: 'Query confidently',
    }],
    employer: [{
      id: 'employer-1', ownership: 'employer', employerName: 'Acme', skillName: 'Coaching',
      targetLevel: 5, targetDate: '2027-02-01', notes: 'Lead the programme', status: 'active',
    }],
  }),
}))
vi.mock('./SetSkillTargetFlow', () => ({
  default: ({ onClose }) => <div role="dialog" aria-label="set-target-flow"><button onClick={onClose}>close-flow</button></div>,
}))

beforeEach(() => {
  supabaseMock = makeSupabaseMock()
})

afterEach(cleanup)

function renderSection() {
  return render(<MemoryRouter><SkillsSection /></MemoryRouter>)
}

describe('SkillsSection development targets', () => {
  it('shows the skill development targets section, separating personal and employer targets', async () => {
    renderSection()

    expect(await screen.findByRole('heading', { name: 'skills.skillTargets' })).toBeInTheDocument()
    expect(screen.getByText('SQL')).toBeInTheDocument()
    expect(screen.getByText('skills.personalTarget')).toBeInTheDocument()
    expect(screen.getByText('Coaching')).toBeInTheDocument()
    expect(screen.getByText('Acme')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /SQL/ })).toHaveAttribute('href', '/skills/skill-1')
  })

  it('does not present a failed target load as an empty target list', async () => {
    vi.mocked(listMySkillDevelopmentTargets).mockRejectedValueOnce(new Error('Unavailable'))
    renderSection()

    expect(await screen.findByRole('alert')).toHaveTextContent('skills.skillTargetsLoadError')
    expect(screen.queryByText('skills.skillTargetsEmpty')).not.toBeInTheDocument()
  })

  it('opens the set-new-target flow from the "Set new target" button', async () => {
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: 'skills.setNewTarget' }))
    expect(await screen.findByRole('dialog', { name: 'set-target-flow' })).toBeInTheDocument()
  })
})
