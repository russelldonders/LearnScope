import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import AppHeader from '../components/AppHeader'
import {
  getSearchPrivacySettings,
  updateSearchPrivacySettings,
  listSearchableSkillIds,
  setSkillSearchable,
} from '../lib/skillDiscovery'

const VISIBILITY_OPTIONS = [
  {
    value: 'hidden',
    label: "Don't show me in skill searches",
    detail: "You won't appear when other learners search for people tracking the same skill.",
  },
  {
    value: 'all',
    label: 'Show me for all my skills',
    detail: 'Anyone tracking the same skill as you can find you in that skill’s search, and send a connection request.',
  },
  {
    value: 'selective',
    label: 'Choose which skills to show',
    detail: 'Pick individual skills below — you can also control this from each skill’s own settings.',
  },
]

export default function ProfilePrivacy() {
  const { user } = useAuth()
  const [skillsProfileVisible, setSkillsProfileVisible] = useState(false)
  const [activityFeedVisible, setActivityFeedVisible] = useState(false)
  const [profileVisibleToMatches, setProfileVisibleToMatches] = useState(false)
  const [searchVisibility, setSearchVisibility] = useState('hidden')
  const [autoIncludeNewSkills, setAutoIncludeNewSkills] = useState(false)
  const [loading, setLoading] = useState(true)
  const [privacySaving, setPrivacySaving] = useState(false)
  const [privacyError, setPrivacyError] = useState(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    try {
      const [{ data }, searchSettings] = await Promise.all([
        supabase.from('profiles').select('skills_profile_visible').eq('id', user.id).single(),
        getSearchPrivacySettings(user.id),
      ])
      setSkillsProfileVisible(data?.skills_profile_visible ?? false)
      setActivityFeedVisible(searchSettings?.activity_feed_visible ?? false)
      setProfileVisibleToMatches(searchSettings?.profile_visible_to_skill_matches ?? false)
      setSearchVisibility(searchSettings?.skill_search_visibility ?? 'hidden')
      setAutoIncludeNewSkills(searchSettings?.auto_include_new_skills_in_search ?? false)
    } catch (err) {
      setPrivacyError(err.message)
    } finally {
      setLoading(false)
    }
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

  async function handleActivityFeedToggle(checked) {
    setPrivacyError(null)
    setPrivacySaving(true)
    try {
      await updateSearchPrivacySettings(user.id, { activity_feed_visible: checked })
      setActivityFeedVisible(checked)
    } catch (err) {
      setPrivacyError(err.message)
    }
    setPrivacySaving(false)
  }

  async function handleProfileVisibleToggle(checked) {
    setPrivacyError(null)
    setPrivacySaving(true)
    try {
      await updateSearchPrivacySettings(user.id, { profile_visible_to_skill_matches: checked })
      setProfileVisibleToMatches(checked)
    } catch (err) {
      setPrivacyError(err.message)
    }
    setPrivacySaving(false)
  }

  async function handleVisibilityChange(value) {
    setPrivacyError(null)
    setPrivacySaving(true)
    try {
      await updateSearchPrivacySettings(user.id, { skill_search_visibility: value })
      setSearchVisibility(value)
    } catch (err) {
      setPrivacyError(err.message)
    }
    setPrivacySaving(false)
  }

  async function handleAutoIncludeToggle(checked) {
    setPrivacyError(null)
    setPrivacySaving(true)
    try {
      await updateSearchPrivacySettings(user.id, { auto_include_new_skills_in_search: checked })
      setAutoIncludeNewSkills(checked)
    } catch (err) {
      setPrivacyError(err.message)
    }
    setPrivacySaving(false)
  }

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <h2 className="font-display text-xl text-ink mb-2">Privacy settings</h2>

        {loading ? (
          <p className="text-secondary">Loading…</p>
        ) : (
          <>
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

              <label className="flex items-start gap-3 mt-4 pt-4 border-t border-hairline">
                <input
                  type="checkbox"
                  checked={profileVisibleToMatches}
                  disabled={privacySaving}
                  onChange={(e) => handleProfileVisibleToggle(e.target.checked)}
                  className="mt-0.5 rounded border-hairline"
                />
                <span className="text-sm text-ink">
                  Show my profile to people I'm not connected with yet, if we track the same skill
                  <span className="block text-xs text-secondary mt-0.5">
                    Only applies to people who find you via skill search below — doesn't change
                    who can find you in the first place.
                  </span>
                </span>
              </label>
            </div>

            <div className="bg-card border border-hairline rounded-lg p-6">
              <h3 className="font-display text-lg text-ink mb-1">Activity feed</h3>
              <p className="text-sm text-secondary mb-4">
                Control whether your milestones show up in your connections' "What your
                connections are up to" feed.
              </p>
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={activityFeedVisible}
                  disabled={privacySaving}
                  onChange={(e) => handleActivityFeedToggle(e.target.checked)}
                  className="mt-0.5 rounded border-hairline"
                />
                <span className="text-sm text-ink">
                  Let your connections see your activity
                  <span className="block text-xs text-secondary mt-0.5">
                    Shows things like skills confirmed, new skills or experience added, and
                    courses started — only to people you're already connected with, and off by
                    default.
                  </span>
                </span>
              </label>
            </div>

            <div className="bg-card border border-hairline rounded-lg p-6">
              <h3 className="font-display text-lg text-ink mb-1">Skill search</h3>
              <p className="text-sm text-secondary mb-4">
                Control whether people tracking the same skill as you can find and connect with
                you, even before you're connected.
              </p>
              <div className="space-y-3">
                {VISIBILITY_OPTIONS.map((opt) => (
                  <label key={opt.value} className="flex items-start gap-3">
                    <input
                      type="radio"
                      name="skill-search-visibility"
                      checked={searchVisibility === opt.value}
                      disabled={privacySaving}
                      onChange={() => handleVisibilityChange(opt.value)}
                      className="mt-0.5"
                    />
                    <span className="text-sm text-ink">
                      {opt.label}
                      <span className="block text-xs text-secondary mt-0.5">{opt.detail}</span>
                    </span>
                  </label>
                ))}
              </div>

              {searchVisibility === 'selective' && (
                <div className="mt-4 pt-4 border-t border-hairline space-y-3">
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={autoIncludeNewSkills}
                      disabled={privacySaving}
                      onChange={(e) => handleAutoIncludeToggle(e.target.checked)}
                      className="mt-0.5 rounded border-hairline"
                    />
                    <span className="text-sm text-ink">Show in searches for any newly added skills</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper"
                  >
                    Choose which skills…
                  </button>
                </div>
              )}
            </div>

            {privacyError && <p className="text-sm text-red-700">{privacyError}</p>}
          </>
        )}
      </main>

      {pickerOpen && <SearchableSkillsModal userId={user.id} onClose={() => setPickerOpen(false)} />}
    </div>
  )
}

function SearchableSkillsModal({ userId, onClose }) {
  const [skills, setSkills] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [savingId, setSavingId] = useState(null)

  useEffect(() => {
    Promise.all([
      supabase.from('skills').select('id, name').eq('user_id', userId).order('name', { ascending: true }),
      listSearchableSkillIds(userId),
    ])
      .then(([{ data, error: skillsError }, searchableIds]) => {
        if (skillsError) throw skillsError
        setSkills(data ?? [])
        setSelected(searchableIds)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [userId])

  async function toggle(skillId, checked) {
    setSavingId(skillId)
    setError(null)
    try {
      await setSkillSearchable(userId, skillId, checked)
      setSelected((prev) => {
        const next = new Set(prev)
        if (checked) next.add(skillId)
        else next.delete(skillId)
        return next
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        className="w-full max-w-md bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-2xl text-ink">Skills shown in search</h2>
          <button type="button" onClick={onClose} className="text-secondary hover:text-ink text-sm">
            Close
          </button>
        </div>
        {loading && <p className="text-sm text-secondary">Loading…</p>}
        {error && <p className="text-sm text-red-700 mb-2">{error}</p>}
        {!loading && skills.length === 0 && <p className="text-sm text-secondary">You haven't added any skills yet.</p>}
        <ul className="space-y-2">
          {skills.map((s) => (
            <li key={s.id}>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={selected.has(s.id)}
                  disabled={savingId === s.id}
                  onChange={(e) => toggle(s.id, e.target.checked)}
                  className="rounded border-hairline"
                />
                <span className="text-sm text-ink">{s.name}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
