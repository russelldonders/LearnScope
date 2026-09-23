import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ManagerTeamPanel, { RateSkillDialog } from './ManagerTeamPanel'
import { FIXTURE_TEAM } from './managerFixtures'
import { LanguageProvider } from '../../context/LanguageContext'

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))

afterEach(cleanup)

describe('ManagerTeamPanel', () => {
  it('shows nothing shared yet for a member with no shared skills', () => {
    render(<ManagerTeamPanel members={[{ id: 'm1', name: 'Alex', teamSince: '2026-01-01', sharedSkills: [] }]} />)
    expect(screen.getByText('Nothing shared yet')).toBeInTheDocument()
  })

  it('summarises each member\'s shared skills as counts rather than per-skill chips', () => {
    const members = [{
      id: 'm1', name: 'Priya Nair', teamSince: '2026-04-12',
      sharedSkills: [
        { id: 'skill-1', name: 'Facilitation', level: 4, sharedAt: '2026-06-01', evidenceCount: 0 },
        {
          id: 'skill-2', name: 'Data storytelling', level: 2, sharedAt: '2026-07-01', evidenceCount: 0,
          managerRating: { level: 3, assessedAt: '2026-08-01' },
        },
      ],
    }]
    render(<ManagerTeamPanel members={members} onRateSkill={vi.fn()} />)
    expect(screen.getByRole('button', { name: '2 shared · 1 rated by you' })).toBeInTheDocument()
    expect(screen.queryByText('Facilitation')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Rate' })).not.toBeInTheDocument()
  })

  it('opens the member\'s skills profile from the shared-skills summary', () => {
    const members = [{
      id: 'm1', name: 'Priya Nair', teamSince: '2026-04-12',
      sharedSkills: [{ id: 'skill-1', name: 'Facilitation', level: 4, sharedAt: '2026-06-01', evidenceCount: 0 }],
    }]
    render(<LanguageProvider><ManagerTeamPanel members={members} /></LanguageProvider>)
    fireEvent.click(screen.getByRole('button', { name: '1 shared · 0 rated by you' }))
    expect(screen.getByRole('heading', { name: 'Priya Nair’s skills profile' })).toBeInTheDocument()
  })

  it('links a collaborative learning count through to the Collaboration tab', () => {
    const onOpenCollaboration = vi.fn()
    render(<ManagerTeamPanel members={[{ id: 'm1', name: 'Alex', sharedSkills: [], collaborativeLearningCount: 2 }]}
      onOpenCollaboration={onOpenCollaboration} />)
    fireEvent.click(screen.getByRole('button', { name: 'View 2 collaborative learning records' }))
    expect(onOpenCollaboration).toHaveBeenCalled()
  })

  it('offers an invite button in the empty state', () => {
    render(<ManagerTeamPanel members={[]} onInvite={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Invite to team' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('invites several connections and an email address in one go', async () => {
    const onInviteConnections = vi.fn().mockResolvedValue([{ id: 'alex', ok: true }, { id: 'sam', ok: true }])
    const onInvite = vi.fn().mockResolvedValue([{ email: 'c@example.com', ok: true }])
    render(<ManagerTeamPanel members={FIXTURE_TEAM}
      connections={[{ id: 'alex', name: 'Alex' }, { id: 'sam', name: 'Sam' }, { id: 'jo', name: 'Jo' }]}
      teamMemberships={[{ member_user_id: 'jo', status: 'pending' }]}
      onInviteConnections={onInviteConnections} onInvite={onInvite} />)
    fireEvent.click(screen.getByRole('button', { name: 'Invite to team' }))
    // Someone already invited is shown, ticked and disabled, rather than hidden.
    expect(screen.getByRole('checkbox', { name: /Jo/ })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Alex' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Sam' }))
    fireEvent.change(screen.getByLabelText('Email 1'), { target: { value: 'c@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send 3 invites' }))
    await waitFor(() => expect(onInviteConnections).toHaveBeenCalledWith(['alex', 'sam']))
    expect(onInvite).toHaveBeenCalledWith(['c@example.com'])
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('invites several people by email in one batch, closing once every address succeeds', async () => {
    const onInvite = vi.fn().mockResolvedValue([
      { email: 'a@example.com', ok: true },
      { email: 'b@example.com', ok: true },
    ])
    render(<ManagerTeamPanel members={FIXTURE_TEAM} onInvite={onInvite} />)
    fireEvent.click(screen.getByRole('button', { name: 'Invite to team' }))
    fireEvent.change(screen.getByLabelText('Email 1'), { target: { value: 'a@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: '+ Add another' }))
    fireEvent.change(screen.getByLabelText('Email 2'), { target: { value: 'b@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send 2 invites' }))
    await waitFor(() => expect(onInvite).toHaveBeenCalledWith(['a@example.com', 'b@example.com']))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('keeps only the failed address in the form after a partial failure', async () => {
    const onInvite = vi.fn().mockResolvedValue([
      { email: 'a@example.com', ok: true },
      { email: 'b@example.com', ok: false, error: 'Could not send this invitation' },
    ])
    render(<ManagerTeamPanel members={FIXTURE_TEAM} onInvite={onInvite} />)
    fireEvent.click(screen.getByRole('button', { name: 'Invite to team' }))
    fireEvent.change(screen.getByLabelText('Email 1'), { target: { value: 'a@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: '+ Add another' }))
    fireEvent.change(screen.getByLabelText('Email 2'), { target: { value: 'b@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send 2 invites' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/b@example\.com/)
    expect(screen.getByLabelText('Email 1')).toHaveValue('b@example.com')
    expect(screen.queryByLabelText('Email 2')).not.toBeInTheDocument()
  })

  it('lets a leader remove an added email row before sending', () => {
    render(<ManagerTeamPanel members={FIXTURE_TEAM} onInvite={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Invite to team' }))
    expect(screen.queryByRole('button', { name: 'Remove email 1' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '+ Add another' }))
    fireEvent.change(screen.getByLabelText('Email 2'), { target: { value: 'b@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Remove email 2' }))
    expect(screen.queryByLabelText('Email 2')).not.toBeInTheDocument()
  })

  it('shows a still-pending invitee in the same list, badged and pinned first, with a revoke action instead of a profile link', () => {
    const onRevokeInvite = vi.fn()
    const pendingMembers = [{ id: 'p1', name: 'Sam Rivera', avatarUrl: null, invitedAt: '2026-08-01' }]
    render(<ManagerTeamPanel members={[{ id: 'm1', name: 'Alex', sharedSkills: [] }]} pendingMembers={pendingMembers} onRevokeInvite={onRevokeInvite} />)

    expect(screen.getByText('Sam Rivera')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'View skills profile for Sam Rivera' })).not.toBeInTheDocument()
    const rows = screen.getAllByRole('row')
    // Header row, then the pending invitee ahead of the (alphabetically earlier) member.
    expect(rows[1]).toHaveTextContent('Sam Rivera')
    expect(rows[1]).toHaveTextContent('Invited')
    expect(rows[1]).not.toHaveClass('opacity-50')

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    expect(onRevokeInvite).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1', name: 'Sam Rivera' }))
  })

  it('hides the revoke action for a pending invitee when no onRevokeInvite is given (an archived team)', () => {
    const pendingMembers = [{ id: 'p1', name: 'Sam Rivera', avatarUrl: null, invitedAt: '2026-08-01' }]
    render(<ManagerTeamPanel members={[]} pendingMembers={pendingMembers} />)
    expect(screen.getByText('Sam Rivera')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument()
  })

  it('lets a manager submit a rating from the rating dialog', async () => {
    const onRate = vi.fn().mockResolvedValue()
    const onLoadHistory = vi.fn().mockResolvedValue([])
    const onClose = vi.fn()
    render(<RateSkillDialog member={{ id: 'm1', name: 'Priya Nair' }}
      skill={{ id: 'skill-1', name: 'Facilitation', level: 4 }}
      onRate={onRate} onLoadHistory={onLoadHistory} onClose={onClose} />)
    // The member's own self-assessed level is shown for context, never edited.
    expect(screen.getByText(/rates themselves at Skilled/)).toBeInTheDocument()
    expect(onLoadHistory).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Beginner' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save rating' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onRate).toHaveBeenCalledWith({ level: 1, comments: null, evidenceUrl: null, files: [] })
  })

  it('flags an invitation with no reply for a fortnight and offers to resend it', async () => {
    const onResendInvite = vi.fn().mockRejectedValue(new Error('This invitation was sent less than an hour ago -- try again later'))
    const pendingMembers = [{ id: 'p1', name: 'Sam Rivera', avatarUrl: null, invitedAt: '2020-01-01' }]
    render(<ManagerTeamPanel members={[]} pendingMembers={pendingMembers} onResendInvite={onResendInvite} />)
    expect(screen.getByText(/No reply yet/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Resend invitation to Sam Rivera' }))
    expect(onResendInvite).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/less than an hour ago/)
  })
})
