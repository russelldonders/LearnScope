import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { usePendingActions } from '../context/PendingActionsContext'
import { useNavVisibility } from '../context/NavVisibilityContext'
import { useLanguage } from '../context/LanguageContext'
import { supabase } from '../lib/supabaseClient'
import NotificationDrawer from './NotificationDrawer'
import { loadHeaderCache, peekHeaderCache } from '../lib/headerCache'

// label is a translation key (LanguageContext) rather than literal text --
// resolved per-item below so this nav/menu stays in one place regardless of
// which language is active.
const NAV_LINKS = [
  { to: '/dashboard', label: 'nav.home' },
  { to: '/skills', label: 'nav.skills', requires: 'hasSkills' },
  { to: '/experience', label: 'nav.experience' },
  { to: '/learning', label: 'nav.learning', requires: 'hasCourses' },
  { to: '/team', label: 'nav.team', requires: 'managerContexts' },
]

const PERSONAL_MENU_ITEMS = [
  { to: '/profile', label: 'menu.profile' },
  { to: '/connections', label: 'menu.connections', requires: 'hasConnectionsActivity' },
  { to: '/profile/connected-accounts', label: 'menu.connectedApps' },
  { to: '/profile/privacy', label: 'menu.privacySettings' },
  { to: '/profile/import', label: 'menu.importSkills' },
]

// brandLogoUrl/brandName/brandHomeHref let a page whitelabel this header for
// an organisation's own branded context (currently only ProviderProfile.jsx,
// for a logged-in visitor viewing an org's public page via its own link).
// brandHomeHref defaults to /dashboard (this learner's own account) so every
// other page continues to behave exactly as before by omitting these props;
// ProviderProfile.jsx overrides it to the org's own page so clicking its
// logo stays on/returns to that page instead of jumping to the visitor's
// personal dashboard.
export default function AppHeader({
  hideNavLinks = false,
  brandLogoUrl,
  brandName,
  brandHomeHref = '/dashboard',
  contextExitHref,
  notificationsHref = '/actions',
}) {
  const { signOut, user, isPlatformAdmin, organisationMemberships, employerMemberships, managerContexts } = useAuth()
  const userId = user?.id ?? null
  const {
    pendingActionCount,
    pendingActionItems = [],
    pendingActionsLoading = false,
    pendingActionsError = null,
    refreshPendingActionCount,
  } = usePendingActions()
  const { navVisibility } = useNavVisibility()
  const { t } = useLanguage()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const menuRef = useRef(null)
  const employerIdsKey = [...new Set((employerMemberships ?? []).map((membership) => membership.employer_id))]
    .sort()
    .join(',')
  const organisationIdsKey = [...new Set((organisationMemberships ?? []).map((membership) => membership.organisation_id))]
    .sort()
    .join(',')
  const portalIdsKey = [...new Set([
    ...(organisationIdsKey ? organisationIdsKey.split(',') : []),
    ...(employerIdsKey ? employerIdsKey.split(',') : []),
  ])].sort().join(',')
  // Cached across page navigations (see headerCache.js), so a header that
  // mounts on the next page starts with these already filled in.
  const identityCacheKey = userId ? `identity:${userId}` : null
  const portalsCacheKey = `portals:${portalIdsKey}`
  const [identity, setIdentity] = useState(() => (identityCacheKey && peekHeaderCache(identityCacheKey)) ?? null)
  const cachedPortals = portalIdsKey ? peekHeaderCache(portalsCacheKey) : []
  const [organisationPortals, setOrganisationPortals] = useState(() => cachedPortals ?? [])
  const [employerPortalsLoading, setEmployerPortalsLoading] = useState(() => cachedPortals === undefined)
  const avatarUrl = identity?.avatar_url ?? null
  const fullName = identity?.full_name ?? null

  useEffect(() => {
    if (!identityCacheKey) return
    let cancelled = false
    loadHeaderCache(identityCacheKey, async () => {
      const { data, error } = await supabase.from('profiles').select('avatar_url, full_name').eq('id', userId).single()
      if (error) throw error
      return data
    })
      .then((data) => { if (!cancelled) setIdentity(data) })
      .catch(() => { if (!cancelled) setIdentity(null) })
    return () => { cancelled = true }
  }, [identityCacheKey, userId])

  useEffect(() => {
    if (!portalIdsKey) {
      setOrganisationPortals([])
      setEmployerPortalsLoading(false)
      return
    }

    let cancelled = false
    loadHeaderCache(portalsCacheKey, async () => {
      const { data, error } = await supabase
        .from('organisations')
        .select('id, name, slug, logo_url')
        .in('id', portalIdsKey.split(','))
        .order('name')
      if (error) throw error
      return data ?? []
    })
      .then((data) => { if (!cancelled) setOrganisationPortals(data) })
      .catch(() => { if (!cancelled) setOrganisationPortals([]) })
      .finally(() => { if (!cancelled) setEmployerPortalsLoading(false) })
    return () => { cancelled = true }
  }, [portalIdsKey, portalsCacheKey])

  const visibleNavLinks = NAV_LINKS.filter((link) => {
    if (link.requires === 'managerContexts') return managerContexts?.length > 0
    return !link.requires || navVisibility[link.requires]
  })
  const visiblePersonalMenuItems = PERSONAL_MENU_ITEMS.filter((item) => !item.requires || navVisibility[item.requires])
  const activeEmployerSlug = location.pathname === '/organisation/learning'
    ? new URLSearchParams(location.search).get('org')
    : null
  const isPersonalWorkspace = !activeEmployerSlug
    && !location.pathname.startsWith('/admin')
    && !location.pathname.startsWith('/organisation')
  const inPlatformConsole = location.pathname.startsWith('/admin')
  const hasEmployerAdminWorkspace = employerMemberships?.some((membership) => membership.role === 'admin') ?? false
  const hasAdminWorkspaces = Boolean(organisationMemberships?.length || hasEmployerAdminWorkspace || isPlatformAdmin)
  const employerIds = new Set((employerMemberships ?? []).map((membership) => membership.employer_id))
  const employerPortals = organisationPortals
    .filter((organisation) => employerIds.has(organisation.id) && organisation.slug)
    .map((organisation) => ({ ...organisation, organisation }))

  useEffect(() => {
    if (!menuOpen) return
    function handleOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    function handleEscape(e) {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [menuOpen])

  // bg-[var(--org-background,var(--color-card))]: --org-background is only
  // ever set (as an inline custom property on an ancestor) by
  // ProviderProfile.jsx when this header is rendered for a branded org's
  // public page -- everywhere else in the app nothing sets that variable,
  // so this resolves to the same --color-card as the plain bg-card class
  // it replaces.
  return (
    <header className="border-b border-hairline bg-[var(--org-background,var(--color-card))]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-ink focus:px-4 focus:py-2 focus:text-paper"
      >
        {t('header.skipToMain')}
      </a>
      <div className="max-w-4xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <Link to={brandHomeHref} className="flex items-center gap-2 font-display text-2xl text-[var(--org-text,var(--color-ink))] shrink-0">
            <img src={brandLogoUrl || '/favicon.svg'} alt="" className="w-7 h-7 object-contain rounded" />
            {brandName || 'LearnScope'}
          </Link>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false)
                setNotificationsOpen(true)
                refreshPendingActionCount?.()
              }}
              aria-label={pendingActionCount > 0 ? `${t('nav.actions')}, ${pendingActionCount} pending` : t('nav.actions')}
              aria-expanded={notificationsOpen}
              aria-controls="notification-drawer"
              className={`relative flex size-11 items-center justify-center rounded-full border shrink-0 ${
                notificationsOpen || location.pathname === '/actions'
                  ? 'border-[var(--org-primary,var(--color-moss))] text-[var(--org-text,var(--color-ink))]'
                  : 'border-hairline text-[var(--org-text,var(--color-ink))] hover:bg-[color-mix(in_srgb,currentColor_8%,transparent)]'
              }`}
            >
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {pendingActionCount > 0 && (
                <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-[var(--org-primary,var(--color-moss))] text-[var(--org-primary-contrast,var(--color-paper))] text-xs font-medium">
                  {pendingActionCount}
                </span>
              )}
            </button>
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                aria-label="Account menu"
                aria-expanded={menuOpen}
                aria-haspopup="true"
                className="flex items-center gap-2"
              >
                <span
                  className={`flex items-center justify-center w-9 h-9 rounded-full border shrink-0 overflow-hidden ${
                    location.pathname.startsWith('/profile') || location.pathname.startsWith('/connections')
                      ? 'border-[var(--org-primary,var(--color-moss))] text-[var(--org-text,var(--color-ink))]'
                      : 'border-hairline text-[var(--org-text,var(--color-ink))] hover:bg-[color-mix(in_srgb,currentColor_8%,transparent)]'
                  }`}
                >
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="8" r="4" />
                      <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" />
                    </svg>
                  )}
                </span>
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-full z-10 mt-2 max-h-[min(42rem,calc(100vh-5rem))] w-[min(18rem,calc(100vw-2rem))] overflow-y-auto rounded-md border border-hairline bg-[var(--org-background,var(--color-card))] py-1 shadow-lg">
                  {(fullName || user?.email) && (
                    <div className="border-b border-hairline px-4 py-2.5">
                      {fullName && <p className="truncate text-sm font-medium text-[var(--org-text,var(--color-ink))]">{fullName}</p>}
                      {user?.email && <p className="truncate text-xs text-secondary">{user.email}</p>}
                    </div>
                  )}
                  <nav aria-label={t('menu.switchWorkspace')}>
                    <div role="group" aria-labelledby="learning-workspaces-label" className="border-b border-hairline py-2">
                      <p id="learning-workspaces-label" className="px-4 pb-1.5 text-xs font-medium text-secondary">{t('menu.learningWorkspaces')}</p>
                      <Link
                        to={contextExitHref || '/dashboard'}
                        onClick={() => setMenuOpen(false)}
                        aria-current={isPersonalWorkspace ? 'page' : undefined}
                        className="flex items-center gap-3 px-4 py-2 text-sm text-[var(--org-text,var(--color-ink))] hover:bg-[color-mix(in_srgb,currentColor_8%,transparent)]"
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md border border-hairline bg-paper">
                          <img src="/favicon.svg" alt="" className="h-5 w-5 object-contain" />
                        </span>
                        <span className="min-w-0 flex-1 font-medium">Personal LearnScope</span>
                        {isPersonalWorkspace && (
                          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="m5 12 4 4L19 6" />
                          </svg>
                        )}
                      </Link>
                      {employerPortals.map((employer) => {
                        const isActive = activeEmployerSlug === employer.organisation.slug
                        return (
                          <Link
                            key={employer.id}
                            to={`/organisations/${encodeURIComponent(employer.organisation.slug)}`}
                            onClick={() => setMenuOpen(false)}
                            aria-current={isActive ? 'page' : undefined}
                            className="flex items-center gap-3 px-4 py-2 text-sm text-[var(--org-text,var(--color-ink))] hover:bg-[color-mix(in_srgb,currentColor_8%,transparent)]"
                          >
                            <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md border border-hairline bg-paper text-xs font-medium text-ink">
                              {employer.organisation.logo_url
                                ? <img src={employer.organisation.logo_url} alt="" className="h-full w-full object-contain" />
                                : employer.name.trim().charAt(0).toUpperCase()}
                            </span>
                            <span className="min-w-0 flex-1 truncate font-medium">{employer.name}</span>
                            {isActive && (
                              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="m5 12 4 4L19 6" />
                              </svg>
                            )}
                          </Link>
                        )
                      })}
                      {employerPortalsLoading && <p role="status" className="px-4 py-2 text-xs text-secondary">Loading employer workspaces…</p>}
                    </div>
                    {hasAdminWorkspaces && (
                      <div role="group" aria-labelledby="admin-workspaces-label" className="border-b border-hairline py-2">
                        <p id="admin-workspaces-label" className="px-4 pb-1.5 text-xs font-medium text-secondary">{t('menu.administration')}</p>
                        {(organisationMemberships?.length || hasEmployerAdminWorkspace) && (
                          <Link
                            to="/organisation"
                            onClick={() => setMenuOpen(false)}
                            aria-current={location.pathname === '/organisation' ? 'page' : undefined}
                            className="flex items-center gap-3 px-4 py-2 text-sm text-[var(--org-text,var(--color-ink))] hover:bg-[color-mix(in_srgb,currentColor_8%,transparent)]"
                          >
                            <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-hairline bg-paper text-ink">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M3 21h18M5 21V7l7-4 7 4v14M9 10h1m4 0h1M9 14h1m4 0h1M9 18h1m4 0h1" />
                              </svg>
                            </span>
                            <span className="min-w-0 flex-1 font-medium">{t('menu.organisationConsole')}</span>
                            {location.pathname === '/organisation' && (
                              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="m5 12 4 4L19 6" />
                              </svg>
                            )}
                          </Link>
                        )}
                        {isPlatformAdmin && (
                          <Link
                            to="/admin"
                            onClick={() => setMenuOpen(false)}
                            aria-current={inPlatformConsole ? 'page' : undefined}
                            className="flex items-center gap-3 px-4 py-2 text-sm text-[var(--org-text,var(--color-ink))] hover:bg-[color-mix(in_srgb,currentColor_8%,transparent)]"
                          >
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-hairline bg-paper">
                              <img src="/favicon.svg" alt="" className="h-5 w-5 object-contain" />
                            </span>
                            <span className="min-w-0 flex-1 font-medium">{t('menu.platformConsole')}</span>
                            {inPlatformConsole && (
                              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="m5 12 4 4L19 6" />
                              </svg>
                            )}
                          </Link>
                        )}
                      </div>
                    )}
                  </nav>
                  {isPersonalWorkspace && (
                    <div className="border-b border-hairline py-2">
                      <p className="px-4 pb-1.5 text-xs font-medium text-secondary">{t('menu.personalAccount')}</p>
                      {visiblePersonalMenuItems.map((item) => (
                        <Link
                          key={item.to}
                          to={item.to}
                          onClick={() => setMenuOpen(false)}
                          className="block px-4 py-2 text-sm text-[var(--org-text,var(--color-ink))] hover:bg-[color-mix(in_srgb,currentColor_8%,transparent)]"
                        >
                          {t(item.label)}
                        </Link>
                      ))}
                    </div>
                  )}
                  <Link
                    to="/help"
                    onClick={() => setMenuOpen(false)}
                    className="block px-4 py-2 text-sm text-[var(--org-text,var(--color-ink))] hover:bg-[color-mix(in_srgb,currentColor_8%,transparent)]"
                  >
                    {t('menu.help')}
                  </Link>
                  <div className="my-1 border-t border-hairline" />
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false)
                      signOut()
                    }}
                    className="block w-full text-left px-4 py-2 text-sm text-[var(--org-text,var(--color-ink))] hover:bg-[color-mix(in_srgb,currentColor_8%,transparent)]"
                  >
                    {t('menu.logout')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        {!hideNavLinks && (
          <nav className="flex items-center flex-wrap gap-1 sm:gap-3 mt-3">
            {visibleNavLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className={`flex items-center gap-1.5 text-sm rounded-md px-2.5 py-1.5 whitespace-nowrap ${
                  location.pathname === link.to || (link.to === '/team' && location.pathname.startsWith('/team/'))
                    ? 'text-ink font-medium bg-paper'
                    : 'text-secondary hover:text-ink'
                }`}
              >
                {t(link.label)}
              </Link>
            ))}
          </nav>
        )}
      </div>
      {notificationsOpen && (
        <div id="notification-drawer">
          <NotificationDrawer
            items={pendingActionItems}
            loading={pendingActionsLoading}
            error={pendingActionsError}
            viewAllHref={notificationsHref}
            onClose={() => setNotificationsOpen(false)}
            onRetry={refreshPendingActionCount}
          />
        </div>
      )}
    </header>
  )
}
