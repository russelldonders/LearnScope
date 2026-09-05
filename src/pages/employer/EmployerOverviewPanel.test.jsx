import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import EmployerOverviewPanel from './EmployerOverviewPanel'

vi.mock('../../lib/admin/employers', () => ({
  listEmployerMembers: vi.fn(),
  listEmployerCourseAssignments: vi.fn(),
  listEmployerDataAccessRequests: vi.fn(),
  listEmployerSkillSuggestions: vi.fn(),
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
}

function renderPanel(customLoaders = loaders) {
  return render(<MemoryRouter><EmployerOverviewPanel employer={employer} loaders={customLoaders} /></MemoryRouter>)
}

describe('EmployerOverviewPanel', () => {
  it('summarises employer work as clickable count tiles', async () => {
    renderPanel()
    expect(screen.getByRole('status')).toHaveTextContent('Loading employer overview')
    expect(await screen.findByText('1 learner currently connected to this employer')).toBeInTheDocument()
    expect(screen.getByText('1 invitation waiting for a response')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Active learners/ })).toHaveAttribute(
      'href', '/?employer=employer-1&section=users'
    )
  })

  it('contains a failed tile load to that tile only', async () => {
    renderPanel({ ...loaders, assignments: vi.fn().mockRejectedValue(new Error('Assignment service unavailable')) })
    expect(await screen.findByText("Couldn't load this count")).toBeInTheDocument()
    expect(screen.getByText('Assignment service unavailable')).toBeInTheDocument()
    expect(screen.getByText('Active learners')).toBeInTheDocument()
  })
})
