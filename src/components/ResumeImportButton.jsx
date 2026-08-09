import { useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fileToBase64 } from '../lib/fileToBase64'
import ResumeImportReviewModal from './ResumeImportReviewModal'

const MAX_FILE_BYTES = 8 * 1024 * 1024
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export default function ResumeImportButton({ hasAvatar, onAvatarSet, onProfileFieldsFilled }) {
  const inputRef = useRef(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [extracted, setExtracted] = useState(null)

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

    setError(null)
    setLoading(true)
    try {
      const fileBase64 = await fileToBase64(file)
      const {
        data: { session },
      } = await supabase.auth.getSession()

      const res = await fetch('/api/parse-cv', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ fileBase64, fileType }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to parse the document.')

      const { skills = [], courses = [], experience = [] } = data
      if (skills.length + courses.length + experience.length === 0) {
        setError("Couldn't find anything to import in that file.")
      } else {
        setExtracted(data)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <button
        onClick={() => inputRef.current?.click()}
        disabled={loading}
        className="rounded-md border border-hairline text-ink py-2 px-4 text-sm font-medium hover:bg-paper disabled:opacity-60"
      >
        {loading ? 'Reading…' : 'Import from CV / resume (PDF or Word)'}
      </button>
      <p className="text-xs text-secondary mt-1">
        We'll pull out skills, courses, experience — and your photo, if there isn't one already.
      </p>
      {error && <p className="text-sm text-red-700 mt-1">{error}</p>}

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        onChange={handleFileChange}
        className="hidden"
      />

      {extracted && (
        <ResumeImportReviewModal
          extracted={extracted}
          hasAvatar={hasAvatar}
          onAvatarSet={onAvatarSet}
          onProfileFieldsFilled={onProfileFieldsFilled}
          onClose={() => setExtracted(null)}
          onImported={() => {
            setExtracted(null)
            window.location.reload()
          }}
        />
      )}
    </div>
  )
}
