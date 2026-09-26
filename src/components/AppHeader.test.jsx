import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AppHeader from './AppHeader'

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    signOut: vi.fn(),
    user: { id: 'user-1' },
    isPlatformAdmin: false,
    organisationMemberships: [],
    employerMemberships: [],
    managerContexts: [],
  }),
}))

vi.mock('../context/PendingActionsContext', () => ({
  usePendingActions: () => ({ pendingActionCount: 1 }),
}))

vi.mock('../context/NavVisibilityContext', () => ({
  useNavVisibility: () => ({ navVisibility: {} }),
}))

vi.mock('../context/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key === 'nav.actions' ? 'Actions' : key }),
}))

vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    from: () => ({
      select() { return this },
      eq() { return this },
      single() { return Promise.resolve({ data: { avatar_url: null, full_name: null } }) },
    }),
  },
}))

afterEach(cleanup)

describe('AppHeader organisation branding', () => {
  it('uses the organisation foreground for the title and header controls', () => {
    render(
      <MemoryRouter initialEntries={['/providers/leeds']}>
        <AppHeader
          hideNavLinks
          brandLogoUrl="https://example.com/logo.png"
          brandName="Leeds United"
          brandHomeHref="/providers/leeds"
        />
      </MemoryRouter>,
    )

    const organisationTextClass = 'text-[var(--org-text,var(--color-ink))]'
    expect(screen.getByRole('link', { name: 'Leeds United' }).className).toContain(organisationTextClass)
    expect(screen.getByRole('link', { name: 'Actions, 1 pending' }).className).toContain(organisationTextClass)
    expect(screen.getByRole('button', { name: 'Account menu' }).firstElementChild.className)
      .toContain(organisationTextClass)
    expect(screen.getByText('1').className)
      .toContain('text-[var(--org-primary-contrast,var(--color-paper))]')
  })
})
