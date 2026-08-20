import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import AppHeader from '../components/AppHeader'

export default function ProfilePrivacy() {
  const { user } = useAuth()
  const [skillsProfileVisible, setSkillsProfileVisible] = useState(false)
  const [loading, setLoading] = useState(true)
  const [privacySaving, setPrivacySaving] = useState(false)
  const [privacyError, setPrivacyError] = useState(null)

  useEffect(() => {
    supabase
      .from('profiles')
      .select('skills_profile_visible')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        setSkillsProfileVisible(data?.skills_profile_visible ?? false)
        setLoading(false)
      })
  }, [])

  async function handlePrivacyToggle(checked) {
    setPrivacyError(null)
    setPrivacySaving(true)
    const { error } = await supabase
      .from('profiles')
      .update({ skills_profile_visible: checked, updated_at: new Date().toISOString() })
      .eq('id', user.id)
    if (error) {
      setPrivacyError(error.message)
    } else {
      setSkillsProfileVisible(checked)
    }
    setPrivacySaving(false)
  }

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />

      <main className="max-w-2xl mx-auto px-4 py-8">
        <h2 className="font-display text-xl text-ink mb-6">Privacy settings</h2>

        {loading ? (
          <p className="text-secondary">Loading…</p>
        ) : (
          <div className="bg-card border border-hairline rounded-lg p-6">
            <h3 className="font-display text-lg text-ink mb-1">Skills profile</h3>
            <p className="text-sm text-secondary mb-4">
              Control what people you're connected with can see about you.
            </p>
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={skillsProfileVisible}
                disabled={privacySaving}
                onChange={(e) => handlePrivacyToggle(e.target.checked)}
                className="mt-0.5 rounded border-hairline"
              />
              <span className="text-sm text-ink">
                Let connections view your skills profile by clicking your name on their
                Connections list
                <span className="block text-xs text-secondary mt-0.5">
                  Shows only skill names, categories, and levels — not notes, evidence, or why
                  you're tracking them. Only visible to people you've already exchanged a skill
                  rating with, and off by default.
                </span>
              </span>
            </label>
            {privacyError && <p className="text-sm text-red-700 mt-2">{privacyError}</p>}
          </div>
        )}
      </main>
    </div>
  )
}
