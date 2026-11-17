import { Link, useLocation } from 'react-router-dom'
import AppHeader from '../../components/AppHeader'
import DropdownNavMenu from '../../components/DropdownNavMenu'
import ScrollableNavBar from '../../components/ScrollableNavBar'
import { ADMIN_NAV, currentAdminNavItem, hrefOf } from '../../lib/adminNav'

// Nav shell for the platform-owner console -- each Admin*.jsx page renders
// itself wrapped in this, the same way every page renders its own AppHeader
// rather than the app using a nested-route/Outlet layout.
export default function AdminLayout({ children }) {
  const location = useLocation()
  const current = currentAdminNavItem(location)

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
          Manage users, organisations, and the shared courses, skill library and
          tags.
        </p>

        <nav aria-label="Platform console">
          <ScrollableNavBar className="mb-6">
            {ADMIN_NAV.map((entry) => {
              if (entry.items) {
                return (
                  <DropdownNavMenu
                    key={entry.key}
                    label={entry.label}
                    active={entry.items.includes(current)}
                    menuWidthClass="w-56"
                    items={entry.items.map((item) => ({
                      key: item.key,
                      label: item.label,
                      to: hrefOf(item),
                      current: item === current,
                    }))}
                  />
                )
              }
              const active = entry === current
              return (
                <Link
                  key={entry.key}
                  to={entry.to}
                  aria-current={active ? 'page' : undefined}
                  className={`shrink-0 text-sm px-3 py-2 border-b-2 whitespace-nowrap ${
                    active ? 'border-moss text-ink font-medium' : 'border-transparent text-secondary hover:text-ink'
                  }`}
                >
                  {entry.label}
                </Link>
              )
            })}
          </ScrollableNavBar>
        </nav>

        {children}
      </main>
    </div>
  )
}
