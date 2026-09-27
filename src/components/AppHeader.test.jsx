import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AppHeader from './AppHeader'

const authMock = vi.hoisted(() => ({
  value: {
    signOut: vi.fn(),
    user: { id: 'user-1' },
    isPlatformAdmin: false,
    organisationMemberships: [],
    employerMemberships: [],
    managerContexts: [],
  },
}))
const databaseMock = vi.hoisted(() => ({ employerRows: [] }))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => authMock.value,
}))

vi.mock('../context/PendingActionsContext', () => ({
  usePendingActions: () => ({ pendingActionCount: 1 }),
}))

vi.mock('../context/NavVisibilityContext', () => ({
  useNavVisibility: () => ({ navVisibility: {} }),
}))

vi.mock('../context/LanguageContext', () => ({
  useLanguage: () => ({
    t: (key) => ({
      'nav.actions': 'Actions',
      'menu.switchWorkspace': 'Switch workspace',
      'menu.personalAccount': 'Personal account',
    })[key] ?? key,
  }),
}))

vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    from: (table) => table === 'profiles'
      ? {
          select() { return this },
          eq() { return this },
          single() { return Promise.resolve({ data: { avatar_url: null, full_name: null } }) },
        }
      : {
          select() { return this },
          in() { return this },
          order() { return Promise.resolve({ data: databaseMock.employerRows, error: null }) },
        },
  },
}))

afterEach(() => {
  cleanup()
  authMock.value = {
    signOut: vi.fn(),
    user: { id: 'user-1' },
    isPlatformAdmin: false,
    organisationMemberships: [],
    employerMemberships: [],
    managerContexts: [],
  }
  databaseMock.employerRows = []
})

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

  it('offers Personal LearnScope from a branded employer context', () => {
    render(
      <MemoryRouter initialEntries={['/employer/home?org=acme']}>
        <AppHeader hideNavLinks contextExitHref="/dashboard" />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    expect(screen.getByText('Switch workspace')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Personal LearnScope' })).toHaveAttribute('href', '/dashboard')
    expect(screen.queryByText('Personal account')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'menu.profile' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'menu.help' })).toBeVisible()
  })

  it('groups learner-owned destinations under Personal account only in the personal workspace', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <AppHeader />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    expect(screen.getByText('Personal account')).toBeVisible()
    expect(screen.getByRole('link', { name: 'menu.profile' })).toHaveAttribute('href', '/profile')
    expect(screen.getByRole('link', { name: 'menu.connectedApps' })).toHaveAttribute('href', '/profile/connected-accounts')
    expect(screen.getByRole('link', { name: 'menu.privacySettings' })).toHaveAttribute('href', '/profile/privacy')
    expect(screen.getByRole('link', { name: 'menu.importSkills' })).toHaveAttribute('href', '/profile/import')
    expect(screen.getByRole('link', { name: 'menu.help' })).toHaveAttribute('href', '/help')
  })

  it('lists every employer LMS and identifies the active workspace', async () => {
    authMock.value = {
      ...authMock.value,
      employerMemberships: [
        { employer_id: 'employer-1', role: 'member' },
        { employer_id: 'employer-2', role: 'member' },
      ],
    }
    databaseMock.employerRows = [
      { id: 'employer-1', name: 'Acme Stores', organisation: { slug: 'acme', logo_url: null } },
      { id: 'employer-2', name: 'Northwind', organisation: { slug: 'northwind', logo_url: 'https://example.com/northwind.png' } },
    ]

    render(
      <MemoryRouter initialEntries={['/employer/home?org=acme']}>
        <AppHeader hideNavLinks contextExitHref="/dashboard" />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    expect(await screen.findByRole('link', { name: 'Acme Stores' })).toHaveAttribute('href', '/providers/acme')
    expect(screen.getByRole('link', { name: 'Acme Stores' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Northwind' })).toHaveAttribute('href', '/providers/northwind')
    expect(screen.getByRole('link', { name: 'Personal LearnScope' })).not.toHaveAttribute('aria-current')
  })

  it('keeps the employer admin console distinct from the employer learner LMS', async () => {
    authMock.value = {
      ...authMock.value,
      employerMemberships: [{ employer_id: 'employer-1', role: 'admin' }],
    }
    databaseMock.employerRows = [
      { id: 'employer-1', name: 'Acme Stores', organisation: { slug: 'acme', logo_url: null } },
    ]

    render(
      <MemoryRouter initialEntries={['/employer/home?org=acme']}>
        <AppHeader hideNavLinks contextExitHref="/dashboard" />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    expect(await screen.findByRole('link', { name: 'Acme Stores' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'menu.employerConsole' })).toHaveAttribute('href', '/employer')
  })

  it('keeps role workspaces in the switcher and marks the active console', () => {
    authMock.value = {
      ...authMock.value,
      isPlatformAdmin: true,
      organisationMemberships: [{ organisation_id: 'org-1', role: 'admin' }],
    }

    render(
      <MemoryRouter initialEntries={['/provider']}>
        <AppHeader hideNavLinks />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    expect(screen.getByRole('link', { name: 'menu.providerConsole' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'menu.platformConsole' })).toHaveAttribute('href', '/admin')
    expect(screen.queryByText('Personal account')).not.toBeInTheDocument()
  })
})
