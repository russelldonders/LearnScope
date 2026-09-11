import { useAdlLaunchUrl } from '../lib/adlLaunch'

// Launches a cmi5 package -- reuses XapiPlayer.jsx's own simplified ADL
// Launch (see useAdlLaunchUrl, lib/adlLaunch.js) rather than cmi5's own
// formal launch method, which calls for the AU to fetch a short-lived auth
// token from a URL (instead of receiving one embedded directly) and to
// send Initialized/Terminated statements marking its own session
// lifecycle. This app implements neither of those -- a deliberate scope
// choice made when cmi5 support was added, not an oversight. Most
// real-world cmi5 content still runs fine against a plain xAPI-style
// launch, but a strictly spec-compliant cmi5 player embedded in a package
// could refuse to launch without the formal fetch step.
export default function Cmi5Player({ contentItem, userId, courseId = null }) {
  const { launchUrl, error } = useAdlLaunchUrl(contentItem, userId, courseId)

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
        // Same reasoning as XapiPlayer.jsx/ScormPlayer.jsx: deliberately no
        // allow-same-origin, so the sandboxed frame can't reach this app's
        // own cookies/localStorage. The package authenticates its own
        // network requests with the embedded launch token instead.
        sandbox="allow-scripts allow-forms"
      />
    </>
  )
}
