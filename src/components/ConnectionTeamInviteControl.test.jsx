import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ConnectionTeamInviteControl from './ConnectionTeamInviteControl'

afterEach(cleanup)

describe('ConnectionTeamInviteControl', () => {
  it('lets a connection be invited to a selected team', async () => {
    const onInvite = vi.fn().mockResolvedValue('membership')
    render(<MemoryRouter><ConnectionTeamInviteControl connection={{ id: 'alex', name: 'Alex' }}
      teams={[{ id: 'one', name: 'First' }, { id: 'two', name: 'Second' }]} onInvite={onInvite} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Add to team' }))
    fireEvent.change(screen.getByLabelText('Team'), { target: { value: 'two' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send invite' }))
    expect(onInvite).toHaveBeenCalledWith('two', 'alex')
    expect(await screen.findByText('Invitation sent to Second.')).toBeInTheDocument()
  })

  it('creates a first team and immediately invites the selected connection', async () => {
    const onCreateTeam = vi.fn().mockResolvedValue({ id: 'new-team', name: 'Mentors' })
    const onInvite = vi.fn().mockResolvedValue('membership')
    render(<MemoryRouter><ConnectionTeamInviteControl connection={{ id: 'alex', name: 'Alex' }} teams={[]}
      onCreateTeam={onCreateTeam} onInvite={onInvite} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Add to team' }))
    fireEvent.change(screen.getByLabelText('New team name'), { target: { value: 'Mentors' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create and invite Alex' }))
    expect(await screen.findByText('Invitation sent to Mentors.')).toBeInTheDocument()
    expect(onCreateTeam).toHaveBeenCalledWith('Mentors')
    expect(onInvite).toHaveBeenCalledWith('new-team', 'alex')
  })
})
