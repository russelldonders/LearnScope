import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { usePendingActions } from '../context/PendingActionsContext'
import { supabase } from '../lib/supabaseClient'

const NAV_LINKS = [
  { to: '/dashboard', label: 'Home' },
  { to: '/skills', label: 'Skills' },
  { to: '/experience', label: 'Experience' },
  { to: '/learning', label: 'Learning' },
  { to: '/training', label: 'Find Training' },
  { to: '/connections', label: 'Connections' },
]

const MENU_ITEMS = [
  { to: '/profile', label: 'Profile' },
  { to: '/profile/privacy', label: 'Privacy Settings' },
  { to: '/profile/import', label: 'Import Skills & Experience' },
]

export default function AppHeader({ hideNavLinks = false }) {
  const { signOut, user, isPlatformAdmin, organisationMemberships } = useAuth()
  const { pendingActionCount } = usePendingActions()
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

  return (
    <header className="border-b border-hairline bg-card">
      <div className="max-w-4xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <Link to="/dashboard" className="flex items-center gap-2 font-display text-2xl text-ink shrink-0">
            <img src="/favicon.svg" alt="" className="w-7 h-7" />
            LearnScope
          </Link>
          <div className="flex items-center gap-2 shrink-0">
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                aria-label="Account menu"
                aria-expanded={menuOpen}
                aria-haspopup="true"
                className="flex items-center gap-2"
              >
                {fullName && (
                  <span className="text-sm text-ink hidden sm:inline">{fullName}</span>
                )}
                <span
                  className={`flex items-center justify-center w-9 h-9 rounded-full border shrink-0 overflow-hidden ${
                    location.pathname.startsWith('/profile')
                      ? 'border-moss text-ink'
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
                <div className="absolute right-0 top-full mt-2 w-56 rounded-md border border-hairline bg-card shadow-lg py-1 z-10">
                  {MENU_ITEMS.map((item) => (
                    <Link
                      key={item.to}
                      to={item.to}
                      onClick={() => setMenuOpen(false)}
                      className="block px-4 py-2 text-sm text-ink hover:bg-paper"
                    >
                      {item.label}
                    </Link>
                  ))}
                  {isPlatformAdmin && (
                    <Link
                      to="/admin"
                      onClick={() => setMenuOpen(false)}
                      className="block px-4 py-2 text-sm text-ink hover:bg-paper"
                    >
                      Platform console
                    </Link>
                  )}
                  {organisationMemberships?.length > 0 && (
                    <Link
                      to="/provider"
                      onClick={() => setMenuOpen(false)}
                      className="block px-4 py-2 text-sm text-ink hover:bg-paper"
                    >
                      Provider console
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
                    Log out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        {!hideNavLinks && (
          <nav className="flex items-center flex-wrap gap-1 sm:gap-3 mt-3">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className={`flex items-center gap-1.5 text-sm rounded-md px-2.5 py-1.5 whitespace-nowrap ${
                  location.pathname === link.to
                    ? 'text-ink font-medium bg-paper'
                    : 'text-secondary hover:text-ink'
                }`}
              >
                {link.label}
                {link.to === '/connections' && pendingActionCount > 0 && (
                  <span className="flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-moss text-paper text-xs font-medium">
                    {pendingActionCount}
                  </span>
                )}
              </Link>
            ))}
          </nav>
        )}
      </div>
    </header>
  )
}
