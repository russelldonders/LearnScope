import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'

// "Import your CV/history", at the top of the Experience page. Shown until
// the learner has run an import once (cv_imported_at, set by
// ResumeImportReviewModal on a first successful import from either the
// onboarding wizard or /profile/import) or has dismissed it.
export default function ImportCvBanner() {
  const { user } = useAuth()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let active = true
    supabase
      .rpc('get_my_profile')
      .select('cv_imported_at, cv_import_banner_dismissed_at')
      .single()
      .then(({ data }) => {
        if (active && data && !data.cv_imported_at && !data.cv_import_banner_dismissed_at) setVisible(true)
      })
    return () => {
      active = false
    }
  }, [])

  // Best-effort: if saving fails, the banner just reappears next visit.
  async function dismiss() {
    setVisible(false)
    await supabase
      .from('profiles')
      .update({ cv_import_banner_dismissed_at: new Date().toISOString() })
      .eq('id', user.id)
  }

  if (!visible) return null

  return (
    <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-lg border border-hairline bg-card px-5 py-4">
      <div>
        <p className="text-sm font-medium text-ink">Have a CV or LinkedIn export handy?</p>
        <p className="text-sm text-secondary mt-0.5">
          Import it to pull in your skills, courses and experience automatically — you'll choose
          exactly what to keep before anything is saved.
        </p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <Link
          to="/profile/import"
          className="rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90 whitespace-nowrap"
        >
          Import now
        </Link>
        <button
          type="button"
          onClick={dismiss}
          className="text-sm text-secondary hover:text-ink whitespace-nowrap"
        >
          Don't show this again
        </button>
      </div>
    </div>
  )
}
