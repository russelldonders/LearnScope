import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import CurrentRoleCard from './CurrentRoleCard'
import { FIXTURE_CURRENT_ROLES } from './roleAlignmentFixtures'

afterEach(cleanup)

describe('CurrentRoleCard', () => {
  it("shows the learner's own current role", () => {
    render(<CurrentRoleCard currentRoles={FIXTURE_CURRENT_ROLES} />)
    expect(screen.getByText('Senior Support Engineer')).toBeInTheDocument()
    expect(screen.getByText(/Acme Corp/)).toBeInTheDocument()
    expect(screen.getByText('Your current role')).toBeInTheDocument()
  })

  it('pluralizes the label and lists every role when there is more than one', () => {
    render(
      <CurrentRoleCard
        currentRoles={[
          ...FIXTURE_CURRENT_ROLES,
          { id: 'experience-2', title: 'Volunteer Coordinator', organization: 'Riverside Trust', since: '2025-01-10' },
        ]}
      />
    )
    expect(screen.getByText('Your current roles')).toBeInTheDocument()
    expect(screen.getByText('Senior Support Engineer')).toBeInTheDocument()
    expect(screen.getByText('Volunteer Coordinator')).toBeInTheDocument()
  })

  it('states this is learner-owned and unaffected by an assignment', () => {
    render(<CurrentRoleCard currentRoles={FIXTURE_CURRENT_ROLES} />)
    expect(screen.getByText(/never changes it/)).toBeInTheDocument()
  })

  it('handles no current role gracefully', () => {
    render(<CurrentRoleCard currentRoles={[]} />)
    expect(screen.getByText(/haven't added a current role yet/)).toBeInTheDocument()
  })

  it('has no interactive controls -- it only displays the learner-owned role(s)', () => {
    render(<CurrentRoleCard currentRoles={FIXTURE_CURRENT_ROLES} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
