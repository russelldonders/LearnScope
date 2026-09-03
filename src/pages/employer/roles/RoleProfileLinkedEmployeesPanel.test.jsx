import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import RoleProfileLinkedEmployeesPanel from './RoleProfileLinkedEmployeesPanel'
import { FIXTURE_LINKED_EMPLOYEES } from './roleProfileFixtures'

afterEach(cleanup)

describe('RoleProfileLinkedEmployeesPanel', () => {
  it('lists each linked employee', () => {
    render(<RoleProfileLinkedEmployeesPanel employees={FIXTURE_LINKED_EMPLOYEES} />)
    expect(screen.getByText('Priya Natarajan')).toBeInTheDocument()
    expect(screen.getByText(/priya@acme.example/)).toBeInTheDocument()
  })

  it('shows an empty state when no employees are linked', () => {
    render(<RoleProfileLinkedEmployeesPanel employees={[]} />)
    expect(screen.getByText('No employees have linked to this role profile yet.')).toBeInTheDocument()
  })

  it('shows a loading state', () => {
    render(<RoleProfileLinkedEmployeesPanel employees={[]} loading />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(screen.queryByText('No employees have linked to this role profile yet.')).not.toBeInTheDocument()
  })

  it('renders no mutation controls -- this panel is read-only', () => {
    render(<RoleProfileLinkedEmployeesPanel employees={FIXTURE_LINKED_EMPLOYEES} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders an inline error', () => {
    render(<RoleProfileLinkedEmployeesPanel employees={[]} error="Couldn't load linked employees." />)
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load linked employees.")
  })
})
