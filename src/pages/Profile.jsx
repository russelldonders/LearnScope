import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import AppHeader from '../components/AppHeader'
import ProfilePhoto from '../components/ProfilePhoto'
import ResumeImportButton from '../components/ResumeImportButton'

export default function Profile() {
  const { user, updateEmail } = useAuth()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [country, setCountry] = useState('')
  const [location, setLocation] = useState('')
  const [language, setLanguage] = useState('')
  const [avatarUrl, setAvatarUrl] = useState(null)
  const [skillsProfileVisible, setSkillsProfileVisible] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [savedMessage, setSavedMessage] = useState(null)
  const [privacySaving, setPrivacySaving] = useState(false)
  const [privacyError, setPrivacyError] = useState(null)

  useEffect(() => {
    loadProfile()
  }, [])

  async function loadProfile() {
    setLoading(true)
    setEmail(user.email)
    const { data, error } = await supabase
      .from('profiles')
      .select('full_name, country, location, language, avatar_url, skills_profile_visible')
      .eq('id', user.id)
      .single()
    if (!error && data) {
      setFullName(data.full_name ?? '')
      setCountry(data.country ?? '')
      setLocation(data.location ?? '')
      setLanguage(data.language ?? '')
      setAvatarUrl(data.avatar_url ?? null)
      setSkillsProfileVisible(data.skills_profile_visible ?? false)
    }
    setLoading(false)
  }

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

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setSavedMessage(null)
    setSaving(true)

    const { error: profileError } = await supabase
      .from('profiles')
      .update({
        full_name: fullName.trim() || null,
        country: country.trim() || null,
        location: location.trim() || null,
        language: language.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)

    if (profileError) {
      setError(profileError.message)
      setSaving(false)
      return
    }

    if (email.trim() !== user.email) {
      const { error: emailError } = await updateEmail(email.trim())
      if (emailError) {
        setError(emailError.message)
        setSaving(false)
        return
      }
      setSavedMessage(
        'Profile saved. Check your new email address for a link to confirm the change.'
      )
    } else {
      setSavedMessage('Profile saved.')
    }

    setSaving(false)
  }

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />

      <main className="max-w-2xl mx-auto px-4 py-8">
        <h2 className="font-display text-xl text-ink mb-6">Your profile</h2>

        {loading ? (
          <p className="text-secondary">Loading…</p>
        ) : (
          <div className="space-y-6">
            <div className="bg-card border border-hairline rounded-lg p-6">
              <ProfilePhoto avatarUrl={avatarUrl} onUploaded={setAvatarUrl} />
              <div className="mt-4">
                <ResumeImportButton
                  hasAvatar={Boolean(avatarUrl)}
                  onAvatarSet={setAvatarUrl}
                  onProfileFieldsFilled={(fields) => {
                    if (fields.full_name && !fullName) setFullName(fields.full_name)
                    if (fields.country && !country) setCountry(fields.country)
                    if (fields.location && !location) setLocation(fields.location)
                    if (fields.language && !language) setLanguage(fields.language)
                  }}
                />
              </div>
            </div>

            <form
              onSubmit={handleSubmit}
              className="bg-card border border-hairline rounded-lg p-6 space-y-4"
            >
              <div>
                <label className="block text-sm text-secondary mb-1" htmlFor="fullName">
                  Name
                </label>
                <input
                  id="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                />
              </div>

              <div>
                <label className="block text-sm text-secondary mb-1" htmlFor="email">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                />
                <p className="text-xs text-secondary mt-1">
                  Changing this sends a confirmation link to the new address.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-secondary mb-1" htmlFor="country">
                    Country
                  </label>
                  <input
                    id="country"
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                  />
                </div>
                <div>
                  <label className="block text-sm text-secondary mb-1" htmlFor="location">
                    Location
                  </label>
                  <input
                    id="location"
                    placeholder="City, region…"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm text-secondary mb-1" htmlFor="language">
                  Language
                </label>
                <input
                  id="language"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                />
              </div>

              {error && <p className="text-sm text-red-700">{error}</p>}
              {savedMessage && <p className="text-sm text-moss">{savedMessage}</p>}

              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-moss text-paper py-2 px-4 font-medium hover:opacity-90 disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </form>

            <div className="bg-card border border-hairline rounded-lg p-6">
              <h3 className="font-display text-lg text-ink mb-1">Privacy</h3>
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
          </div>
        )}
      </main>
    </div>
  )
}
