import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { getMemberSince, listConnectionRecentGrowth, listMyRatingsGivenTo, rateConnectionSkill } from '../lib/connections'
import { requestSkillAccess } from '../lib/skillDiscovery'
import { formatMonthYear, formatRelativeDate, formatAbsoluteDate } from '../lib/dates'
import { LEVELS, LEVEL_LABELS } from '../lib/levels'
import AppHeader from '../components/AppHeader'
import AccessibleDialog from '../components/AccessibleDialog'
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
  const [requestOpen, setRequestOpen] = useState(false)
  const [requestNote, setRequestNote] = useState('')
  const [requestSending, setRequestSending] = useState(false)
  const [requestError, setRequestError] = useState(null)
  const [requestSent, setRequestSent] = useState(false)
  const [allowRatings, setAllowRatings] = useState(false)
  const [ratingSkill, setRatingSkill] = useState(null)
  const [myRatingBySkillId, setMyRatingBySkillId] = useState({})

  useEffect(() => {
    load()
  }, [userId])

  async function load() {
    setLoading(true)
    setError(null)
    const [{ data: profile, error: profileError }, since] = await Promise.all([
      supabase
        .from('profiles')
        .select(
          'full_name, avatar_url, country, location, skills_profile_visible, profile_visible_to_skill_matches, allow_connection_skill_ratings'
        )
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
    setAllowRatings(Boolean(profile.allow_connection_skill_ratings))
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

        try {
          setMyRatingBySkillId(await listMyRatingsGivenTo((data ?? []).map((s) => s.id)))
        } catch {
          setMyRatingBySkillId({})
        }
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

  async function handleRequestAccess(e) {
    e.preventDefault()
    setRequestSending(true)
    setRequestError(null)
    try {
      await requestSkillAccess({ recipientId: userId, note: requestNote })
      setRequestSent(true)
      setRequestOpen(false)
      setRequestNote('')
    } catch (err) {
      setRequestError(err.message)
    } finally {
      setRequestSending(false)
    }
  }

  async function handleSubmitRating(level, comments) {
    await rateConnectionSkill(ratingSkill, name, level, comments)
    setMyRatingBySkillId((prev) => ({ ...prev, [ratingSkill.id]: { level, ratedAt: new Date().toISOString() } }))
    setRatingSkill(null)
  }

  const canRate = !isOwnProfile && allowRatings

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
                {!isOwnProfile && <RequestAccessButton
                  name={name} requestSent={requestSent} onOpen={() => setRequestOpen(true)} />}
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
                      All skills ({skills.length})
                    </button>
                  </div>
                )}

                {filteredSkills.length === 0 ? (
                  <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
                    <p className="text-secondary">
                      {filterMode === 'common' && skills.length > 0
                        ? "You don't share any skills in common yet."
                        : 'No skills tracked yet.'}
                    </p>
                    {!isOwnProfile && skills.length === 0 && <RequestAccessButton
                      name={name} requestSent={requestSent} onOpen={() => setRequestOpen(true)} />}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {filteredSkills.map((skill) => {
                      const lastRatedAt = myRatingBySkillId[skill.id]?.ratedAt
                      const content = <>
                        <GrowthRing level={skill.level} size={48} />
                        <div className="min-w-0 flex-1">
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
                          {canRate && lastRatedAt && (
                            <p className="text-xs text-secondary mt-1" title={formatAbsoluteDate(lastRatedAt)}>
                              You last rated this skill {formatRelativeDate(lastRatedAt)}
                            </p>
                          )}
                        </div>
                      </>
                      return canRate ? (
                        <button
                          key={skill.id}
                          type="button"
                          onClick={() => setRatingSkill(skill)}
                          className="bg-card border border-hairline rounded-lg p-4 flex gap-4 items-center text-left hover:border-moss/60 transition-colors"
                        >
                          {content}
                        </button>
                      ) : (
                        <div key={skill.id} className="bg-card border border-hairline rounded-lg p-4 flex gap-4 items-center">
                          {content}
                        </div>
                      )
                    })}
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

      {ratingSkill && (
        <RateSkillDialog
          skill={ratingSkill}
          initialLevel={myRatingBySkillId[ratingSkill.id]?.level}
          lastRatedAt={myRatingBySkillId[ratingSkill.id]?.ratedAt}
          onClose={() => setRatingSkill(null)}
          onSubmit={handleSubmitRating}
        />
      )}

      {requestOpen && (
        <AccessibleDialog
          labelledBy="request-skill-access-title"
          onClose={requestSending ? undefined : () => setRequestOpen(false)}
          closeOnBackdrop={!requestSending}
          panelClassName="w-full max-w-md bg-card border border-hairline rounded-lg p-6"
        >
          <h2 id="request-skill-access-title" className="font-display text-xl text-ink mb-2">
            Request skill access
          </h2>
          <p className="text-sm text-secondary mb-4">
            Ask {name} to consider sharing some of their skills with you. They choose what, if anything, to share.
          </p>
          <form onSubmit={handleRequestAccess} className="space-y-3">
            <label className="block text-sm text-ink">
              Note (optional)
              <textarea
                rows={3}
                maxLength={500}
                value={requestNote}
                disabled={requestSending}
                onChange={(e) => setRequestNote(e.target.value)}
                placeholder="Let them know why you're asking"
                className="mt-1 block w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink"
              />
            </label>
            {requestError && <p role="alert" className="text-sm text-red-700">{requestError}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={requestSending}
                onClick={() => setRequestOpen(false)}
                className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={requestSending}
                className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
              >
                {requestSending ? 'Sending…' : 'Send request'}
              </button>
            </div>
          </form>
        </AccessibleDialog>
      )}
    </div>
  )
}

// Defaults to the rater's own last rating for this skill, if they've rated
// it before; otherwise starts at the lowest level rather than the
// skill-owner's level or a mid-scale guess -- an unrated skill shouldn't
// default toward "I already think this is Capable."
function RateSkillDialog({ skill, initialLevel, lastRatedAt, onClose, onSubmit }) {
  const [level, setLevel] = useState(initialLevel ?? LEVELS[0])
  const [comments, setComments] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(level, comments)
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  return (
    <AccessibleDialog
      labelledBy="rate-skill-dialog-title"
      onClose={submitting ? undefined : onClose}
      closeOnBackdrop={!submitting}
      panelClassName="w-full max-w-sm bg-card border border-hairline rounded-lg p-6"
    >
      <h2 id="rate-skill-dialog-title" className="font-display text-xl text-ink mb-4">
        Rate {skill.name}
      </h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <span className="block text-sm text-secondary mb-2">Your rating</span>
          <div className="flex items-center justify-between">
            {LEVELS.map((l) => (
              <button
                type="button"
                key={l}
                disabled={submitting}
                onClick={() => setLevel(l)}
                className={`flex flex-col items-center gap-1 rounded-md px-1 py-1 ${level === l ? 'bg-moss/10' : ''}`}
              >
                <GrowthRing level={l} size={36} />
                <span className="font-mono text-[10px] text-secondary">{LEVEL_LABELS[l]}</span>
                <span className="font-mono text-[9px] text-secondary/70 h-3">{l === initialLevel ? 'Most recent' : ''}</span>
              </button>
            ))}
          </div>
        </div>

        <textarea
          rows={3}
          value={comments}
          disabled={submitting}
          onChange={(e) => setComments(e.target.value)}
          placeholder="Why this level? (optional)"
          className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
        />

        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

        {lastRatedAt && (
          <p className="text-[11px] text-secondary/70" title={formatAbsoluteDate(lastRatedAt)}>
            Last rated {formatRelativeDate(lastRatedAt)}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
          >
            {submitting ? 'Submitting…' : 'Submit rating'}
          </button>
        </div>
      </form>
    </AccessibleDialog>
  )
}

function RequestAccessButton({ name, requestSent, onOpen }) {
  if (requestSent) {
    return <p className="text-sm text-secondary mt-4">Request sent to {name}.</p>
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mt-4 rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper"
    >
      Request skill access
    </button>
  )
}
