import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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
const databaseMock = vi.hoisted(() => ({ employerRows: [], organisationRows: [] }))

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
      'menu.learningWorkspaces': 'Learning workspaces',
      'menu.administration': 'Administration',
      'menu.organisationConsole': 'Organisation console',
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
          order() { return Promise.resolve({ data: table === 'employers' ? databaseMock.employerRows : databaseMock.organisationRows, error: null }) },
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
  databaseMock.organisationRows = []
})

describe('AppHeader organisation branding', () => {
  it('uses the organisation foreground for the title and header controls', () => {
    render(
      <MemoryRouter initialEntries={['/organisations/leeds']}>
        <AppHeader
          hideNavLinks
          brandLogoUrl="https://example.com/logo.png"
          brandName="Leeds United"
          brandHomeHref="/organisations/leeds"
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
      <MemoryRouter initialEntries={['/organisation/learning?org=acme']}>
        <AppHeader hideNavLinks contextExitHref="/dashboard" />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    expect(screen.getByRole('navigation', { name: 'Switch workspace' })).toBeVisible()
    expect(screen.getByRole('group', { name: 'Learning workspaces' })).toBeVisible()
    expect(screen.queryByRole('group', { name: 'Administration' })).not.toBeInTheDocument()
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
    databaseMock.organisationRows = [
      { id: 'employer-1', name: 'Acme Stores', slug: 'acme', logo_url: null },
      { id: 'employer-2', name: 'Northwind', slug: 'northwind', logo_url: 'https://example.com/northwind.png' },
    ]

    render(
      <MemoryRouter initialEntries={['/organisation/learning?org=acme']}>
        <AppHeader hideNavLinks contextExitHref="/dashboard" />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    expect(await screen.findByRole('link', { name: 'Acme Stores' })).toHaveAttribute('href', '/organisations/acme')
    expect(screen.getByRole('link', { name: 'Acme Stores' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Northwind' })).toHaveAttribute('href', '/organisations/northwind')
    expect(screen.getByRole('link', { name: 'Personal LearnScope' })).not.toHaveAttribute('aria-current')
  })

  it('shows a learner workspace and one organisation console entry for its administration', async () => {
    authMock.value = {
      ...authMock.value,
      employerMemberships: [{ employer_id: 'employer-1', role: 'admin' }],
    }
    databaseMock.organisationRows = [
      { id: 'employer-1', name: 'Acme Stores', slug: 'acme', logo_url: null },
    ]

    render(
      <MemoryRouter initialEntries={['/organisation/learning?org=acme']}>
        <AppHeader hideNavLinks contextExitHref="/dashboard" />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    expect(await screen.findByRole('link', { name: 'Acme Stores' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Organisation console' })).toHaveAttribute('href', '/organisation')
  })

  it('separates learner-facing workspaces from organisation and platform administration', async () => {
    authMock.value = {
      ...authMock.value,
      isPlatformAdmin: true,
      organisationMemberships: [{ organisation_id: 'employer-1', role: 'admin' }],
      employerMemberships: [{ employer_id: 'employer-1', role: 'admin' }],
    }
    databaseMock.organisationRows = [{ id: 'employer-1', name: 'Acme Stores', slug: 'acme', logo_url: null }]

    render(
      <MemoryRouter initialEntries={['/organisation?org=employer-1']}>
        <AppHeader hideNavLinks />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    const learningWorkspaces = screen.getByRole('group', { name: 'Learning workspaces' })
    const administration = screen.getByRole('group', { name: 'Administration' })

    expect(within(learningWorkspaces).getByRole('link', { name: 'Personal LearnScope' })).toBeVisible()
    expect(await within(learningWorkspaces).findByRole('link', { name: 'Acme Stores' })).toBeVisible()
    expect(within(administration).getByRole('link', { name: 'Organisation console' })).toHaveAttribute('href', '/organisation')
    expect(within(administration).queryByRole('link', { name: 'Acme Stores' })).not.toBeInTheDocument()
    expect(within(administration).getByRole('link', { name: 'menu.platformConsole' })).toHaveAttribute('href', '/admin')
    expect(learningWorkspaces.compareDocumentPosition(administration) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText('Personal account')).not.toBeInTheDocument()
  })
})
