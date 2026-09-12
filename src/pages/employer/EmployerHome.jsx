import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
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

  return (
    <div className="min-h-screen bg-[var(--org-background,var(--color-paper))]" style={orgBrandStyle(branding)}>
      <AppHeader
        brandLogoUrl={branding?.logoUrl}
        brandName={branding?.name}
        brandHomeHref={orgSlug ? `/employer/home?org=${orgSlug}` : '/dashboard'}
      />
      <main className="max-w-3xl mx-auto px-4 py-10">
        <div className="mb-8">
          <p className="text-xs font-medium text-secondary uppercase tracking-wide">
            {employer ? employer.name : 'Employer'}
          </p>
          <h1 className="font-display text-2xl text-[var(--org-text,var(--color-ink))] mt-1">
            Your training and skills
          </h1>
        </div>
        {employer ? (
          <>
            <EmployerAssignedTrainingPanel employerId={employer.id} />
            <LearnerRoleAlignmentContainer employerId={employer.id} />
          </>
        ) : (
          <p className="text-secondary">Loading…</p>
        )}
      </main>
    </div>
  )
}
