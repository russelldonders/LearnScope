import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LearnerRoleAlignmentContainer from './LearnerRoleAlignmentContainer'

const hookMock = vi.hoisted(() => ({ value: {} }))
vi.mock('./useMyRoleAssignments', () => ({ useMyRoleAssignments: () => hookMock.value }))
vi.mock('./employer-link/LearnerRoleAlignmentSection', () => ({ default: () => <div /> }))

afterEach(cleanup)

describe('LearnerRoleAlignmentContainer home summary', () => {
  it('summarises real skill and training progress and links to the detailed view', () => {
    hookMock.value = {
      currentRoles: [],
      pendingAssignments: [],
      linkedAssignments: [{ assignmentId: 'assignment-1', roleProfile: { name: 'Team leader' } }],
      alignmentByAssignmentId: {
        'assignment-1': {
          aligned: [{ id: 'skill-1' }, { id: 'skill-2' }],
          gaps: [{ id: 'skill-3' }],
          training: [{ id: 'course-1', completed: true }, { id: 'course-2', completed: false }],
        },
      },
      loading: false,
      error: null,
    }

    render(
      <MemoryRouter>
        <LearnerRoleAlignmentContainer variant="summary" roleHref="/employer/home?org=acme&section=role" />
      </MemoryRouter>,
    )

    expect(screen.getByText('Team leader')).toBeInTheDocument()
    expect(screen.getByText('2 of 3')).toBeInTheDocument()
    expect(screen.getByText('1 of 2')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View details' })).toHaveAttribute('href', '/employer/home?org=acme&section=role')
  })

  it('makes a pending role profile prominent without exposing personal role details', () => {
    hookMock.value = {
      currentRoles: [{ id: 'private-role', title: 'Private personal role' }],
      pendingAssignments: [{ assignmentId: 'pending-1', roleProfile: { name: 'Store manager' } }],
      linkedAssignments: [],
      alignmentByAssignmentId: {},
      loading: false,
      error: null,
    }

    render(<MemoryRouter><LearnerRoleAlignmentContainer variant="summary" roleHref="/role" /></MemoryRouter>)

    expect(screen.getByText('Role profile awaiting your response')).toBeInTheDocument()
    expect(screen.getByText(/Store manager/)).toBeInTheDocument()
    expect(screen.queryByText('Private personal role')).not.toBeInTheDocument()
  })
})
