import { useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fileToBase64 } from '../lib/fileToBase64'
import CvImportReviewModal from './CvImportReviewModal'

const MAX_FILE_BYTES = 8 * 1024 * 1024

export default function CvImportButton() {
  const inputRef = useRef(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [extracted, setExtracted] = useState(null)
  const [imported, setImported] = useState(false)

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    if (file.type !== 'application/pdf') {
      setError('Please upload a PDF file.')
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      setError('That file is too large (max 8MB).')
      return
    }

    setError(null)
    setLoading(true)
    try {
      const pdfBase64 = await fileToBase64(file)
      const {
        data: { session },
      } = await supabase.auth.getSession()

      const res = await fetch('/api/parse-cv', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ pdfBase64 }),
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
    <div className="bg-card border border-hairline rounded-lg p-4 flex items-center justify-between gap-4">
      <div>
        <h3 className="font-display text-lg text-ink">Import from CV or LinkedIn export</h3>
        <p className="text-sm text-secondary mt-0.5">
          Upload a PDF and we'll pull out skills, courses, and experience for you to review.
        </p>
        {error && <p className="text-sm text-red-700 mt-1">{error}</p>}
        {imported && <p className="text-sm text-moss mt-1">Imported successfully.</p>}
      </div>

      <button
        onClick={() => inputRef.current?.click()}
        disabled={loading}
        className="shrink-0 rounded-md border border-hairline text-ink py-2 px-4 font-medium hover:bg-paper disabled:opacity-60"
      >
        {loading ? 'Reading…' : 'Upload PDF'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        onChange={handleFileChange}
        className="hidden"
      />

      {extracted && (
        <CvImportReviewModal
          extracted={extracted}
          onClose={() => setExtracted(null)}
          onImported={() => {
            setExtracted(null)
            setImported(true)
            window.location.reload()
          }}
        />
      )}
    </div>
  )
}
