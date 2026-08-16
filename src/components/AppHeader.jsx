import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'

const NAV_LINKS = [
  { to: '/dashboard', label: 'Home' },
  { to: '/skills', label: 'Skills' },
  { to: '/experience', label: 'Experience' },
  { to: '/training', label: 'Find Training' },
  { to: '/connections', label: 'Connections' },
]

export default function AppHeader() {
  const { signOut, user } = useAuth()
  const location = useLocation()
  const [avatarUrl, setAvatarUrl] = useState(null)
  const [fullName, setFullName] = useState(null)

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

  return (
    <header className="border-b border-hairline bg-card">
      <div className="max-w-4xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <Link to="/dashboard" className="flex items-center gap-2 font-display text-2xl text-ink shrink-0">
            <img src="/favicon.svg" alt="" className="w-7 h-7" />
            LearnScope
          </Link>
          <div className="flex items-center gap-2 shrink-0">
            {fullName && (
              <span className="text-sm text-ink hidden sm:inline">{fullName}</span>
            )}
            <Link
              to="/profile"
              aria-label="Your profile"
              title="Your profile"
              className={`flex items-center justify-center w-9 h-9 rounded-full border shrink-0 overflow-hidden ${
                location.pathname === '/profile'
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
            </Link>
            <button
              onClick={signOut}
              className="shrink-0 text-sm text-secondary hover:text-ink border border-hairline rounded-md px-3 py-1.5"
            >
              Log out
            </button>
          </div>
        </div>
        <nav className="flex items-center flex-wrap gap-1 sm:gap-3 mt-3">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className={`text-sm rounded-md px-2.5 py-1.5 whitespace-nowrap ${
                location.pathname === link.to
                  ? 'text-ink font-medium bg-paper'
                  : 'text-secondary hover:text-ink'
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  )
}
