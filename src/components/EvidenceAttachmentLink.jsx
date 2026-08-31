import { useState } from 'react'
import { getEvidenceSignedUrl } from '../lib/skillEvidence'

// A single uploaded evidence file, shown as a button that lazily fetches a
// short-lived signed URL (files live in a private bucket) and opens it in a
// new tab. Shared by skill assessments and skill activity logs -- both
// store evidence the same way (skillEvidence.js), just on different tables.
export default function EvidenceAttachmentLink({ path, index }) {
  const [signedUrl, setSignedUrl] = useState(null)
  const [loadingUrl, setLoadingUrl] = useState(false)
  const [error, setError] = useState(null)

  async function handleViewEvidence() {
    if (signedUrl) {
      window.open(signedUrl, '_blank', 'noopener')
      return
    }
    setLoadingUrl(true)
    setError(null)
    try {
      const url = await getEvidenceSignedUrl(path)
      setSignedUrl(url)
      window.open(url, '_blank', 'noopener')
    } catch {
      setError("Couldn't load — try again")
    } finally {
      setLoadingUrl(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={handleViewEvidence}
        disabled={loadingUrl}
        className="text-xs text-moss font-medium"
      >
        {loadingUrl ? 'Loading…' : `Attachment ${index + 1}`}
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  )
}
