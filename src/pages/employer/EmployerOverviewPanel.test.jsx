import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import EmployerOverviewPanel from './EmployerOverviewPanel'

vi.mock('../../lib/admin/employers', () => ({
  listEmployerMembers: vi.fn(),
  listEmployerCourseAssignments: vi.fn(),
  listEmployerDataAccessRequests: vi.fn(),
  listEmployerSkillSuggestions: vi.fn(),
  listEmployerLinkedProviders: vi.fn(),
}))

afterEach(cleanup)

const employer = { id: 'employer-1', name: 'Acme' }
const loaders = {
  members: vi.fn().mockResolvedValue([
    { id: 'member-1', role: 'member', status: 'active' },
    { id: 'member-2', role: 'member', status: 'pending' },
    { id: 'admin-1', role: 'admin', status: 'active' },
  ]),
  assignments: vi.fn().mockResolvedValue([{ id: 'assignment-1', status: 'assigned' }]),
  accessRequests: vi.fn().mockResolvedValue([{ id: 'access-1', status: 'pending' }]),
  skillSuggestions: vi.fn().mockResolvedValue([{ id: 'suggestion-1', status: 'suggested' }]),
  linkedProviders: vi.fn().mockResolvedValue([
    { id: 'link-1', organisations: { name: 'Northstar Learning', org_code: 'NORTH' } },
  ]),
}

function renderPanel(customLoaders = loaders) {
  return render(<MemoryRouter><EmployerOverviewPanel employer={employer} loaders={customLoaders} /></MemoryRouter>)
}

describe('EmployerOverviewPanel', () => {
  it('summarises employer work and surfaces linked providers', async () => {
    renderPanel()
    expect(screen.getByRole('status')).toHaveTextContent('Loading employer overview')
    expect(await screen.findByText('Northstar Learning')).toBeInTheDocument()
    expect(screen.getByText('1 learner currently connected to this employer')).toBeInTheDocument()
    expect(screen.getByText('1 invitation waiting for a response')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Manage linked providers' })).toHaveAttribute(
      'href', '/?employer=employer-1&section=providers'
    )
  })

  it('shows a direct provider action when none are linked', async () => {
    renderPanel({ ...loaders, linkedProviders: vi.fn().mockResolvedValue([]) })
    expect(await screen.findByText('No additional providers linked yet.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /No additional providers linked yet/ })).toHaveAttribute(
      'href', '/?employer=employer-1&section=providers'
    )
  })

  it('contains failures to the affected overview surface', async () => {
    renderPanel({ ...loaders, linkedProviders: vi.fn().mockRejectedValue(new Error('Provider service unavailable')) })
    expect(await screen.findByText("Couldn't load linked providers.")).toBeInTheDocument()
    expect(screen.getByText('Provider service unavailable')).toBeInTheDocument()
    expect(screen.getByText('Active learners')).toBeInTheDocument()
  })
})
