import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Connections from './Connections'
import * as connectionApi from '../lib/connections'
import * as managerApi from '../lib/managerTeams'

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'me', email: 'me@example.com' } }),
}))
vi.mock('../components/AppHeader', () => ({ default: () => <header>Header</header> }))
vi.mock('../components/ConnectionsTeams', () => ({ default: () => <section>Team controls</section> }))
vi.mock('../lib/connections', () => ({
  listMyPeerRatings: vi.fn(), listConnections: vi.fn(), listSentInvites: vi.fn(),
  getProfiles: vi.fn(), getSharedSkillCounts: vi.fn(), sendInviteEmail: vi.fn(), revokeInvite: vi.fn(),
}))
vi.mock('../lib/managerTeams', () => ({
  listMyLedManagerTeams: vi.fn(), inviteConnectionToManagerTeam: vi.fn(),
}))

function renderPage(path = '/connections') {
  return render(<MemoryRouter initialEntries={[path]}><Connections /></MemoryRouter>)
}

beforeEach(() => {
  vi.resetAllMocks()
  connectionApi.listMyPeerRatings.mockResolvedValue([])
  connectionApi.listConnections.mockResolvedValue([])
  connectionApi.listSentInvites.mockResolvedValue([])
  connectionApi.getProfiles.mockResolvedValue({})
  connectionApi.getSharedSkillCounts.mockResolvedValue({})
  managerApi.listMyLedManagerTeams.mockResolvedValue([])
  managerApi.inviteConnectionToManagerTeam.mockResolvedValue('invite')
})
afterEach(cleanup)

describe('Connections sections', () => {
  it('shows people by default and keeps team controls in their own tab', async () => {
    renderPage()
    expect(screen.getByRole('tab', { name: 'People' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText(/No connections yet/)).toBeInTheDocument()
    expect(screen.queryByText('Team controls')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Teams' }))
    expect(screen.getByRole('tab', { name: 'Teams' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Team controls')).toBeInTheDocument()
    expect(screen.queryByText(/No connections yet/)).not.toBeInTheDocument()
  })

  it('offers an add-to-team action for each connection', async () => {
    connectionApi.listConnections.mockResolvedValue([{ id: 'alex', name: 'Alex' }])
    connectionApi.getProfiles.mockResolvedValue({ alex: { name: 'Alex' } })
    managerApi.listMyLedManagerTeams.mockResolvedValue([{ id: 'team-1', name: 'Coaching', status: 'active' }])
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Add to team' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send invite' }))
    expect(managerApi.inviteConnectionToManagerTeam).toHaveBeenCalledWith('team-1', 'alex')
    expect(await screen.findByText('Invitation sent to Coaching.')).toBeInTheDocument()
  })

  it('opens the teams tab directly and supports arrow-key tab navigation', () => {
    renderPage('/connections?section=teams')
    const teamsTab = screen.getByRole('tab', { name: 'Teams' })
    expect(teamsTab).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(teamsTab, { key: 'ArrowLeft' })
    expect(screen.getByRole('tab', { name: 'People' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'People' })).toHaveFocus()
  })
})
