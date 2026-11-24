import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
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
vi.mock('../lib/skillDiscovery', async (importOriginal) => ({
  ...(await importOriginal()),
  listSkillMatches: vi.fn(),
  sendConnectionRequest: vi.fn().mockResolvedValue(),
}))
vi.mock('../lib/coaching', async (importOriginal) => ({
  ...(await importOriginal()),
  requestCoaching: vi.fn().mockResolvedValue('new-id'),
  listCoachRatings: vi.fn().mockResolvedValue([]),
  listCoachReviews: vi.fn().mockResolvedValue([
    { id: 'v1', rating: 5, comment: 'Brilliant coach', reviewer_name: 'Rae Learner', reviewer_avatar_url: null, updated_at: '2026-11-20T10:00:00Z' },
  ]),
}))

const { listSkillMatches } = await import('../lib/skillDiscovery')
const { listCoachRatings, requestCoaching } = await import('../lib/coaching')
const { default: PeopleWithSkillModal } = await import('./PeopleWithSkillModal')

const person = (fields) => ({
  user_id: 'u', full_name: 'Someone', avatar_url: null, level: 3, is_connection: false, profile_viewable: false,
  has_pending_request: false, is_coach: false, coach_skill_id: null, my_coaching_status: null, ...fields,
})

function open(props = {}) {
  return render(
    <MemoryRouter>
      <PeopleWithSkillModal librarySkillId="lib-1" skillName="Public speaking" skillId="mine" onClose={vi.fn()} {...props} />
    </MemoryRouter>,
  )
}

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe('PeopleWithSkillModal coaches', () => {
  it('marks coaches and can show only them', async () => {
    listSkillMatches.mockResolvedValue([
      person({ user_id: 'c', full_name: 'Coral', is_coach: true, coach_skill_id: 'theirs', level: 5 }),
      person({ user_id: 'e', full_name: 'Eli' }),
    ])
    open()
    expect(await screen.findByText('Coral')).toBeInTheDocument()
    expect(screen.getByText('Eli')).toBeInTheDocument()
    expect(screen.getByText('Coach')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Coaches only' }))
    expect(screen.queryByText('Eli')).not.toBeInTheDocument()
    expect(screen.getByText('Coral')).toBeInTheDocument()
    // Asking needs the skill to be the learner's own.
    expect(screen.queryByRole('button', { name: 'Ask to coach you' })).not.toBeInTheDocument()
  })

  it('opened from Find a coach, says when no one offers coaching', async () => {
    listSkillMatches.mockResolvedValue([person({ user_id: 'e', full_name: 'Eli' })])
    open({ coachesOnly: true })
    expect(await screen.findByText('No one is offering coaching on this skill yet.')).toBeInTheDocument()
  })

  it('asks a coach to coach the learner in their own skill, with a message', async () => {
    listSkillMatches.mockResolvedValue([
      person({ user_id: 'c', full_name: 'Coral', is_coach: true, coach_skill_id: 'theirs' }),
      person({ user_id: 'd', full_name: 'Dana', is_coach: true, coach_skill_id: 'dana-skill', my_coaching_status: 'active' }),
    ])
    const onCoachingChange = vi.fn()
    open({ canAskForCoaching: true, onCoachingChange })
    expect(await screen.findByText('Your coach')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Ask to coach you' }))
    fireEvent.change(screen.getByPlaceholderText('What would you like Coral to help you with? (optional)'), { target: { value: 'My first talk' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
    await waitFor(() => expect(requestCoaching).toHaveBeenCalledWith('mine', 'theirs', 'My first talk'))
    expect(await screen.findByText('Coaching requested')).toBeInTheDocument()
    expect(onCoachingChange).toHaveBeenCalled()
  })

  it('shows the stars of each coach and opens their named reviews', async () => {
    listSkillMatches.mockResolvedValue([person({ user_id: 'c', full_name: 'Coral', is_coach: true, coach_skill_id: 'theirs' })])
    listCoachRatings.mockResolvedValue([{ coach_id: 'c', average_rating: 4.5, review_count: 2 }])
    open()
    expect(await screen.findByText('4.5 · 2 reviews')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Read reviews' }))
    expect(await screen.findByText('Brilliant coach')).toBeInTheDocument()
    expect(screen.getByText('Rae Learner')).toBeInTheDocument()
  })

  it('marks a coach approved by LearnScope as such', async () => {
    listSkillMatches.mockResolvedValue([person({ user_id: 'c', full_name: 'Coral', is_coach: true, coach_skill_id: 'theirs', coach_approved: true })])
    open()
    expect(await screen.findByText('Approved by LearnScope')).toBeInTheDocument()
  })
})
