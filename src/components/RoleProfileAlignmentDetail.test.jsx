import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RoleProfileAlignmentDetail from './RoleProfileAlignmentDetail'

afterEach(cleanup)

const aligned = [{ skillId: 'skill-1', name: 'Facilitation', targetLevel: 3, learnerLevel: 4 }]
const gaps = [{ skillId: 'skill-2', name: 'Incident response', targetLevel: 4, learnerLevel: null }]
const training = [
  { courseId: 'course-1', title: 'De-escalation fundamentals', completed: true },
  { courseId: 'course-2', title: 'Advanced troubleshooting', completed: false },
]

function renderDetail(props = {}) {
  return render(
    <RoleProfileAlignmentDetail
      employerName="Acme Corp"
      roleProfileName="Senior Support Engineer"
      aligned={aligned}
      gaps={gaps}
      training={training}
      {...props}
    />
  )
}

describe('RoleProfileAlignmentDetail', () => {
  it('shows a badge naming the employer and role profile, plus a collapsed summary', () => {
    renderDetail()
    expect(screen.getByText("Linked to Acme Corp's Senior Support Engineer role profile")).toBeInTheDocument()
    expect(screen.getByText('1/2 skills met · 1/2 training complete')).toBeInTheDocument()
  })

  it('expands to show aligned/gaps/training detail and a disconnect action', () => {
    renderDetail()
    fireEvent.click(screen.getByText('1/2 skills met · 1/2 training complete'))
    expect(screen.getByText(/Facilitation -- at/)).toBeInTheDocument()
    expect(screen.getByText(/Incident response -- requires/)).toBeInTheDocument()
    expect(screen.getByText(/De-escalation fundamentals/)).toHaveTextContent('(Completed)')
    expect(screen.getByText(/Advanced troubleshooting/)).toHaveTextContent('(Not completed)')
    expect(screen.getByRole('button', { name: 'Disconnect role profile' })).toBeInTheDocument()
  })

  it('never lets a click reach an ancestor click handler (TimelineItem\'s own card is one big button)', () => {
    const onCardClick = vi.fn()
    render(
      <div onClick={onCardClick}>
        <RoleProfileAlignmentDetail
          employerName="Acme Corp"
          roleProfileName="Senior Support Engineer"
          aligned={aligned}
          gaps={gaps}
          training={training}
        />
      </div>
    )
    fireEvent.click(screen.getByText('1/2 skills met · 1/2 training complete'))
    expect(onCardClick).not.toHaveBeenCalled()
  })

  it('confirms before disconnecting, and calls onDisconnect with no arguments', () => {
    const onDisconnect = vi.fn()
    renderDetail({ onDisconnect })
    fireEvent.click(screen.getByText('1/2 skills met · 1/2 training complete'))
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect role profile' }))
    expect(screen.getByText(/This experience entry stays exactly as it is/)).toBeInTheDocument()
    const confirmButtons = screen.getAllByRole('button', { name: 'Disconnect' })
    fireEvent.click(confirmButtons[confirmButtons.length - 1])
    expect(onDisconnect).toHaveBeenCalledWith()
  })
})
