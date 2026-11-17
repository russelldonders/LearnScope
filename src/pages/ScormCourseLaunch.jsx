import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getPublishedCourseForLaunch, listEnrolledCatalogueIds, enrolInCatalogueCourse } from '../lib/courseCatalogue'
import CourseLearn from './CourseLearn'

export default function ScormCourseLaunch() {
  const { courseId } = useParams()
  const { user, loading: authLoading, signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [personalCourseId, setPersonalCourseId] = useState(null)
  const [courseName, setCourseName] = useState('LearnScope course')

  useEffect(() => {
    window.parent.postMessage({ type: 'learnscope.scorm.ready', version: 1 }, '*')
  }, [])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    setError(null)
    Promise.all([getPublishedCourseForLaunch(courseId), listEnrolledCatalogueIds(user.id)])
      .then(async ([course, enrolled]) => {
        if (!course) throw new Error('This course is no longer available.')
        setCourseName(course.name)
        const existing = enrolled.get(course.id)
        const personal = existing ? { id: existing.id } : await enrolInCatalogueCourse(user.id, course)
        if (!cancelled) setPersonalCourseId(personal.id)
      })
      .catch((err) => !cancelled && setError(err.message))
    return () => { cancelled = true }
  }, [courseId, user])

  async function handleSignIn(event) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    const { error: signInError } = await signIn(email, password)
    if (signInError) setError(signInError.message)
    setSubmitting(false)
  }

  if (authLoading) {
    return <LaunchStatus message="Checking your LearnScope session…" />
  }

  if (!user) {
    return (
      <main className="min-h-screen bg-paper px-4 py-10 text-ink">
        <div className="mx-auto max-w-md rounded-xl border border-hairline bg-card p-6">
          <p className="font-display text-2xl">Continue in LearnScope</p>
          <p className="mt-2 text-sm leading-relaxed text-secondary">
            Sign in once to connect this LMS launch to your personal learning record. Your LMS receives course
            completion and score; detailed activity stays in LearnScope.
          </p>
          <form onSubmit={handleSignIn} className="mt-6 space-y-4">
            <div>
              <label htmlFor="scorm-email" className="mb-1 block text-sm font-medium">Email</label>
              <input
                id="scorm-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-gold"
              />
            </div>
            <div>
              <label htmlFor="scorm-password" className="mb-1 block text-sm font-medium">Password</label>
              <input
                id="scorm-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-gold"
              />
            </div>
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-moss px-4 py-2 font-medium text-paper hover:opacity-90 disabled:opacity-60"
            >
              {submitting ? 'Signing in…' : 'Sign in and open course'}
            </button>
          </form>
          <p className="mt-5 text-center text-sm text-secondary">
            Need an account?{' '}
            <Link to="/signup" target="_blank" rel="noopener noreferrer" className="font-medium text-moss underline underline-offset-2">
              Create one in a new tab
            </Link>
          </p>
        </div>
      </main>
    )
  }

  if (error) {
    return (
      <main className="min-h-screen bg-paper px-4 py-10">
        <div className="mx-auto max-w-xl rounded-lg border border-hairline bg-card p-6">
          <h1 className="font-display text-xl text-ink">Course unavailable</h1>
          <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>
          <p className="mt-3 text-sm text-secondary">Ask the organisation that supplied this package for a fresh export.</p>
        </div>
      </main>
    )
  }

  if (!personalCourseId) return <LaunchStatus message={`Opening ${courseName}…`} />

  return <CourseLearn courseId={personalCourseId} embeddedScorm />
}

function LaunchStatus({ message }) {
  return (
    <main className="min-h-screen bg-paper grid place-items-center px-4">
      <p role="status" className="text-sm text-secondary">{message}</p>
    </main>
  )
}
