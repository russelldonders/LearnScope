import { useRef, useState } from 'react'
import { signLtiLaunch } from '../lib/courseContent'

// Opens in a new tab rather than an iframe -- unlike SCORM/xAPI/cmi5's
// self-hosted packages, an LTI tool is an arbitrary third-party site
// LearnScope doesn't control, and many set X-Frame-Options/CSP that would
// silently block embedding. A real form POST (not a query-string GET) is
// also what the LTI 1.1 launch method itself expects, since the parameter
// set (plus the OAuth signature) can be long.
//
// Signing happens on click, not on mount -- this reaches out to an
// external, admin-configured URL, so it shouldn't fire just because the
// learner scrolled past this item in the outline.
export default function LtiPlayer({ contentItem, userId, courseId = null }) {
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState(null)
  const formRef = useRef(null)

  async function handleLaunch() {
    setLaunching(true)
    setError(null)
    try {
      const { launchUrl, toolName, params } = await signLtiLaunch(contentItem.id, courseId)
      const form = formRef.current
      form.action = launchUrl
      // Closes the reverse-tabnabbing gap a plain target="_blank" form
      // leaves open in engines that don't apply noopener to forms the way
      // they do to <a rel="noopener">: without this, the tool's own tab
      // keeps a window.opener handle back to this one, which a malicious
      // or compromised tool page could use to navigate this tab elsewhere.
      form.setAttribute('rel', 'noopener')
      form.innerHTML = ''
      for (const [key, value] of Object.entries(params)) {
        const input = document.createElement('input')
        input.type = 'hidden'
        input.name = key
        input.value = value
        form.appendChild(input)
      }
      form.dataset.toolName = toolName
      form.submit()
    } catch (err) {
      setError(err.message)
    } finally {
      setLaunching(false)
    }
  }

  return (
    <div>
      <p className="text-xs text-secondary mb-2">
        Opens in a new tab. Activity may or may not be reported back to your LearnScope record, depending on the
        tool -- use the mark-complete button below when you're done either way.
      </p>
      <button
        type="button"
        onClick={handleLaunch}
        disabled={launching || !userId}
        className="inline-flex items-center gap-2 rounded-md bg-moss px-4 py-2 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-60"
      >
        {launching ? 'Launching…' : `Open ${contentItem.title || 'tool'}`}
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <path d="M15 3h6v6" />
          <path d="M10 14 21 3" />
        </svg>
      </button>
      {error && <p className="mt-2 text-sm text-red-700" role="alert">{error}</p>}
      {/* Hidden, JS-built form -- target="_blank" opens the tool in a new
          tab/window rather than navigating this one away from the course. */}
      <form ref={formRef} method="POST" target="_blank" className="hidden" />
    </div>
  )
}
