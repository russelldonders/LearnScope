import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import GrowthRing from './GrowthRing'
import PersonAvatar from './PersonAvatar'
import { LEVEL_LABELS } from '../lib/levels'
import { listSkillMatches, sendConnectionRequest, isDuplicatePendingRequestError } from '../lib/skillDiscovery'
import AccessibleDialog from './AccessibleDialog'
import SkillLevelFilter from './SkillLevelFilter'
import { LEVEL_FILTER_THRESHOLD, atLeastLevel, sortByLevel } from '../lib/peopleByLevel'
import { useLanguage } from '../context/LanguageContext'
import { requestCoaching } from '../lib/coaching'

const SEARCH_THRESHOLD = 10

// Everyone findable with a skill, experts first. People offering coaching on
// it (0335) are marked Coach and can be shown alone (coachesOnly starts it
// that way, from "Find a coach"). canAskForCoaching: the skill is the
// learner's own, so they can ask a coach to coach them in it; onCoachingChange
// is told when they do.
export default function PeopleWithSkillModal({ librarySkillId, skillName, skillId, onClose, coachesOnly: startCoachesOnly = false, canAskForCoaching = false, onCoachingChange = null }) {
  const { t } = useLanguage()
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [minLevel, setMinLevel] = useState(0)
  const [coachesOnly, setCoachesOnly] = useState(startCoachesOnly)
  // Which form is open: `connect:<user id>` or `coach:<user id>`.
  const [openRequestFor, setOpenRequestFor] = useState(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    listSkillMatches(librarySkillId)
      .then(setMatches)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [librarySkillId])

  // Experts at the top; a level filter once there are enough people to need
  // one (see peopleByLevel.js), as on the skill's Network tab.
  const showLevelFilter = matches.length > LEVEL_FILTER_THRESHOLD
  const hasCoaches = matches.some((m) => m.is_coach)
  const shown = coachesOnly ? matches.filter((m) => m.is_coach) : matches
  const byLevel = sortByLevel(atLeastLevel(shown, showLevelFilter ? minLevel : 0), (m) => m.level, (m) => m.full_name)
  const visible =
    search.trim() && matches.length > SEARCH_THRESHOLD
      ? byLevel.filter((m) => (m.full_name || '').toLowerCase().includes(search.trim().toLowerCase()))
      : byLevel

  function handleRequested(userId) {
    setMatches((prev) => prev.map((m) => (m.user_id === userId ? { ...m, has_pending_request: true } : m)))
    setOpenRequestFor(null)
  }

  function handleCoachingRequested(userId) {
    setMatches((prev) => prev.map((m) => (m.user_id === userId ? { ...m, my_coaching_status: 'requested' } : m)))
    setOpenRequestFor(null)
    onCoachingChange?.()
  }

  function toggleForm(key) {
    setOpenRequestFor(openRequestFor === key ? null : key)
  }

  return (
    <AccessibleDialog
      labelledBy="people-with-skill-dialog-title"
      onClose={onClose}
      panelClassName="w-full max-w-md bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
        <div className="flex items-center justify-between mb-1">
          <h2 id="people-with-skill-dialog-title" className="font-display text-2xl text-ink">{t('modals.peopleWithSkill.title', { skillName })}</h2>
          <button type="button" onClick={onClose} className="text-secondary hover:text-ink text-sm shrink-0">
            {t('modals.peopleWithSkill.close')}
          </button>
        </div>
        <p className="text-xs text-secondary mb-4">
          {t('modals.peopleWithSkill.subtitle')}
        </p>

        {(hasCoaches || coachesOnly) && (
          <label className="flex items-center gap-2 mb-4 text-sm text-ink">
            <input
              type="checkbox"
              checked={coachesOnly}
              onChange={(e) => setCoachesOnly(e.target.checked)}
              className="rounded border-hairline"
            />
            {t('modals.peopleWithSkill.coachesOnly')}
          </label>
        )}

        {showLevelFilter && (
          <SkillLevelFilter id="people-with-skill-level" value={minLevel} onChange={setMinLevel} className="mb-4" />
        )}

        {matches.length > SEARCH_THRESHOLD && (
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('modals.peopleWithSkill.searchPlaceholder')}
            className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-moss"
          />
        )}

        {loading && <p className="text-sm text-secondary">{t('modals.peopleWithSkill.loading')}</p>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

        {!loading && !error && visible.length === 0 && (
          <p className="text-sm text-secondary">
            {coachesOnly && !hasCoaches
              ? t('modals.peopleWithSkill.noCoaches')
              : matches.length === 0 ? t('modals.peopleWithSkill.noOneDiscoverable') : t('modals.peopleWithSkill.noMatches')}
          </p>
        )}

        <ul className="space-y-2">
          {visible.map((m) => (
            <li key={m.user_id} className="rounded-md border border-hairline p-3">
              <div className="flex items-center gap-3">
                {m.profile_viewable ? (
                  <Link
                    to={`/skills-profile/${m.user_id}`}
                    className="flex items-center gap-3 min-w-0 group flex-1"
                  >
                    <PersonAvatar name={m.full_name} avatarUrl={m.avatar_url} />
                    <span className="min-w-0">
                      <span className="block text-sm text-ink font-medium truncate group-hover:text-moss group-hover:underline">
                        {m.full_name || t('modals.peopleWithSkill.someone')}
                      </span>
                      <PersonDetail match={m} />
                    </span>
                  </Link>
                ) : (
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <PersonAvatar name={m.full_name} avatarUrl={m.avatar_url} />
                    <span className="min-w-0">
                      <span className="block text-sm text-ink font-medium truncate">{m.full_name || t('modals.peopleWithSkill.someone')}</span>
                      <PersonDetail match={m} />
                    </span>
                  </div>
                )}
                <GrowthRing level={m.level} size={24} labels={LEVEL_LABELS} />
                {m.is_connection ? (
                  <span className="font-mono text-[10px] uppercase tracking-wide text-secondary/70 shrink-0">
                    {t('modals.peopleWithSkill.connected')}
                  </span>
                ) : m.has_pending_request ? (
                  <span className="font-mono text-[10px] uppercase tracking-wide text-secondary/70 shrink-0">
                    {t('modals.peopleWithSkill.requested')}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => toggleForm(`connect:${m.user_id}`)}
                    className="rounded-full border border-hairline px-3 py-1 text-xs font-medium text-ink hover:border-moss hover:text-moss shrink-0"
                  >
                    {t('modals.peopleWithSkill.connect')}
                  </button>
                )}
              </div>
              {canAskForCoaching && m.is_coach && (
                <div className="mt-2 flex justify-end">
                  {m.my_coaching_status ? (
                    <span className="font-mono text-[10px] uppercase tracking-wide text-moss">
                      {m.my_coaching_status === 'active' ? t('modals.peopleWithSkill.yourCoach') : t('modals.peopleWithSkill.coachingRequested')}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => toggleForm(`coach:${m.user_id}`)}
                      className="rounded-full bg-moss px-3 py-1 text-xs font-medium text-paper hover:opacity-90"
                    >
                      {t('modals.peopleWithSkill.askToCoach')}
                    </button>
                  )}
                </div>
              )}
              {openRequestFor === `connect:${m.user_id}` && (
                <RequestForm
                  placeholder={t('modals.peopleWithSkill.connectPromptPlaceholder', { name: m.full_name || t('modals.peopleWithSkill.thisPerson') })}
                  send={(message) => sendConnectionRequest({ recipientId: m.user_id, skillId, message })}
                  onSent={() => handleRequested(m.user_id)}
                  onCancel={() => setOpenRequestFor(null)}
                />
              )}
              {openRequestFor === `coach:${m.user_id}` && (
                <RequestForm
                  placeholder={t('modals.peopleWithSkill.coachPromptPlaceholder', { name: m.full_name || t('modals.peopleWithSkill.thisPerson') })}
                  note={t('modals.peopleWithSkill.coachConnectsNote')}
                  send={(message) => requestCoaching(skillId, m.coach_skill_id, message)}
                  onSent={() => handleCoachingRequested(m.user_id)}
                  onCancel={() => setOpenRequestFor(null)}
                />
              )}
            </li>
          ))}
        </ul>
    </AccessibleDialog>
  )
}

// Their level in words, and Coach if they offer coaching on the skill.
function PersonDetail({ match }) {
  const { t } = useLanguage()
  if (!match.level && !match.is_coach) return null
  return (
    <span className="flex items-center gap-1.5 text-xs text-secondary">
      {match.is_coach && (
        <span className="rounded-full bg-moss/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-moss">
          {t('modals.peopleWithSkill.coachBadge')}
        </span>
      )}
      {match.level ? LEVEL_LABELS[match.level] : null}
    </span>
  )
}

// An optional message and Send, for a connection request or asking someone
// to coach you. send(message) does the sending; note says what sending it
// will lead to.
function RequestForm({ placeholder, note = null, send, onSent, onCancel }) {
  const { t } = useLanguage()
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)

  async function handleSend() {
    setSending(true)
    setError(null)
    try {
      await send(message)
      onSent()
    } catch (err) {
      if (isDuplicatePendingRequestError(err)) {
        setError(t('modals.peopleWithSkill.alreadyPendingRequest'))
      } else {
        setError(err.message)
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="mt-3 pt-3 border-t border-hairline">
      <textarea
        rows={2}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-xs focus:outline-none focus:ring-2 focus:ring-moss"
      />
      {note && <p className="text-xs text-secondary mt-1">{note}</p>}
      {error &&<p role="alert" className="text-xs text-red-700 mt-1">{error}</p>}
      <div className="flex items-center gap-2 mt-2">
        <button
          type="button"
          onClick={handleSend}
          disabled={sending}
          className="rounded-md bg-moss text-paper py-1.5 px-3 text-xs font-medium hover:opacity-90 disabled:opacity-60"
        >
          {sending ? t('modals.peopleWithSkill.sending') : t('modals.peopleWithSkill.sendRequest')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-hairline text-ink py-1.5 px-3 text-xs font-medium hover:bg-paper"
        >
          {t('modals.peopleWithSkill.cancel')}
        </button>
      </div>
    </div>
  )
}
