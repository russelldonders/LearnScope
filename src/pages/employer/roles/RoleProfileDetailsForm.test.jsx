import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RoleProfileDetailsForm from './RoleProfileDetailsForm'

afterEach(cleanup)

describe('RoleProfileDetailsForm', () => {
  it('starts blank and titled "New role profile" when creating', () => {
    render(<RoleProfileDetailsForm />)
    expect(screen.getByText('New role profile')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('')
  })

  it('pre-fills from roleProfile and titles "Edit role profile" when editing', () => {
    render(<RoleProfileDetailsForm roleProfile={{ name: 'Senior Support Engineer', description: 'Handles escalations.' }} />)
    expect(screen.getByText('Edit role profile')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('Senior Support Engineer')
    expect(screen.getByLabelText('Description')).toHaveValue('Handles escalations.')
  })

  it('calls onSave with trimmed name and description', () => {
    const onSave = vi.fn()
    render(<RoleProfileDetailsForm onSave={onSave} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Field Lead  ' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: '  Owns field ops.  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith({ name: 'Field Lead', description: 'Owns field ops.' })
  })

  it('does not call onSave when the name is blank', () => {
    const onSave = vi.fn()
    render(<RoleProfileDetailsForm onSave={onSave} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('disables inputs and shows "Saving…" while saving', () => {
    render(<RoleProfileDetailsForm roleProfile={{ name: 'X', description: '' }} saving />)
    expect(screen.getByLabelText('Name')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
  })

  it('renders an inline error', () => {
    render(<RoleProfileDetailsForm error="That name is already used." />)
    expect(screen.getByRole('alert')).toHaveTextContent('That name is already used.')
  })

  it('only shows Cancel when onCancel is provided', () => {
    const { rerender } = render(<RoleProfileDetailsForm />)
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    rerender(<RoleProfileDetailsForm onCancel={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })
})
