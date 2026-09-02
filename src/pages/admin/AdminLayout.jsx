import { Link, useLocation } from 'react-router-dom'
import AppHeader from '../../components/AppHeader'

const SECTIONS = [
  { to: '/admin', label: 'Users' },
  { to: '/admin/providers', label: 'Providers' },
  { to: '/admin/employers', label: 'Employers' },
  { to: '/admin/catalogue', label: 'Course catalogue' },
  { to: '/admin/skills', label: 'Skill library' },
  { to: '/admin/tags', label: 'Tags' },
  { to: '/admin/onboarding', label: 'Settings' },
]

// Nav shell for the platform-owner console -- each Admin*.jsx page renders
// itself wrapped in this, the same way every page renders its own AppHeader
// rather than the app using a nested-route/Outlet layout.
export default function AdminLayout({ children }) {
  const location = useLocation()

  return (
    <div className="min-h-screen bg-paper">
      {/* hideNavLinks: same reasoning as ProviderConsole.jsx -- this console
          is a distinct workspace from the learner-facing app, with its own
          nav (below) for switching between admin sections. */}
      <AppHeader hideNavLinks />
      <main id="main-content" tabIndex={-1} className="max-w-5xl mx-auto px-4 py-8">
        <h1 className="font-display text-xl text-ink mb-1">Platform console</h1>
        <p className="text-sm text-secondary mb-6">
          Manage users, provider organisations, and the shared course catalogue, skill library and
          tags.
        </p>

        <nav className="flex items-center flex-wrap gap-1 mb-6 border-b border-hairline">
          {SECTIONS.map((s) => (
            <Link
              key={s.to}
              to={s.to}
              aria-current={location.pathname === s.to ? 'page' : undefined}
              className={`text-sm px-3 py-2 -mb-px border-b-2 whitespace-nowrap ${
                location.pathname === s.to
                  ? 'border-moss text-ink font-medium'
                  : 'border-transparent text-secondary hover:text-ink'
              }`}
            >
              {s.label}
            </Link>
          ))}
        </nav>

        {children}
      </main>
    </div>
  )
}
