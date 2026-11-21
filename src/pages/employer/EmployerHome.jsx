import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import AppHeader from '../../components/AppHeader'
import { orgBrandStyle } from '../../lib/orgBranding'
import { getEmployerLoginContext } from '../../lib/employerRoleProfiles'
import LearnerRoleAlignmentContainer from '../roles/LearnerRoleAlignmentContainer'
import EmployerAssignedTrainingPanel from './EmployerAssignedTrainingPanel'
import EmployerCataloguePanel from './EmployerCataloguePanel'
import { useLanguage } from '../../context/LanguageContext'
import {
  findCustomPage,
  getLearnerWorkspaceSettings,
  isSectionVisible,
  sectionHeading,
  sectionLabel,
  visibleSections,
} from '../../lib/learnerWorkspaceSettings'
import {
  LearnerWorkspaceNav,
  WorkspaceAnnouncement,
  WorkspaceHelp,
  WorkspaceCustomPage,
  WorkspaceIntro,
} from './LearnerWorkspaceParts'

// Set in place of a message when the slug resolves to no employer, so the
// effect below doesn't need t; the message is translated where it's shown.
const NOT_AVAILABLE = 'employer-not-available'

// The learner-facing counterpart to EmployerConsole.jsx (which is admin-only,
// see OrganisationAdminRoute's own comment) -- reached via the organisation URL
// (?org=:slug) an admin copies from the settings cog there, but for a plain
// employer_members 'member' this is where they land instead of the console.
// Deliberately just an employer-branded shell around
// LearnerRoleAlignmentContainer (scoped to this one employer via its
// employerId prop) rather than new assignment/alignment logic of its own --
// that container already is the learner's assigned role profile, required
// skills/training and pending assignments, previously only reachable buried
// on the Experience page.
//
// Which sections show, in what order, what they're called, where members
// land and what Home says come from the organisation's learner workspace
// settings (0325, set on LearnerWorkspaceSettingsPage). Presentation only:
// a hidden section changes what's shown here, not what anyone can access.
export default function EmployerHome() {
  const { t } = useLanguage()
  const [searchParams] = useSearchParams()
  const orgSlug = searchParams.get('org')
  const [employer, setEmployer] = useState(undefined)
  const [settings, setSettings] = useState(null)
  const [error, setError] = useState(null)
  // Members-only branding from get_employer_login_context (20261005090000)
  // rather than the public provider profile, so it still shows when the
  // organisation keeps its public page turned off.
  const branding = employer?.branding ?? null

  useEffect(() => {
    if (!orgSlug) return
    getEmployerLoginContext(orgSlug)
      .then(async (result) => {
        if (!result) {
          setError(NOT_AVAILABLE)
          return
        }
        const workspaceSettings = await getLearnerWorkspaceSettings(result.id)
        setSettings(workspaceSettings)
        setEmployer(result)
      })
      .catch((err) => setError(err.message))
  }, [orgSlug])

  // EmployerMemberRoute already confirmed membership before rendering this,
  // so reaching a resolved-but-missing employer here means the URL itself is
  // stale/invalid rather than a permissions problem.
  if (error) {
    return (
      <div className="min-h-screen bg-paper">
        <AppHeader />
        <main id="main-content" tabIndex={-1} className="max-w-3xl mx-auto px-4 py-10">
          <p className="text-sm text-red-700">{error === NOT_AVAILABLE ? t('employerHome.notAvailable') : error}</p>
        </main>
      </div>
    )
  }

  // The bare workspace URL opens the organisation's chosen landing section;
  // a section it has hidden falls back there too.
  const landingSection = settings?.landingSection ?? 'home'
  const requestedSection = searchParams.get('section')
  const section = settings && isSectionVisible(settings, requestedSection) ? requestedSection : landingSection

  function sectionHref(nextSection) {
    const params = new URLSearchParams(searchParams)
    if (nextSection === landingSection) params.delete('section')
    else params.set('section', nextSection)
    return `/organisation/learning?${params.toString()}`
  }

  const navItems = settings
    ? visibleSections(settings).map((id) => ({ id, label: sectionLabel(t, settings, id), href: sectionHref(id) }))
    : []
  const showLearning = settings ? isSectionVisible(settings, 'learning') : false
  const showRole = settings ? isSectionVisible(settings, 'role') : false

  return (
    <div className="org-brand-scope min-h-screen bg-[var(--org-background,var(--color-paper))]" style={orgBrandStyle(branding)}>
      <AppHeader
        hideNavLinks
        brandLogoUrl={branding?.logoUrl}
        brandName={branding?.name || employer?.name}
        brandHomeHref={orgSlug ? `/organisation/learning?org=${orgSlug}` : '/dashboard'}
        contextExitHref="/dashboard"
        notificationsHref={orgSlug ? `/actions?org=${encodeURIComponent(orgSlug)}` : '/actions'}
      />
      <div className="border-b border-hairline bg-[var(--org-background,var(--color-card))]">
        <LearnerWorkspaceNav items={navItems} current={section} />
      </div>
      <main id="main-content" tabIndex={-1} className="max-w-4xl mx-auto px-4 py-8 sm:py-10">
        <div className="mb-8 sm:mb-10">
          <p className="text-xs font-medium text-secondary uppercase tracking-[0.12em]">
            {employer ? t('employerHome.learningWith', { name: employer.name }) : t('employerHome.employerLearning')}
          </p>
          <h1 className="font-display text-3xl sm:text-4xl text-[var(--org-text,var(--color-ink))] mt-2">
            {settings ? sectionHeading(t, settings, section) : t(`employerHome.headings.${section}`)}
          </h1>
          {section === 'home' && settings && <WorkspaceIntro settings={settings} />}
        </div>
        {employer && settings ? (
          <>
            {section === 'home' && (
              <>
                <WorkspaceAnnouncement settings={settings} />
                {showLearning && (
                  <EmployerAssignedTrainingPanel
                    employerId={employer.id}
                    employerName={employer.name}
                    employerLogoUrl={branding?.logoUrl}
                    variant="home"
                    viewAllHref={sectionHref('learning')}
                    framing={settings.assignedTrainingFraming}
                  />
                )}
                {showRole && (
                  <LearnerRoleAlignmentContainer
                    employerId={employer.id}
                    variant="summary"
                    roleHref={sectionHref('role')}
                  />
                )}
                <WorkspaceHelp settings={settings} />
              </>
            )}
            {section === 'learning' && (
              <EmployerAssignedTrainingPanel
                employerId={employer.id}
                employerName={employer.name}
                employerLogoUrl={branding?.logoUrl}
                framing={settings.assignedTrainingFraming}
              />
            )}
            {section === 'catalogue' && (
              <EmployerCataloguePanel
                employerId={employer.id}
                employerName={employer.name}
                employerLogoUrl={branding?.logoUrl}
                enrolment={settings.catalogueEnrolment}
              />
            )}
            {section === 'role' && <LearnerRoleAlignmentContainer employerId={employer.id} />}
            {findCustomPage(settings, section) && <WorkspaceCustomPage page={findCustomPage(settings, section)} organisationId={employer.id} />}
          </>
        ) : (
          <p className="text-secondary">{t('common.loading')}</p>
        )}
      </main>
    </div>
  )
}
