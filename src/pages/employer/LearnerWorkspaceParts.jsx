import { Link } from 'react-router-dom'
import { useLanguage } from '../../context/LanguageContext'

// The parts of an organisation's learner workspace that its settings shape
// (organisation_learner_workspace_settings, 0325). Shared by the real
// workspace (EmployerHome.jsx) and the admin's live preview
// (LearnerWorkspaceSettingsPage.jsx), so the preview can't drift from what
// members actually see.

// Each item is { id, label, href } for real links, or { id, label } with
// onSelect for the preview, which switches section in place.
export function LearnerWorkspaceNav({ items, current, onSelect }) {
  const { t } = useLanguage()
  const className = (active) => `border-b-2 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
    active
      ? 'border-[var(--org-primary,var(--color-moss))] text-[var(--org-text,var(--color-ink))]'
      : 'border-transparent text-secondary hover:text-[var(--org-text,var(--color-ink))]'
  }`
  return (
    <nav aria-label={t('employerHome.navLabel')} className="max-w-4xl mx-auto px-4 flex gap-6 overflow-x-auto">
      {items.map((item) => (onSelect ? (
        <button
          key={item.id}
          type="button"
          onClick={() => onSelect(item.id)}
          aria-current={current === item.id ? 'page' : undefined}
          className={className(current === item.id)}
        >
          {item.label}
        </button>
      ) : (
        <Link key={item.id} to={item.href} aria-current={current === item.id ? 'page' : undefined} className={className(current === item.id)}>
          {item.label}
        </Link>
      )))}
    </nav>
  )
}

export function WorkspaceIntro({ settings }) {
  const { t } = useLanguage()
  return (
    <p className="text-sm text-secondary mt-2 max-w-2xl whitespace-pre-line">
      {settings.welcomeMessage || t('employerHome.homeIntro')}
    </p>
  )
}

export function WorkspaceAnnouncement({ settings }) {
  const { t } = useLanguage()
  if (!settings.announcement) return null
  return (
    <aside
      aria-labelledby="workspace-announcement-heading"
      className="mb-8 rounded-lg border border-[var(--org-primary,var(--color-moss))] border-l-4 bg-card px-4 py-3"
    >
      <h2 id="workspace-announcement-heading" className="text-xs font-medium uppercase tracking-[0.12em] text-secondary">
        {t('employerHome.announcement')}
      </h2>
      <p className="mt-1 text-sm text-ink whitespace-pre-line">{settings.announcement}</p>
    </aside>
  )
}

export function WorkspaceHelp({ settings }) {
  const { t } = useLanguage()
  const hasContact = Boolean(settings.contactName || settings.contactEmail)
  if (!hasContact && settings.pinnedLinks.length === 0) return null
  return (
    <section aria-labelledby="workspace-help-heading" className="mt-10 border-t border-hairline pt-6">
      <h2 id="workspace-help-heading" className="font-display text-xl text-[var(--org-text,var(--color-ink))]">
        {t('employerHome.helpHeading')}
      </h2>
      <div className="mt-4 grid gap-6 sm:grid-cols-2">
        {hasContact && (
          <div>
            <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-secondary">{t('employerHome.contactHeading')}</h3>
            {settings.contactName && <p className="mt-1 font-medium text-ink">{settings.contactName}</p>}
            {settings.contactRole && <p className="text-sm text-secondary">{settings.contactRole}</p>}
            {settings.contactEmail && (
              <a href={`mailto:${settings.contactEmail}`} className="mt-1 inline-block text-sm text-ink underline underline-offset-4 decoration-hairline hover:decoration-current break-all">
                {settings.contactEmail}
              </a>
            )}
          </div>
        )}
        {settings.pinnedLinks.length > 0 && (
          <div>
            <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-secondary">{t('employerHome.linksHeading')}</h3>
            <ul className="mt-1 space-y-1">
              {settings.pinnedLinks.map((link) => (
                <li key={`${link.label}-${link.url}`}>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-ink underline underline-offset-4 decoration-hairline hover:decoration-current"
                  >
                    {link.label}
                    <span className="sr-only"> {t('employerHome.opensInNewTab')}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}
