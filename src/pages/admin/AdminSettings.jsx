import { Link, Navigate, useLocation } from 'react-router-dom'
import AdminLayout from './AdminLayout'
import { OnboardingSettingsSection } from './AdminOnboarding'
import { NotificationSettingsSection } from './AdminNotifications'
import AdminMemberFieldSettings from './AdminMemberFieldSettings'

// Platform configuration only -- one section at a time, chosen from a side
// menu (a stacked list on a phone) and kept in the URL hash so links like
// /admin/settings#notifications still open the right one. Release history
// and the audit log are records rather than settings, so they have their own
// pages under Insights (/admin/whats-new, /admin/audit-log).
const SETTINGS_SECTIONS = [
  {
    id: 'first-login-journey',
    label: 'First login journey',
    description: 'The steps a new learner sees the first time they sign in',
    Component: OnboardingSettingsSection,
  },
  {
    id: 'member-fields',
    label: 'Member fields',
    description: 'Details kept on every member record',
    Component: AdminMemberFieldSettings,
  },
  {
    id: 'notifications',
    label: 'Notifications',
    description: 'The emails LearnScope sends',
    Component: NotificationSettingsSection,
  },
]

// Sections that used to live on this page, now on their own pages.
const MOVED_SECTIONS = {
  'whats-new': '/admin/whats-new',
  'audit-log': '/admin/audit-log',
}

export default function AdminSettings() {
  const { hash } = useLocation()
  const requested = hash.slice(1)

  if (MOVED_SECTIONS[requested]) return <Navigate to={MOVED_SECTIONS[requested]} replace />

  const current = SETTINGS_SECTIONS.find((section) => section.id === requested) ?? SETTINGS_SECTIONS[0]
  const { Component } = current

  return (
    <AdminLayout>
      <div className="mb-6">
        <h2 className="font-display text-xl text-ink mb-1">Settings</h2>
        <p className="text-sm text-secondary max-w-2xl">
          Configure the shared learner and employer experience and the emails the platform sends.
        </p>
      </div>

      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        <nav aria-label="Settings sections" className="md:w-56 md:shrink-0">
          <ul className="space-y-1">
            {SETTINGS_SECTIONS.map((section) => {
              const active = section === current
              return (
                <li key={section.id}>
                  <Link
                    to={`#${section.id}`}
                    aria-current={active ? 'page' : undefined}
                    className={`block rounded-md border-l-2 px-3 py-2 ${
                      active ? 'border-moss bg-card' : 'border-transparent hover:bg-card'
                    }`}
                  >
                    <span className={`block text-sm ${active ? 'font-medium text-ink' : 'text-ink'}`}>{section.label}</span>
                    <span className="block text-xs text-secondary">{section.description}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>

        <section id={current.id} aria-label={current.label} className="min-w-0 flex-1">
          <Component />
        </section>
      </div>
    </AdminLayout>
  )
}
