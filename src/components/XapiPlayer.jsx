import { useAdlLaunchUrl } from '../lib/adlLaunch'

// Launches an xAPI (Tin Can) package via the ADL Launch convention -- see
// useAdlLaunchUrl (lib/adlLaunch.js, shared with Cmi5Player.jsx) for how
// the launch URL itself is built.
export default function XapiPlayer({ contentItem, userId, courseId = null }) {
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
