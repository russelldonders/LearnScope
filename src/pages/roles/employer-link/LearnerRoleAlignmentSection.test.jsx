import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import LearnerRoleAlignmentSection from './LearnerRoleAlignmentSection'
import { FIXTURE_CURRENT_ROLE } from './roleAlignmentFixtures'

afterEach(cleanup)

// The fixtures deliberately give the learner's own current role the same
// title as one of the linkable role profiles (a realistic "this matches my
// job" case), so assertions below scope to a specific section rather than
// asserting on that shared title text alone.
function currentRoleCard() {
  return screen.getByText('Your current role').closest('div')
}

describe('LearnerRoleAlignmentSection', () => {
  it('always shows the current role, and the link picker when nothing is linked', () => {
    render(<LearnerRoleAlignmentSection />)
    expect(currentRoleCard()).toHaveTextContent(FIXTURE_CURRENT_ROLE.organization)
    expect(screen.getByText('Link to a role profile')).toBeInTheDocument()
    expect(screen.queryByText('Disconnect')).not.toBeInTheDocument()
  })

  it('linking a role profile swaps the picker for the alignment summary, without touching the current role card', () => {
    render(<LearnerRoleAlignmentSection />)
    fireEvent.click(screen.getByRole('radio', { name: /Senior Support Engineer/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Link role profile' }))

    expect(screen.queryByText('Link to a role profile')).not.toBeInTheDocument()
    expect(screen.getByText('Aligned (1)')).toBeInTheDocument()
    expect(screen.getByText('Gaps (2)')).toBeInTheDocument()
    expect(currentRoleCard()).toHaveTextContent(FIXTURE_CURRENT_ROLE.organization)
  })

  it('disconnecting keeps the current role and reverts to the picker, not any deleted/empty state', () => {
    render(<LearnerRoleAlignmentSection />)
    fireEvent.click(screen.getByRole('radio', { name: /Field Operations Lead/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Link role profile' }))
    expect(screen.getByText(/Employer requirements/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    const confirmButtons = screen.getAllByRole('button', { name: 'Disconnect' })
    fireEvent.click(confirmButtons[confirmButtons.length - 1])

    expect(screen.queryByText(/Employer requirements/)).not.toBeInTheDocument()
    expect(screen.getByText('Link to a role profile')).toBeInTheDocument()
    // The learner's own current role is untouched by the disconnect.
    expect(currentRoleCard()).toHaveTextContent(FIXTURE_CURRENT_ROLE.organization)
  })
})
