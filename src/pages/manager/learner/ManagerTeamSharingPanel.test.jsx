import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ManagerTeamSharingPanel from './ManagerTeamSharingPanel'
import {
  FIXTURE_AVAILABLE_SKILLS,
  FIXTURE_MEMBERSHIP,
  FIXTURE_SHARED_SKILL_IDS,
} from './managerLearnerFixtures'

afterEach(cleanup)

function renderPanel(props = {}) {
  return render(
    <ManagerTeamSharingPanel
      membership={FIXTURE_MEMBERSHIP}
      availableSkills={FIXTURE_AVAILABLE_SKILLS}
      sharedSkillIds={FIXTURE_SHARED_SKILL_IDS}
      {...props}
    />
  )
}

describe('ManagerTeamSharingPanel', () => {
  it('summarizes how many skills are currently shared', () => {
    renderPanel()
    expect(screen.getByText('Sharing 1 skill')).toBeInTheDocument()
  })

  it('tells the learner experience and personal learning history are excluded', () => {
    renderPanel()
    const consentCopy = screen.getByText(/Nothing else about your profile/)
    expect(consentCopy).toHaveTextContent('experience')
    expect(consentCopy).toHaveTextContent('personal learning history')
  })

  it('opens the edit dialog and calls onSave with the explicit selected subset', () => {
    const onSave = vi.fn()
    renderPanel({ onSave })

    fireEvent.click(screen.getByRole('button', { name: 'Edit shared skills' }))
    // skill-1 starts checked (already shared); add skill-2.
    fireEvent.click(screen.getByRole('checkbox', { name: /Stakeholder communication/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }))

    expect(onSave).toHaveBeenCalledWith(expect.arrayContaining(['skill-1', 'skill-2']))
    expect(onSave.mock.calls[0][0]).toHaveLength(2)
  })

  it('supports sharing nothing via "Share nothing"', () => {
    const onSave = vi.fn()
    renderPanel({ onSave })

    fireEvent.click(screen.getByRole('button', { name: 'Edit shared skills' }))
    fireEvent.click(screen.getByRole('button', { name: 'Share nothing' }))
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }))

    expect(onSave).toHaveBeenCalledWith([])
  })

  it('closes the edit dialog once the caller reports saving finished with no error', () => {
    const { rerender } = renderPanel({ saving: true })
    fireEvent.click(screen.getByRole('button', { name: 'Edit shared skills' }))
    expect(screen.getByText('Choose skills to share')).toBeInTheDocument()

    rerender(
      <ManagerTeamSharingPanel
        membership={FIXTURE_MEMBERSHIP}
        availableSkills={FIXTURE_AVAILABLE_SKILLS}
        sharedSkillIds={FIXTURE_SHARED_SKILL_IDS}
        saving={false}
        error={null}
      />
    )

    expect(screen.queryByText('Choose skills to share')).not.toBeInTheDocument()
  })

  it('confirms before leaving the team and calls onLeaveTeam', () => {
    const onLeaveTeam = vi.fn()
    renderPanel({ onLeaveTeam })

    fireEvent.click(screen.getByRole('button', { name: 'Leave team' }))
    expect(screen.getByText(/Leave Field Ops Growth Team\?/)).toBeInTheDocument()

    // Two "Leave team" buttons now exist: the panel's trigger and the
    // confirm dialog's own confirm button -- the dialog's is the second.
    const leaveButtons = screen.getAllByRole('button', { name: 'Leave team' })
    fireEvent.click(leaveButtons[leaveButtons.length - 1])
    expect(onLeaveTeam).toHaveBeenCalledWith()
  })
})
