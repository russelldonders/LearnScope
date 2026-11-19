import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const connections = vi.hoisted(() => ({
  listConnections: vi.fn(), listConnectionsActivity: vi.fn(), listMyPeerRatings: vi.fn(), disconnectConnection: vi.fn(),
}))
const teams = vi.hoisted(() => ({
  listMySharedTeamsByConnection: vi.fn(), listMyLedManagerTeams: vi.fn(), inviteConnectionToManagerTeam: vi.fn(),
  createManagerWorkspace: vi.fn(), createManagerTeam: vi.fn(),
}))
const employer = vi.hoisted(() => ({ listMyLineManagementWithConnections: vi.fn() }))
vi.mock('../lib/connections', () => connections)
vi.mock('../lib/managerTeams', () => teams)
vi.mock('../lib/employerManagement', () => employer)
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' }, refreshWorkspaces: vi.fn() }) }))
vi.mock('../context/LanguageContext', async () => {
  const { english } = await import('../lib/i18n/translations')
  const t = (key, params) => {
    const value = key.split('.').reduce((v, part) => v?.[part], english) ?? key
    return params ? value.replace(/\{(\w+)\}/g, (m, name) => (name in params ? params[name] : m)) : value
  }
  return { useLanguage: () => ({ language: 'en', setLanguage: vi.fn(), t }) }
})

const { default: ConnectionPanel } = await import('./ConnectionPanel')

function PeoplePage() {
  const location = useLocation()
  return <p>People page {location.state?.disconnectedName}</p>
}

function renderPanel() {
  return render(
    <MemoryRouter initialEntries={['/skills-profile/alex']}>
      <Routes>
        <Route path="/skills-profile/:userId" element={<ConnectionPanel userId="alex" name="Alex" />} />
        <Route path="/connections" element={<PeoplePage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  connections.listConnections.mockResolvedValue([{ id: 'alex', name: 'Alex' }])
  connections.listConnectionsActivity.mockResolvedValue([
    { event_type: 'course_completed', actor_id: 'alex', skill_name: null, detail: 'Data Basics · OpenLearn', event_at: '2026-11-10T00:00:00Z' },
    { event_type: 'skill_confirmed', actor_id: 'alex', skill_name: 'Python', level: 4, event_at: '2026-11-09T00:00:00Z' },
  ])
  connections.listMyPeerRatings.mockResolvedValue([
    { id: 'r1', rater_id: 'alex', skill_owner_id: 'me', skill_name: 'SQL', level: 3, rated_at: '2026-10-01T00:00:00Z' },
    { id: 'r2', rater_id: 'me', skill_owner_id: 'sam', skill_name: 'Excel', level: 2, rated_at: '2026-10-02T00:00:00Z' },
  ])
  connections.disconnectConnection.mockResolvedValue()
  teams.listMySharedTeamsByConnection.mockResolvedValue([
    { connectionUserId: 'alex', teamId: 'team-1', teamName: 'Coaching', membershipStatus: 'active', myRole: 'member', theirRole: 'manager' },
  ])
  teams.listMyLedManagerTeams.mockResolvedValue([])
  employer.listMyLineManagementWithConnections.mockResolvedValue([
    { connectionUserId: 'alex', direction: 'manages_me', relationshipType: 'primary', employerName: 'Acme' },
  ])
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ConnectionPanel', () => {
  it('shows how you relate, their activity and the ratings between you', async () => {
    renderPanel()
    expect(await screen.findByRole('heading', { name: 'You and Alex' })).toBeInTheDocument()
    expect(screen.getByText('Your line manager at Acme')).toBeInTheDocument()
    expect(screen.getByText('Leads you in Coaching')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Coaching' })).toHaveAttribute('href', '/connections?section=teams&team=team-1')
    // Already in a team together, so no add-to-team.
    expect(screen.queryByRole('button', { name: 'Add to team' })).not.toBeInTheDocument()
    expect(screen.getByText('Data Basics')).toBeInTheDocument()
    // Level changes are the profile's own Recent growth section.
    expect(screen.queryByText('Python')).not.toBeInTheDocument()
    expect(screen.getByText('They rated your SQL: Capable')).toBeInTheDocument()
    expect(screen.queryByText(/Excel/)).not.toBeInTheDocument()
  })

  it('offers to add them to a team when you share none', async () => {
    teams.listMySharedTeamsByConnection.mockResolvedValue([])
    employer.listMyLineManagementWithConnections.mockResolvedValue([])
    renderPanel()
    expect(await screen.findByText('You don’t share a team or a reporting line yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add to team' })).toBeInTheDocument()
  })

  it('disconnects only after confirming, then goes back to People saying so', async () => {
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect from Alex' }))
    expect(connections.disconnectConnection).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(connections.disconnectConnection).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect from Alex' }))
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    await waitFor(() => expect(connections.disconnectConnection).toHaveBeenCalledWith('alex'))
    expect(await screen.findByText('People page Alex')).toBeInTheDocument()
  })

  it('shows nothing for someone you aren’t connected to', async () => {
    connections.listConnections.mockResolvedValue([{ id: 'sam', name: 'Sam' }])
    const { container } = renderPanel()
    await waitFor(() => expect(connections.listConnections).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
