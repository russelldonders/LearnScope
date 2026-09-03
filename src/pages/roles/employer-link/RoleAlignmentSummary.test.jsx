import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RoleAlignmentSummary from './RoleAlignmentSummary'
import { FIXTURE_LINKED_ROLE_PROFILE } from './roleAlignmentFixtures'
import { computeRoleAlignment } from './roleAlignment'

afterEach(cleanup)

const learnerSkills = [
  { skillId: 'skill-1', name: 'Facilitation', level: 4 },
  { skillId: 'skill-2', name: 'Stakeholder communication', level: 2 },
]
const { aligned, gaps } = computeRoleAlignment(learnerSkills, FIXTURE_LINKED_ROLE_PROFILE.requiredSkills)

function renderSummary(props = {}) {
  return render(
    <RoleAlignmentSummary
      linkedRoleProfile={FIXTURE_LINKED_ROLE_PROFILE}
      aligned={aligned}
      gaps={gaps}
      training={FIXTURE_LINKED_ROLE_PROFILE.training}
      {...props}
    />
  )
}

describe('RoleAlignmentSummary', () => {
  it('shows aligned skills and gaps (including an untracked skill) separately', () => {
    renderSummary()
    expect(screen.getByText('Aligned (1)')).toBeInTheDocument()
    expect(screen.getByText(/Facilitation -- at Skilled, requires Capable/)).toBeInTheDocument()

    expect(screen.getByText('Gaps (2)')).toBeInTheDocument()
    expect(screen.getByText(/Stakeholder communication -- requires Skilled, you're at Developing/)).toBeInTheDocument()
    expect(screen.getByText(/Incident response -- requires Capable, you haven't tracked this skill yet/)).toBeInTheDocument()
  })

  it('shows employer training with its requirement', () => {
    renderSummary()
    expect(screen.getByText(/De-escalation fundamentals/)).toHaveTextContent('(Required)')
    expect(screen.getByText(/Advanced troubleshooting/)).toHaveTextContent('(Recommended)')
  })

  it('labels requirements as employer-managed', () => {
    renderSummary()
    expect(screen.getByText(/Employer requirements -- managed by Acme Corp/)).toBeInTheDocument()
  })

  it('opens a confirm dialog before disconnecting, and calls onDisconnect', () => {
    const onDisconnect = vi.fn()
    renderSummary({ onDisconnect })
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    expect(screen.getByText(/Your current role and skill history stay exactly as they are/)).toBeInTheDocument()

    const confirmButtons = screen.getAllByRole('button', { name: 'Disconnect' })
    fireEvent.click(confirmButtons[confirmButtons.length - 1])
    expect(onDisconnect).toHaveBeenCalledWith()
  })

  it('surfaces a failed disconnect attempt inline in the confirm dialog', () => {
    renderSummary({ error: "Couldn't disconnect -- try again." })
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't disconnect -- try again.")
  })

  it('closes the confirm dialog once disconnecting finishes with no error', () => {
    const { rerender } = renderSummary({ disconnecting: true })
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    rerender(
      <RoleAlignmentSummary
        linkedRoleProfile={FIXTURE_LINKED_ROLE_PROFILE}
        aligned={aligned}
        gaps={gaps}
        training={FIXTURE_LINKED_ROLE_PROFILE.training}
        disconnecting={false}
        error={null}
      />
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
