import { useEffect, useState } from 'react'
import { scormLaunchUrl, createXapiLaunchSession, xapiActivityId } from '../lib/courseContent'

// Launches an xAPI (Tin Can) package via the ADL Launch convention -- a
// query-string payload (endpoint/auth/actor/registration/activity_id), not
// a shared JS object like SCORM's window.API, since that's how the xAPI
// spec's own launch method works. The package sends its statements to
// api/xapi/[...path].js (see that file's own comments for what it does and
// doesn't implement), authenticating with the embedded launch token rather
// than a Supabase session -- the sandboxed iframe below has none to give it.
export default function XapiPlayer({ contentItem, userId, courseId = null }) {
  const [launchUrl, setLaunchUrl] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLaunchUrl(null)
    setError(null)

    const baseUrl = scormLaunchUrl(contentItem)
    if (!baseUrl) {
      setError('This xAPI package has no launch page.')
      return
    }

    createXapiLaunchSession(contentItem.id, userId, courseId)
      .then((session) => {
        if (cancelled) return
        const params = new URLSearchParams({
          endpoint: `${window.location.origin}/api/xapi/`,
          // Basic auth, per the ADL Launch spec -- username is the session
          // token, password left empty (the LRS endpoint only checks the
          // token half, see resolveSession() there).
          auth: `Basic ${btoa(`${session.token}:`)}`,
          actor: JSON.stringify({
            objectType: 'Agent',
            // account.name, not mbox -- avoids handing the learner's email
            // to arbitrary uploaded package code just to identify them.
            account: { homePage: 'https://learnscope.app', name: userId },
          }),
          registration: session.id,
          activity_id: xapiActivityId(contentItem),
        })
        setLaunchUrl(`${baseUrl}?${params.toString()}`)
      })
      .catch((err) => !cancelled && setError(err.message))

    return () => {
      cancelled = true
    }
  }, [contentItem.id, userId, courseId])

  if (error) return <p className="text-sm text-red-700">{error}</p>
  if (!launchUrl) return <p className="text-sm text-secondary">Loading…</p>

  return (
    <>
      <p className="text-xs text-secondary mb-2">
        Activity this package reports is recorded to your LearnScope record. Bookmarking/resume support varies by
        package, and completion isn't detected automatically yet -- use the mark-complete button below when you're
        done.
      </p>
      <iframe
        title={contentItem.title}
        src={launchUrl}
        className="w-full h-[600px] border border-hairline rounded-md bg-paper"
        // Same reasoning as ScormPlayer.jsx: deliberately no allow-same-
        // origin, so the sandboxed frame gets an opaque origin and can't
        // reach this app's own cookies/localStorage (including the
        // Supabase session token). Unlike SCORM, xAPI content doesn't need
        // same-origin access to a shared JS object -- it authenticates its
        // own network requests with the embedded launch token instead, so
        // the sandbox doesn't block anything it actually needs.
        sandbox="allow-scripts allow-forms"
      />
    </>
  )
}
