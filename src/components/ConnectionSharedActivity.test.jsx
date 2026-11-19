import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const shared = vi.hoisted(() => ({
  listSharedActivities: vi.fn(),
  saveSharedCard: vi.fn(),
  addSharedActivity: vi.fn(),
  dismissSharedActivity: vi.fn(),
}))
const draft = vi.hoisted(() => ({ draftActivitiesFromText: vi.fn() }))
const refreshPendingActionCount = vi.hoisted(() => vi.fn())

vi.mock('../lib/sharedActivities', async (importOriginal) => ({ ...(await importOriginal()), ...shared }))
vi.mock('../lib/quickActivityLog', () => draft)
vi.mock('../lib/supabaseClient', () => {
  const result = (data) => {
    const chain = {
      select: () => chain, eq: () => chain, order: () => Promise.resolve({ data }), single: () => Promise.resolve({ data: { full_name: 'Ana' } }),
    }
    return chain
  }
  return { supabase: { from: (table) => result(table === 'skills' ? [{ id: 'my-sql', name: 'SQL', library_skill_id: 'lib-sql' }] : null) } }
})
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me', email: 'ana@example.com' } }) }))
vi.mock('../context/PendingActionsContext', () => ({ usePendingActions: () => ({ refreshPendingActionCount }) }))
vi.mock('../context/LanguageContext', () => import('../test/languageMock'))
vi.mock('./VoiceInputButton', () => ({ default: () => null }))

const { default: ConnectionSharedActivity } = await import('./ConnectionSharedActivity')

const theirSkills = [{ id: 'their-speaking', name: 'Public speaking', library_skill_id: 'lib-speaking' }]

beforeEach(() => {
  shared.listSharedActivities.mockResolvedValue([])
  shared.saveSharedCard.mockResolvedValue({ id: 'new' })
  shared.addSharedActivity.mockResolvedValue('copy')
  shared.dismissSharedActivity.mockResolvedValue()
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderSection() {
  return render(<ConnectionSharedActivity connection={{ id: 'ben', name: 'Ben' }} theirSkills={theirSkills} />)
}

describe('ConnectionSharedActivity', () => {
  it('reads what you wrote into cards locked to the connection, and saves them tagged with them', async () => {
    draft.draftActivitiesFromText.mockResolvedValue({
      outcome: 'activities',
      activities: [{ title: 'Board talk', date: '2026-11-18', duration_minutes: null, verb: 'experienced', skills: [], their_skills: [0], note: null, done_by: 'them' }],
    })
    renderSection()
    fireEvent.change(screen.getByRole('textbox', { name: 'Log something with Ben' }), { target: { value: 'Ben gave a great board talk' } })
    fireEvent.click(screen.getByRole('button', { name: 'Log it' }))

    const card = await screen.findByRole('article', { name: 'Board talk' })
    expect(draft.draftActivitiesFromText).toHaveBeenCalledWith(expect.objectContaining({
      connection: { name: 'Ben', skills: theirSkills },
    }))
    expect(within(card).getByRole('radio', { name: 'Ben did it — I saw' })).toBeChecked()
    expect(within(card).getByText('Public speaking')).toBeInTheDocument()
    // It can be switched to something done together.
    fireEvent.click(within(card).getByRole('radio', { name: 'We did it together' }))
    expect(within(card).getByText('Your skills')).toBeInTheDocument()
    fireEvent.click(within(card).getByRole('radio', { name: 'Ben did it — I saw' }))

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(shared.saveSharedCard).toHaveBeenCalledTimes(1))
    expect(shared.saveSharedCard.mock.calls[0][0]).toMatchObject({ kind: 'observed', title: 'Board talk' })
    expect(shared.saveSharedCard.mock.calls[0][1]).toMatchObject({ userId: 'me', connection: { id: 'ben', name: 'Ben' } })
    expect(await screen.findByText('Saved. Ben can add it to their own record too.')).toBeInTheDocument()
  })

  it('lets you add what they logged with you to your own record, or dismiss it', async () => {
    shared.listSharedActivities.mockResolvedValue([
      { id: 'r1', logged_by: 'ben', kind: 'joint', status: 'suggested', happened_at: '2026-11-18T09:00:00Z', title: 'Paired on SQL', note: null, duration: 'PT1H', level: null, skills: [{ libraryId: 'lib-sql', name: 'SQL' }] },
      { id: 'r2', logged_by: 'ben', kind: 'observed', status: 'suggested', happened_at: '2026-11-17T09:00:00Z', title: 'Workshop', note: null, duration: null, level: null, skills: [] },
      { id: 'r3', logged_by: 'me', kind: 'rated', status: null, happened_at: '2026-11-16T09:00:00Z', title: 'Ben’s Public speaking', note: null, duration: null, level: 4, skills: [{ libraryId: 'lib-speaking', name: 'Public speaking' }] },
      { id: 'r4', logged_by: 'me', kind: 'observed', status: 'suggested', happened_at: '2026-11-15T09:00:00Z', title: 'Board talk', note: null, duration: null, level: null, skills: [] },
    ])
    renderSection()
    const list = await screen.findByRole('region', { name: 'Between you' })
    expect(within(list).getByText(/Ben and you/)).toBeInTheDocument()
    expect(within(list).getByText(/Ben saw you/)).toBeInTheDocument()
    expect(within(list).getByText('Public speaking')).toBeInTheDocument()
    expect(within(list).getByText(/Skilled/)).toBeInTheDocument()
    expect(within(list).getByText('Waiting for Ben to add it')).toBeInTheDocument()
    await waitFor(() => expect(within(list).getByText('Counts towards your SQL')).toBeInTheDocument())

    const [addFirst] = within(list).getAllByRole('button', { name: 'Add to my record' })
    fireEvent.click(addFirst)
    await waitFor(() => expect(shared.addSharedActivity).toHaveBeenCalledTimes(1))
    expect(shared.addSharedActivity.mock.calls[0][0].id).toBe('r1')
    expect(shared.addSharedActivity.mock.calls[0][1]).toMatchObject({ loggedByName: 'Ben' })
    await waitFor(() => expect(refreshPendingActionCount).toHaveBeenCalled())

    fireEvent.click(within(list).getAllByRole('button', { name: 'Dismiss' })[1])
    await waitFor(() => expect(shared.dismissSharedActivity).toHaveBeenCalledWith(expect.objectContaining({ id: 'r2' })))
  })
})
