import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { fileToBase64 } from '../lib/fileToBase64'
import ResumeImportReviewModal from '../components/ResumeImportReviewModal'
import SkillsToLearnStep from '../components/onboarding/SkillsToLearnStep'

const MAX_FILE_BYTES = 8 * 1024 * 1024
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export default function Onboarding() {
  const { user, markOnboardingComplete } = useAuth()
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const [step, setStep] = useState('import')
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [extracted, setExtracted] = useState(null)
  const [avatarUrl, setAvatarUrl] = useState(null)
  const [profileFields, setProfileFields] = useState(null)
  const [finishing, setFinishing] = useState(false)

  useEffect(() => {
    supabase
      .from('profiles')
      .select('avatar_url, full_name, country, location, language')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        setAvatarUrl(data?.avatar_url ?? null)
        setProfileFields(data ?? {})
      })
  }, [])

  async function parseCv(body) {
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
      if (!res.ok) throw new Error(data.error || 'Failed to parse the document.')

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
    await parseCv({ fileBase64, fileType })
  }

  function handleUrlSubmit(e) {
    e.preventDefault()
    if (!url.trim()) return
    parseCv({ url: url.trim() })
  }

  async function persistProfileFields(fields) {
    // Only fills fields that are still blank -- never overwrites what the
    // learner already has (e.g. the name they gave at signup).
    const current = profileFields ?? {}
    const updates = {}
    for (const key of ['full_name', 'country', 'location', 'language']) {
      if (fields[key] && !current[key]) updates[key] = fields[key]
    }
    if (Object.keys(updates).length === 0) return
    updates.updated_at = new Date().toISOString()
    // Best-effort -- if this fails, the learner can still fill these in
    // from the profile page, so it shouldn't block the wizard.
    const { error } = await supabase.from('profiles').update(updates).eq('id', user.id)
    if (!error) setProfileFields((prev) => ({ ...prev, ...updates }))
  }

  async function finish() {
    setFinishing(true)
    const { error } = await markOnboardingComplete()
    if (error) {
      setFinishing(false)
      setError("Couldn't finish setup — check your connection and try again.")
      return
    }
    navigate('/dashboard')
  }

  return (
    <div className="min-h-screen bg-paper px-4 py-10">
      <div className="w-full max-w-xl mx-auto bg-card border border-hairline rounded-lg p-8">
        <span className="font-display text-2xl text-ink mb-1 block">Welcome to LearnScope</span>

        {step === 'import' && (
          <>
            <p className="text-sm text-secondary mb-6">
              Let's get some starting information into your profile. If you have a CV or LinkedIn
              export handy, we can pull out your skills, courses and experience automatically —
              you'll review and choose exactly what to keep before anything is saved. Or skip this
              and add things yourself later.
            </p>

            <div className="space-y-4">
              <div>
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  disabled={loading}
                  className="w-full rounded-md border border-hairline text-ink py-2 px-4 text-sm font-medium hover:bg-paper disabled:opacity-60"
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

              <div className="flex items-center gap-3">
                <span className="flex-1 h-px bg-hairline" />
                <span className="font-mono text-[10px] uppercase tracking-wide text-secondary">or</span>
                <span className="flex-1 h-px bg-hairline" />
              </div>

              <form onSubmit={handleUrlSubmit} className="flex items-center gap-2">
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/my-cv.pdf"
                  disabled={loading}
                  className="flex-1 rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                />
                <button
                  type="submit"
                  disabled={loading || !url.trim()}
                  className="rounded-md border border-hairline text-ink py-2 px-4 text-sm font-medium hover:bg-paper disabled:opacity-60"
                >
                  Import
                </button>
              </form>
            </div>

            <div className="pt-6 mt-6 border-t border-hairline">
              <button
                type="button"
                onClick={() => setStep('skills')}
                className="text-sm text-secondary hover:text-ink"
              >
                Skip this step →
              </button>
            </div>
          </>
        )}

        {step === 'skills' && <SkillsToLearnStep onDone={finish} />}

        {error && <p className="text-sm text-red-700 mt-4">{error}</p>}
        {finishing && !error && (
          <p className="text-sm text-secondary mt-4">Finishing up…</p>
        )}
      </div>

      {extracted && (
        <ResumeImportReviewModal
          extracted={extracted}
          hasAvatar={Boolean(avatarUrl)}
          onAvatarSet={setAvatarUrl}
          onProfileFieldsFilled={persistProfileFields}
          onClose={() => setExtracted(null)}
          onImported={() => {
            setExtracted(null)
            setStep('skills')
          }}
        />
      )}
    </div>
  )
}
