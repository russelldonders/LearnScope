import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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

// A personal target only shows up in the merged targets section once the
// skill it's for is in the loaded skills list (see targetRows in
// SkillsSection.jsx) -- so the 'skills'/'skill_targets' tables need a
// matching row for skill-1 here, unlike the employer-side 'Coaching' target
// below, which is deliberately left unmatched to exercise the "employer
// target on a skill not yet tracked" branch.
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
  supabaseMock = defaultSupabaseMock()
})

afterEach(cleanup)

function renderSection() {
  return render(<MemoryRouter><SkillsSection /></MemoryRouter>)
}

describe('SkillsSection development targets', () => {
  it('shows one merged targets section covering both a tracked and an untracked skill, with no separate "skills to develop" section', async () => {
    renderSection()

    const heading = await screen.findByRole('heading', { name: 'skills.skillTargets' })
    const targetsSection = heading.closest('section')
    expect(within(targetsSection).getByText('SQL')).toBeInTheDocument()
    expect(within(targetsSection).getByText('skills.personalTarget')).toBeInTheDocument()
    expect(within(targetsSection).getByText('Coaching')).toBeInTheDocument()
    expect(within(targetsSection).getByText('Acme')).toBeInTheDocument()
    expect(within(targetsSection).getByRole('link', { name: /SQL/ })).toHaveAttribute('href', '/skills/skill-1')
    // Coaching has no matching tracked skill (no library_skill_id match), so
    // it renders as a plain row with no link to a skill page.
    expect(within(targetsSection).queryByRole('link', { name: /Coaching/ })).not.toBeInTheDocument()

    // The old separate "Skills to develop" section is gone -- its content is
    // now part of this one section instead (sorted not-yet-met first).
    expect(screen.queryByText('skills.toDevelop.title')).not.toBeInTheDocument()
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
