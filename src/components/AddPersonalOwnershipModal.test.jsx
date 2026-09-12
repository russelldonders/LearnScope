import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AddPersonalOwnershipModal from './AddPersonalOwnershipModal'
import { claimPersonalAccountOwnership } from '../lib/accountOwnership'

const updateEmail = vi.fn()
const updatePassword = vi.fn()

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ updateEmail, updatePassword }),
}))

vi.mock('../lib/accountOwnership', () => ({
  claimPersonalAccountOwnership: vi.fn(),
}))

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  updateEmail.mockResolvedValue({ error: null })
  updatePassword.mockResolvedValue({ error: null })
  claimPersonalAccountOwnership.mockResolvedValue(undefined)
})

function fillForm({ email = 'me@personal.example', password = 'a-strong-password', confirm = password, acknowledge = true } = {}) {
  fireEvent.change(screen.getByLabelText('Personal email'), { target: { value: email } })
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: password } })
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: confirm } })
  if (acknowledge) {
    fireEvent.click(screen.getByLabelText('I understand this becomes my personal login for this account.'))
  }
}

describe('AddPersonalOwnershipModal', () => {
  it('requires the acknowledgement checkbox before submitting', () => {
    render(<AddPersonalOwnershipModal onClose={() => {}} onClaimed={() => {}} />)
    fillForm({ acknowledge: false })
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled()
  })

  it('rejects mismatched passwords without calling any update', async () => {
    render(<AddPersonalOwnershipModal onClose={() => {}} onClaimed={() => {}} />)
    fillForm({ password: 'a-strong-password', confirm: 'different-password' })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Passwords do not match.')
    expect(updateEmail).not.toHaveBeenCalled()
  })

  it('updates email then password then claims ownership, in order, on success', async () => {
    const onClaimed = vi.fn()
    render(<AddPersonalOwnershipModal onClose={() => {}} onClaimed={onClaimed} />)
    fillForm()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(onClaimed).toHaveBeenCalled())
    expect(updateEmail).toHaveBeenCalledWith('me@personal.example')
    expect(updatePassword).toHaveBeenCalledWith('a-strong-password')
    expect(claimPersonalAccountOwnership).toHaveBeenCalled()
  })

  it('stops and shows an error if the email update fails, without claiming ownership', async () => {
    updateEmail.mockResolvedValue({ error: { message: 'Email already in use.' } })
    render(<AddPersonalOwnershipModal onClose={() => {}} onClaimed={() => {}} />)
    fillForm()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Email already in use.')
    expect(updatePassword).not.toHaveBeenCalled()
    expect(claimPersonalAccountOwnership).not.toHaveBeenCalled()
  })
})
