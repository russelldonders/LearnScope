import { useState } from 'react'
import ConfirmDialog from './ConfirmDialog'
import ActivityReflection from './ActivityReflection'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import { isHttpUrl } from '../lib/skillResources'
import { REFLECTION_PROMPTS } from '../lib/quickActivityLog'
import {
  PLANNED_SESSION_STATUSES,
  SESSION_LENGTHS,
  cancelCoachingSession,
  completeCoachingSession,
  myDisplayName,
  proposeCoachingSession,
  rescheduleCoachingSession,
  respondToCoachingSession,
} from '../lib/coaching'

// When a session is, in the reader's own time zone.
function sessionTime(startsAt) {
  return new Date(startsAt).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

// A datetime-local value (the reader's local time) for an instant.
function localInputValue(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// The sessions in one coaching relationship (0336), for either person in it:
// planning one, answering the other's proposal, suggesting another time,
// cancelling and -- for the learner, once it has happened -- marking it done,
// which records it as something they did together on the learner's skill
// and offers a reflection. relationship: a row from list_my_coaching;
// sessions: its sessions; onChange: reload after anything changes.
export default function CoachingSessions({ relationship, sessions, onChange, now = Date.now() }) {
  const { t } = useLanguage()
  const { user } = useAuth()
  const k = (key, params) => t(`skillDetail.coaching.sessions.${key}`, params)
  const [planning, setPlanning] = useState(false)
  const [moving, setMoving] = useState(null)
  const [completing, setCompleting] = useState(null)
  const [cancelling, setCancelling] = useState(null)
  const [reflectOn, setReflectOn] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState(null)
  const active = relationship.status === 'active'
  const isLearner = relationship.role === 'learner'
  const name = relationship.other_name

  const planned = sessions.filter((s) => PLANNED_SESSION_STATUSES.includes(s.status))
  const done = sessions.filter((s) => s.status === 'done')

  async function act(id, action) {
    setBusyId(id)
    setError(null)
    try {
      await action()
      await onChange()
      return true
    } catch (err) {
      setError(err.message)
      return false
    } finally {
      setBusyId(null)
    }
  }

  if (!active && planned.length === 0 && done.length === 0) return null

  return (
    <div className="mt-2 ml-8 space-y-2 border-l border-hairline/60 pl-3">
      <p className="text-xs font-medium text-secondary">{k('heading')}</p>
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      {planned.length === 0 && done.length === 0 && <p className="text-xs text-secondary">{k('noSessions')}</p>}

      <ul className="space-y-2">
        {planned.map((session) => {
          const started = new Date(session.starts_at).getTime() <= now
          const busy = busyId === session.id
          return (
            <li key={session.id} className="text-xs">
              <SessionSummary session={session} />
              <p className="text-secondary">
                {session.status === 'proposed'
                  ? (session.proposed_by_me ? k('waitingForThem', { name }) : k('proposedByThem', { name }))
                  : started
                    ? (isLearner ? k('happened') : k('waitingForDone', { name }))
                    : k('confirmed')}
              </p>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                {session.status === 'proposed' && !session.proposed_by_me && (
                  <>
                    <ActionButton primary disabled={busy} onClick={() => act(session.id, () => respondToCoachingSession(session.id, true))}>{k('confirm')}</ActionButton>
                    <ActionButton disabled={busy} onClick={() => act(session.id, () => respondToCoachingSession(session.id, false))}>{k('decline')}</ActionButton>
                  </>
                )}
                {session.status === 'confirmed' && started && isLearner && (
                  <ActionButton primary disabled={busy} onClick={() => setCompleting(session)}>{k('markDone')}</ActionButton>
                )}
                {active && !(session.status === 'confirmed' && started) && (
                  <ActionButton disabled={busy} onClick={() => setMoving(moving?.id === session.id ? null : session)}>{k('suggestTime')}</ActionButton>
                )}
                {/* Once it has started, only the learner says it didn't happen. */}
                {!(session.status === 'confirmed' && started && !isLearner) && (
                  <ActionButton disabled={busy} onClick={() => setCancelling(session)}>{k('callOff')}</ActionButton>
                )}
              </div>
              {moving?.id === session.id && (
                <SessionForm
                  initial={session}
                  submitLabel={k('sendNewTime')}
                  onCancel={() => setMoving(null)}
                  onSubmit={async (plan) => {
                    if (await act(session.id, () => rescheduleCoachingSession(session.id, plan))) setMoving(null)
                  }}
                />
              )}
              {completing?.id === session.id && (
                <CompleteForm
                  session={session}
                  onCancel={() => setCompleting(null)}
                  onSubmit={async (note) => {
                    let row = null
                    const ok = await act(session.id, async () => {
                      const actor = { name: await myDisplayName(user.id), email: user.email }
                      row = await completeCoachingSession({ session, relationship, userId: user.id, actor, title: k('activityTitle', { name }), note })
                    })
                    if (ok) {
                      setCompleting(null)
                      setReflectOn(row)
                    }
                  }}
                />
              )}
            </li>
          )
        })}
      </ul>

      {reflectOn && (
        <div>
          <p role="status" className="text-xs text-moss">{k('recorded')}</p>
          <ActivityReflection
            rows={[reflectOn]}
            promptKey={REFLECTION_PROMPTS[Math.floor(Math.random() * REFLECTION_PROMPTS.length)]}
            idPrefix={`coaching-reflection-${reflectOn.id}`}
            onClose={() => setReflectOn(null)}
          />
        </div>
      )}

      {done.length > 0 && (
        <div>
          <p className="text-xs text-secondary">{k('doneHeading')}</p>
          <ul className="mt-1 space-y-1">
            {[...done].reverse().map((session) => (
              <li key={session.id} className="text-xs text-ink">
                <span aria-hidden="true" className="text-moss">✓ </span>
                {sessionTime(session.starts_at)} · {k('minutes', { count: session.duration_minutes })}
              </li>
            ))}
          </ul>
        </div>
      )}

      {active && (planning ? (
        <SessionForm
          submitLabel={k('propose')}
          onCancel={() => setPlanning(false)}
          onSubmit={async (plan) => {
            if (await act('new', () => proposeCoachingSession(relationship.id, plan))) setPlanning(false)
          }}
        />
      ) : (
        <ActionButton onClick={() => setPlanning(true)}>{k('plan')}</ActionButton>
      ))}

      {cancelling && (
        <ConfirmDialog
          message={k('confirmCallOff', { date: sessionTime(cancelling.starts_at) })}
          confirmLabel={k('callOff')}
          confirming={busyId === cancelling.id}
          onCancel={() => setCancelling(null)}
          onConfirm={async () => {
            await act(cancelling.id, () => cancelCoachingSession(cancelling.id))
            setCancelling(null)
          }}
        />
      )}
    </div>
  )
}

// When, how long, where (a link opens in a new tab) and what for.
function SessionSummary({ session }) {
  const { t } = useLanguage()
  const location = session.location
  return (
    <>
      <p className="text-sm text-ink">
        {sessionTime(session.starts_at)} · {t('skillDetail.coaching.sessions.minutes', { count: session.duration_minutes })}
        {location && (
          <>
            {' · '}
            {isHttpUrl(location) ? (
              <a href={location} target="_blank" rel="noopener noreferrer" className="text-moss hover:underline break-all">{location}</a>
            ) : (
              <span className="break-words">{location}</span>
            )}
          </>
        )}
      </p>
      {session.agenda && <p className="whitespace-pre-wrap text-secondary">{session.agenda}</p>}
    </>
  )
}

function SessionForm({ initial = null, submitLabel, onSubmit, onCancel }) {
  const { t } = useLanguage()
  const k = (key, params) => t(`skillDetail.coaching.sessions.${key}`, params)
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
  tomorrow.setMinutes(0, 0, 0)
  const [when, setWhen] = useState(localInputValue(initial ? new Date(initial.starts_at) : tomorrow))
  const [length, setLength] = useState(initial?.duration_minutes ?? 60)
  const [location, setLocation] = useState(initial?.location ?? '')
  const [agenda, setAgenda] = useState(initial?.agenda ?? '')
  const [saving, setSaving] = useState(false)
  const lengths = SESSION_LENGTHS.includes(length) ? SESSION_LENGTHS : [...SESSION_LENGTHS, length].sort((a, b) => a - b)
  const id = initial?.id ?? 'new'

  async function handleSubmit(e) {
    e.preventDefault()
    if (!when) return
    setSaving(true)
    try {
      await onSubmit({ startsAt: new Date(when).toISOString(), durationMinutes: Number(length), location, agenda })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-2 space-y-2 rounded-md border border-hairline bg-card p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-xs text-secondary" htmlFor={`session-when-${id}`}>
          {k('when')}
          <input
            id={`session-when-${id}`}
            type="datetime-local"
            required
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className="mt-1 block w-full rounded-md border border-hairline bg-paper px-2 py-1.5 text-sm text-ink"
          />
        </label>
        <label className="block text-xs text-secondary" htmlFor={`session-length-${id}`}>
          {k('duration')}
          <select
            id={`session-length-${id}`}
            value={length}
            onChange={(e) => setLength(Number(e.target.value))}
            className="mt-1 block w-full rounded-md border border-hairline bg-paper px-2 py-1.5 text-sm text-ink"
          >
            {lengths.map((minutes) => <option key={minutes} value={minutes}>{k('minutes', { count: minutes })}</option>)}
          </select>
        </label>
      </div>
      <label className="block text-xs text-secondary" htmlFor={`session-location-${id}`}>
        {k('location')}
        <input
          id={`session-location-${id}`}
          type="text"
          maxLength={500}
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          className="mt-1 block w-full rounded-md border border-hairline bg-paper px-2 py-1.5 text-sm text-ink"
        />
      </label>
      <label className="block text-xs text-secondary" htmlFor={`session-agenda-${id}`}>
        {k('agenda')}
        <textarea
          id={`session-agenda-${id}`}
          rows={2}
          maxLength={2000}
          value={agenda}
          onChange={(e) => setAgenda(e.target.value)}
          className="mt-1 block w-full rounded-md border border-hairline bg-paper px-2 py-1.5 text-sm text-ink"
        />
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="rounded-md bg-moss px-3 py-1.5 text-xs font-medium text-paper hover:opacity-90 disabled:opacity-60">
          {submitLabel}
        </button>
        <button type="button" onClick={onCancel} className="rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-ink">
          {k('cancel')}
        </button>
      </div>
    </form>
  )
}

// Marking a session done: an optional note, then it's recorded.
function CompleteForm({ session, onSubmit, onCancel }) {
  const { t } = useLanguage()
  const k = (key, params) => t(`skillDetail.coaching.sessions.${key}`, params)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        setSaving(true)
        try {
          await onSubmit(note)
        } finally {
          setSaving(false)
        }
      }}
      className="mt-2 space-y-2 rounded-md border border-hairline bg-card p-3"
    >
      <p className="text-xs text-secondary">{k('doneExplain')}</p>
      <label className="block text-xs text-secondary" htmlFor={`session-note-${session.id}`}>
        {k('doneNote')}
        <textarea
          id={`session-note-${session.id}`}
          rows={2}
          maxLength={2000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="mt-1 block w-full rounded-md border border-hairline bg-paper px-2 py-1.5 text-sm text-ink"
        />
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="rounded-md bg-moss px-3 py-1.5 text-xs font-medium text-paper hover:opacity-90 disabled:opacity-60">
          {k('saveDone')}
        </button>
        <button type="button" onClick={onCancel} className="rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-ink">
          {k('cancel')}
        </button>
      </div>
    </form>
  )
}

function ActionButton({ onClick, disabled = false, primary = false, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={primary
        ? 'rounded-md bg-moss px-2.5 py-1 text-xs font-medium text-paper hover:opacity-90 disabled:opacity-60'
        : 'text-xs font-medium text-moss hover:underline disabled:opacity-60'}
    >
      {children}
    </button>
  )
}
