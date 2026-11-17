import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AdminOverview from './AdminOverview'
import * as overview from '../../lib/admin/overview'

vi.mock('./AdminLayout', () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock('../../lib/admin/onboardingSteps', () => ({ listAllOnboardingSteps: vi.fn().mockResolvedValue([]) }))
vi.mock('../../lib/admin/overview', () => ({
  countCoursesAwaitingApproval: vi.fn(),
  countOpenResourceReports: vi.fn(),
  countRejectedCourses: vi.fn(),
  countBlockedUsers: vi.fn(),
  countInactiveProviders: vi.fn(),
  countPendingStaffInvitations: vi.fn(),
  countRecentCourseSubmissions: vi.fn().mockResolvedValue(0),
}))

afterEach(cleanup)

function setCounts(counts) {
  overview.countCoursesAwaitingApproval.mockResolvedValue(counts.approvals ?? 0)
  overview.countOpenResourceReports.mockResolvedValue(counts.reports ?? 0)
  overview.countRejectedCourses.mockResolvedValue(counts.rejected ?? 0)
  overview.countBlockedUsers.mockResolvedValue(counts.blocked ?? 0)
  overview.countInactiveProviders.mockResolvedValue(counts.inactive ?? 0)
  overview.countPendingStaffInvitations.mockResolvedValue(counts.invites ?? 0)
}

function renderOverview() {
  render(<MemoryRouter><AdminOverview /></MemoryRouter>)
}

beforeEach(() => setCounts({}))

describe('AdminOverview', () => {
  it('leads with what needs an admin decision, linking to where it is dealt with', async () => {
    setCounts({ approvals: 3, reports: 1 })
    renderOverview()
    const action = await screen.findByRole('region', { name: 'Needs your action' })
    expect(within(action).getByRole('link', { name: /Courses awaiting approval/ }))
      .toHaveAttribute('href', '/admin/courses?status=pending_approval')
    expect(within(action).getByRole('link', { name: /Reported resources/ }))
      .toHaveAttribute('href', '/admin/reported-resources')
    expect(within(action).getByText('3')).toBeInTheDocument()
  })

  it('separates items waiting on others from current status', async () => {
    setCounts({ rejected: 2, invites: 4, blocked: 1, inactive: 5 })
    renderOverview()
    const waiting = await screen.findByRole('region', { name: 'Waiting on others' })
    expect(within(waiting).getByRole('link', { name: /Pending staff invitations/ }))
      .toHaveAttribute('href', '/admin/organisations?invites=pending')
    expect(within(waiting).getByRole('link', { name: /Rejected courses awaiting revision/ })).toBeInTheDocument()
    const status = screen.getByRole('region', { name: 'Current status' })
    expect(within(status).getByRole('link', { name: /Blocked users/ })).toHaveAttribute('href', '/admin/users?status=blocked')
    expect(within(status).getByRole('link', { name: /Inactive organisations/ })).toBeInTheDocument()
  })

  it('says so when nothing needs action, but still shows the other counts', async () => {
    setCounts({ blocked: 2 })
    renderOverview()
    expect(await screen.findByText('Nothing needs your action right now.')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Current status' })).toHaveTextContent('2 accounts currently blocked')
  })

  it('shows an error on a tile whose count fails', async () => {
    overview.countOpenResourceReports.mockRejectedValue(new Error('No access'))
    renderOverview()
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load this count")
  })
})
