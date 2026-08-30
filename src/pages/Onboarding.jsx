import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import ImportProfileDataButton from '../components/ImportProfileDataButton'
import SkillsToLearnStep from '../components/onboarding/SkillsToLearnStep'

// Fallback if onboarding_steps can't be read for some reason -- keeps the
// wizard working (both steps, current order) rather than stranding a new
// user on a blank screen.
const DEFAULT_STEP_KEYS = ['import', 'skills']

export default function Onboarding() {
  const { user, markOnboardingComplete } = useAuth()
  const navigate = useNavigate()
  // null = not yet loaded from onboarding_steps. Platform-admin-configurable
  // (see /admin/onboarding) -- only the steps an admin has enabled, in
  // order, ever get shown; an empty list finishes onboarding immediately.
  const [stepKeys, setStepKeys] = useState(null)
  const [stepIndex, setStepIndex] = useState(0)
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

  useEffect(() => {
    supabase
      .from('onboarding_steps')
      .select('key')
      .eq('enabled', true)
      .order('order_index')
      .then(({ data, error }) => {
        setStepKeys(!error && data ? data.map((s) => s.key) : DEFAULT_STEP_KEYS)
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

  // Shared by every step's "done" action -- moves to whatever's next in the
  // admin-enabled list, or finishes onboarding once there's nothing left.
  function handleStepComplete() {
    if (stepIndex + 1 < stepKeys.length) setStepIndex((i) => i + 1)
    else finish()
  }

  // Every step disabled: nothing to show, so finish immediately rather than
  // rendering an empty wizard shell.
  useEffect(() => {
    if (stepKeys && stepKeys.length === 0 && !finishing) finish()
  }, [stepKeys])

  if (stepKeys === null || (stepKeys.length === 0 && !error)) {
    return (
      <div className="min-h-screen bg-paper px-4 py-10 flex items-center justify-center">
        <p className="text-secondary">Loading…</p>
      </div>
    )
  }

  const currentStep = stepKeys[stepIndex]

  return (
    <div className="min-h-screen bg-paper px-4 py-10">
      <div className="w-full max-w-xl mx-auto bg-card border border-hairline rounded-lg p-8">
        <span className="font-display text-2xl text-ink mb-1 block">Welcome to LearnScope</span>

        {currentStep === 'import' && (
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
              onImported={handleStepComplete}
            />

            <div className="pt-6 mt-6 border-t border-hairline">
              <button
                type="button"
                onClick={handleStepComplete}
                className="text-sm text-secondary hover:text-ink"
              >
                Skip this step →
              </button>
            </div>
          </>
        )}

        {currentStep === 'skills' && <SkillsToLearnStep onDone={handleStepComplete} />}

        {error && <p className="text-sm text-red-700 mt-4">{error}</p>}
        {finishing && !error && (
          <p className="text-sm text-secondary mt-4">Finishing up…</p>
        )}
      </div>
    </div>
  )
}
