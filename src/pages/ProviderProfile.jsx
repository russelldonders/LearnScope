import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import AppHeader from '../components/AppHeader'
import { getProviderProfile } from '../lib/providerProfile'

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

  useEffect(() => {
    setProfile(undefined)
    setError(null)
    getProviderProfile(slug)
      .then(setProfile)
      .catch((err) => setError(err.message))
  }, [slug])

  const loading = profile === undefined && !error

  return (
    <div className="min-h-screen bg-paper">
      {authLoading ? null : user ? <AppHeader hideNavLinks /> : <PublicHeader />}

      <main className="max-w-3xl mx-auto px-4 py-10">
        {loading && <p className="text-secondary">Loading…</p>}
        {error && <p className="text-sm text-red-700">{error}</p>}

        {!loading && !error && !profile && (
          <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
            <p className="text-secondary">This provider page isn't available.</p>
          </div>
        )}

        {profile && (
          <>
            <div className="flex items-start gap-4 mb-8">
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
                    className="text-sm text-moss font-medium break-all"
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
              <h2 className="font-display text-xl text-ink mb-4">Skills offered</h2>
              {profile.skills.length === 0 ? (
                <p className="text-sm text-secondary">No skills listed yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {profile.skills.map((skill) => (
                    <span
                      key={skill.id}
                      title={skill.description || undefined}
                      className="font-mono text-xs uppercase tracking-wide text-ink border border-hairline rounded-full px-3 py-1"
                    >
                      {skill.name}
                      {skill.category ? ` · ${skill.category}` : ''}
                    </span>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h2 className="font-display text-xl text-ink mb-4">Training offered</h2>
              {profile.courses.length === 0 ? (
                <p className="text-sm text-secondary">No training listed yet.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {profile.courses.map((course) => (
                    <div key={course.id} className="bg-card border border-hairline rounded-lg p-4">
                      <h3 className="font-display text-lg text-ink">{course.name}</h3>
                      <p className="font-mono text-xs text-secondary mt-0.5">
                        {[course.courseType, course.duration].filter(Boolean).join(' · ')}
                      </p>
                      {course.synopsis && <p className="text-sm text-secondary mt-2">{course.synopsis}</p>}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  )
}

function PublicHeader() {
  return (
    <header className="max-w-3xl mx-auto px-4 py-6 flex items-center justify-between">
      <Link to="/" className="flex items-center gap-2 font-display text-2xl text-ink">
        <img src="/favicon.svg" alt="" className="w-7 h-7" />
        LearnScope
      </Link>
      <nav className="flex items-center gap-3">
        <Link to="/login" className="text-sm text-secondary hover:text-ink">
          Log in
        </Link>
        <Link to="/signup" className="rounded-md bg-moss text-paper py-2 px-4 font-medium hover:opacity-90">
          Sign up
        </Link>
      </nav>
    </header>
  )
}
