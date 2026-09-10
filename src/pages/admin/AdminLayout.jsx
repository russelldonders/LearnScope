import { Link, useLocation } from 'react-router-dom'
import AppHeader from '../../components/AppHeader'

const SECTIONS = [
  { to: '/admin', label: 'Overview' },
  { to: '/admin/users', label: 'Users' },
  { to: '/admin/providers', label: 'Providers' },
  { to: '/admin/employers', label: 'Employers' },
  { to: '/admin/catalogue', label: 'Courses' },
  { to: '/admin/skills', label: 'Skill library' },
  { to: '/admin/tags', label: 'Tags' },
  { to: '/admin/activity', label: 'Activity log' },
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
        <div className="flex items-start justify-between gap-4 mb-1">
          <h1 className="font-display text-xl text-ink">Platform console</h1>
          <a
            href="https://github.com/russelldonders/LearnScope/blob/staging/docs/admin-guide/README.md"
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-sm text-moss font-medium hover:underline"
          >
            Admin guide ↗
          </a>
        </div>
        <p className="text-sm text-secondary mb-6">
          Manage users, provider organisations, and the shared courses, skill library and
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
