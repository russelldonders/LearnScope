import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import ImportProfileDataButton from '../components/ImportProfileDataButton'
import SkillsToLearnStep from '../components/onboarding/SkillsToLearnStep'

export default function Onboarding() {
  const { user, markOnboardingComplete } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState('import')
  const [error, setError] = useState(null)
  const [avatarUrl, setAvatarUrl] = useState(null)
  const [profileFields, setProfileFields] = useState(null)
  const [finishing, setFinishing] = useState(false)

  useEffect(() => {
    supabase
      .from('profiles')
      .select('avatar_url, first_name, last_name, country, location, language')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        setAvatarUrl(data?.avatar_url ?? null)
        setProfileFields(data ?? {})
      })
  }, [])

  async function persistProfileFields(fields) {
    // Only fills fields that are still blank -- never overwrites what the
    // learner already has (e.g. the name they gave at signup).
    const current = profileFields ?? {}
    const updates = {}
    for (const key of ['first_name', 'last_name', 'country', 'location', 'language']) {
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
              Let's get some starting information into your profile. If you have a CV, LinkedIn
              export, or similar document handy, we can pull out your skills, courses and
              experience automatically — you'll review and choose exactly what to keep before
              anything is saved. Or skip this and add things yourself later.
            </p>

            <ImportProfileDataButton
              autoOpen
              hasAvatar={Boolean(avatarUrl)}
              onAvatarSet={setAvatarUrl}
              onProfileFieldsFilled={persistProfileFields}
              onImported={() => setStep('skills')}
            />

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
    </div>
  )
}
