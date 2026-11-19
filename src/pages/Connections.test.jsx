import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Connections from './Connections'
import * as connectionApi from '../lib/connections'
import * as managerApi from '../lib/managerTeams'
import * as employerApi from '../lib/employerManagement'

const authState = { managerContexts: [] }
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'me', email: 'me@example.com' }, refreshWorkspaces: vi.fn().mockResolvedValue(),
    managerContexts: authState.managerContexts,
  }),
}))
// Resolves against the real English dictionary (rather than a key-passthrough
// stub) so assertions on rendered text (e.g. 'Connections', 'No connections yet')
// stay meaningful -- translations.js has no side effects/imports of its own,
// so this doesn't pull in the real supabaseClient the way useLanguage's own
// module does.
vi.mock('../context/LanguageContext', async () => {
  const { english } = await import('../lib/i18n/translations')
  const t = (key, params) => {
    const value = key.split('.').reduce((v, part) => v?.[part], english) ?? key
    return params ? value.replace(/\{(\w+)\}/g, (m, name) => (name in params ? params[name] : m)) : value
  }
  return { useLanguage: () => ({ language: 'en', setLanguage: vi.fn(), t }) }
})
vi.mock('../components/AppHeader', () => ({ default: () => <header>Header</header> }))
vi.mock('../components/ConnectionsTeams', () => ({ default: () => <section>Team controls</section> }))
vi.mock('../components/InviteConnectModal', () => ({
  default: ({ onClose }) => <div role="dialog" aria-label="Invite someone to connect"><button type="button" onClick={onClose}>Done</button></div>,
}))
vi.mock('../lib/connections', () => ({
  listMyPeerRatings: vi.fn(), listConnections: vi.fn(), listConnectionsActivity: vi.fn(), listSentInvites: vi.fn(),
  getProfiles: vi.fn(), getConnectionSkills: vi.fn(), sendInviteEmail: vi.fn(), revokeInvite: vi.fn(),
  disconnectConnection: vi.fn(),
}))
vi.mock('../lib/employerManagement', () => ({ listMyLineManagementWithConnections: vi.fn() }))
vi.mock('../lib/managerTeams', () => ({
  listMyLedManagerTeams: vi.fn(), inviteConnectionToManagerTeam: vi.fn(),
  createManagerWorkspace: vi.fn(), createManagerTeam: vi.fn(),
  listMySharedTeamsByConnection: vi.fn(),
}))

function renderPage(path = '/connections') {
  return render(<MemoryRouter initialEntries={[path]}><Connections /></MemoryRouter>)
}

beforeEach(() => {
  vi.resetAllMocks()
  authState.managerContexts = []
  connectionApi.listMyPeerRatings.mockResolvedValue([])
  connectionApi.listConnections.mockResolvedValue([])
  connectionApi.listConnectionsActivity.mockResolvedValue([])
  connectionApi.listSentInvites.mockResolvedValue([])
  connectionApi.getProfiles.mockResolvedValue({})
  connectionApi.getConnectionSkills.mockResolvedValue({})
  employerApi.listMyLineManagementWithConnections.mockResolvedValue([])
  managerApi.listMyLedManagerTeams.mockResolvedValue([])
  managerApi.listMySharedTeamsByConnection.mockResolvedValue([])
  managerApi.inviteConnectionToManagerTeam.mockResolvedValue('invite')
  managerApi.createManagerWorkspace.mockResolvedValue('workspace')
  managerApi.createManagerTeam.mockResolvedValue('new-team')
})
afterEach(cleanup)

describe('Connections sections', () => {
  it('shows people by default and keeps team controls in their own tab', async () => {
    renderPage()
    expect(screen.getByRole('tab', { name: /^Connections/ })).toHaveAttribute('aria-selected', 'true')
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
    fireEvent.keyDown(teamsTab, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: /^Connections/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /^Connections/ })).toHaveFocus()
  })

  it('has no separate My team tab: people you manage are on Teams, where old My team links now open', async () => {
    authState.managerContexts = [{ employerId: 'employer-1', employerName: 'Acme' }]
    renderPage('/connections?section=team&employer=employer-1')
    expect(screen.queryByRole('tab', { name: 'My team' })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Teams' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Team controls')).toBeInTheDocument()
    await screen.findByRole('tab', { name: /^Connections/ })
  })

  it('lists pending invites on the Connections tab, under the connections, with no tab of their own', async () => {
    connectionApi.listConnections.mockResolvedValue([{ id: 'alex', name: 'Alex' }])
    connectionApi.getProfiles.mockResolvedValue({ alex: { name: 'Alex' } })
    connectionApi.listSentInvites.mockResolvedValue([
      {
        id: 'invite-1', status: 'pending', invite_type: 'rate', invitee_email: 'friend@example.com',
        created_at: '2026-09-01T00:00:00Z', skills: { name: 'SQL' },
      },
    ])
    renderPage()
    const invites = await screen.findByRole('region', { name: /^Pending invites/ })
    expect(invites).toHaveTextContent('sent to friend@example.com')
    expect(screen.queryByRole('tab', { name: /^Pending invites/ })).not.toBeInTheDocument()

    const search = screen.getByRole('searchbox', { name: 'Search connections' })
    fireEvent.change(search, { target: { value: 'friend' } })
    expect(screen.getByRole('region', { name: /^Pending invites/ })).toBeInTheDocument()
    expect(screen.queryByText(/No connections match/)).not.toBeInTheDocument()
    fireEvent.change(search, { target: { value: 'alex' } })
    expect(screen.queryByRole('region', { name: /^Pending invites/ })).not.toBeInTheDocument()
  })

  it('shows each connection once, summing up their last month, most recently active first', async () => {
    const recent = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
    connectionApi.listConnections.mockResolvedValue([{ id: 'alex', name: 'Alex' }, { id: 'sam', name: 'Sam' }, { id: 'kim', name: 'Kim' }])
    connectionApi.getProfiles.mockResolvedValue({ alex: { name: 'Alex' }, sam: { name: 'Sam' }, kim: { name: 'Kim' } })
    connectionApi.listConnectionsActivity.mockResolvedValue([
      { event_type: 'skill_confirmed', actor_id: 'sam', full_name: 'Sam', skill_name: 'Python', level: 4, event_at: recent(1) },
      { event_type: 'course_completed', actor_id: 'sam', full_name: 'Sam', skill_name: null, detail: 'Data Basics · OpenLearn', event_at: recent(2) },
      { event_type: 'skill_added', actor_id: 'alex', full_name: 'Alex', skill_name: 'SQL', event_at: recent(60) },
    ])
    renderPage()
    expect(await screen.findByText('Reached Skilled in Python · Completed “Data Basics”')).toBeInTheDocument()
    expect(screen.getByText('No updates in the last month')).toBeInTheDocument()
    expect(screen.getByText('Connected')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'What your connections are up to' })).not.toBeInTheDocument()
    const profiles = screen.getAllByRole('link').map((link) => link.getAttribute('href')).filter((href) => href.startsWith('/skills-profile/'))
    expect(profiles).toEqual(['/skills-profile/sam', '/skills-profile/alex', '/skills-profile/kim'])
    expect(connectionApi.listConnectionsActivity).toHaveBeenCalledWith(300)
    // Details live on the person's own page, not in the list.
    expect(screen.queryByRole('button', { name: 'Show details' })).not.toBeInTheDocument()
  })

  it('filters connections by a skill they show and by a team you share', async () => {
    connectionApi.listConnections.mockResolvedValue([{ id: 'alex', name: 'Alex' }, { id: 'sam', name: 'Sam' }])
    connectionApi.getProfiles.mockResolvedValue({ alex: { name: 'Alex' }, sam: { name: 'Sam' } })
    connectionApi.getConnectionSkills.mockResolvedValue({
      alex: [{ libraryId: 'lib-py', name: 'Python', shared: false }],
      sam: [{ libraryId: 'lib-sql', name: 'SQL', shared: true }],
    })
    connectionApi.listSentInvites.mockResolvedValue([
      { id: 'invite-1', status: 'pending', invite_type: 'connect', invitee_email: 'new@example.com', created_at: '2026-11-01T00:00:00Z' },
    ])
    managerApi.listMySharedTeamsByConnection.mockResolvedValue([
      { connectionUserId: 'sam', teamId: 'team-1', teamName: 'Coaching', membershipStatus: 'active', myRole: 'manager', theirRole: 'member' },
      { connectionUserId: 'alex', teamId: 'team-2', teamName: 'Sales', membershipStatus: 'pending', myRole: 'manager', theirRole: 'member' },
    ])
    renderPage()
    const profileLinks = () => screen.queryAllByRole('link').map((link) => link.getAttribute('href')).filter((href) => href.startsWith('/skills-profile/'))
    const skillFilter = await screen.findByRole('combobox', { name: 'Filter by skill' })
    expect([...skillFilter.options].map((o) => o.textContent)).toEqual(['All skills', 'Python', 'SQL'])
    const teamFilter = screen.getByRole('combobox', { name: 'Filter by team' })
    // A team they've only been invited to isn't one you share yet.
    expect([...teamFilter.options].map((o) => o.textContent)).toEqual(['All teams', 'Coaching'])

    fireEvent.change(skillFilter, { target: { value: 'lib-py' } })
    expect(profileLinks()).toEqual(['/skills-profile/alex'])
    expect(screen.queryByRole('region', { name: /^Pending invites/ })).not.toBeInTheDocument()

    fireEvent.change(teamFilter, { target: { value: 'team-1' } })
    expect(profileLinks()).toEqual([])
    expect(screen.getByText('No connections match these filters.')).toBeInTheDocument()

    fireEvent.change(skillFilter, { target: { value: '' } })
    expect(profileLinks()).toEqual(['/skills-profile/sam'])

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(profileLinks()).toHaveLength(2)
    expect(screen.getByRole('region', { name: /^Pending invites/ })).toBeInTheDocument()
  })

  it('says how you relate and which skills you share, and opens their page for the rest', async () => {
    connectionApi.listConnections.mockResolvedValue([{ id: 'alex', name: 'Alex' }])
    connectionApi.getProfiles.mockResolvedValue({ alex: { name: 'Alex' } })
    connectionApi.getConnectionSkills.mockResolvedValue({
      alex: ['Excel', 'Python', 'SQL', 'Writing'].map((name) => ({ libraryId: name, name, shared: true })),
    })
    employerApi.listMyLineManagementWithConnections.mockResolvedValue([
      { connectionUserId: 'alex', direction: 'manages_me', relationshipType: 'primary', employerName: 'Acme' },
    ])
    managerApi.listMySharedTeamsByConnection.mockResolvedValue([
      { connectionUserId: 'alex', teamId: 'team-1', teamName: 'Coaching', membershipStatus: 'active', myRole: 'member', theirRole: 'manager' },
    ])
    renderPage()
    expect(await screen.findByText('Your line manager at Acme · Leads you in Coaching')).toBeInTheDocument()
    expect(screen.getByText(/^Shared skills: Excel, Python, SQL/)).toHaveTextContent('Shared skills: Excel, Python, SQL +1 more')
    expect(screen.queryByRole('button', { name: 'Disconnect from Alex' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add to team' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Alex/ })).toHaveAttribute('href', '/skills-profile/alex')
  })

  it('says so after disconnecting from someone on their page', async () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: '/connections', state: { disconnectedName: 'Alex' } }]}>
        <Connections />
      </MemoryRouter>,
    )
    expect(await screen.findByText('You’re no longer connected to Alex.')).toBeInTheDocument()
  })

  it('offers to invite someone to connect from the People tab', async () => {
    renderPage()
    expect(await screen.findByText(/Invite someone to connect — they don’t need to be on LearnScope yet/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Invite someone' }))
    expect(screen.getByRole('dialog', { name: 'Invite someone to connect' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('lists an invitation to connect with the other pending invites, and resends it as one', async () => {
    connectionApi.listSentInvites.mockResolvedValue([
      {
        id: 'invite-2', status: 'pending', invite_type: 'connect', invitee_email: 'new@example.com',
        created_at: '2026-11-01T00:00:00Z', skills: null, url: 'https://app.example/connect/abc',
      },
    ])
    connectionApi.sendInviteEmail.mockResolvedValue()
    renderPage()
    expect(await screen.findByText('Invitation to connect — sent to new@example.com')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Resend email' }))
    await waitFor(() => expect(connectionApi.sendInviteEmail).toHaveBeenCalledWith(expect.objectContaining({
      toEmail: 'new@example.com', shareUrl: 'https://app.example/connect/abc', emailType: 'connect',
    })))
  })

  it('keeps the connection list when the activity fails to load, and can retry', async () => {
    connectionApi.listConnectionsActivity.mockRejectedValueOnce(new Error('boom'))
    renderPage()
    expect(await screen.findByText('Couldn’t load what your connections have been up to.')).toBeInTheDocument()
    expect(await screen.findByText(/No connections yet/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.queryByText('Couldn’t load what your connections have been up to.')).not.toBeInTheDocument())
    expect(connectionApi.listConnectionsActivity).toHaveBeenCalledTimes(2)
  })

  it('leaves the pending invites section out when there are none, and treats an old invites link as Connections', async () => {
    renderPage('/connections?section=invites')
    expect(screen.getByRole('tab', { name: /^Connections/ })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText(/No connections yet/)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /^Pending invites/ })).not.toBeInTheDocument()
  })
})
