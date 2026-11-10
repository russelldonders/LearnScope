import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

let profile = {}
const update = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }))

vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    rpc: () => ({ select: () => ({ single: () => Promise.resolve({ data: profile }) }) }),
    from: () => ({ update }),
  },
}))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }))

const { default: ImportCvBanner } = await import('./ImportCvBanner')

afterEach(() => {
  cleanup()
  update.mockClear()
})

const renderBanner = () => render(<MemoryRouter><ImportCvBanner /></MemoryRouter>)

describe('CV import prompt on the Experience page', () => {
  it('shows until a CV is imported, and can be dismissed for good', async () => {
    profile = { cv_imported_at: null, cv_import_banner_dismissed_at: null }
    renderBanner()
    expect(await screen.findByRole('link', { name: 'Import now' })).toHaveAttribute('href', '/profile/import')
    fireEvent.click(screen.getByRole('button', { name: "Don't show this again" }))
    expect(screen.queryByRole('link', { name: 'Import now' })).not.toBeInTheDocument()
    expect(update).toHaveBeenCalledWith({ cv_import_banner_dismissed_at: expect.any(String) })
  })

  it('stays hidden once a CV has been imported or the prompt dismissed', async () => {
    for (const state of [{ cv_imported_at: '2026-01-01' }, { cv_import_banner_dismissed_at: '2026-01-01' }]) {
      profile = state
      renderBanner()
      await Promise.resolve()
      expect(screen.queryByText(/Have a CV/)).not.toBeInTheDocument()
      cleanup()
    }
  })
})
