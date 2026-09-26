import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import AppHeader from '../../components/AppHeader'
import { getOrganisationBranding, orgBrandStyle } from '../../lib/orgBranding'
import { getEmployerLoginContext } from '../../lib/employerRoleProfiles'
import LearnerRoleAlignmentContainer from '../roles/LearnerRoleAlignmentContainer'
import EmployerAssignedTrainingPanel from './EmployerAssignedTrainingPanel'

// The learner-facing counterpart to EmployerConsole.jsx (which is admin-only,
// see EmployerAdminRoute's own comment) -- reached via the same employer URL
// (?org=:slug) an admin copies from the settings cog there, but for a plain
// employer_members 'member' this is where they land instead of the console.
// Deliberately just an employer-branded shell around
// LearnerRoleAlignmentContainer (scoped to this one employer via its
// employerId prop) rather than new assignment/alignment logic of its own --
// that container already is the learner's assigned role profile, required
// skills/training and pending assignments, previously only reachable buried
// on the Experience page.
export default function EmployerHome() {
  const [searchParams] = useSearchParams()
  const orgSlug = searchParams.get('org')
  const section = ['learning', 'role'].includes(searchParams.get('section')) ? searchParams.get('section') : 'home'
  const [branding, setBranding] = useState(null)
  const [employer, setEmployer] = useState(undefined)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!orgSlug) return
    getOrganisationBranding(orgSlug).then(setBranding).catch(() => {})
    getEmployerLoginContext(orgSlug)
      .then((result) => {
        if (!result) throw new Error('This employer page isn\'t available.')
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
        <main className="max-w-3xl mx-auto px-4 py-10">
          <p className="text-sm text-red-700">{error}</p>
        </main>
      </div>
    )
  }

  function sectionHref(nextSection) {
    const params = new URLSearchParams(searchParams)
    if (nextSection === 'home') params.delete('section')
    else params.set('section', nextSection)
    return `/employer/home?${params.toString()}`
  }

  const navItems = [
    { id: 'home', label: 'Home' },
    { id: 'learning', label: 'My learning' },
    { id: 'role', label: 'Role & skills' },
  ]

  return (
    <div className="min-h-screen bg-[var(--org-background,var(--color-paper))]" style={orgBrandStyle(branding)}>
      <AppHeader
        hideNavLinks
        brandLogoUrl={branding?.logoUrl}
        brandName={branding?.name}
        brandHomeHref={orgSlug ? `/employer/home?org=${orgSlug}` : '/dashboard'}
        contextExitHref="/dashboard"
        contextExitLabel="Back to LearnScope"
      />
      <div className="border-b border-hairline bg-[var(--org-background,var(--color-card))]">
        <nav aria-label="Employer learning" className="max-w-4xl mx-auto px-4 flex gap-6 overflow-x-auto">
          {navItems.map((item) => (
            <Link
              key={item.id}
              to={sectionHref(item.id)}
              aria-current={section === item.id ? 'page' : undefined}
              className={`border-b-2 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
                section === item.id
                  ? 'border-[var(--org-primary,var(--color-moss))] text-[var(--org-text,var(--color-ink))]'
                  : 'border-transparent text-secondary hover:text-[var(--org-text,var(--color-ink))]'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
      <main id="main-content" className="max-w-4xl mx-auto px-4 py-8 sm:py-10">
        <div className="mb-8 sm:mb-10">
          <p className="text-xs font-medium text-secondary uppercase tracking-[0.12em]">
            {employer ? `Learning with ${employer.name}` : 'Employer learning'}
          </p>
          <h1 className="font-display text-3xl sm:text-4xl text-[var(--org-text,var(--color-ink))] mt-2">
            {section === 'home' && 'Welcome back'}
            {section === 'learning' && 'My learning'}
            {section === 'role' && 'Role & skills'}
          </h1>
          {section === 'home' && (
            <p className="text-sm text-secondary mt-2 max-w-2xl">
              Pick up where you left off, see what is next, and track the learning connected to your role.
            </p>
          )}
        </div>
        {employer ? (
          <>
            {section === 'home' && (
              <>
                <EmployerAssignedTrainingPanel
                  employerId={employer.id}
                  employerName={employer.name}
                  employerLogoUrl={branding?.logoUrl}
                  variant="home"
                  viewAllHref={sectionHref('learning')}
                />
                <LearnerRoleAlignmentContainer
                  employerId={employer.id}
                  variant="summary"
                  roleHref={sectionHref('role')}
                />
              </>
            )}
            {section === 'learning' && (
              <EmployerAssignedTrainingPanel
                employerId={employer.id}
                employerName={employer.name}
                employerLogoUrl={branding?.logoUrl}
              />
            )}
            {section === 'role' && <LearnerRoleAlignmentContainer employerId={employer.id} />}
          </>
        ) : (
          <p className="text-secondary">Loading…</p>
        )}
      </main>
    </div>
  )
}
