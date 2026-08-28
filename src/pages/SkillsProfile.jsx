import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { listConnectionsActivity } from '../lib/connections'
import AppHeader from '../components/AppHeader'
import GrowthRing from '../components/GrowthRing'
import PersonAvatar from '../components/PersonAvatar'
import ConnectionsActivityFeed from '../components/ConnectionsActivityFeed'

export default function SkillsProfile() {
  const { userId } = useParams()
  const { user } = useAuth()
  const isOwnProfile = user.id === userId
  const [name, setName] = useState('')
  const [avatarUrl, setAvatarUrl] = useState(null)
  const [location, setLocation] = useState('')
  const [country, setCountry] = useState('')
  const [visible, setVisible] = useState(false)
  const [skills, setSkills] = useState([])
  const [tagsBySkill, setTagsBySkill] = useState(new Map())
  const [ownLibrarySkillIds, setOwnLibrarySkillIds] = useState(new Set())
  // "In common" only means anything when comparing against someone else --
  // viewing your own profile always shows everything you share, no filter.
  const [filterMode, setFilterMode] = useState(isOwnProfile ? 'all' : 'common')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activity, setActivity] = useState([])
  const [activityError, setActivityError] = useState(null)

  useEffect(() => {
    load()
  }, [userId])

  async function load() {
    setLoading(true)
    setError(null)
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('full_name, avatar_url, country, location, skills_profile_visible, profile_visible_to_skill_matches')
      .eq('id', userId)
      .single()
    if (profileError) {
      setError("This person's profile couldn't be found.")
      setLoading(false)
      return
    }
    setName(profile.full_name || 'This person')
    setAvatarUrl(profile.avatar_url ?? null)
    setLocation(profile.location ?? '')
    setCountry(profile.country ?? '')
    // Either opt-in can grant visibility -- skills_profile_visible for an
    // existing connection, profile_visible_to_skill_matches for someone who
    // shares a skill but isn't connected yet. RLS still gates which rows can
    // come back at all (see 0016/0051 and 0058's SELECT policies on skills),
    // but the "Skills open to being asked to validate are discoverable"
    // policy (0042/0051) permits rows regardless of visible_on_profile, so
    // the per-skill toggle from SkillDetail's SettingsSection must also be
    // enforced explicitly here -- otherwise a skill opted into validator
    // discovery but not into profile visibility would still show up.
    const mayBeVisible = Boolean(profile.skills_profile_visible || profile.profile_visible_to_skill_matches)
    setVisible(mayBeVisible)

    if (mayBeVisible) {
      const [{ data, error: skillsError }, { data: tagLinks }] = await Promise.all([
        supabase
          .from('skills')
          .select('id, name, level, library_skill_id')
          .eq('user_id', userId)
          .eq('visible_on_profile', true)
          .order('name', { ascending: true }),
        supabase.from('skill_tags').select('skill_id, tags(name)').eq('user_id', userId),
      ])
      if (skillsError) {
        setError(skillsError.message)
      } else {
        setSkills(data ?? [])
        const map = new Map()
        for (const link of tagLinks ?? []) {
          if (!link.tags?.name) continue
          if (!map.has(link.skill_id)) map.set(link.skill_id, [])
          map.get(link.skill_id).push(link.tags.name)
        }
        setTagsBySkill(map)
      }

      // Only needed to work out which of their shared skills overlap with
      // yours -- your own tracking list isn't shown, just used to filter
      // theirs (see filteredSkills below).
      if (!isOwnProfile) {
        const { data: mine } = await supabase
          .from('skills')
          .select('library_skill_id')
          .eq('user_id', user.id)
          .not('library_skill_id', 'is', null)
        setOwnLibrarySkillIds(new Set((mine ?? []).map((s) => s.library_skill_id)))
      }
    }

    try {
      setActivity(await listConnectionsActivity(10, userId))
      setActivityError(null)
    } catch (err) {
      setActivity([])
      setActivityError(err.message || 'Something went wrong.')
    }

    setLoading(false)
  }

  const commonSkills = useMemo(
    () => skills.filter((s) => s.library_skill_id && ownLibrarySkillIds.has(s.library_skill_id)),
    [skills, ownLibrarySkillIds]
  )
  const filteredSkills = filterMode === 'common' ? commonSkills : skills

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />

      <main id="main-content" tabIndex={-1} className="max-w-4xl mx-auto px-4 py-8">
        <Link to="/connections" className="text-sm text-secondary hover:text-ink mb-6 inline-block">
          ← Back to connections
        </Link>

        {loading ? (
          <p className="text-secondary">Loading…</p>
        ) : error ? (
          <p className="text-red-700 text-sm">{error}</p>
        ) : (
          <>
            <div className="bg-card border border-hairline rounded-lg p-6 mb-6 flex items-center gap-4">
              <PersonAvatar name={name} avatarUrl={avatarUrl} size={20} />
              <div className="min-w-0">
                <h1 className="font-display text-xl text-ink truncate">{name}</h1>
                {(location || country) && (
                  <p className="text-sm text-secondary truncate">{[location, country].filter(Boolean).join(', ')}</p>
                )}
              </div>
            </div>

            {!visible ? (
              <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
                <p className="text-secondary">{name} hasn't made their skills profile visible.</p>
              </div>
            ) : (
              <div className="mb-10">
                {!isOwnProfile && skills.length > 0 && (
                  <div className="inline-flex rounded-md border border-hairline overflow-hidden mb-4" role="group" aria-label="Filter skills">
                    <button
                      type="button"
                      onClick={() => setFilterMode('common')}
                      aria-pressed={filterMode === 'common'}
                      className={`py-1.5 px-3 text-sm font-medium border-r border-hairline ${
                        filterMode === 'common' ? 'bg-moss text-paper' : 'text-ink hover:bg-paper'
                      }`}
                    >
                      In common ({commonSkills.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setFilterMode('all')}
                      aria-pressed={filterMode === 'all'}
                      className={`py-1.5 px-3 text-sm font-medium ${
                        filterMode === 'all' ? 'bg-moss text-paper' : 'text-ink hover:bg-paper'
                      }`}
                    >
                      All shared skills ({skills.length})
                    </button>
                  </div>
                )}

                {filteredSkills.length === 0 ? (
                  <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
                    <p className="text-secondary">
                      {filterMode === 'common' ? "You don't share any skills in common yet." : 'No skills tracked yet.'}
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {filteredSkills.map((skill) => (
                      <div
                        key={skill.id}
                        className="bg-card border border-hairline rounded-lg p-4 flex gap-4 items-center"
                      >
                        <GrowthRing level={skill.level} size={48} />
                        <div className="min-w-0">
                          <h3 className="font-display text-lg text-ink truncate">{skill.name}</h3>
                          {tagsBySkill.get(skill.id)?.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {tagsBySkill.get(skill.id).map((t) => (
                                <span
                                  key={t}
                                  className="font-mono text-[10px] uppercase tracking-wide text-secondary border border-hairline rounded-full px-2 py-0.5"
                                >
                                  {t}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {(activity.length > 0 || activityError) && (
              <div>
                <h2 className="font-display text-xl text-ink mb-6">Recent activity</h2>
                {activityError ? (
                  <div className="flex items-center justify-between gap-3 bg-card border border-hairline rounded-lg px-4 py-3">
                    <p className="text-sm text-secondary">Couldn't load recent activity.</p>
                  </div>
                ) : (
                  <ConnectionsActivityFeed events={activity} />
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
