import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RoleProfileTrainingPanel from './RoleProfileTrainingPanel'
import { FIXTURE_COURSE_CATALOGUE, FIXTURE_ROLE_PROFILES } from './roleProfileFixtures'

afterEach(cleanup)

const FIXTURE_TRAINING = FIXTURE_ROLE_PROFILES[0].training

describe('RoleProfileTrainingPanel', () => {
  it('lists each training item with its requirement', () => {
    render(<RoleProfileTrainingPanel training={FIXTURE_TRAINING} availableCourses={FIXTURE_COURSE_CATALOGUE} />)
    expect(screen.getByText('De-escalation fundamentals')).toBeInTheDocument()
    expect(screen.getByLabelText('Requirement for De-escalation fundamentals')).toHaveValue('required')
    expect(screen.getByLabelText('Requirement for Advanced troubleshooting')).toHaveValue('recommended')
  })

  it('shows an empty state when no training is assigned', () => {
    render(<RoleProfileTrainingPanel training={[]} availableCourses={FIXTURE_COURSE_CATALOGUE} />)
    expect(screen.getByText('No training assigned yet.')).toBeInTheDocument()
  })

  it('only offers courses not already assigned in the "add" picker', () => {
    render(<RoleProfileTrainingPanel training={FIXTURE_TRAINING} availableCourses={FIXTURE_COURSE_CATALOGUE} />)
    const picker = screen.getByLabelText('Add training')
    const optionNames = [...picker.querySelectorAll('option')].map((o) => o.textContent)
    expect(optionNames).not.toContain('De-escalation fundamentals')
    expect(optionNames).toContain('Leading through change')
  })

  it('calls onAddTraining with the chosen course and requirement', () => {
    const onAddTraining = vi.fn()
    render(<RoleProfileTrainingPanel training={[]} availableCourses={FIXTURE_COURSE_CATALOGUE} onAddTraining={onAddTraining} />)
    fireEvent.change(screen.getByLabelText('Add training'), { target: { value: 'course-3' } })
    fireEvent.change(screen.getByLabelText('Requirement'), { target: { value: 'recommended' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(onAddTraining).toHaveBeenCalledWith({ courseId: 'course-3', requirement: 'recommended' })
  })

  it('calls onUpdateRequirement with the courseId (not a synthetic id) when a requirement select changes', () => {
    const onUpdateRequirement = vi.fn()
    render(
      <RoleProfileTrainingPanel
        training={FIXTURE_TRAINING}
        availableCourses={FIXTURE_COURSE_CATALOGUE}
        onUpdateRequirement={onUpdateRequirement}
      />
    )
    fireEvent.change(screen.getByLabelText('Requirement for De-escalation fundamentals'), {
      target: { value: 'recommended' },
    })
    expect(onUpdateRequirement).toHaveBeenCalledWith('course-1', 'recommended')
  })

  it('calls onRemoveTraining with the courseId for the right item', () => {
    const onRemoveTraining = vi.fn()
    render(
      <RoleProfileTrainingPanel
        training={FIXTURE_TRAINING}
        availableCourses={FIXTURE_COURSE_CATALOGUE}
        onRemoveTraining={onRemoveTraining}
      />
    )
    const row = screen.getByText('De-escalation fundamentals').closest('li')
    fireEvent.click(within(row).getByRole('button', { name: 'Remove' }))
    expect(onRemoveTraining).toHaveBeenCalledWith('course-1')
  })

  it('renders an inline error', () => {
    render(
      <RoleProfileTrainingPanel
        training={[]}
        availableCourses={FIXTURE_COURSE_CATALOGUE}
        error="Couldn't save that training."
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't save that training.")
  })
})
