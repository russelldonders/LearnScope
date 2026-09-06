import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Connections from './Connections'
import * as connectionApi from '../lib/connections'

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'me', email: 'me@example.com' } }),
}))
vi.mock('../components/AppHeader', () => ({ default: () => <header>Header</header> }))
vi.mock('../components/ConnectionsTeams', () => ({ default: () => <section>Team controls</section> }))
vi.mock('../lib/connections', () => ({
  listMyPeerRatings: vi.fn(), listConnections: vi.fn(), listSentInvites: vi.fn(),
  getProfiles: vi.fn(), getSharedSkillCounts: vi.fn(), sendInviteEmail: vi.fn(), revokeInvite: vi.fn(),
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

  it('opens the teams tab directly and supports arrow-key tab navigation', () => {
    renderPage('/connections?section=teams')
    const teamsTab = screen.getByRole('tab', { name: 'Teams' })
    expect(teamsTab).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(teamsTab, { key: 'ArrowLeft' })
    expect(screen.getByRole('tab', { name: 'People' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'People' })).toHaveFocus()
  })
})
