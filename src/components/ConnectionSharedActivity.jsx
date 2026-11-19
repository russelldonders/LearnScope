import { useCallback, useEffect, useState } from 'react'
import VoiceInputButton from './VoiceInputButton'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import { usePendingActions } from '../context/PendingActionsContext'
import { supabase } from '../lib/supabaseClient'
import { draftActivitiesFromText } from '../lib/quickActivityLog'
import { durationMinutes, formatMinutes } from '../lib/xapiStatement'
import { LEVEL_LABELS } from '../lib/levels'
import { formatFullDate } from '../lib/dates'
import { localDateString } from '../lib/skillGoalProgress'
import {
  addSharedActivity,
  dismissSharedActivity,
  listSharedActivities,
  matchingSkills,
  saveSharedCard,
  sharedCardProblem,
  sharedCardsFromDraft,
} from '../lib/sharedActivities'

const INPUT_CLASS =
  'w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-moss'

// A connection's Activity tab, above what they've been up to: log something
// you did together, or something you saw them do, in your own words; and
// everything either of you has logged with or about the other ("Between
// you"), where their entries about you can be added to your own record.
//   connection  -- { id, name }
//   theirSkills -- the skills they show you (id, name, library_skill_id)
export default function ConnectionSharedActivity({ connection, theirSkills = [] }) {
  const { user } = useAuth()
  const { t, language } = useLanguage()
  const { refreshPendingActionCount } = usePendingActions()
  const [mySkills, setMySkills] = useState([])
  const [myName, setMyName] = useState('')
  const [rows, setRows] = useState([])
  const [listError, setListError] = useState(null)
  const [text, setText] = useState('')
  const [reading, setReading] = useState(false)
  const [question, setQuestion] = useState(null)
  const [cards, setCards] = useState([])
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(0)
  const [answering, setAnswering] = useState(null)

  const loadRows = useCallback(async () => {
    try {
      setRows(await listSharedActivities(connection.id))
      setListError(null)
    } catch (err) {
      setListError(err.message)
    }
  }, [connection.id])

  useEffect(() => {
    loadRows()
    supabase
      .from('skills')
      .select('id, name, library_skill_id')
      .eq('user_id', user.id)
      .order('name')
      .then(({ data }) => setMySkills(data ?? []))
    supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single()
      .then(({ data }) => setMyName(data?.full_name ?? ''))
  }, [loadRows, user.id])

  const actor = { name: myName, email: user.email }

  async function handleRead(e) {
    e.preventDefault()
    if (!text.trim()) return
    setFormError(null)
    setQuestion(null)
    setSaved(0)
    setReading(true)
    try {
      const draft = await draftActivitiesFromText({
        text, skills: mySkills, goals: [], language, connection: { name: connection.name, skills: theirSkills },
      })
      if (draft.outcome === 'clarify') {
        setQuestion(draft.message)
      } else {
        setCards((current) => [...current, ...sharedCardsFromDraft(draft, mySkills, theirSkills)])
        setText('')
      }
    } catch (err) {
      setFormError(err.message)
    } finally {
      setReading(false)
    }
  }

  function updateCard(key, changes) {
    setCards((current) => current.map((card) => (card.key === key ? { ...card, ...changes } : card)))
    setErrors((current) => ({ ...current, [key]: null }))
  }

  async function handleSave() {
    const problems = Object.fromEntries(
      cards.map((card) => [card.key, sharedCardProblem(card)]).filter(([, problem]) => problem).map(([key, problem]) => [key, t(problem)]),
    )
    if (Object.keys(problems).length > 0) {
      setErrors(problems)
      return
    }
    setSaving(true)
    setFormError(null)
    let count = 0
    try {
      for (const card of cards) {
        await saveSharedCard(card, { userId: user.id, actor, connection })
        count += 1
        setCards((current) => current.filter((other) => other.key !== card.key))
      }
    } catch (err) {
      setFormError(err.message)
    }
    setSaved(count)
    setSaving(false)
    await loadRows()
  }

  async function answer(row, add) {
    setAnswering(row.id)
    setListError(null)
    try {
      if (add) await addSharedActivity(row, { actor, loggedByName: connection.name, mySkills })
      else await dismissSharedActivity(row)
      await loadRows()
      await refreshPendingActionCount?.()
    } catch (err) {
      setListError(err.message)
    } finally {
      setAnswering(null)
    }
  }

  return (
    <div className="space-y-8">
      <section aria-labelledby="shared-log-heading" className="bg-card border border-hairline rounded-lg p-6">
        <h2 id="shared-log-heading" className="font-display text-lg text-ink mb-1">{t('sharedActivity.logHeading', { name: connection.name })}</h2>
        <p className="text-sm text-secondary mb-4">{t('sharedActivity.logIntro', { name: connection.name })}</p>

        <form onSubmit={handleRead} className="space-y-2">
          <label htmlFor="shared-log-text" className="sr-only">{t('sharedActivity.logHeading', { name: connection.name })}</label>
          <textarea
            id="shared-log-text"
            rows={2}
            maxLength={1000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                e.currentTarget.form.requestSubmit()
              }
            }}
            placeholder={t('sharedActivity.placeholder', { name: connection.name })}
            className={INPUT_CLASS}
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={reading || !text.trim()}
              className="rounded-md bg-moss text-paper text-sm font-medium px-4 py-2 hover:opacity-90 disabled:opacity-60"
            >
              {reading ? t('quickLog.reading') : t('quickLog.readButton')}
            </button>
            <VoiceInputButton text={text} onText={setText} onError={setFormError} disabled={reading} />
          </div>
        </form>

        {question && <p role="status" className="text-sm text-ink mt-3">{question}</p>}
        {formError && <p role="alert" className="text-sm text-red-700 mt-3">{formError}</p>}
        {saved > 0 && (
          <p role="status" className="text-sm text-moss mt-3">{t('sharedActivity.saved', { count: saved, name: connection.name })}</p>
        )}

        {cards.length > 0 && (
          <div className="mt-4 space-y-3">
            {cards.map((card) => (
              <SharedCard
                key={card.key}
                card={card}
                connection={connection}
                error={errors[card.key]}
                onChange={(changes) => updateCard(card.key, changes)}
                onRemove={() => setCards((current) => current.filter((other) => other.key !== card.key))}
              />
            ))}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="rounded-md bg-moss text-paper text-sm font-medium px-4 py-2 hover:opacity-90 disabled:opacity-60"
              >
                {saving ? t('quickLog.saving') : t('sharedActivity.save', { count: cards.length })}
              </button>
              <button type="button" onClick={() => setCards([])} disabled={saving} className="text-sm text-secondary hover:text-ink">
                {t('quickLog.discard')}
              </button>
            </div>
          </div>
        )}
      </section>

      {(rows.length > 0 || listError) && (
        <section aria-labelledby="between-you-heading" className="bg-card border border-hairline rounded-lg p-6">
          <h2 id="between-you-heading" className="font-display text-lg text-ink mb-2">{t('sharedActivity.betweenYou')}</h2>
          {listError && <p role="alert" className="text-sm text-red-700 mb-2">{listError}</p>}
          <ul className="divide-y divide-hairline/40">
            {rows.map((row) => (
              <SharedRow
                key={row.id}
                row={row}
                mine={row.logged_by === user.id}
                connection={connection}
                matching={matchingSkills(row, mySkills)}
                answering={answering === row.id}
                onAnswer={(add) => answer(row, add)}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function SharedCard({ card, connection, error, onChange, onRemove }) {
  const { t } = useLanguage()
  const id = (name) => `${card.key}-${name}`
  const joint = card.kind === 'joint'
  const skills = joint ? card.mySkills : card.theirSkills
  const skillsField = joint ? 'mySkills' : 'theirSkills'
  return (
    <article aria-labelledby={id('heading')} className="rounded-lg border border-hairline bg-paper p-4">
      <div className="flex items-start justify-between gap-2 mb-3">
        <h3 id={id('heading')} className="text-sm font-medium text-ink break-words min-w-0">{card.title || t('quickLog.untitled')}</h3>
        <button type="button" onClick={onRemove} className="text-xs text-secondary hover:text-ink shrink-0">{t('quickLog.remove')}</button>
      </div>

      <fieldset className="mb-3">
        <legend className="text-xs text-secondary mb-1">{t('sharedActivity.whoLabel')}</legend>
        <div className="flex flex-wrap gap-2">
          {[['joint', t('sharedActivity.together')], ['observed', t('sharedActivity.theyDidIt', { name: connection.name })]].map(([value, label]) => (
            <label
              key={value}
              className={`cursor-pointer rounded-full border px-3 py-1 text-xs ${card.kind === value ? 'border-moss bg-moss/10 text-ink font-medium' : 'border-hairline text-secondary hover:text-ink'}`}
            >
              <input
                type="radio"
                name={id('kind')}
                value={value}
                checked={card.kind === value}
                onChange={() => onChange({ kind: value })}
                className="sr-only"
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="sm:col-span-2">
          <label htmlFor={id('title')} className="block text-xs text-secondary mb-1">{t('quickLog.titleLabel')}</label>
          <input id={id('title')} value={card.title} maxLength={200} onChange={(e) => onChange({ title: e.target.value })} className={INPUT_CLASS} />
        </div>
        <div>
          <label htmlFor={id('date')} className="block text-xs text-secondary mb-1">{t('quickLog.dateLabel')}</label>
          <input id={id('date')} type="date" max={localDateString()} value={card.date} onChange={(e) => onChange({ date: e.target.value })} className={INPUT_CLASS} />
        </div>
        <div>
          <label htmlFor={id('minutes')} className="block text-xs text-secondary mb-1">{t('quickLog.minutesLabel')}</label>
          <input
            id={id('minutes')}
            type="number"
            inputMode="numeric"
            min="0"
            step="1"
            value={card.durationMinutes}
            onChange={(e) => onChange({ durationMinutes: e.target.value })}
            className={INPUT_CLASS}
          />
        </div>
      </div>

      <div className="mt-3">
        <p className="text-xs text-secondary mb-1">
          {joint ? t('sharedActivity.yourSkills') : t('sharedActivity.theirSkills', { name: connection.name })}
        </p>
        {skills.length > 0 ? (
          <ul className="flex flex-wrap items-center gap-1.5">
            {skills.map((skill) => (
              <li key={skill.id} className="inline-flex items-center gap-1 rounded-full border border-hairline bg-card pl-2.5 pr-1 py-1 text-xs text-ink">
                {skill.name}
                <button
                  type="button"
                  onClick={() => onChange({ [skillsField]: skills.filter((other) => other.id !== skill.id) })}
                  aria-label={t('quickLog.removeSkill', { name: skill.name })}
                  className="rounded-full p-0.5 text-secondary hover:text-ink"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-secondary">{t('sharedActivity.noSkills')}</p>
        )}
        {!joint && <p className="text-xs text-secondary mt-1">{t('sharedActivity.observedNote', { name: connection.name })}</p>}
      </div>

      <div className="mt-3">
        <label htmlFor={id('note')} className="block text-xs text-secondary mb-1">{t('quickLog.noteLabel')}</label>
        <textarea id={id('note')} rows={1} maxLength={2000} value={card.note} onChange={(e) => onChange({ note: e.target.value })} className={INPUT_CLASS} />
      </div>

      {error && <p role="alert" className="text-sm text-red-700 mt-2">{error}</p>}
    </article>
  )
}

// Who logged it and how it relates, from the viewer's side.
function headline(row, mine, name, t) {
  const key = `sharedActivity.${mine ? 'by' : 'from'}.${row.kind}`
  return t(key, { name })
}

function SharedRow({ row, mine, connection, matching, answering, onAnswer }) {
  const { t } = useLanguage()
  const minutes = durationMinutes({ result: { duration: row.duration } })
  // Written by the other person, so taken only as plain text.
  const skills = (Array.isArray(row.skills) ? row.skills : [])
    .map((skill) => (typeof skill?.name === 'string' ? skill.name : null))
    .filter(Boolean)
  // A rating reads as the skill and the level given; anything else as its title.
  const rated = row.kind === 'rated'
  const title = rated ? skills[0] ?? row.title : row.title
  const waitingOnMe = !mine && row.status === 'suggested'
  return (
    <li className="py-3">
      <p className="text-xs text-secondary">
        {headline(row, mine, connection.name, t)} · {formatFullDate(row.happened_at)}
      </p>
      <p className="text-sm text-ink mt-0.5 break-words">
        {title}
        {rated && row.level && <span className="text-secondary"> · {LEVEL_LABELS[row.level]}</span>}
        {minutes > 0 && <span className="text-secondary"> · {formatMinutes(minutes)}</span>}
      </p>
      {!rated && skills.length > 0 && <p className="text-xs text-secondary mt-0.5">{skills.join(', ')}</p>}
      {row.note && !rated && <p className="text-sm text-secondary mt-0.5 break-words line-clamp-3">{row.note}</p>}

      {waitingOnMe ? (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => onAnswer(true)}
            disabled={answering}
            className="rounded-md bg-moss text-paper text-xs font-medium px-3 py-1.5 hover:opacity-90 disabled:opacity-60"
          >
            {t('sharedActivity.add')}
          </button>
          <button type="button" onClick={() => onAnswer(false)} disabled={answering} className="text-xs text-secondary hover:text-ink">
            {t('sharedActivity.dismiss')}
          </button>
          <span className="text-xs text-secondary">
            {matching.length > 0
              ? t('sharedActivity.addsTo', { skills: matching.map((skill) => skill.name).join(', ') })
              : t('sharedActivity.addsToNone')}
          </span>
        </div>
      ) : row.status && (
        <p className="text-xs text-secondary mt-1">{t(`sharedActivity.status.${mine ? 'mine' : 'theirs'}.${row.status}`, { name: connection.name })}</p>
      )}
    </li>
  )
}
