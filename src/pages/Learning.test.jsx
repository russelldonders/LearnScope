import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Learning from './Learning'
import { listMySkillDevelopmentTargets } from '../lib/skillDevelopmentTargets'

const { order, eq, select, from } = vi.hoisted(() => {
  const orderMock = vi.fn()
  const eqMock = vi.fn(() => ({ order: orderMock }))
  const selectMock = vi.fn(() => ({ eq: eqMock }))
  const fromMock = vi.fn(() => ({ select: selectMock }))
  return { order: orderMock, eq: eqMock, select: selectMock, from: fromMock }
})

vi.mock('../lib/supabaseClient', () => ({ supabase: { from } }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../context/LanguageContext', () => ({
  useLanguage: () => ({
    t: (key) => ({
      'learning.skillTargets': 'Skill development targets',
      'learning.skillTargetsIntro': 'Targets stay attached to skills. Personal targets are yours; employer targets remain within that employment context.',
      'learning.chooseSkill': 'Choose a skill',
      'learning.skillTargetsLoadError': 'Your skill targets could not be loaded. Please try again.',
      'learning.skillTargetsEmpty': 'No active skill targets yet.',
      'learning.personalTarget': 'Personal target',
      'learning.targetLevelPrefix': 'Level',
      'learning.targetDatePrefix': 'by',
    })[key] ?? key,
  }),
}))
vi.mock('../components/AppHeader', () => ({ default: () => <header>LearnScope navigation</header> }))
vi.mock('../lib/courseContent', () => ({ listCourseProgressByCatalogueId: vi.fn().mockResolvedValue({}) }))
vi.mock('../lib/courseCatalogue', () => ({ listMyAssignedCourseEmployers: vi.fn().mockResolvedValue(new Map()) }))
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

beforeEach(() => {
  order.mockReset().mockResolvedValue({ data: [], error: null })
  from.mockClear()
  select.mockClear()
  eq.mockClear()
})

afterEach(cleanup)

describe('Learning', () => {
  it('separates learner-owned and employer-owned skill targets', async () => {
    render(<MemoryRouter><Learning /></MemoryRouter>)

    expect(await screen.findByRole('heading', { name: 'Skill development targets' })).toBeInTheDocument()
    expect(screen.getByText('SQL')).toBeInTheDocument()
    expect(screen.getByText('Personal target')).toBeInTheDocument()
    expect(screen.getByText('Coaching')).toBeInTheDocument()
    expect(screen.getByText('Acme')).toBeInTheDocument()
    expect(screen.getByText(/Personal targets are yours/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /SQL/ })).toHaveAttribute('href', '/skills/skill-1')
  })

  it('does not present a failed target load as an empty target list', async () => {
    vi.mocked(listMySkillDevelopmentTargets).mockRejectedValueOnce(new Error('Unavailable'))
    render(<MemoryRouter><Learning /></MemoryRouter>)

    expect(await screen.findByRole('alert')).toHaveTextContent(/skill targets could not be loaded/i)
    expect(screen.queryByText(/No active skill targets yet/i)).not.toBeInTheDocument()
  })
})
