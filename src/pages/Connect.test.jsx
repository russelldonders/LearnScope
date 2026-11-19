import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const lib = vi.hoisted(() => ({ getConnectInvitePreview: vi.fn(), acceptConnectInvite: vi.fn() }))
const auth = vi.hoisted(() => ({ user: null }))
vi.mock('../lib/connections', async (importOriginal) => ({ ...(await importOriginal()), ...lib }))
vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: auth.user, loading: false }) }))
vi.mock('../context/LanguageContext', async () => {
  const { english } = await import('../lib/i18n/translations')
  const t = (key, params) => {
    const value = key.split('.').reduce((v, part) => v?.[part], english) ?? key
    return params ? value.replace(/\{(\w+)\}/g, (m, name) => (name in params ? params[name] : m)) : value
  }
  return { useLanguage: () => ({ language: 'en', setLanguage: vi.fn(), t }) }
})

const { default: Connect } = await import('./Connect')
const { getPendingInviteCode, pendingInvitePath } = await import('../lib/connections')

const pending = { inviter_name: 'Ada Owner', inviter_avatar_url: null, status: 'pending' }

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/connect/abc123']}>
      <Routes>
        <Route path="/connect/:code" element={<Connect />} />
        <Route path="/skills-profile/:userId" element={<p>Their profile</p>} />
        <Route path="/signup" element={<p>Sign up page</p>} />
        <Route path="/login" element={<p>Log in page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  auth.user = null
  localStorage.clear()
  lib.getConnectInvitePreview.mockResolvedValue(pending)
  lib.acceptConnectInvite.mockResolvedValue('ada')
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Connect', () => {
  it('shows a signed-out visitor who invited them and sends them to sign up, then back here', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Ada Owner would like to connect' })).toBeInTheDocument()
    expect(screen.getByText(/Either of you can disconnect at any time/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sign up to connect' }))
    expect(await screen.findByText('Sign up page')).toBeInTheDocument()
    expect(pendingInvitePath(getPendingInviteCode())).toBe('/connect/abc123')
  })

  it('connects a signed-in visitor only when they choose to, then opens the inviter’s profile', async () => {
    auth.user = { id: 'me' }
    renderPage()
    const accept = await screen.findByRole('button', { name: 'Connect with Ada Owner' })
    expect(lib.acceptConnectInvite).not.toHaveBeenCalled()
    fireEvent.click(accept)
    await waitFor(() => expect(lib.acceptConnectInvite).toHaveBeenCalledWith('abc123'))
    expect(await screen.findByText('Their profile')).toBeInTheDocument()
  })

  it('shows why connecting failed', async () => {
    auth.user = { id: 'me' }
    lib.acceptConnectInvite.mockRejectedValue(new Error('This invite has already been used.'))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Connect with Ada Owner' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('already been used')
  })

  it('explains an invitation that can’t be accepted', async () => {
    const cases = [
      ['used', 'This invitation has already been used.'],
      ['revoked', 'This invitation was withdrawn.'],
      ['expired', 'This invitation link has expired. Ask Ada Owner for a new one.'],
      ['connected', 'You’re already connected with Ada Owner.'],
      ['own_invite', /This is your own invitation/],
    ]
    for (const [status, text] of cases) {
      lib.getConnectInvitePreview.mockResolvedValue({ ...pending, status })
      renderPage()
      expect(await screen.findByText(text)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Connect with|Sign up to connect/ })).not.toBeInTheDocument()
      cleanup()
    }
  })

  it('says when the link is not valid', async () => {
    lib.getConnectInvitePreview.mockResolvedValue(null)
    renderPage()
    expect(await screen.findByText('This invitation link isn’t valid.')).toBeInTheDocument()
  })
})

describe('pendingInvitePath', () => {
  it('sends a connect invitation code back to the connect page', () => {
    expect(pendingInvitePath('connect:abc')).toBe('/connect/abc')
    expect(pendingInvitePath('plan:abc')).toBe('/plan-invite/abc')
    expect(pendingInvitePath('abc')).toBe('/rate/abc')
  })
})
