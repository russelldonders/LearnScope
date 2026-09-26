import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import AdminLayout from './AdminLayout'
import { OnboardingSettingsSection } from './AdminOnboarding'
import { NotificationSettingsSection } from './AdminNotifications'
import { WhatsNewSettingsSection } from './AdminReleases'
import { AuditLogSettingsSection } from './AdminActivityLog'
import AdminMemberFieldSettings from './AdminMemberFieldSettings'

const SETTINGS_SECTIONS = [
  { id: 'first-login-journey', label: 'First login journey' },
  { id: 'member-fields', label: 'Member fields' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'whats-new', label: "What's new" },
  { id: 'audit-log', label: 'Audit log' },
]

export default function AdminSettings() {
  const { hash } = useLocation()

  useEffect(() => {
    if (!hash) return
    const section = document.getElementById(hash.slice(1))
    section?.scrollIntoView()
  }, [hash])

  return (
    <AdminLayout>
      <div className="mb-10">
        <h2 className="font-display text-xl text-ink mb-1">Settings</h2>
        <p className="text-sm text-secondary max-w-2xl">
          Configure shared learner and employer experiences, manage platform communications, and
          review releases and administrative changes.
        </p>
        <nav aria-label="Settings sections" className="mt-4">
          <p className="text-xs font-medium text-secondary mb-2">On this page</p>
          <ul className="flex flex-wrap gap-x-5 gap-y-2">
            {SETTINGS_SECTIONS.map((section) => (
              <li key={section.id}>
                <a className="text-sm font-medium text-moss hover:underline" href={`#${section.id}`}>
                  {section.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <div className="divide-y divide-hairline">
        <section id="first-login-journey" className="scroll-mt-6 pb-10">
          <OnboardingSettingsSection />
        </section>
        <section id="member-fields" className="scroll-mt-6 py-10">
          <AdminMemberFieldSettings />
        </section>
        <section id="notifications" className="scroll-mt-6 py-10">
          <NotificationSettingsSection />
        </section>
        <section id="whats-new" className="scroll-mt-6 py-10">
          <WhatsNewSettingsSection />
        </section>
        <section id="audit-log" className="scroll-mt-6 pt-10">
          <AuditLogSettingsSection />
        </section>
      </div>
    </AdminLayout>
  )
}
