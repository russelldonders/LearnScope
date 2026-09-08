import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import AppHeader from '../components/AppHeader'
import CourseThumbnail from '../components/CourseThumbnail'
import { LEVEL_LABELS } from '../lib/levels'
import { getProviderProfile } from '../lib/providerProfile'
import { orgBrandStyle } from '../lib/orgBranding'
import {
  listEnrolledCatalogueIds,
  enrolInCatalogueCourse,
  setPendingEnrolCourseId,
  listCourseCohorts,
  enrolInCourseCohort,
} from '../lib/courseCatalogue'
import CohortPickerModal from '../components/CohortPickerModal'

// Public provider profile -- reachable logged out (0090's get_provider_profile
// RPC is anon-safe), so unlike every other content page this can't assume
// AppHeader's authenticated-account chrome makes sense: a logged-in visitor
// gets the normal app header (no learner nav links -- this isn't part of
// that flow), a logged-out one gets a minimal logo + log in/sign up header,
// same links as Landing.jsx's own header.
export default function ProviderProfile() {
  const { slug } = useParams()
  const { user, loading: authLoading } = useAuth()
  const [profile, setProfile] = useState(undefined)
  const [error, setError] = useState(null)
  const [enrolledIds, setEnrolledIds] = useState(new Map())
  const [enrollingId, setEnrollingId] = useState(null)
  const [enrolError, setEnrolError] = useState(null)
  // Set once a course with at least one cohort is about to be enrolled into
  // -- mirrors CourseCatalogue.jsx's own cohortPicker state.
  const [cohortPicker, setCohortPicker] = useState(null)
  const [cohortEnrolling, setCohortEnrolling] = useState(false)
  const [cohortError, setCohortError] = useState(null)

  useEffect(() => {
    setProfile(undefined)
    setError(null)
    getProviderProfile(slug)
      .then(setProfile)
      .catch((err) => setError(err.message))
  }, [slug])

  // Independent of the profile fetch (works for any logged-in visitor,
  // whether or not they've been here before) -- lets an already-enrolled
  // learner see that on this page rather than only discovering it back on
  // /training.
  useEffect(() => {
    if (user) listEnrolledCatalogueIds(user.id).then(setEnrolledIds)
  }, [user])

  const loading = profile === undefined && !error

  async function handleEnrol(course) {
    setEnrolError(null)
    setEnrollingId(course.id)
    try {
      // A course with any cohorts defined enrols via a specific one instead
      // of the plain catalogue insert below -- purely additive, see
      // CourseCatalogue.jsx's own handleEnrol for the same branching.
      const cohorts = await listCourseCohorts(course.id)
      if (cohorts.length > 0) {
        setCohortError(null)
        setCohortPicker({ course, cohorts })
        return
      }

      const enrolled = await enrolInCatalogueCourse(user.id, {
        id: course.id,
        name: course.name,
        provider: profile.organisation.name,
        course_type: course.courseType,
        duration: course.duration,
      })
      setEnrolledIds((prev) => new Map(prev).set(course.id, { id: enrolled.id, completedDate: enrolled.completed_date }))
    } catch (err) {
      setEnrolError({ id: course.id, message: err.message })
    } finally {
      setEnrollingId(null)
    }
  }

  async function handleCohortEnrol(cohortId) {
    const { course } = cohortPicker
    setCohortError(null)
    setCohortEnrolling(true)
    try {
      const enrolled = await enrolInCourseCohort(cohortId)
      setEnrolledIds((prev) => new Map(prev).set(course.id, { id: enrolled.id, completedDate: enrolled.completed_date }))
      setCohortPicker(null)
    } catch (err) {
      setCohortError(err.message)
    } finally {
      setCohortEnrolling(false)
    }
  }

  // Falls back to the app's own moss/slate design tokens via CSS var()'s
  // second argument whenever an org hasn't set a custom colour -- so this
  // page renders identically to before this feature for every org that
  // hasn't opted into branding, and only the CTA buttons/name link actually
  // switch to a custom colour (see the Tailwind arbitrary-value classes
  // below), rather than a hardcoded style ProviderProfile would otherwise
  // have to override.
  const brandStyle = profile
    ? orgBrandStyle({
        primaryColor: profile.organisation.brandPrimaryColor,
        secondaryColor: profile.organisation.brandSecondaryColor,
        hoverColor: profile.organisation.brandHoverColor,
      })
    : undefined
  // text-paper (the default CTA text colour) is itself a theme-dependent
  // token -- it flips between near-white and near-black across light/dark
  // mode, same as --color-moss does, so the two stay paired automatically
  // for an org using the default colours. A custom brand colour has no
  // dark-mode variant of its own though, so pairing it with the
  // theme-flipping text-paper could land on near-black text over a
  // near-black background for a dark-mode visitor. Fixed white text isn't
  // guaranteed-legible against every hex an admin could pick (this is an
  // inherent tradeoff of a free colour picker, called out in the settings
  // modal's own hint), but it at least stays consistent across themes
  // instead of silently flipping to the wrong end of the contrast range.
  const hasCustomPrimary = Boolean(profile?.organisation.brandPrimaryColor)
  const ctaTextClass = hasCustomPrimary ? 'text-white' : 'text-paper'

  return (
    <div className="min-h-screen bg-paper" style={brandStyle}>
      {authLoading ? null : user ? (
        // brandName intentionally omitted: this page's own hero section
        // (below) already introduces the org by name, so the header shows
        // just its logo mark rather than repeating the name.
        <AppHeader hideNavLinks brandLogoUrl={profile?.organisation.logoUrl} />
      ) : (
        <PublicHeader organisation={profile?.organisation} slug={slug} />
      )}

      <main className="max-w-4xl mx-auto px-4 py-10">
        {loading && <p className="text-secondary">Loading…</p>}
        {error && <p className="text-sm text-red-700">{error}</p>}

        {!loading && !error && !profile && (
          <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
            <p className="text-secondary">This provider page isn't available.</p>
          </div>
        )}

        {profile && (
          <>
            <div
              className={`flex items-start gap-4 mb-8 ${
                profile.organisation.brandSecondaryColor ? 'border-l-4 border-[var(--org-secondary)] pl-4' : ''
              }`}
            >
              {profile.organisation.logoUrl && (
                <img
                  src={profile.organisation.logoUrl}
                  alt=""
                  className="w-16 h-16 rounded-md object-contain border border-hairline bg-card shrink-0"
                />
              )}
              <div className="min-w-0">
                <h1 className="font-display text-2xl sm:text-3xl text-ink">{profile.organisation.name}</h1>
                {profile.organisation.url && (
                  <a
                    href={profile.organisation.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-[var(--org-primary,var(--color-moss))] font-medium break-all"
                  >
                    {profile.organisation.url}
                  </a>
                )}
                {profile.organisation.about && (
                  <p className="text-secondary mt-2 whitespace-pre-wrap">{profile.organisation.about}</p>
                )}
              </div>
            </div>

            <section className="mb-10">
              <h2 className="font-display text-xl text-ink mb-4 pb-1 border-b-2 border-[var(--org-primary,transparent)]">
                Skills offered
              </h2>
              {profile.skills.length === 0 ? (
                <p className="text-sm text-secondary">No skills listed yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {profile.skills.map((skill) => (
                    <span
                      key={skill.id}
                      title={skill.description || undefined}
                      className="font-mono text-xs uppercase tracking-wide text-ink border border-[var(--org-primary,var(--color-hairline))] rounded-full px-3 py-1"
                    >
                      {skill.name}
                      {skill.category ? ` · ${skill.category}` : ''}
                    </span>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h2 className="font-display text-xl text-ink mb-4 pb-1 border-b-2 border-[var(--org-primary,transparent)]">
                Training offered
              </h2>
              {profile.courses.length === 0 ? (
                <p className="text-sm text-secondary">No training listed yet.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {profile.courses.map((course) => {
                    const enrollment = enrolledIds.get(course.id)
                    const enrolled = Boolean(enrollment)
                    const completed = Boolean(enrollment?.completedDate)
                    return (
                    <div key={course.id} className="bg-card border border-hairline rounded-lg overflow-hidden flex flex-col">
                      <CourseThumbnail
                        name={course.name}
                        provider={profile.organisation.name}
                        logoUrl={profile.organisation.logoUrl}
                        imageUrl={course.imageUrl}
                        className="h-24 w-full shrink-0"
                      />
                      <div className="p-4 flex flex-col flex-1">
                        <h3 className="font-display text-lg text-ink">{course.name}</h3>
                        <p className="font-mono text-xs text-secondary mt-0.5">
                          {[course.courseType, course.duration].filter(Boolean).join(' · ')}
                        </p>
                        {course.synopsis && <p className="text-sm text-secondary mt-2 flex-1">{course.synopsis}</p>}
                        {course.catalogues.length > 0 && (
                          <p className="text-xs text-secondary mt-2">
                            {course.catalogues.map((c) => c.name).join(', ')}
                          </p>
                        )}
                        {(course.skillEntries.length > 0 || course.tags.length > 0) && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {course.skillEntries.map((e) => (
                              <span
                                key={e.skillId}
                                className="font-mono text-[10px] uppercase tracking-wide text-[var(--org-primary,var(--color-moss))] border border-[var(--org-primary,var(--color-moss))] rounded-full px-2 py-0.5"
                              >
                                {e.skillName} · {LEVEL_LABELS[e.level]}
                              </span>
                            ))}
                            {course.tags.map((t) => (
                              <span
                                key={t.id}
                                className="font-mono text-[10px] uppercase tracking-wide text-secondary border border-hairline rounded-full px-2 py-0.5"
                              >
                                {t.name}
                              </span>
                            ))}
                          </div>
                        )}
                        {enrolError?.id === course.id && (
                          <p className="text-xs text-red-700 mt-2">{enrolError.message}</p>
                        )}
                        {user ? (
                          <button
                            type="button"
                            onClick={() => handleEnrol(course)}
                            disabled={enrolled || enrollingId === course.id}
                            className={`mt-3 self-start rounded-md bg-[var(--org-primary,var(--color-moss))] hover:bg-[var(--org-hover,var(--org-primary,var(--color-moss)))] hover:opacity-90 ${ctaTextClass} py-1.5 px-3 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed`}
                          >
                            {completed
                              ? 'Completed ✓'
                              : enrolled
                                ? 'Enrolled ✓'
                                : enrollingId === course.id
                                  ? 'Enrolling…'
                                  : 'Enrol'}
                          </button>
                        ) : (
                          <Link
                            to={`/login?org=${slug}`}
                            onClick={() => setPendingEnrolCourseId(course.id)}
                            className={`mt-3 self-start rounded-md bg-[var(--org-primary,var(--color-moss))] hover:bg-[var(--org-hover,var(--org-primary,var(--color-moss)))] hover:opacity-90 ${ctaTextClass} py-1.5 px-3 text-sm font-medium`}
                          >
                            Log in to enrol
                          </Link>
                        )}
                      </div>
                    </div>
                    )
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {cohortPicker && (
        <CohortPickerModal
          courseName={cohortPicker.course.name}
          cohorts={cohortPicker.cohorts ?? []}
          enrolling={cohortEnrolling}
          error={cohortError}
          onEnrol={handleCohortEnrol}
          onClose={() => setCohortPicker(null)}
        />
      )}
    </div>
  )
}

// Swaps in the org's own logo once its profile has loaded, and links Log
// in/Sign up onward with ?org=:slug so Login.jsx/Signup.jsx can pick up the
// same branding -- until then (profile still loading, or an org with no
// logo of its own), this renders exactly as before: the plain LearnScope
// mark linking home. Drops the wordmark next to a custom logo (unlike the
// LearnScope default, which pairs its favicon with the "LearnScope" text) --
// the page's own hero section a few lines below already introduces the org
// by its full name, so repeating it here would just be the same name twice
// in the same viewport.
function PublicHeader({ organisation, slug }) {
  const authLinkSuffix = slug ? `?org=${slug}` : ''
  // Same theme-flip reasoning as the main component's ctaTextClass.
  const ctaTextClass = organisation?.brandPrimaryColor ? 'text-white' : 'text-paper'
  return (
    <header className="max-w-4xl mx-auto px-4 py-6 flex items-center justify-between">
      <Link to={organisation?.logoUrl ? `/providers/${slug}` : '/'} className="flex items-center gap-2 font-display text-2xl text-ink">
        <img
          src={organisation?.logoUrl || '/favicon.svg'}
          alt=""
          className="w-7 h-7 object-contain rounded"
        />
        {!organisation?.logoUrl && 'LearnScope'}
      </Link>
      <nav className="flex items-center gap-3">
        <Link to={`/login${authLinkSuffix}`} className="text-sm text-secondary hover:text-ink">
          Log in
        </Link>
        <Link
          to={`/signup${authLinkSuffix}`}
          className={`rounded-md bg-[var(--org-primary,var(--color-moss))] hover:bg-[var(--org-hover,var(--org-primary,var(--color-moss)))] hover:opacity-90 ${ctaTextClass} py-2 px-4 font-medium`}
        >
          Sign up
        </Link>
      </nav>
    </header>
  )
}
