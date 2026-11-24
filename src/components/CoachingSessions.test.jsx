import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me', email: 'me@example.com' } }) }))
vi.mock('../context/LanguageContext', async () => {
  const { english } = await import('../lib/i18n/translations')
  const t = (key, params) => {
    const value = key.split('.').reduce((v, part) => v?.[part], english) ?? key
    return typeof value === 'string' && params ? value.replace(/\{(\w+)\}/g, (m, name) => (name in params ? params[name] : m)) : value
  }
  return { useLanguage: () => ({ language: 'en-GB', setLanguage: vi.fn(), t }) }
})
vi.mock('./ActivityReflection', () => ({ default: ({ rows }) => <p>Reflect on {rows[0].id}</p> }))
vi.mock('../lib/coaching', async (importOriginal) => ({
  ...(await importOriginal()),
  proposeCoachingSession: vi.fn().mockResolvedValue('new'),
  respondToCoachingSession: vi.fn().mockResolvedValue(),
  rescheduleCoachingSession: vi.fn().mockResolvedValue('moved'),
  cancelCoachingSession: vi.fn().mockResolvedValue(),
  completeCoachingSession: vi.fn().mockResolvedValue({ id: 'activity-1' }),
  myDisplayName: vi.fn().mockResolvedValue('Me Learner'),
}))

const coaching = await import('../lib/coaching')
const { default: CoachingSessions } = await import('./CoachingSessions')

const NOW = new Date('2026-11-24T12:00:00Z').getTime()
const relationship = (fields = {}) => ({
  id: 'r1', role: 'learner', status: 'active', other_name: 'Coral', other_user_id: 'coach',
  learner_skill_id: 'mine', library_skill_id: 'lib', skill_name: 'Public speaking', ...fields,
})
const session = (fields) => ({
  id: 's1', relationship_id: 'r1', status: 'proposed', proposed_by_me: false, starts_at: '2026-11-30T10:00:00Z',
  duration_minutes: 60, location: 'https://meet.example.com/abc', agenda: 'My workshop', ...fields,
})

function show(rel, sessions, onChange = vi.fn().mockResolvedValue()) {
  render(<CoachingSessions relationship={rel} sessions={sessions} onChange={onChange} now={NOW} />)
  return onChange
}

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe('CoachingSessions', () => {
  it('answers a time the other person proposed, with where and what for', async () => {
    const onChange = show(relationship(), [session()])
    expect(screen.getByText('Coral proposed this time')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'https://meet.example.com/abc' })).toHaveAttribute('target', '_blank')
    expect(screen.getByText('My workshop')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(coaching.respondToCoachingSession).toHaveBeenCalledWith('s1', true))
    expect(onChange).toHaveBeenCalled()
  })

  it('waits for the other person on a time you proposed, and can suggest another', async () => {
    show(relationship(), [session({ proposed_by_me: true })])
    expect(screen.getByText('Waiting for Coral to confirm')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Suggest another time' }))
    fireEvent.change(screen.getByLabelText('Date and time'), { target: { value: '2026-12-01T15:30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Suggest this time' }))
    await waitFor(() => expect(coaching.rescheduleCoachingSession).toHaveBeenCalledWith('s1', expect.objectContaining({
      startsAt: new Date('2026-12-01T15:30').toISOString(),
      durationMinutes: 60,
    })))
  })

  it('plans a new session', async () => {
    show(relationship(), [])
    expect(screen.getByText('No sessions planned yet.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Plan a session' }))
    fireEvent.change(screen.getByLabelText('Date and time'), { target: { value: '2026-12-02T09:00' } })
    fireEvent.change(screen.getByLabelText('Length'), { target: { value: '30' } })
    fireEvent.change(screen.getByLabelText('Where (a place or a video link)'), { target: { value: 'Café' } })
    fireEvent.click(screen.getByRole('button', { name: 'Propose session' }))
    await waitFor(() => expect(coaching.proposeCoachingSession).toHaveBeenCalledWith('r1', {
      startsAt: new Date('2026-12-02T09:00').toISOString(), durationMinutes: 30, location: 'Café', agenda: '',
    }))
  })

  it('lets the learner mark a session that happened as done, then reflect on it', async () => {
    show(relationship(), [session({ status: 'confirmed', starts_at: '2026-11-24T10:00:00Z' })])
    expect(screen.getByText('Did it happen?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Mark as done' }))
    fireEvent.change(screen.getByLabelText('Notes (optional)'), { target: { value: 'Great practice' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to my record' }))
    await waitFor(() => expect(coaching.completeCoachingSession).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'me',
      actor: { name: 'Me Learner', email: 'me@example.com' },
      title: 'Coaching session with Coral',
      note: 'Great practice',
    })))
    expect(await screen.findByText('Added to your record.')).toBeInTheDocument()
    expect(screen.getByText('Reflect on activity-1')).toBeInTheDocument()
  })

  it('leaves marking done to the learner when the coach is reading', () => {
    show(relationship({ role: 'coach', other_name: 'Lee' }), [session({ status: 'confirmed', starts_at: '2026-11-24T10:00:00Z' })])
    expect(screen.getByText('Waiting for Lee to mark it done')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark as done' })).not.toBeInTheDocument()
  })

  it('cancels only after confirming', async () => {
    show(relationship(), [session({ status: 'confirmed' })])
    fireEvent.click(screen.getByRole('button', { name: 'Cancel session' }))
    expect(coaching.cancelCoachingSession).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel session' }))
    await waitFor(() => expect(coaching.cancelCoachingSession).toHaveBeenCalledWith('s1'))
  })

  it('lists done sessions and plans nothing once coaching has ended', () => {
    show(relationship({ status: 'ended' }), [session({ status: 'done' })])
    expect(screen.getByText('Done')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Plan a session' })).not.toBeInTheDocument()
  })
})
