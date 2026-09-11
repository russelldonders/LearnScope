import { useEffect, useState } from 'react'
import { createXapiLaunchSession, scormLaunchUrl, xapiActivityId } from './courseContent'

// Shared by XapiPlayer.jsx and Cmi5Player.jsx -- both launch their package
// the same simplified way: an auth token embedded directly in the iframe
// URL, per the ADL Launch convention, rather than a shared JS object like
// SCORM's window.API. cmi5's own launch method formally calls for a
// fetch-URL/token-exchange step plus an Initialized/Terminated statement
// lifecycle; this app doesn't implement that (a deliberate scope choice,
// not an oversight -- see Cmi5Player.jsx), so a cmi5 package launches the
// exact same way an xAPI one does. The package sends its statements to
// api/xapi/[...path].js either way, authenticating with the embedded
// launch token rather than a Supabase session -- the sandboxed iframe has
// none to give it.
export function useAdlLaunchUrl(contentItem, userId, courseId = null) {
  const [launchUrl, setLaunchUrl] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLaunchUrl(null)
    setError(null)

    const baseUrl = scormLaunchUrl(contentItem)
    if (!baseUrl) {
      setError('This package has no launch page.')
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

  return { launchUrl, error }
}
