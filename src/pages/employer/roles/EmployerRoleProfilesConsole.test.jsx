import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import EmployerRoleProfilesConsole from './EmployerRoleProfilesConsole'

afterEach(cleanup)

describe('EmployerRoleProfilesConsole', () => {
  it('selecting a role profile shows its skills, training and linked employees', () => {
    render(<EmployerRoleProfilesConsole />)
    fireEvent.click(screen.getByText('Senior Support Engineer'))
    expect(screen.getByText('Required skills')).toBeInTheDocument()
    expect(screen.getByText('Facilitation')).toBeInTheDocument()
    expect(screen.getByText('Training')).toBeInTheDocument()
    expect(screen.getByText('De-escalation fundamentals')).toBeInTheDocument()
    expect(screen.getByText('Linked employees')).toBeInTheDocument()
    expect(screen.getByText('Priya Natarajan')).toBeInTheDocument()
  })

  it('creating a role profile adds it to the list and selects it', () => {
    render(<EmployerRoleProfilesConsole />)
    fireEvent.click(screen.getByRole('button', { name: 'New role profile' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Onboarding Specialist' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Guides new hires.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getAllByText('Onboarding Specialist').length).toBeGreaterThan(0)
    // A brand-new role profile starts with no required skills yet.
    expect(screen.getByText('No required skills yet.')).toBeInTheDocument()
  })

  it('adding a required skill updates both the skills panel and the list summary count', () => {
    render(<EmployerRoleProfilesConsole />)
    fireEvent.click(screen.getByText('Field Operations Lead'))
    expect(screen.getByText('No required skills yet.')).toBeInTheDocument()

    const skillsPanel = screen.getByText('Required skills').closest('div')
    fireEvent.change(within(skillsPanel).getByLabelText('Add a skill'), { target: { value: 'skill-3' } })
    fireEvent.click(within(skillsPanel).getByRole('button', { name: 'Add' }))

    expect(screen.getByText('Data storytelling')).toBeInTheDocument()
    expect(screen.getByText(/1 skill · 0 training items · 0 employees linked/)).toBeInTheDocument()
  })

  it('removing a required skill updates the list summary count', () => {
    render(<EmployerRoleProfilesConsole />)
    fireEvent.click(screen.getByText('Senior Support Engineer'))
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0])
    expect(screen.getByText(/2 skills · 2 training items · 2 employees linked/)).toBeInTheDocument()
  })
})
