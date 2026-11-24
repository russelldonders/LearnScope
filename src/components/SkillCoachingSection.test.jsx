import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
vi.mock('../context/LanguageContext', async () => {
  const { english } = await import('../lib/i18n/translations')
  const t = (key, params) => {
    const value = key.split('.').reduce((v, part) => v?.[part], english) ?? key
    return params ? value.replace(/\{(\w+)\}/g, (m, name) => (name in params ? params[name] : m)) : value
  }
  return { useLanguage: () => ({ language: 'en-GB', setLanguage: vi.fn(), t }) }
})
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me', email: 'me@example.com' } }) }))
vi.mock('../lib/coaching', async (importOriginal) => ({
  ...(await importOriginal()),
  listMyCoaching: vi.fn(),
  listMyCoachingSessions: vi.fn(),
  listMyCoachReviews: vi.fn().mockResolvedValue([]),
  listCoachReviews: vi.fn().mockResolvedValue([]),
  countSkillCoaches: vi.fn(),
  listMyCoachInterests: vi.fn(),
  registerCoachInterest: vi.fn().mockResolvedValue(),
  withdrawCoachInterest: vi.fn().mockResolvedValue(),
  respondToCoachingRequest: vi.fn().mockResolvedValue(),
  withdrawCoachingRequest: vi.fn().mockResolvedValue(),
  endCoaching: vi.fn().mockResolvedValue(),
}))

const coaching = await import('../lib/coaching')
const { default: SkillCoachingSection } = await import('./SkillCoachingSection')

const skill = { id: 'mine', library_skill_id: 'lib-1', offer_coaching: false }
const row = (fields) => ({
  id: 'r1', other_name: 'Coral', other_avatar_url: null, skill_name: 'Public speaking',
  learner_skill_id: 'mine', coach_skill_id: 'theirs', requested_at: '2026-11-20T10:00:00Z',
  responded_at: null, started_at: null, ended_at: null, message: null, ...fields,
})

function setUp({ rows = [], coaches = 0, interests = [], sessions = [] } = {}) {
  coaching.listMyCoachingSessions.mockResolvedValue(sessions)
  coaching.listMyCoaching.mockResolvedValue(rows)
  coaching.countSkillCoaches.mockResolvedValue(coaches)
  coaching.listMyCoachInterests.mockResolvedValue(interests)
}

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe('SkillCoachingSection', () => {
  it('lets a learner say they are looking for a coach when no one offers coaching', async () => {
    setUp()
    render(<SkillCoachingSection skill={skill} userId="me" onFindCoach={vi.fn()} />)
    expect(await screen.findByText('No one is offering coaching on this skill yet.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Find a coach' })).not.toBeInTheDocument()

    setUp({ interests: [{ id: 'i1', skill_id: 'mine', coach_available_at: null }] })
    fireEvent.click(screen.getByRole('button', { name: "I'm looking for a coach" }))
    await waitFor(() => expect(coaching.registerCoachInterest).toHaveBeenCalledWith('me', 'mine'))
    expect(await screen.findByText(/You're looking for a coach/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Stop looking' }))
    await waitFor(() => expect(coaching.withdrawCoachInterest).toHaveBeenCalledWith('mine'))
  })

  it('offers Find a coach when there are coaches', async () => {
    setUp({ coaches: 2 })
    const onFindCoach = vi.fn()
    render(<SkillCoachingSection skill={skill} userId="me" onFindCoach={onFindCoach} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Find a coach' }))
    expect(onFindCoach).toHaveBeenCalled()
    expect(screen.queryByText('No one is offering coaching on this skill yet.')).not.toBeInTheDocument()
  })

  it('shows the learner their coach, ends it only after confirming, and keeps earlier coaching as history', async () => {
    setUp({
      coaches: 1,
      rows: [
        row({ role: 'learner', status: 'active', started_at: '2026-11-21T10:00:00Z' }),
        row({ id: 'r0', role: 'learner', status: 'declined', other_name: 'Dev', responded_at: '2026-10-01T10:00:00Z' }),
        row({ id: 'elsewhere', role: 'learner', status: 'active', learner_skill_id: 'another-skill', other_name: 'Elsewhere' }),
      ],
    })
    render(<SkillCoachingSection skill={skill} userId="me" onFindCoach={vi.fn()} />)
    expect(await screen.findByText('Your coach')).toBeInTheDocument()
    expect(screen.getByText('Coral')).toBeInTheDocument()
    expect(screen.getByText(/Couldn't coach you/)).toBeInTheDocument()
    expect(screen.queryByText('Elsewhere')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'End coaching' }))
    expect(coaching.endCoaching).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('End coaching with Coral? It stays in your history.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'End coaching' }))
    await waitFor(() => expect(coaching.endCoaching).toHaveBeenCalledWith('r1'))
  })

  it('lets a coach accept or decline people who asked, with their message', async () => {
    setUp({
      coaches: 0,
      rows: [row({ role: 'coach', status: 'requested', coach_skill_id: 'mine', learner_skill_id: 'theirs', other_name: 'Lee', message: 'Help with my talk' })],
    })
    render(<SkillCoachingSection skill={{ ...skill, offer_coaching: true }} userId="me" onFindCoach={vi.fn()} />)
    expect(await screen.findByText('People you coach')).toBeInTheDocument()
    expect(screen.getByText('“Help with my talk”')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(coaching.respondToCoachingRequest).toHaveBeenCalledWith('r1', true))
  })
})

describe('SkillCoachingSection sessions', () => {
  it('shows the sessions of each active coaching, under the person', async () => {
    setUp({
      coaches: 1,
      rows: [row({ role: 'learner', status: 'active', started_at: '2026-11-21T10:00:00Z' })],
      sessions: [
        { id: 's1', relationship_id: 'r1', status: 'proposed', proposed_by_me: false, starts_at: '2099-01-05T10:00:00Z', duration_minutes: 45, location: null, agenda: null },
        { id: 's0', relationship_id: 'other', status: 'proposed', proposed_by_me: false, starts_at: '2099-01-06T10:00:00Z', duration_minutes: 30, location: null, agenda: null },
      ],
    })
    render(<SkillCoachingSection skill={skill} userId="me" onFindCoach={vi.fn()} />)
    expect(await screen.findByText('Coral proposed this time')).toBeInTheDocument()
    expect(screen.getAllByText(/45 min/)).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Plan a session' })).toBeInTheDocument()
  })
})
