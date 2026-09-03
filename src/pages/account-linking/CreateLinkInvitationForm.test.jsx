import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CreateLinkInvitationForm from './CreateLinkInvitationForm'

afterEach(cleanup)

describe('CreateLinkInvitationForm', () => {
  it('states that verifying does not merge profiles, move records, or auto-share information', () => {
    render(<CreateLinkInvitationForm />)
    const disclaimer = screen.getByText(/doesn't merge your profiles/)
    expect(disclaimer).toHaveTextContent('move any records between the accounts')
    expect(disclaimer).toHaveTextContent('automatically')
    expect(disclaimer).toHaveTextContent('share employer or private information')
  })

  it('calls onCreateInvitation with the trimmed email', () => {
    const onCreateInvitation = vi.fn()
    render(<CreateLinkInvitationForm onCreateInvitation={onCreateInvitation} />)
    fireEvent.change(screen.getByLabelText('Email address of the other account'), {
      target: { value: '  me.work@example.com  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create link invitation' }))
    expect(onCreateInvitation).toHaveBeenCalledWith('me.work@example.com')
  })

  it('does not call onCreateInvitation for a blank email', () => {
    const onCreateInvitation = vi.fn()
    render(<CreateLinkInvitationForm onCreateInvitation={onCreateInvitation} />)
    expect(screen.getByRole('button', { name: 'Create link invitation' })).toBeDisabled()
  })

  it('disables the input and button, and shows pending text, while creating', () => {
    render(<CreateLinkInvitationForm creating />)
    expect(screen.getByLabelText('Email address of the other account')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Creating invitation…' })).toBeDisabled()
  })

  it('renders an inline error', () => {
    render(<CreateLinkInvitationForm error="That email already has a pending invitation." />)
    expect(screen.getByRole('alert')).toHaveTextContent('That email already has a pending invitation.')
  })
})
