import { useEffect, useMemo, useRef, useState } from 'react'
import SkillPickerModal from './SkillPickerModal'
import ActivityReflection from './ActivityReflection'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import { supabase } from '../lib/supabaseClient'
import { saveActivity } from '../lib/activitySkillLinks'
import { linkSkillToExperiences } from '../lib/currentRole'
import { experienceTrail } from '../lib/xapiStatement'
import { findOrCreatePersonalSkill } from '../lib/skillLibrary'
import { XAPI_VERBS } from '../lib/xapiVerbs'
import { distanceUnitFromPace, goalLogFeedback, localDateString } from '../lib/skillGoalProgress'
import {
  buildCardStatement,
  cardFromRow,
  cardFromTemplate,
  cardsFromDraft,
  currentExperiences,
  derivedGoalsForCard,
  draftActivitiesFromText,
  REFLECTION_PROMPTS,
  repeatTemplates,
} from '../lib/quickActivityLog'

const INPUT_CLASS =
  'w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss'
const RECENT_ROWS = 60

// The browser's speech-to-text, where it has one (Chrome, Edge, Safari).
function speechRecognitionClass() {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition || window.webkitSpeechRecognition || null
}

// The browser's own regional variant when it matches the app's language
// (so en-GB stays en-GB), otherwise the app's language.
function speechLanguage(language) {
  const browser = typeof navigator !== 'undefined' ? navigator.language : ''
  if (browser?.toLowerCase().startsWith(language)) return browser
  return language === 'zh' ? 'zh-CN' : language
}

// "What did you do?" on the dashboard. A sentence becomes draft activities the
// learner checks and edits before anything is saved; things they log often can
// be repeated with one tap. Goal values ride along on the activity, so goals
// update the same way as logging from a goal's own tracker. repeatRequest
// ({ row, nonce }) adds a card copying an activity from elsewhere on the page,
// to check and save like any other.
export default function QuickActivityLog({ user, goalItems, onLogged, onOpenFullForm, repeatRequest = null }) {
  const { t, language } = useLanguage()
  const sectionRef = useRef(null)
  const [skills, setSkills] = useState([])
  const [experiences, setExperiences] = useState([])
  const [recentRows, setRecentRows] = useState([])
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef(null)
  const SpeechRecognition = useMemo(speechRecognitionClass, [])
  const [actorName, setActorName] = useState('')
  const [text, setText] = useState('')
  const [reading, setReading] = useState(false)
  const [question, setQuestion] = useState(null)
  const [cards, setCards] = useState([])
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState(null)

  const goals = useMemo(() => goalItems.map((item) => item.goal), [goalItems])
  const templates = useMemo(() => repeatTemplates(recentRows, skills, goals), [recentRows, skills, goals])

  async function loadSkills() {
    const { data } = await supabase.from('skills').select('id, name').eq('user_id', user.id).order('name')
    setSkills(data ?? [])
  }

  // Current roles and projects an activity can be part of; read from the whole
  // Experience list so a project's parent job is available for its trail.
  async function loadExperiences() {
    const { data } = await supabase
      .from('experience')
      .select('id, title, organization, type, start_date, end_date, parent_experience_id')
      .eq('user_id', user.id)
    setExperiences(currentExperiences(data ?? []))
  }

  async function loadRecent() {
    const { data } = await supabase
      .from('xapi_statements')
      .select('id, statement, resource_id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(RECENT_ROWS)
    setRecentRows(data ?? [])
  }

  useEffect(() => () => recognitionRef.current?.abort(), [])

  // "Log again" from the activity list. Waits for the learner's skills, since
  // the card only keeps skills they still have.
  const handledRepeat = useRef(null)
  useEffect(() => {
    if (!repeatRequest || handledRepeat.current === repeatRequest.nonce || skills.length === 0) return
    handledRepeat.current = repeatRequest.nonce
    const card = cardFromRow(repeatRequest.row, skills, goals)
    if (!card) return
    setResult(null)
    setCards((current) => [...current, card])
    sectionRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    sectionRef.current?.focus({ preventScroll: true })
  }, [repeatRequest, skills, goals])

  function toggleListening() {
    if (listening) {
      recognitionRef.current?.stop()
      return
    }
    const recognition = new SpeechRecognition()
    recognition.lang = speechLanguage(language)
    recognition.interimResults = true
    recognition.continuous = false
    // What they say is added to anything already typed, never replacing it.
    const typed = text.trim()
    recognition.onresult = (event) => {
      const spoken = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join('')
        .trim()
      setText([typed, spoken].filter(Boolean).join(' '))
    }
    recognition.onerror = (event) => {
      if (event.error === 'aborted' || event.error === 'no-speech') return
      const blocked = event.error === 'not-allowed' || event.error === 'service-not-allowed'
      setFormError(t(blocked ? 'quickLog.voice.blocked' : 'quickLog.voice.failed'))
    }
    recognition.onend = () => {
      setListening(false)
      recognitionRef.current = null
    }
    recognitionRef.current = recognition
    setFormError(null)
    setResult(null)
    try {
      recognition.start()
      setListening(true)
    } catch {
      recognitionRef.current = null
      setFormError(t('quickLog.voice.failed'))
    }
  }

  useEffect(() => {
    loadSkills()
    loadExperiences()
    loadRecent()
    supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single()
      .then(({ data }) => setActorName(data?.full_name ?? ''))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loads once per learner; the loaders are recreated every render
  }, [user.id])

  async function handleRead(e) {
    e.preventDefault()
    const sentence = text.trim()
    if (!sentence) return
    setFormError(null)
    setQuestion(null)
    setResult(null)
    setReading(true)
    try {
      const draft = await draftActivitiesFromText({ text: sentence, skills, goals, experiences, language })
      if (draft.outcome === 'clarify') {
        setQuestion(draft.message)
      } else {
        setCards((current) => [...current, ...cardsFromDraft(draft, skills, goals, experiences)])
        setText('')
      }
    } catch (err) {
      setFormError(err.message)
    } finally {
      setReading(false)
    }
  }

  function addTemplate(template) {
    setResult(null)
    setCards((current) => [...current, cardFromTemplate(template.card)])
  }

  function updateCard(key, changes) {
    setCards((current) => current.map((card) => (card.key === key ? { ...card, ...changes } : card)))
    setErrors((current) => ({ ...current, [key]: null }))
  }

  function removeCard(key) {
    setCards((current) => current.filter((card) => card.key !== key))
  }

  async function handleSave() {
    const actor = { name: actorName, email: user.email }
    const built = cards.map((card) => ({ card, ...buildCardStatement(card, goals, actor, experiences) }))
    const problems = Object.fromEntries(
      built
        .filter((b) => b.error)
        .map((b) => [b.card.key, b.goal ? `${b.goal.title}: ${t(b.error)}` : t(b.error)]),
    )
    if (Object.keys(problems).length > 0) {
      setErrors(problems)
      return
    }

    setSaving(true)
    setFormError(null)
    const touchedGoalIds = new Set(
      cards.flatMap((card) => [
        ...card.goalValues.map((entry) => entry.goalId),
        ...derivedGoalsForCard(card, goals).map((goal) => goal.id),
      ]),
    )
    const before = new Map(goalItems.map((item) => [item.goal.id, item.progress]))
    const savedRows = []
    try {
      for (const { card, statement, skillIds, experienceId } of built) {
        const row = await saveActivity({ userId: user.id, statement, evidence: null, skillIds, experienceId })
        // Same as logging from the full form: an activity done as part of a
        // role or project also links its skills to that role or project.
        if (experienceId) {
          for (const skillId of skillIds) await linkSkillToExperiences(user.id, skillId, [experienceId])
        }
        savedRows.push({ id: row.id, statement: row.statement })
        removeCard(card.key)
      }
    } catch (err) {
      setFormError(err.message)
    }
    const saved = savedRows.length
    const refreshed = (await onLogged()) ?? []
    await loadRecent()
    const celebrations = refreshed
      .filter((item) => touchedGoalIds.has(item.goal.id) && before.has(item.goal.id))
      .map((item) => {
        const key = goalLogFeedback(item.goal, before.get(item.goal.id), item.progress)
        if (key === 'skillGoals.dashboard.reachedNow') return t('quickLog.reachedOn', { goal: item.goal.title })
        if (key === 'skillGoals.dashboard.newBest') return t('quickLog.newBestOn', { goal: item.goal.title })
        return null
      })
      .filter(Boolean)
    if (saved > 0) {
      const prompt = REFLECTION_PROMPTS[Math.floor(Math.random() * REFLECTION_PROMPTS.length)]
      setResult({ saved, celebrations, rows: savedRows, prompt })
    }
    setSaving(false)
  }

  return (
    <section ref={sectionRef} tabIndex={-1} aria-labelledby="quick-log-heading" className="focus:outline-none">
      <h2 id="quick-log-heading" className="font-display text-xl text-ink mb-1">{t('quickLog.title')}</h2>
      <p className="text-sm text-secondary mb-4">{t('quickLog.subtitle')}</p>

      <form onSubmit={handleRead} className="space-y-2">
        <label htmlFor="quick-log-text" className="sr-only">{t('quickLog.title')}</label>
        <textarea
          id="quick-log-text"
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
          placeholder={t('quickLog.placeholder')}
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
          {SpeechRecognition && (
            <button
              type="button"
              onClick={toggleListening}
              disabled={reading}
              aria-pressed={listening}
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-60 ${
                listening ? 'border-moss bg-moss/10 text-moss' : 'border-hairline bg-card text-ink hover:border-moss'
              }`}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
              </svg>
              {listening ? t('quickLog.voice.stop') : t('quickLog.voice.start')}
            </button>
          )}
          {onOpenFullForm && (
            <button type="button" onClick={onOpenFullForm} className="text-sm text-secondary hover:text-ink underline">
              {t('quickLog.fullForm')}
            </button>
          )}
        </div>
        {listening && (
          <p role="status" className="text-xs text-secondary">{t('quickLog.voice.listening')}</p>
        )}
      </form>

      {question && (
        <p role="status" className="mt-3 rounded-md border border-hairline bg-card px-3 py-2 text-sm text-ink">
          {question} <span className="text-secondary">{t('quickLog.answerHint')}</span>
        </p>
      )}
      {formError && <p role="alert" className="text-sm text-red-700 mt-3">{formError}</p>}

      {templates.length > 0 && (
        <div className="mt-4">
          <p className="font-mono text-[11px] uppercase tracking-wide text-secondary mb-2">{t('quickLog.repeatHeading')}</p>
          <ul className="flex flex-wrap gap-2">
            {templates.map((template) => (
              <li key={template.label}>
                <button
                  type="button"
                  onClick={() => addTemplate(template)}
                  className="rounded-full border border-hairline bg-card px-3 py-1.5 text-xs text-ink hover:border-moss text-left"
                >
                  + {template.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {cards.length > 0 && (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-secondary">{t('quickLog.checkHint')}</p>
          {cards.map((card) => (
            <DraftCard
              key={card.key}
              card={card}
              skills={skills}
              goals={goals}
              experiences={experiences}
              error={errors[card.key]}
              onChange={(changes) => updateCard(card.key, changes)}
              onRemove={() => removeCard(card.key)}
              onSkillCreated={(skill) => setSkills((current) => [...current, skill].sort((a, b) => a.name.localeCompare(b.name)))}
            />
          ))}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-md bg-moss text-paper text-sm font-medium px-4 py-2 hover:opacity-90 disabled:opacity-60"
            >
              {saving ? t('quickLog.saving') : t('quickLog.saveButton', { count: cards.length })}
            </button>
            <button type="button" onClick={() => setCards([])} disabled={saving} className="text-sm text-secondary hover:text-ink">
              {t('quickLog.discard')}
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="mt-3">
          <div role="status" className="text-sm text-moss">
            <p>{t('quickLog.saved', { count: result.saved })}</p>
            {result.celebrations.map((line) => <p key={line} className="font-medium">{line}</p>)}
          </div>
          <ActivityReflection key={result.rows.map((row) => row.id).join(',')} rows={result.rows} promptKey={result.prompt} />
        </div>
      )}
    </section>
  )
}

function DraftCard({ card, skills, goals, experiences, error, onChange, onRemove, onSkillCreated }) {
  const { t } = useLanguage()
  const { user } = useAuth()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [addingSkill, setAddingSkill] = useState(false)
  const [skillError, setSkillError] = useState(null)
  const id = (field) => `${card.key}-${field}`
  const derived = derivedGoalsForCard(card, goals)

  async function addSuggestedSkill() {
    setSkillError(null)
    setAddingSkill(true)
    try {
      const { skill, created } = await findOrCreatePersonalSkill(user.id, card.newSkill)
      if (created) onSkillCreated(skill)
      onChange({ skills: [...card.skills, skill], newSkill: null })
    } catch (err) {
      setSkillError(err.message)
    } finally {
      setAddingSkill(false)
    }
  }

  function setGoalField(goalId, field, value) {
    onChange({
      goalValues: card.goalValues.map((entry) => (entry.goalId === goalId ? { ...entry, [field]: value } : entry)),
    })
  }

  return (
    <article aria-labelledby={id('heading')} className="rounded-lg border border-hairline bg-card p-4">
      <div className="flex items-start justify-between gap-2 mb-3">
        <h3 id={id('heading')} className="text-sm font-medium text-ink break-words min-w-0">{card.title || t('quickLog.untitled')}</h3>
        <button type="button" onClick={onRemove} className="text-xs text-secondary hover:text-ink shrink-0">
          {t('quickLog.remove')}
        </button>
      </div>

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
        <div>
          <label htmlFor={id('verb')} className="block text-xs text-secondary mb-1">{t('quickLog.verbLabel')}</label>
          <select id={id('verb')} value={card.verb} onChange={(e) => onChange({ verb: e.target.value })} className={INPUT_CLASS}>
            {XAPI_VERBS.map((verb) => (
              <option key={verb.value} value={verb.value}>{verb.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-3">
        <p className="text-xs text-secondary mb-1">{t('quickLog.skillsLabel')}</p>
        <ul className="flex flex-wrap items-center gap-1.5">
          {card.skills.map((skill) => (
            <li key={skill.id} className="inline-flex items-center gap-1 rounded-full border border-hairline bg-paper pl-2.5 pr-1 py-1 text-xs text-ink">
              {skill.name}
              <button
                type="button"
                onClick={() => onChange({ skills: card.skills.filter((other) => other.id !== skill.id) })}
                aria-label={t('quickLog.removeSkill', { name: skill.name })}
                className="rounded-full p-0.5 text-secondary hover:text-ink"
              >
                ×
              </button>
            </li>
          ))}
          <li>
            <button type="button" onClick={() => setPickerOpen(true)} className="text-xs text-moss font-medium hover:underline px-1">
              {card.skills.length ? t('quickLog.changeSkills') : t('quickLog.chooseSkill')}
            </button>
          </li>
        </ul>
        {card.newSkill && card.skills.length === 0 && (
          <p className="text-xs text-secondary mt-2">
            {t('quickLog.newSkillPrompt', { name: card.newSkill })}{' '}
            <button type="button" onClick={addSuggestedSkill} disabled={addingSkill} className="text-moss font-medium hover:underline disabled:opacity-60">
              {t('quickLog.addSkill', { name: card.newSkill })}
            </button>
          </p>
        )}
        {skillError && <p role="alert" className="text-xs text-red-700 mt-1">{skillError}</p>}
      </div>

      {card.goalValues.length > 0 && (
        <div className="mt-3 space-y-2">
          {card.goalValues.map((entry) => {
            const goal = goals.find((other) => other.id === entry.goalId)
            if (!goal) return null
            return (
              <fieldset key={entry.goalId} className="rounded-md border border-hairline bg-paper p-2">
                <legend className="px-1 text-xs text-secondary">{t('quickLog.countsTowards', { goal: goal.title })}</legend>
                <div className="flex flex-wrap items-end gap-2">
                  <GoalValueFields goal={goal} entry={entry} idPrefix={id(`goal-${goal.id}`)} onField={(field, value) => setGoalField(goal.id, field, value)} />
                  <button
                    type="button"
                    onClick={() => onChange({ goalValues: card.goalValues.filter((other) => other.goalId !== goal.id) })}
                    className="text-xs text-secondary hover:text-ink py-2"
                  >
                    {t('quickLog.notForGoal')}
                  </button>
                </div>
              </fieldset>
            )
          })}
        </div>
      )}
      {derived.length > 0 && (
        <p className="mt-2 text-xs text-secondary">
          {t('quickLog.alsoCounts', { goals: derived.map((goal) => goal.title).join(', ') })}
        </p>
      )}

      {experiences.length > 0 && (
        <div className="mt-3">
          <label htmlFor={id('experience')} className="block text-xs text-secondary mb-1">{t('quickLog.partOfLabel')}</label>
          <select
            id={id('experience')}
            value={card.experienceId ?? ''}
            onChange={(e) => onChange({ experienceId: e.target.value || null })}
            className={INPUT_CLASS}
          >
            <option value="">{t('quickLog.partOfNone')}</option>
            {experiences.map((experience) => (
              <option key={experience.id} value={experience.id}>{experienceTrail(experience)}</option>
            ))}
          </select>
        </div>
      )}

      <div className="mt-3">
        <label htmlFor={id('note')} className="block text-xs text-secondary mb-1">{t('quickLog.noteLabel')}</label>
        <textarea id={id('note')} rows={1} maxLength={2000} value={card.note} onChange={(e) => onChange({ note: e.target.value })} className={INPUT_CLASS} />
      </div>

      {error && <p role="alert" className="text-sm text-red-700 mt-2">{error}</p>}

      {pickerOpen && (
        <SkillPickerModal
          activityTitle={card.title}
          activityDescription={card.note}
          skills={skills}
          onConfirm={(chosen) => {
            const merged = [...card.skills]
            for (const skill of chosen) {
              if (!merged.some((other) => other.id === skill.id)) merged.push({ id: skill.id, name: skill.name })
              if (!skills.some((other) => other.id === skill.id)) onSkillCreated({ id: skill.id, name: skill.name })
            }
            onChange({ skills: merged, newSkill: merged.length ? null : card.newSkill })
            setPickerOpen(false)
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </article>
  )
}

function GoalValueFields({ goal, entry, idPrefix, onField }) {
  const { t } = useLanguage()
  const kind = goal.measure_kind
  const field = (name, label, props = {}) => (
    <div className="min-w-[7rem] flex-1">
      <label htmlFor={`${idPrefix}-${name}`} className="block text-xs text-secondary mb-1">{label}</label>
      <input
        id={`${idPrefix}-${name}`}
        value={entry[name]}
        onChange={(e) => onField(name, e.target.value)}
        className={INPUT_CLASS}
        {...props}
      />
    </div>
  )
  if (kind === 'count' || kind === 'number') {
    return field('value', goal.unit, { type: 'number', inputMode: kind === 'count' ? 'numeric' : 'decimal', min: '0', step: kind === 'count' ? '1' : 'any' })
  }
  if (kind === 'duration') return field('time', t('skillGoals.timeLabel'), { inputMode: 'numeric', placeholder: '25:30' })
  if (kind === 'pace') {
    return (
      <>
        {field('distance', t('skillGoals.distanceLabel', { unit: distanceUnitFromPace(goal.unit) }), { type: 'number', inputMode: 'decimal', min: '0', step: 'any' })}
        {field('time', t('skillGoals.timeLabel'), { inputMode: 'numeric', placeholder: '25:30' })}
      </>
    )
  }
  return null
}
