import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import CurrentRoleCard from './CurrentRoleCard'
import { FIXTURE_CURRENT_ROLE } from './roleAlignmentFixtures'

afterEach(cleanup)

describe('CurrentRoleCard', () => {
  it('shows the learner\'s own current role', () => {
    render(<CurrentRoleCard currentRole={FIXTURE_CURRENT_ROLE} />)
    expect(screen.getByText('Senior Support Engineer')).toBeInTheDocument()
    expect(screen.getByText(/Acme Corp/)).toBeInTheDocument()
  })

  it('states this is learner-owned and unaffected by linking', () => {
    render(<CurrentRoleCard currentRole={FIXTURE_CURRENT_ROLE} />)
    expect(screen.getByText(/never changes it/)).toBeInTheDocument()
  })

  it('handles no current role gracefully', () => {
    render(<CurrentRoleCard currentRole={null} />)
    expect(screen.getByText(/haven't added a current role yet/)).toBeInTheDocument()
  })

  it('has no interactive controls -- it only displays the learner-owned role', () => {
    render(<CurrentRoleCard currentRole={FIXTURE_CURRENT_ROLE} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
