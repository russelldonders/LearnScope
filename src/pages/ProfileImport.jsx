import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import AppHeader from '../components/AppHeader'
import ImportProfileDataButton from '../components/ImportProfileDataButton'

export default function ProfileImport() {
  const { user } = useAuth()
  const [profileFields, setProfileFields] = useState(null)
  const [avatarUrl, setAvatarUrl] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('profiles')
      .select('avatar_url, first_name, last_name, country, location, language')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        setAvatarUrl(data?.avatar_url ?? null)
        setProfileFields(data ?? {})
        setLoading(false)
      })
  }, [])

  async function persistProfileFields(fields) {
    // Only fills fields that are still blank -- never overwrites what's
    // already on the profile. There's no separate edit-form step on this
    // page, so this writes straight to the database.
    const current = profileFields ?? {}
    const updates = {}
    for (const key of ['first_name', 'last_name', 'country', 'location', 'language']) {
      if (fields[key] && !current[key]) updates[key] = fields[key]
    }
    if (Object.keys(updates).length === 0) return
    updates.updated_at = new Date().toISOString()
    const { error } = await supabase.from('profiles').update(updates).eq('id', user.id)
    if (!error) setProfileFields((prev) => ({ ...prev, ...updates }))
  }

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />

      <main className="max-w-2xl mx-auto px-4 py-8">
        <h2 className="font-display text-xl text-ink mb-2">Import skills & experience</h2>
        <p className="text-sm text-secondary mb-6">
          Upload a CV, LinkedIn export, or similar document — or link to one online — and we'll
          pull out skills, courses, and experience for you to review. Nothing is saved until you
          choose what to keep.
        </p>

        {loading ? (
          <p className="text-secondary">Loading…</p>
        ) : (
          <div className="bg-card border border-hairline rounded-lg p-6">
            <ImportProfileDataButton
              autoOpen
              hasAvatar={Boolean(avatarUrl)}
              onAvatarSet={setAvatarUrl}
              onProfileFieldsFilled={persistProfileFields}
            />
          </div>
        )}
      </main>
    </div>
  )
}
