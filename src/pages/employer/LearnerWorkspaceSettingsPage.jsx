import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import AppHeader from '../../components/AppHeader'
import { useAuth } from '../../context/AuthContext'
import { useLanguage } from '../../context/LanguageContext'
import { getOrganisation } from '../../lib/admin/organisations'
import { orgBrandStyle } from '../../lib/orgBranding'
import {
  DEFAULT_WORKSPACE_SETTINGS,
  HIDEABLE_SECTIONS,
  LIMITS,
  getLearnerWorkspaceSettings,
  saveLearnerWorkspaceSettings,
  sectionHeading,
  sectionLabel,
  validateWorkspaceSettings,
  visibleSections,
} from '../../lib/learnerWorkspaceSettings'
import {
  LearnerWorkspaceNav,
  WorkspaceAnnouncement,
  WorkspaceHelp,
  WorkspaceIntro,
} from './LearnerWorkspaceParts'

// An organisation admin's settings for the workspace its members see
// (EmployerHome.jsx): sections, landing section, Home content and two
// behaviour rules -- with a live preview built from the same parts as the
// real workspace. Presentation only; the learner's personal workspace is
// never affected.

const inputClass = 'mt-1 w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss'
const buttonClass = 'rounded-md border border-hairline px-3 py-2 text-sm text-ink hover:bg-paper disabled:opacity-50'
const smallButtonClass = 'rounded-md border border-hairline px-2 py-1 text-xs text-ink hover:bg-paper disabled:opacity-40'
const primaryClass = 'rounded-md bg-moss text-paper px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50'
const fieldsetClass = 'rounded-lg border border-hairline bg-card p-4 sm:p-5'
const legendClass = 'px-1 font-display text-lg text-ink'

const SECTION_NAMES = { home: 'Home', learning: 'My learning', catalogue: 'Catalogue', role: 'Role & skills' }

const PREVIEW_PLACEHOLDERS = {
  learning: 'The training you assign appears here.',
  role: 'Each member’s role profile and progress appears here.',
}

function brandingOf(organisation) {
  if (!organisation) return null
  return {
    logoUrl: organisation.logo_url,
    primaryColor: organisation.brand_primary_color,
    secondaryColor: organisation.brand_secondary_color,
    hoverColor: organisation.brand_hover_color,
    backgroundColor: organisation.brand_background_color,
    textColor: organisation.brand_text_color,
  }
}

export default function LearnerWorkspaceSettingsPage() {
  const { organisationId } = useParams()
  const { employerMemberships, organisationMemberships, isPlatformAdmin } = useAuth()
  // Mirrors the table's write policy (0325): employer admins, the
  // organisation's own admins, or platform admins.
  const allowed = Boolean(isPlatformAdmin)
    || (employerMemberships ?? []).some((m) => m.employer_id === organisationId && m.role === 'admin')
    || (organisationMemberships ?? []).some((m) => m.organisation_id === organisationId && m.role === 'admin')

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader hideNavLinks />
      <main id="main-content" tabIndex={-1} className="max-w-6xl mx-auto px-4 py-8">
        <Link to={`/organisation?org=${organisationId}`} className="inline-block text-sm text-moss hover:underline mb-5">
          Back to organisation workspace
        </Link>
        {allowed
          ? <LearnerWorkspaceSettings key={organisationId} organisationId={organisationId} />
          : <p role="alert" className="text-sm text-secondary">Only an administrator of this organisation can change its learner workspace.</p>}
      </main>
    </div>
  )
}

export function LearnerWorkspaceSettings({ organisationId }) {
  const [organisation, setOrganisation] = useState(null)
  const [saved, setSaved] = useState(null)
  const [draft, setDraft] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [errors, setErrors] = useState([])
  const [message, setMessage] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let live = true
    Promise.all([getOrganisation(organisationId), getLearnerWorkspaceSettings(organisationId)])
      .then(([org, settings]) => {
        if (!live) return
        setOrganisation(org)
        setSaved(settings)
        setDraft(settings)
      })
      .catch((err) => { if (live) setLoadError(err.message) })
    return () => { live = false }
  }, [organisationId])

  const dirty = useMemo(() => JSON.stringify(saved) !== JSON.stringify(draft), [saved, draft])

  if (loadError) return <p role="alert" className="text-sm text-red-700">{loadError}</p>
  if (!draft) return <p className="text-sm text-secondary">Loading…</p>

  function update(changes) {
    setMessage(null)
    setDraft((current) => ({ ...current, ...changes }))
  }

  function move(section, offset) {
    const order = [...draft.sectionOrder]
    const from = order.indexOf(section)
    const to = from + offset
    if (to < 0 || to >= order.length) return
    order.splice(from, 1)
    order.splice(to, 0, section)
    update({ sectionOrder: order })
  }

  function setShown(section, shown) {
    const hidden = shown ? draft.hiddenSections.filter((s) => s !== section) : [...draft.hiddenSections, section]
    update({
      hiddenSections: hidden,
      landingSection: hidden.includes(draft.landingSection) ? 'home' : draft.landingSection,
    })
  }

  function setLabel(section, value) {
    const { [section]: _previous, ...others } = draft.sectionLabels
    update({ sectionLabels: value ? { ...others, [section]: value } : others })
  }

  function setLink(index, changes) {
    update({ pinnedLinks: draft.pinnedLinks.map((link, i) => (i === index ? { ...link, ...changes } : link)) })
  }

  async function save(event) {
    event.preventDefault()
    const problems = validateWorkspaceSettings(draft)
    setErrors(problems)
    setMessage(null)
    if (problems.length > 0) return
    setSaving(true)
    try {
      const result = await saveLearnerWorkspaceSettings(organisationId, draft)
      setSaved(result)
      setDraft(result)
      setMessage('Saved. Members see these changes the next time they open the workspace.')
    } catch (err) {
      setErrors([err.message])
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="font-display text-2xl text-ink">Learner workspace</h1>
        <p className="text-sm text-secondary mt-1 max-w-3xl">
          Choose what members of {organisation?.name ?? 'your organisation'} see when they open its workspace. This only changes the organisation’s
          workspace. Members’ own skills, experience, plans and profile stay under their control, and hiding a section doesn’t remove anything.
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        <form onSubmit={save} className="space-y-6" noValidate>
          <fieldset className={fieldsetClass}>
            <legend className={legendClass}>Sections</legend>
            <p className="text-sm text-secondary mb-4">Show, hide, rename and reorder the sections. Home is always shown.</p>
            <ol className="space-y-3">
              {draft.sectionOrder.map((section, index) => {
                const shown = !draft.hiddenSections.includes(section)
                const name = SECTION_NAMES[section]
                return (
                  <li key={section} className="rounded-md border border-hairline p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-ink">{name}</span>
                      <div className="flex items-center gap-2">
                        <button type="button" className={smallButtonClass} onClick={() => move(section, -1)} disabled={index === 0} aria-label={`Move ${name} up`}>↑</button>
                        <button type="button" className={smallButtonClass} onClick={() => move(section, 1)} disabled={index === draft.sectionOrder.length - 1} aria-label={`Move ${name} down`}>↓</button>
                      </div>
                    </div>
                    <div className="mt-2 grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-end">
                      <label className="flex items-center gap-2 text-sm text-ink sm:pb-2">
                        <input
                          type="checkbox"
                          checked={shown}
                          disabled={!HIDEABLE_SECTIONS.includes(section)}
                          onChange={(event) => setShown(section, event.target.checked)}
                        />
                        Show {name}
                      </label>
                      <label className="block text-sm text-secondary">
                        Name shown to members (optional)
                        <input
                          className={inputClass}
                          value={draft.sectionLabels[section] ?? ''}
                          placeholder={name}
                          maxLength={LIMITS.sectionLabel}
                          onChange={(event) => setLabel(section, event.target.value)}
                        />
                      </label>
                    </div>
                  </li>
                )
              })}
            </ol>
            <label className="block text-sm text-secondary mt-4">
              Members land on
              <select className={inputClass} value={draft.landingSection} onChange={(event) => update({ landingSection: event.target.value })}>
                {visibleSections(draft).map((section) => (
                  <option key={section} value={section}>{draft.sectionLabels[section]?.trim() || SECTION_NAMES[section]}</option>
                ))}
              </select>
            </label>
          </fieldset>

          <fieldset className={fieldsetClass}>
            <legend className={legendClass}>Home page</legend>
            <label className="block text-sm text-secondary">
              Welcome message
              <textarea
                className={`${inputClass} min-h-24`}
                value={draft.welcomeMessage}
                maxLength={LIMITS.welcomeMessage}
                placeholder="Leave blank to use LearnScope’s standard welcome."
                onChange={(event) => update({ welcomeMessage: event.target.value })}
              />
            </label>
            <label className="block text-sm text-secondary mt-4">
              Announcement
              <textarea
                className={`${inputClass} min-h-20`}
                value={draft.announcement}
                maxLength={LIMITS.announcement}
                placeholder="Optional. Shown at the top of Home until you clear it."
                onChange={(event) => update({ announcement: event.target.value })}
              />
            </label>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block text-sm text-secondary">
                Contact name
                <input className={inputClass} value={draft.contactName} maxLength={LIMITS.contactName} onChange={(event) => update({ contactName: event.target.value })} />
              </label>
              <label className="block text-sm text-secondary">
                Contact role
                <input className={inputClass} value={draft.contactRole} maxLength={LIMITS.contactRole} placeholder="e.g. Learning and development" onChange={(event) => update({ contactRole: event.target.value })} />
              </label>
              <label className="block text-sm text-secondary sm:col-span-2">
                Contact email
                <input type="email" className={inputClass} value={draft.contactEmail} maxLength={LIMITS.contactEmail} onChange={(event) => update({ contactEmail: event.target.value })} />
              </label>
            </div>
            <div className="mt-5">
              <p className="text-sm font-medium text-ink">Useful links</p>
              <p className="text-xs text-secondary">Up to {LIMITS.links}. Each needs a full https:// address.</p>
              <ul className="mt-2 space-y-3">
                {draft.pinnedLinks.map((link, index) => (
                  <li key={index} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-end">
                    <label className="block text-sm text-secondary">
                      Link {index + 1} name
                      <input className={inputClass} value={link.label} maxLength={LIMITS.linkLabel} onChange={(event) => setLink(index, { label: event.target.value })} />
                    </label>
                    <label className="block text-sm text-secondary">
                      Link {index + 1} address
                      <input type="url" className={inputClass} value={link.url} maxLength={LIMITS.linkUrl} placeholder="https://" onChange={(event) => setLink(index, { url: event.target.value })} />
                    </label>
                    <button
                      type="button"
                      className={`${buttonClass} sm:mb-0.5`}
                      onClick={() => update({ pinnedLinks: draft.pinnedLinks.filter((_, i) => i !== index) })}
                    >
                      Remove<span className="sr-only"> link {index + 1}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {draft.pinnedLinks.length < LIMITS.links && (
                <button type="button" className={`${buttonClass} mt-3`} onClick={() => update({ pinnedLinks: [...draft.pinnedLinks, { label: '', url: '' }] })}>
                  Add link
                </button>
              )}
            </div>
          </fieldset>

          <fieldset className={fieldsetClass}>
            <legend className={legendClass}>How it works for members</legend>
            <fieldset>
              <legend className="text-sm font-medium text-ink">Catalogue</legend>
              <label className="mt-2 flex items-start gap-2 text-sm text-ink">
                <input type="radio" name="catalogue-enrolment" className="mt-1" checked={draft.catalogueEnrolment === 'self_enrol'} onChange={() => update({ catalogueEnrolment: 'self_enrol' })} />
                <span>Members can enrol themselves</span>
              </label>
              <label className="mt-2 flex items-start gap-2 text-sm text-ink">
                <input type="radio" name="catalogue-enrolment" className="mt-1" checked={draft.catalogueEnrolment === 'browse_only'} onChange={() => update({ catalogueEnrolment: 'browse_only' })} />
                <span>
                  Browse only. Members see what’s available and ask you to assign it
                  <span className="block text-xs text-secondary">Courses they’re already enrolled in stay available to them.</span>
                </span>
              </label>
            </fieldset>
            <fieldset className="mt-5">
              <legend className="text-sm font-medium text-ink">Describe assigned training as</legend>
              {[
                ['assigned', 'Assigned by your organisation'],
                ['required', 'Required by your organisation'],
                ['recommended', 'Recommended by your organisation'],
              ].map(([value, label]) => (
                <label key={value} className="mt-2 flex items-center gap-2 text-sm text-ink">
                  <input type="radio" name="training-framing" checked={draft.assignedTrainingFraming === value} onChange={() => update({ assignedTrainingFraming: value })} />
                  {label}
                </label>
              ))}
            </fieldset>
          </fieldset>

          {errors.length > 0 && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <ul className="list-disc pl-5 space-y-1">{errors.map((problem) => <li key={problem}>{problem}</li>)}</ul>
            </div>
          )}
          {message && <p role="status" className="text-sm text-moss">{message}</p>}

          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className={primaryClass} disabled={saving || !dirty}>{saving ? 'Saving…' : 'Save changes'}</button>
            <button type="button" className={buttonClass} onClick={() => { setErrors([]); update({ ...DEFAULT_WORKSPACE_SETTINGS }) }}>
              Use LearnScope defaults
            </button>
            {dirty && <span className="text-xs text-secondary">Unsaved changes. Members won’t see them until you save.</span>}
          </div>
        </form>

        <div className="lg:sticky lg:top-6">
          <h2 className="font-display text-lg text-ink">Preview</h2>
          <p className="text-xs text-secondary mb-3">What members will see, with your changes. Their own training and role details appear where marked.</p>
          <LearnerWorkspacePreview settings={draft} organisation={organisation} />
        </div>
      </div>
    </>
  )
}

export function LearnerWorkspacePreview({ settings, organisation }) {
  const { t } = useLanguage()
  const [chosen, setChosen] = useState(null)
  const shown = visibleSections(settings)
  const section = shown.includes(chosen) ? chosen : settings.landingSection
  const items = shown.map((id) => ({ id, label: sectionLabel(t, settings, id) }))
  const name = organisation?.name ?? ''

  const placeholder = (text) => (
    <div className="rounded-lg border border-dashed border-hairline p-6 text-center text-sm text-secondary">{text}</div>
  )

  return (
    <div
      role="region"
      aria-label="Member workspace preview"
      className="org-brand-scope overflow-hidden rounded-lg border border-hairline bg-[var(--org-background,var(--color-paper))]"
      style={orgBrandStyle(brandingOf(organisation))}
    >
      <div className="border-b border-hairline bg-[var(--org-background,var(--color-card))]">
        <LearnerWorkspaceNav items={items} current={section} onSelect={setChosen} />
      </div>
      <div className="px-4 py-6">
        <p className="text-xs font-medium text-secondary uppercase tracking-[0.12em]">{t('employerHome.learningWith', { name })}</p>
        <p className="font-display text-2xl text-[var(--org-text,var(--color-ink))] mt-2">{sectionHeading(t, settings, section)}</p>
        {section === 'home' && <WorkspaceIntro settings={settings} />}
        <div className="mt-6">
          {section === 'home' && (
            <>
              <WorkspaceAnnouncement settings={settings} />
              <div className="space-y-3">
                {shown.includes('learning') && placeholder(`${PREVIEW_PLACEHOLDERS.learning} ${t(`employerTraining.${settings.assignedTrainingFraming}By`, { employer: name })}.`)}
                {shown.includes('role') && placeholder('A summary of each member’s role progress appears here.')}
              </div>
              <WorkspaceHelp settings={settings} />
            </>
          )}
          {section === 'learning' && placeholder(`${PREVIEW_PLACEHOLDERS.learning} ${t(`employerTraining.${settings.assignedTrainingFraming}By`, { employer: name })}.`)}
          {section === 'catalogue' && (
            <>
              <p className="text-sm text-secondary mb-3">
                {settings.catalogueEnrolment === 'browse_only' ? t('employerCatalogue.browseOnly', { employer: name }) : t('employerCatalogue.intro')}
              </p>
              {placeholder(settings.catalogueEnrolment === 'browse_only'
                ? 'Courses from your catalogues appear here, without an Enrol button.'
                : 'Courses from your catalogues appear here, each with an Enrol button.')}
            </>
          )}
          {section === 'role' && placeholder(PREVIEW_PLACEHOLDERS.role)}
        </div>
      </div>
    </div>
  )
}
