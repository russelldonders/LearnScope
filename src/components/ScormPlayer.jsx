import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { scormLaunchUrl } from '../lib/courseContent'

async function loadProgress(contentItemId, userId) {
  const { data, error } = await supabase
    .from('course_content_progress')
    .select('*')
    .eq('content_item_id', contentItemId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return data
}

// cmi.* elements are set by the content package itself (LMSSetValue), with
// no built-in limit -- cap the serialized size before it's persisted so a
// broken or malicious package can't grow one learner's own progress row
// without bound. 200KB is generous for legitimate suspend_data/bookmarking
// usage.
const MAX_CMI_DATA_BYTES = 200_000

async function saveProgress(contentItemId, userId, { status, score, cmiData }) {
  let serializable = cmiData
  if (JSON.stringify(cmiData).length > MAX_CMI_DATA_BYTES) {
    serializable = { _truncated: true }
  }

  const { error } = await supabase.from('course_content_progress').upsert(
    {
      content_item_id: contentItemId,
      user_id: userId,
      status,
      score,
      cmi_data: serializable,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'content_item_id,user_id' }
  )
  if (error) throw error
}

// A working (if intentionally minimal) SCORM 1.2 run-time environment: the
// content calls window.API.LMS* directly (that's the whole SCORM contract,
// predating anything like postMessage), which only works if the iframe is
// same-origin with this page -- see courseContent.js's publicUrlFor comment
// for why content is served through /course-content/* rather than
// Supabase's own storage domain. Every cmi.* element read/written is kept
// in a flat dict backed by cmi_data jsonb, so content that round-trips its
// own values (suspend_data, bookmarking, etc.) keeps working across
// sessions; cmi.core.lesson_status and cmi.core.score.raw are additionally
// promoted to course_content_progress's own status/score columns so
// progress can be queried without unpacking the blob.
export default function ScormPlayer({ contentItem, userId, onProgress }) {
  const [apiReady, setApiReady] = useState(false)
  const [error, setError] = useState(null)
  const cmiRef = useRef({})
  const statusRef = useRef('not_attempted')
  const scoreRef = useRef(null)
  const initializedRef = useRef(false)
  const lastErrorRef = useRef('0')

  useEffect(() => {
    let cancelled = false

    loadProgress(contentItem.id, userId)
      .then((progress) => {
        if (cancelled) return
        cmiRef.current = progress?.cmi_data ?? {}
        statusRef.current = progress?.status ?? 'not_attempted'
        scoreRef.current = progress?.score ?? null

        window.API = buildScormApi({
          cmiRef,
          statusRef,
          scoreRef,
          lastErrorRef,
          initializedRef,
          userId,
          resumed: Boolean(progress),
          onCommit: async () => {
            await saveProgress(contentItem.id, userId, {
              status: statusRef.current,
              score: scoreRef.current,
              cmiData: cmiRef.current,
            })
            onProgress?.()
          },
        })
        setApiReady(true)
      })
      .catch((err) => setError(err.message))

    return () => {
      cancelled = true
      delete window.API
    }
  }, [contentItem.id, userId])

  const launchUrl = scormLaunchUrl(contentItem)

  if (error) return <p className="text-sm text-red-700">{error}</p>
  if (!launchUrl) return <p className="text-sm text-red-700">This SCORM package has no launch page.</p>
  if (!apiReady) return <p className="text-sm text-secondary">Loading…</p>

  return (
    <>
      <p className="text-xs text-secondary mb-2">
        SCORM progress tracking (completion, score) isn't wired up yet -- content displays, but doesn't report
        back to your account.
      </p>
      <iframe
        title={contentItem.title}
        src={launchUrl}
        className="w-full h-[600px] border border-hairline rounded-md bg-paper"
        // Deliberately NOT allow-same-origin: content is served through
        // /course-content/*, same origin as the app itself (required so
        // SCORM's own window.parent.API lookup could work at all), which
        // means allow-same-origin + allow-scripts together would hand
        // uploaded, unreviewed content full access to this app's own
        // localStorage/cookies -- including the Supabase session token
        // supabase-js persists there by default. Without it, the sandboxed
        // frame gets an opaque origin instead: it can still run and
        // display, but can't read the parent's storage, and window.API
        // (below) genuinely isn't reachable from inside it either -- that's
        // the security boundary working as intended, not a bug to route
        // around. Real LMS integration needs a separate, cookie-free
        // content origin bridging via postMessage; deferred until that
        // exists. No allow-popups either -- unreviewed content on the app's
        // own origin is not somewhere phishing popups should be allowed
        // from.
        sandbox="allow-scripts allow-forms"
      />
    </>
  )
}

function buildScormApi({ cmiRef, statusRef, scoreRef, lastErrorRef, initializedRef, resumed, onCommit }) {
  function get(element) {
    if (element === 'cmi.core.lesson_status') return statusRef.current === 'not_attempted' ? 'not attempted' : statusRef.current
    if (element === 'cmi.core.score.raw') return scoreRef.current == null ? '' : String(scoreRef.current)
    if (element === 'cmi.core.entry') return resumed ? 'resume' : 'ab-initio'
    if (element === 'cmi.core.credit') return 'credit'
    if (element === 'cmi.core.lesson_mode') return 'normal'
    return cmiRef.current[element] ?? ''
  }

  function set(element, value) {
    if (element === 'cmi.core.lesson_status') {
      // SCORM's own status vocabulary ("passed"/"failed"/"completed"/
      // "incomplete"/"browsed"/"not attempted") maps onto
      // course_content_progress's check constraint 1:1 except the space in
      // "not attempted" vs our "not_attempted".
      statusRef.current = value === 'not attempted' ? 'not_attempted' : value
      return
    }
    if (element === 'cmi.core.score.raw') {
      const n = Number(value)
      scoreRef.current = Number.isFinite(n) ? n : null
      return
    }
    cmiRef.current[element] = value
  }

  return {
    LMSInitialize() {
      if (initializedRef.current) {
        lastErrorRef.current = '101'
        return 'false'
      }
      initializedRef.current = true
      lastErrorRef.current = '0'
      return 'true'
    },
    LMSFinish() {
      if (!initializedRef.current) {
        lastErrorRef.current = '301'
        return 'false'
      }
      // A content package that never explicitly sets a final status (e.g.
      // simple video-only SCOs) still counts as complete once the learner
      // reaches the end and the package calls Finish.
      if (statusRef.current === 'not_attempted') statusRef.current = 'completed'
      initializedRef.current = false
      lastErrorRef.current = '0'
      onCommit()
      return 'true'
    },
    LMSGetValue(element) {
      if (!initializedRef.current) {
        lastErrorRef.current = '301'
        return ''
      }
      lastErrorRef.current = '0'
      return get(element)
    },
    LMSSetValue(element, value) {
      if (!initializedRef.current) {
        lastErrorRef.current = '301'
        return 'false'
      }
      set(element, value)
      lastErrorRef.current = '0'
      return 'true'
    },
    LMSCommit() {
      if (!initializedRef.current) {
        lastErrorRef.current = '301'
        return 'false'
      }
      onCommit()
      lastErrorRef.current = '0'
      return 'true'
    },
    LMSGetLastError() {
      return lastErrorRef.current
    },
    LMSGetErrorString(code) {
      return { '0': 'No error', '101': 'General exception', '301': 'Not initialized' }[code] ?? 'Unknown error'
    },
    LMSGetDiagnostic(code) {
      return code
    },
  }
}
