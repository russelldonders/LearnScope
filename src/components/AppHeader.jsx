import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { usePendingActions } from '../context/PendingActionsContext'
import { useNavVisibility } from '../context/NavVisibilityContext'
import { useLanguage } from '../context/LanguageContext'
import { supabase } from '../lib/supabaseClient'

// label is a translation key (LanguageContext) rather than literal text --
// resolved per-item below so this nav/menu stays in one place regardless of
// which language is active.
const NAV_LINKS = [
  { to: '/dashboard', label: 'nav.home' },
  { to: '/skills', label: 'nav.skills', requires: 'hasSkills' },
  { to: '/experience', label: 'nav.experience' },
  { to: '/learning', label: 'nav.learning', requires: 'hasCourses' },
]

const MENU_ITEMS = [
  { to: '/profile', label: 'menu.profile' },
  { to: '/connections', label: 'menu.connections', requires: 'hasConnectionsActivity' },
  { to: '/profile/connected-accounts', label: 'menu.connectedApps' },
  { to: '/profile/privacy', label: 'menu.privacySettings' },
  { to: '/profile/import', label: 'menu.importSkills' },
  { to: '/help', label: 'menu.help' },
]

// brandLogoUrl/brandName/brandHomeHref let a page whitelabel this header for
// an organisation's own branded context (currently only ProviderProfile.jsx,
// for a logged-in visitor viewing an org's public page via its own link).
// brandHomeHref defaults to /dashboard (this learner's own account) so every
// other page continues to behave exactly as before by omitting these props;
// ProviderProfile.jsx overrides it to the org's own page so clicking its
// logo stays on/returns to that page instead of jumping to the visitor's
// personal dashboard.
export default function AppHeader({ hideNavLinks = false, brandLogoUrl, brandName, brandHomeHref = '/dashboard' }) {
  const { signOut, user, isPlatformAdmin, organisationMemberships, employerMemberships } = useAuth()
  const { pendingActionCount } = usePendingActions()
  const { navVisibility } = useNavVisibility()
  const { t } = useLanguage()
  const location = useLocation()
  const [avatarUrl, setAvatarUrl] = useState(null)
  const [fullName, setFullName] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!user) return
    supabase
      .from('profiles')
      .select('avatar_url, full_name')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        setAvatarUrl(data?.avatar_url ?? null)
        setFullName(data?.full_name ?? null)
      })
  }, [user])

  const visibleNavLinks = NAV_LINKS.filter((link) => !link.requires || navVisibility[link.requires])
  const visibleMenuItems = MENU_ITEMS.filter((item) => !item.requires || navVisibility[item.requires])

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
          <Link to={brandHomeHref} className="flex items-center gap-2 font-display text-2xl text-ink shrink-0">
            <img src={brandLogoUrl || '/favicon.svg'} alt="" className="w-7 h-7 object-contain rounded" />
            {brandLogoUrl ? brandName : 'LearnScope'}
          </Link>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              to="/actions"
              aria-label={pendingActionCount > 0 ? `${t('nav.actions')}, ${pendingActionCount} pending` : t('nav.actions')}
              className={`relative flex items-center justify-center w-9 h-9 rounded-full border shrink-0 ${
                location.pathname === '/actions'
                  ? 'border-[var(--org-primary,var(--color-moss))] text-ink'
                  : 'border-hairline text-ink hover:bg-paper'
              }`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {pendingActionCount > 0 && (
                <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-[var(--org-primary,var(--color-moss))] text-paper text-xs font-medium">
                  {pendingActionCount}
                </span>
              )}
            </Link>
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
                      ? 'border-[var(--org-primary,var(--color-moss))] text-ink'
                      : 'border-hairline text-ink hover:bg-paper'
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
                <div className="absolute right-0 top-full mt-2 w-56 rounded-md border border-hairline bg-[var(--org-background,var(--color-card))] shadow-lg py-1 z-10">
                  {fullName && (
                    <div className="px-4 py-2 text-sm font-medium text-ink border-b border-hairline">
                      {fullName}
                    </div>
                  )}
                  {visibleMenuItems.map((item) => (
                    <Link
                      key={item.to}
                      to={item.to}
                      onClick={() => setMenuOpen(false)}
                      className="block px-4 py-2 text-sm text-ink hover:bg-paper"
                    >
                      {t(item.label)}
                    </Link>
                  ))}
                  {isPlatformAdmin && (
                    <Link
                      to={location.pathname.startsWith('/admin') ? '/dashboard' : '/admin'}
                      onClick={() => setMenuOpen(false)}
                      className="block px-4 py-2 text-sm text-ink hover:bg-paper"
                    >
                      {location.pathname.startsWith('/admin') ? t('menu.switchToLearner') : t('menu.platformConsole')}
                    </Link>
                  )}
                  {organisationMemberships?.length > 0 && (
                    <Link
                      to={location.pathname.startsWith('/provider') ? '/dashboard' : '/provider'}
                      onClick={() => setMenuOpen(false)}
                      className="block px-4 py-2 text-sm text-ink hover:bg-paper"
                    >
                      {location.pathname.startsWith('/provider') ? t('menu.switchToLearner') : t('menu.providerConsole')}
                    </Link>
                  )}
                  {employerMemberships?.some((m) => m.role === 'admin') && (
                    <Link
                      to={location.pathname.startsWith('/employer') ? '/dashboard' : '/employer'}
                      onClick={() => setMenuOpen(false)}
                      className="block px-4 py-2 text-sm text-ink hover:bg-paper"
                    >
                      {location.pathname.startsWith('/employer') ? t('menu.switchToLearner') : t('menu.employerConsole')}
                    </Link>
                  )}
                  <div className="my-1 border-t border-hairline" />
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false)
                      signOut()
                    }}
                    className="block w-full text-left px-4 py-2 text-sm text-ink hover:bg-paper"
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
                  location.pathname === link.to
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
    </header>
  )
}
