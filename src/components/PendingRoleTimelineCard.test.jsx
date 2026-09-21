import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PendingRoleTimelineCard from './PendingRoleTimelineCard'
import { LanguageProvider } from '../context/LanguageContext'

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}))

afterEach(cleanup)

const assignment = {
  assignmentId: 'assignment-2',
  employerName: 'Acme Corp',
  roleProfile: { name: 'Field Operations Lead', description: 'Coordinates on-site teams.' },
  proposedAt: '2026-08-20',
}
const currentRoles = [{ id: 'experience-1', title: 'Senior Support Engineer', organization: 'Acme Corp' }]

function renderCard(props = {}) {
  return render(
    <LanguageProvider>
      <PendingRoleTimelineCard assignment={assignment} {...props} />
    </LanguageProvider>
  )
}

describe('PendingRoleTimelineCard', () => {
  it('shows the proposing employer and role profile', () => {
    renderCard()
    expect(screen.getByText(/Acme Corp/)).toBeInTheDocument()
    expect(screen.getByText('Field Operations Lead')).toBeInTheDocument()
  })

  it('with no current roles, shows no picker and accepts with no target', () => {
    const onAccept = vi.fn()
    renderCard({ onAccept })
    expect(screen.queryByLabelText('Link to')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    expect(onAccept).toHaveBeenCalledWith('assignment-2', undefined)
  })

  it('with a current role available, defaults to creating a new one but lets the learner pick it instead', () => {
    const onAccept = vi.fn()
    renderCard({ currentRoles, onAccept })
    expect(screen.getByRole('button', { name: 'Accept' })).not.toBeDisabled()
    fireEvent.change(screen.getByLabelText('Link to'), { target: { value: 'experience-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    expect(onAccept).toHaveBeenCalledWith('assignment-2', 'experience-1')
  })

  it('calls onDecline with the assignmentId', () => {
    const onDecline = vi.fn()
    renderCard({ onDecline })
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }))
    expect(onDecline).toHaveBeenCalledWith('assignment-2')
  })

  it('disables both actions while responding', () => {
    renderCard({ responding: true })
    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Decline' })).toBeDisabled()
  })
})
