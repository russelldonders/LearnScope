import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fileToBase64 } from '../lib/fileToBase64'
import ResumeImportReviewModal from './ResumeImportReviewModal'

const MAX_FILE_BYTES = 8 * 1024 * 1024
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

// Generalized "import skills, courses & experience" flow: a document
// (CV, LinkedIn export, transcript, etc.) can be provided either as an
// uploaded file or a URL. Shared by the Profile page and the first-login
// wizard rather than duplicated, since both need identical behavior --
// only what happens after import (autoOpen, onImported) differs per caller.
export default function ImportProfileDataButton({
  hasAvatar,
  onAvatarSet,
  onProfileFieldsFilled,
  onImported,
  autoOpen = false,
}) {
  const inputRef = useRef(null)
  const [open, setOpen] = useState(autoOpen)
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [extracted, setExtracted] = useState(null)

  useEffect(() => {
    if (autoOpen) setOpen(true)
  }, [autoOpen])

  async function parseFrom(body) {
    setError(null)
    setLoading(true)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const res = await fetch('/api/parse-cv', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to import.')

      const { skills = [], courses = [], experience = [] } = data
      if (skills.length + courses.length + experience.length === 0) {
        setError("Couldn't find anything to import there.")
      } else {
        setExtracted(data)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    let fileType
    if (file.type === 'application/pdf') fileType = 'pdf'
    else if (file.type === DOCX_MIME) fileType = 'docx'
    else {
      setError('Please upload a PDF or Word (.docx) file.')
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      setError('That file is too large (max 8MB).')
      return
    }

    const fileBase64 = await fileToBase64(file)
    await parseFrom({ fileBase64, fileType })
  }

  function handleUrlSubmit(e) {
    e.preventDefault()
    if (!url.trim()) return
    parseFrom({ url: url.trim() })
  }

  return (
    <div>
      {!open ? (
        <div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-md border border-hairline text-ink py-2 px-4 text-sm font-medium hover:bg-paper"
          >
            Import skills & experience
          </button>
          <p className="text-xs text-secondary mt-1">
            From a CV, LinkedIn export, or similar — we'll pull out skills, courses, experience,
            and your photo, if there isn't one already.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={loading}
              className="rounded-md border border-hairline text-ink py-2 px-4 text-sm font-medium hover:bg-paper disabled:opacity-60"
            >
              {loading ? 'Reading…' : 'Upload a PDF or Word file'}
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>

          <div className="flex items-center gap-3 max-w-sm">
            <span className="flex-1 h-px bg-hairline" />
            <span className="font-mono text-[10px] uppercase tracking-wide text-secondary">or</span>
            <span className="flex-1 h-px bg-hairline" />
          </div>

          <form onSubmit={handleUrlSubmit} className="flex items-center gap-2 max-w-sm">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/my-cv.pdf"
              disabled={loading}
              className="flex-1 rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            />
            <button
              type="submit"
              disabled={loading || !url.trim()}
              className="shrink-0 rounded-md border border-hairline text-ink py-2 px-4 text-sm font-medium hover:bg-paper disabled:opacity-60"
            >
              Import
            </button>
          </form>

          {error && <p className="text-sm text-red-700">{error}</p>}
        </div>
      )}

      {extracted && (
        <ResumeImportReviewModal
          extracted={extracted}
          hasAvatar={hasAvatar}
          onAvatarSet={onAvatarSet}
          onProfileFieldsFilled={onProfileFieldsFilled}
          onClose={() => setExtracted(null)}
          onImported={() => {
            setExtracted(null)
            onImported?.()
          }}
        />
      )}
    </div>
  )
}
