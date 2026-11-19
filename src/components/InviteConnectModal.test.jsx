import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const lib = vi.hoisted(() => ({
  createConnectInvite: vi.fn(),
  getOrCreateConnectShareLink: vi.fn(),
  isDuplicatePendingConnectInviteError: vi.fn(),
  sendInviteEmail: vi.fn(),
  whatsappShareUrl: vi.fn(),
}))
vi.mock('../lib/connections', () => lib)
vi.mock('../lib/device', () => ({ isMobileDevice: () => false }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me', email: 'me@example.com' } }) }))
vi.mock('../context/LanguageContext', async () => {
  const { english } = await import('../lib/i18n/translations')
  const t = (key, params) => {
    const value = key.split('.').reduce((v, part) => v?.[part], english) ?? key
    return params ? value.replace(/\{(\w+)\}/g, (m, name) => (name in params ? params[name] : m)) : value
  }
  return { useLanguage: () => ({ language: 'en', setLanguage: vi.fn(), t }) }
})

const { default: InviteConnectModal } = await import('./InviteConnectModal')

const LINK = { id: 'link-1', share_code: 'link', invite_type: 'connect', url: 'https://app.example/connect/link' }

beforeEach(() => {
  lib.getOrCreateConnectShareLink.mockResolvedValue(LINK)
  lib.createConnectInvite.mockResolvedValue({ id: 'inv-1', share_code: 'abc', invite_type: 'connect', url: 'https://app.example/connect/abc' })
  lib.sendInviteEmail.mockResolvedValue()
  lib.isDuplicatePendingConnectInviteError.mockReturnValue(false)
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function send(address) {
  fireEvent.change(screen.getByLabelText('Invite by email'), { target: { value: address } })
  fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }))
}

describe('InviteConnectModal', () => {
  it('emails an invitation to connect and hands it to the invites list', async () => {
    const onSent = vi.fn()
    render(<InviteConnectModal onClose={vi.fn()} onSent={onSent} />)
    send('friend@example.com')
    expect(await screen.findByText('Invitation sent to friend@example.com')).toBeInTheDocument()
    expect(lib.createConnectInvite).toHaveBeenCalledWith('friend@example.com', 'me')
    expect(lib.sendInviteEmail).toHaveBeenCalledWith({ toEmail: 'friend@example.com', shareUrl: 'https://app.example/connect/abc', emailType: 'connect' })
    expect(onSent).toHaveBeenCalledWith(expect.objectContaining({ id: 'inv-1', invitee_email: 'friend@example.com', status: 'pending' }))
  })

  it('offers a link to share', async () => {
    render(<InviteConnectModal onClose={vi.fn()} />)
    expect(await screen.findByDisplayValue(LINK.url)).toBeInTheDocument()
    expect(lib.getOrCreateConnectShareLink).toHaveBeenCalledWith('me')
  })

  it('checks the address before sending anything', async () => {
    render(<InviteConnectModal onClose={vi.fn()} />)
    send('not-an-email')
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid email address.')
    send('ME@example.com')
    expect(await screen.findByRole('alert')).toHaveTextContent('That’s your own email address.')
    expect(lib.createConnectInvite).not.toHaveBeenCalled()
  })

  it('says when that person already has an invitation waiting', async () => {
    lib.createConnectInvite.mockRejectedValue({ code: '23505' })
    lib.isDuplicatePendingConnectInviteError.mockReturnValue(true)
    render(<InviteConnectModal onClose={vi.fn()} />)
    send('friend@example.com')
    expect(await screen.findByRole('alert')).toHaveTextContent('You already have an invitation waiting with friend@example.com.')
  })

  it('keeps an invitation whose email failed, so it can be resent', async () => {
    const onSent = vi.fn()
    lib.sendInviteEmail.mockRejectedValue(new Error('Failed to send email.'))
    render(<InviteConnectModal onClose={vi.fn()} onSent={onSent} />)
    send('friend@example.com')
    expect(await screen.findByRole('alert')).toHaveTextContent(/didn’t send|didn't send/)
    await waitFor(() => expect(onSent).toHaveBeenCalled())
  })
})
