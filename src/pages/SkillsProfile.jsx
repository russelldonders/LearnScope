import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { getMemberSince, listConnectionRecentGrowth } from '../lib/connections'
import { formatMonthYear, formatRelativeDate, formatAbsoluteDate } from '../lib/dates'
import { LEVEL_LABELS } from '../lib/levels'
import AppHeader from '../components/AppHeader'
import GrowthRing from '../components/GrowthRing'
import GrowthArrow from '../components/GrowthArrow'
import PersonAvatar from '../components/PersonAvatar'

const EXPERT_LEVEL = 5

export default function SkillsProfile() {
  const { userId } = useParams()
  const { user } = useAuth()
  const isOwnProfile = user.id === userId
  const [name, setName] = useState('')
  const [avatarUrl, setAvatarUrl] = useState(null)
  const [location, setLocation] = useState('')
  const [country, setCountry] = useState('')
  const [memberSince, setMemberSince] = useState(null)
  const [visible, setVisible] = useState(false)
  const [skills, setSkills] = useState([])
  const [tagsBySkill, setTagsBySkill] = useState(new Map())
  const [ownLibrarySkillIds, setOwnLibrarySkillIds] = useState(new Set())
  // "In common" only means anything when comparing against someone else --
  // viewing your own profile always shows everything you share, no filter.
  const [filterMode, setFilterMode] = useState(isOwnProfile ? 'all' : 'common')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [growth, setGrowth] = useState([])
  const [growthError, setGrowthError] = useState(null)

  useEffect(() => {
    load()
  }, [userId])

  async function load() {
    setLoading(true)
    setError(null)
    const [{ data: profile, error: profileError }, since] = await Promise.all([
      supabase
        .from('profiles')
        .select('full_name, avatar_url, country, location, skills_profile_visible, profile_visible_to_skill_matches')
        .eq('id', userId)
        .single(),
      getMemberSince(userId).catch(() => null),
    ])
    if (profileError) {
      setError("This person's profile couldn't be found.")
      setLoading(false)
      return
    }
    setName(profile.full_name || 'This person')
    setAvatarUrl(profile.avatar_url ?? null)
    setLocation(profile.location ?? '')
    setCountry(profile.country ?? '')
    setMemberSince(since)
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
      setGrowth(await listConnectionRecentGrowth(userId))
      setGrowthError(null)
    } catch (err) {
      setGrowth([])
      setGrowthError(err.message || 'Something went wrong.')
    }

    setLoading(false)
  }

  const commonSkills = useMemo(
    () => skills.filter((s) => s.library_skill_id && ownLibrarySkillIds.has(s.library_skill_id)),
    [skills, ownLibrarySkillIds]
  )
  const filteredSkills = filterMode === 'common' ? commonSkills : skills
  const expertCount = useMemo(() => skills.filter((s) => s.level === EXPERT_LEVEL).length, [skills])

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
                <p className="text-xs text-secondary mt-1">
                  {memberSince && <span>Member since {formatMonthYear(memberSince.slice(0, 10))}</span>}
                  {memberSince && visible && skills.length > 0 && <span> · </span>}
                  {visible && skills.length > 0 && (
                    <span>
                      {skills.length} skill{skills.length === 1 ? '' : 's'} shared
                      {expertCount > 0 ? ` · Expert in ${expertCount}` : ''}
                    </span>
                  )}
                </p>
              </div>
            </div>

            {!visible ? (
              <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
                <p className="text-secondary">{name} hasn't made their skills profile visible.</p>
              </div>
            ) : (
              <div className="mb-10">
                {!isOwnProfile && skills.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-4" role="group" aria-label="Filter skills">
                    <button
                      type="button"
                      onClick={() => setFilterMode('common')}
                      aria-pressed={filterMode === 'common'}
                      className={`font-mono text-xs rounded-full px-3 py-1 border transition-colors ${
                        filterMode === 'common'
                          ? 'bg-moss text-paper border-moss'
                          : 'border-hairline text-secondary hover:text-ink'
                      }`}
                    >
                      In common ({commonSkills.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setFilterMode('all')}
                      aria-pressed={filterMode === 'all'}
                      className={`font-mono text-xs rounded-full px-3 py-1 border transition-colors ${
                        filterMode === 'all'
                          ? 'bg-moss text-paper border-moss'
                          : 'border-hairline text-secondary hover:text-ink'
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

            {(growth.length > 0 || growthError) && (
              <div>
                <h2 className="font-display text-xl text-ink mb-6">Recent growth</h2>
                {growthError ? (
                  <div className="flex items-center justify-between gap-3 bg-card border border-hairline rounded-lg px-4 py-3">
                    <p className="text-sm text-secondary">Couldn't load recent growth.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {growth.map((row) => (
                      <div
                        key={`${row.skill_id}-${row.assessed_at}`}
                        className="flex items-center gap-4 bg-card border border-hairline rounded-lg px-4 py-4"
                      >
                        <div className="flex items-center gap-2 shrink-0">
                          <GrowthRing level={row.previous_level} size={38} color="var(--color-hairline)" />
                          <GrowthArrow />
                          <GrowthRing level={row.level} size={56} targetLevel={row.target_level} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-ink truncate">{row.skill_name}</p>
                          <p className="text-sm">
                            <span className="text-secondary">
                              {row.previous_level ? LEVEL_LABELS[row.previous_level] : 'New'} →{' '}
                            </span>
                            <span className="text-ink font-medium">{LEVEL_LABELS[row.level]}</span>
                          </p>
                          {row.target_level && (
                            <p
                              className="font-mono text-[11px] uppercase tracking-wide text-secondary mt-1"
                              title={formatAbsoluteDate(row.target_date)}
                            >
                              Target: {LEVEL_LABELS[row.target_level]} · {formatRelativeDate(row.target_date)}
                            </p>
                          )}
                        </div>
                        <p
                          className="font-mono text-xs text-secondary shrink-0 self-start"
                          title={formatAbsoluteDate(row.assessed_at)}
                        >
                          {formatRelativeDate(row.assessed_at)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
