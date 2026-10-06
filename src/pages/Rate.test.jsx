import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Rate from './Rate'

const previewMock = vi.hoisted(() => vi.fn())

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: null, loading: false }) }))
vi.mock('../context/PendingActionsContext', () => ({
  usePendingActions: () => ({ refreshPendingActionCount: vi.fn() }),
}))
vi.mock('../context/LanguageContext', async () => {
  const { english } = await import('../lib/i18n/translations')
  const resolve = (key) => key.split('.').reduce((value, part) => value?.[part], english) ?? key
  const t = (key, params) =>
    String(resolve(key)).replace(/\{(\w+)\}/g, (match, name) => (params && name in params ? params[name] : match))
  return { useLanguage: () => ({ language: 'en', t }) }
})
vi.mock('../lib/connections', () => ({
  getInvitePreview: previewMock,
  acceptInviteAndRate: vi.fn(),
  declineInvite: vi.fn(),
  setPendingInviteCode: vi.fn(),
  clearPendingInviteCode: vi.fn(),
}))

afterEach(cleanup)
beforeEach(() => previewMock.mockReset())

function renderRate() {
  return render(
    <MemoryRouter initialEntries={['/rate/abc']}>
      <Routes>
        <Route path="/rate/:code" element={<Rate />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('Rate', () => {
  it('fills the inviter name into the translated request', async () => {
    previewMock.mockResolvedValue({
      invite_type: 'rate',
      status: 'pending',
      inviter_name: 'Sam',
      skill_name: 'Facilitation',
      skill_category: null,
    })
    renderRate()
    expect(await screen.findByText(/Sam wants your rating on their skill:/)).toBeInTheDocument()
    expect(screen.getByText('Facilitation')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Log in to rate' })).toBeInTheDocument()
  })

  it('falls back to "Someone" when the inviter has no name', async () => {
    previewMock.mockResolvedValue({ invite_type: 'rate', status: 'pending', inviter_name: null, skill_name: 'X' })
    renderRate()
    expect(await screen.findByText(/Someone wants your rating/)).toBeInTheDocument()
  })

  it('shows the not-found message for an unknown code', async () => {
    previewMock.mockResolvedValue(null)
    renderRate()
    expect(await screen.findByText("This invite link doesn't exist.")).toBeInTheDocument()
  })
})
