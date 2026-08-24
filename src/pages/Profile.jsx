import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import AppHeader from '../components/AppHeader'
import ProfilePhoto from '../components/ProfilePhoto'
import { COUNTRIES } from '../lib/countries'
import { LANGUAGES } from '../lib/languages'

export default function Profile() {
  const { user, updateEmail, signOut, refreshNeedsName } = useAuth()
  const navigate = useNavigate()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [country, setCountry] = useState('')
  const [location, setLocation] = useState('')
  const [language, setLanguage] = useState('')
  const [avatarUrl, setAvatarUrl] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [savedMessage, setSavedMessage] = useState(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState(null)

  useEffect(() => {
    loadProfile()
  }, [])

  async function loadProfile() {
    setLoading(true)
    setEmail(user.email)
    const { data, error } = await supabase
      .from('profiles')
      .select('first_name, last_name, country, location, language, avatar_url')
      .eq('id', user.id)
      .single()
    if (!error && data) {
      setFirstName(data.first_name ?? '')
      setLastName(data.last_name ?? '')
      setCountry(data.country ?? '')
      setLocation(data.location ?? '')
      setLanguage(data.language ?? '')
      setAvatarUrl(data.avatar_url ?? null)
    }
    setLoading(false)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSavedMessage(null)

    if (!firstName.trim() || !lastName.trim()) {
      setError('Please enter your first and last name.')
      return
    }
    setError(null)
    setSaving(true)

    const { error: profileError } = await supabase
      .from('profiles')
      .update({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        country: country || null,
        location: location.trim() || null,
        language: language || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)

    if (profileError) {
      setError(profileError.message)
      setSaving(false)
      return
    }
    refreshNeedsName()

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

  async function handleDeleteAccount() {
    setDeleteError(null)
    setDeleting(true)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const res = await fetch('/api/delete-account', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to delete account.')

      await signOut()
      navigate('/')
    } catch (err) {
      setDeleteError(err.message)
      setDeleting(false)
    }
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
            </div>

            <form
              onSubmit={handleSubmit}
              className="bg-card border border-hairline rounded-lg p-6 space-y-4"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-secondary mb-1" htmlFor="firstName">
                    First name
                  </label>
                  <input
                    id="firstName"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                  />
                </div>
                <div>
                  <label className="block text-sm text-secondary mb-1" htmlFor="lastName">
                    Last name
                  </label>
                  <input
                    id="lastName"
                    required
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                  />
                </div>
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
                  <select
                    id="country"
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                  >
                    <option value="">Select a country…</option>
                    {country && !COUNTRIES.includes(country) && (
                      <option value={country}>{country}</option>
                    )}
                    {COUNTRIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
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
                <select
                  id="language"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                >
                  <option value="">Select a language…</option>
                  {language && !LANGUAGES.includes(language) && (
                    <option value={language}>{language}</option>
                  )}
                  {LANGUAGES.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
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
              <h3 className="font-display text-lg text-ink mb-1">Your data</h3>
              <p className="text-sm text-secondary mb-4">
                Download a copy of everything in your LearnScope record.
              </p>
              <Link
                to="/profile/export"
                className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper inline-block"
              >
                Download my data
              </Link>
            </div>

            <div className="bg-card border border-red-200 rounded-lg p-6">
              <h3 className="font-display text-lg text-ink mb-1">Delete account</h3>
              <p className="text-sm text-secondary mb-4">
                Permanently deletes your account and everything in it — skills, courses,
                experience, connections, and evidence files. Peer ratings and validations you gave
                to other learners stay as their evidence, with your identity removed. This can't be
                undone.
              </p>
              <label className="block text-sm text-ink mb-2">
                Type <span className="font-mono font-semibold">DELETE</span> to confirm
              </label>
              <input
                type="text"
                value={deleteConfirmText}
                disabled={deleting}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                className="w-full max-w-xs rounded-md border border-hairline px-3 py-1.5 text-sm mb-3"
              />
              <div>
                <button
                  type="button"
                  disabled={deleteConfirmText !== 'DELETE' || deleting}
                  onClick={handleDeleteAccount}
                  className="rounded-md bg-red-700 text-white py-1.5 px-3 text-sm font-medium hover:bg-red-800 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {deleting ? 'Deleting…' : 'Permanently delete my account'}
                </button>
              </div>
              {deleteError && <p className="text-sm text-red-700 mt-3">{deleteError}</p>}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
