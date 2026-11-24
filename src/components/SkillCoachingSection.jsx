import { useCallback, useEffect, useState } from 'react'
import PersonAvatar from './PersonAvatar'
import ConfirmDialog from './ConfirmDialog'
import CoachingSessions from './CoachingSessions'
import { Part } from './SkillNetworkSection'
import { useLanguage } from '../context/LanguageContext'
import { formatFullDate } from '../lib/dates'
import {
  OPEN_COACHING_STATUSES,
  coachingOnSkill,
  countSkillCoaches,
  endCoaching,
  listMyCoachInterests,
  listMyCoaching,
  listMyCoachingSessions,
  registerCoachInterest,
  respondToCoachingRequest,
  withdrawCoachInterest,
  withdrawCoachingRequest,
} from '../lib/coaching'

// Coaching on the learner's own skill, on its Network tab (0335): their
// coach, or finding one -- and, when no one offers coaching on the skill,
// saying they're looking for one -- and, if they offer coaching on it
// themselves, the people who've asked them and whom they coach. Earlier
// coaching stays listed as history. refreshKey: changes when something
// elsewhere (Find an expert) asked a coach, so this reloads.
export default function SkillCoachingSection({ skill, userId, onFindCoach, refreshKey = 0 }) {
  const { t } = useLanguage()
  const k = (key, params) => t(`skillDetail.coaching.${key}`, params)
  const [rows, setRows] = useState(null)
  const [sessions, setSessions] = useState([])
  const [coachCount, setCoachCount] = useState(null)
  const [interest, setInterest] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState(null)
  const [ending, setEnding] = useState(null)

  const load = useCallback(async () => {
    try {
      const [mine, count, interests, allSessions] = await Promise.all([
        listMyCoaching(),
        countSkillCoaches(skill.library_skill_id),
        listMyCoachInterests(),
        listMyCoachingSessions(),
      ])
      setRows(mine)
      setSessions(allSessions)
      setCoachCount(count)
      setInterest(interests.find((row) => row.skill_id === skill.id) ?? null)
    } catch (err) {
      setError(err.message)
    }
  }, [skill.id, skill.library_skill_id])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  async function act(id, action) {
    setBusyId(id)
    setError(null)
    try {
      await action()
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  if (!skill.library_skill_id) return null
  if (rows === null) {
    return error ? <p role="alert" className="mt-4 text-sm text-red-700">{error}</p> : null
  }

  const { asLearner, asCoach } = coachingOnSkill(rows, skill.id)
  const myCoaches = asLearner.filter((row) => row.status === 'active')
  const myRequests = asLearner.filter((row) => row.status === 'requested')
  const myPast = asLearner.filter((row) => !OPEN_COACHING_STATUSES.includes(row.status))
  const theirRequests = asCoach.filter((row) => row.status === 'requested')
  const coaching = asCoach.filter((row) => row.status === 'active')
  const coachedBefore = asCoach.filter((row) => row.status === 'ended')
  const noCoaches = coachCount === 0 && myCoaches.length === 0

  return (
    <>
      <Part
        id="skill-coaching"
        title={k('title')}
        description={k('description')}
        action={coachCount > 0 ? { label: k('findCoach'), onClick: onFindCoach } : null}
      >
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

        {myCoaches.length > 0 && (
          <CoachingList heading={myCoaches.length === 1 ? k('yourCoach') : k('yourCoaches')}>
            {myCoaches.map((row) => (
              <CoachingPerson
                key={row.id}
                row={row}
                detail={k('coachingYouSince', { date: formatFullDate(row.started_at) })}
                below={<CoachingSessions relationship={row} sessions={sessions.filter((s) => s.relationship_id === row.id)} onChange={load} />}
              >
                <TextButton onClick={() => setEnding(row)} disabled={busyId === row.id}>{k('endCoaching')}</TextButton>
              </CoachingPerson>
            ))}
          </CoachingList>
        )}

        {myRequests.length > 0 && (
          <CoachingList heading={k('askedHeading')}>
            {myRequests.map((row) => (
              <CoachingPerson key={row.id} row={row} detail={k('waitingFor', { date: formatFullDate(row.requested_at) })}>
                <TextButton onClick={() => act(row.id, () => withdrawCoachingRequest(row.id))} disabled={busyId === row.id}>
                  {k('withdraw')}
                </TextButton>
              </CoachingPerson>
            ))}
          </CoachingList>
        )}

        {/* Looking for a coach: said once there's no one offering coaching, and
            kept until they find one or stop looking. */}
        {interest ? (
          <div className="rounded-md bg-moss/5 px-3 py-2">
            <p className="text-sm text-ink">{interest.coach_available_at || !noCoaches ? k('coachNowAvailable') : k('lookingForCoach')}</p>
            <TextButton onClick={() => act('interest', () => withdrawCoachInterest(skill.id))} disabled={busyId === 'interest'}>
              {k('stopLooking')}
            </TextButton>
          </div>
        ) : noCoaches && (
          <div>
            <p className="text-sm text-secondary">{k('noCoaches')}</p>
            <button
              type="button"
              onClick={() => act('interest', () => registerCoachInterest(userId, skill.id))}
              disabled={busyId === 'interest'}
              className="mt-2 rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-ink hover:border-moss hover:text-moss disabled:opacity-60"
            >
              {k('lookForCoach')}
            </button>
          </div>
        )}

        {myPast.length > 0 && (
          <CoachingList heading={k('earlierHeading')}>
            {myPast.map((row) => <CoachingPerson key={row.id} row={row} detail={pastDetail(row, k)} />)}
          </CoachingList>
        )}
      </Part>

      {(skill.offer_coaching || asCoach.length > 0) && (
        <Part id="skill-coaching-others" title={k('youCoachTitle')} description={k('youCoachDescription')}>
          {theirRequests.length === 0 && coaching.length === 0 && coachedBefore.length === 0 && (
            <p className="text-sm text-secondary">{k('noLearnersYet')}</p>
          )}
          {theirRequests.length > 0 && (
            <CoachingList heading={k('requestsHeading')} note={k('acceptConnects')}>
              {theirRequests.map((row) => (
                <CoachingPerson key={row.id} row={row} detail={k('askedOn', { date: formatFullDate(row.requested_at) })} message={row.message}>
                  <button
                    type="button"
                    onClick={() => act(row.id, () => respondToCoachingRequest(row.id, true))}
                    disabled={busyId === row.id}
                    className="rounded-md bg-moss px-3 py-1 text-xs font-medium text-paper hover:opacity-90 disabled:opacity-60"
                  >
                    {k('accept')}
                  </button>
                  <TextButton onClick={() => act(row.id, () => respondToCoachingRequest(row.id, false))} disabled={busyId === row.id}>
                    {k('decline')}
                  </TextButton>
                </CoachingPerson>
              ))}
            </CoachingList>
          )}
          {coaching.length > 0 && (
            <CoachingList heading={k('coachingHeading')}>
              {coaching.map((row) => (
                <CoachingPerson
                  key={row.id}
                  row={row}
                  detail={k('since', { date: formatFullDate(row.started_at) })}
                  below={<CoachingSessions relationship={row} sessions={sessions.filter((s) => s.relationship_id === row.id)} onChange={load} />}
                >
                  <TextButton onClick={() => setEnding(row)} disabled={busyId === row.id}>{k('endCoaching')}</TextButton>
                </CoachingPerson>
              ))}
            </CoachingList>
          )}
          {coachedBefore.length > 0 && (
            <CoachingList heading={k('earlierHeading')}>
              {coachedBefore.map((row) => <CoachingPerson key={row.id} row={row} detail={pastDetail(row, k)} />)}
            </CoachingList>
          )}
        </Part>
      )}

      {ending && (
        <ConfirmDialog
          message={k('confirmEnd', { name: ending.other_name })}
          confirmLabel={k('endCoaching')}
          confirming={busyId === ending.id}
          onCancel={() => setEnding(null)}
          onConfirm={async () => {
            await act(ending.id, () => endCoaching(ending.id))
            setEnding(null)
          }}
        />
      )}
    </>
  )
}

// How earlier coaching ended, with its dates.
function pastDetail(row, k) {
  if (row.status === 'ended') {
    return k('pastEnded', { start: formatFullDate(row.started_at), end: formatFullDate(row.ended_at) })
  }
  if (row.status === 'declined') return k('pastDeclined', { date: formatFullDate(row.responded_at) })
  return k('pastWithdrawn', { date: formatFullDate(row.responded_at) })
}

function CoachingList({ heading, note = null, children }) {
  return (
    <div>
      <p className="text-xs text-secondary mb-1">{heading}</p>
      {note && <p className="text-xs text-secondary mb-2">{note}</p>}
      <ul className="space-y-2">{children}</ul>
    </div>
  )
}

// below: shown under the person, the width of the list (their sessions).
function CoachingPerson({ row, detail, message = null, children = null, below = null }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <PersonAvatar name={row.other_name} avatarUrl={row.other_avatar_url} size={6} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-ink truncate">{row.other_name}</span>
        <span className="block text-xs text-secondary">{detail}</span>
        {message && <span className="mt-1 block whitespace-pre-wrap text-xs text-ink">“{message}”</span>}
      </span>
      {children && <span className="flex items-center gap-3">{children}</span>}
      {below && <div className="w-full">{below}</div>}
    </li>
  )
}

function TextButton({ onClick, disabled = false, children }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="text-xs font-medium text-moss hover:underline disabled:opacity-60">
      {children}
    </button>
  )
}
