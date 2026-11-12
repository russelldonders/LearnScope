import { useEffect, useState } from 'react'
import AccessibleDialog from './AccessibleDialog'
import VoiceInputButton from './VoiceInputButton'
import { useLanguage } from '../context/LanguageContext'
import { formatClock } from '../lib/xapiStatement'
import { MEASURE_KINDS, isDerivedKind, localDateString, parseClock } from '../lib/skillGoalProgress'
import { createSkillGoal, deleteSkillGoal, draftSkillGoal, listSkillGoals, stopSkillGoal, updateSkillGoal } from '../lib/skillGoals'
import { supabase } from '../lib/supabaseClient'
import { findOrCreatePersonalSkill } from '../lib/skillLibrary'

const INPUT_CLASS =
  'w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss'
const RHYTHMS = [1, 2, 3, 7, 14, 30]
const PERIODS = ['day', 'week', 'month', 'year']

function isClockKind(kind) {
  return kind === 'duration' || kind === 'pace'
}

function emptyForm(today) {
  return {
    title: '',
    metric: '',
    measure_kind: 'count',
    unit: '',
    direction: 'higher',
    aggregation: 'best',
    period: '',
    target: '',
    target_date: '',
    started_on: today,
    tracker_question: '',
    log_every_days: '',
    per_set: '',
    sets_per_session: '',
    sessions_per_period: '',
  }
}

function formFromGoal(goal, today) {
  return {
    ...emptyForm(today),
    ...goal,
    period: goal.period ?? '',
    target:
      goal.target_value == null ? '' : isClockKind(goal.measure_kind) ? formatClock(goal.target_value) : String(goal.target_value),
    target_date: goal.target_date ?? '',
    started_on: goal.started_on ?? today,
    log_every_days: goal.log_every_days == null ? '' : String(goal.log_every_days),
    per_set: goal.per_set == null ? '' : String(goal.per_set),
    sets_per_session: goal.sets_per_session == null ? '' : String(goal.sets_per_session),
    sessions_per_period: goal.sessions_per_period == null ? '' : String(goal.sessions_per_period),
  }
}

const DAYS_IN_PERIOD = { day: 1, week: 7, month: 31, year: 366 }

// Whether the goal can be done in sets: a counted total that repeats.
function takesShape(form) {
  return form.measure_kind === 'count' && form.aggregation === 'total' && Boolean(form.period)
}

// "3 sets of 100, 4 times a week", as typed. Returns { shape: null } when it
// isn't used, { shape } with the numbers, or { errorKey }.
function parseShape(form) {
  if (!takesShape(form)) return { shape: null }
  const fields = [form.per_set, form.sets_per_session, form.sessions_per_period].map((value) => String(value).trim())
  if (fields.every((value) => value === '')) return { shape: null }
  const [perSet, sets, sessions] = fields.map(Number)
  const whole = (value, max) => Number.isInteger(value) && value >= 1 && value <= max
  if (!whole(perSet, 100000) || !whole(sets, 50) || !whole(sessions, DAYS_IN_PERIOD[form.period])) {
    return { errorKey: 'skillGoals.errorShape' }
  }
  return { shape: { per_set: perSet, sets_per_session: sets, sessions_per_period: sessions } }
}

// Keeps the form inside the rules the table enforces as the measure changes.
function applyKindRules(form) {
  const next = { ...form }
  const kind = next.measure_kind
  if (kind === 'pace') {
    next.unit = next.unit === 'min/mi' ? 'min/mi' : 'min/km'
    next.direction = 'lower'
    next.aggregation = 'best'
  } else if (kind === 'duration') {
    next.unit = 'seconds'
  } else if (kind === 'activities') {
    next.unit = 'activities'
    next.aggregation = 'total'
  } else if (kind === 'practice_time') {
    next.unit = 'minutes'
    next.aggregation = 'total'
  }
  if (next.aggregation === 'total') next.direction = 'higher'
  if (next.aggregation === 'best') next.period = ''
  return next
}

// Switching to a different measure starts it clean: the old unit, direction and
// the AI's metric name described the previous one.
function changeKind(form, kind) {
  const hasTypedUnit = (value) => value === 'count' || value === 'number'
  return {
    ...form,
    measure_kind: kind,
    metric: '',
    unit: hasTypedUnit(form.measure_kind) && hasTypedUnit(kind) ? form.unit : '',
    direction: 'higher',
    aggregation: 'best',
  }
}

// Reads the target as typed. Returns { value } or { errorKey }.
function parseTarget(form) {
  const text = form.target.trim()
  if (!text) return { value: null }
  if (isClockKind(form.measure_kind)) {
    const seconds = parseClock(text)
    return seconds ? { value: seconds } : { errorKey: 'skillGoals.errorTime' }
  }
  // Many locales' decimal keypads only offer a comma.
  const value = Number(text.replace(',', '.'))
  if (!Number.isFinite(value) || value < 0) return { errorKey: 'skillGoals.errorNumber' }
  if (form.measure_kind === 'count' && !Number.isInteger(value)) return { errorKey: 'skillGoals.errorWholeNumber' }
  return { value }
}

// Adding a goal has two steps: the learner describes it in their own words and
// AI drafts it, or they skip straight to the fields. Either way they see every
// field and nothing is saved until they confirm. With `goal` set this edits it.
//
// Without `skill` (adding from Home) the goal's skill is part of the draft:
// AI picks one of the learner's skills (userId's) or names a new one, shown
// as a field they can change. A new skill is created only when they save.
// onSaved then gets the new goal.
export default function SkillGoalModal({ skill = null, userId = null, goal = null, goals = [], onSaved, onSetLevelTarget, onClose }) {
  const { t, language } = useLanguage()
  const today = localDateString()
  const isEdit = Boolean(goal)
  const [step, setStep] = useState(isEdit ? 'review' : 'describe')
  const [text, setText] = useState('')
  const [drafting, setDrafting] = useState(false)
  const [response, setResponse] = useState(null)
  const [fromAi, setFromAi] = useState(false)
  const [form, setForm] = useState(() => (goal ? formFromGoal(goal, today) : emptyForm(today)))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const picksSkill = !skill && !isEdit
  const [mySkills, setMySkills] = useState([])
  const [skillName, setSkillName] = useState('')
  const [listening, setListening] = useState(false)

  useEffect(() => {
    if (!picksSkill || !userId) return
    let active = true
    supabase
      .from('skills')
      .select('id, name')
      .eq('user_id', userId)
      .order('name')
      .then(({ data }) => {
        if (active) setMySkills(data ?? [])
      })
    return () => {
      active = false
    }
  }, [picksSkill, userId])

  const matchingSkill = mySkills.find((other) => other.name.toLowerCase() === skillName.trim().toLowerCase()) ?? null

  const update = (key) => (e) =>
    setForm((current) =>
      applyKindRules(key === 'measure_kind' ? changeKind(current, e.target.value) : { ...current, [key]: e.target.value }),
    )
  const kind = form.measure_kind
  const clockKind = isClockKind(kind)
  const typedShape = parseShape(form).shape
  const shapePreview = typedShape
    ? t('skillGoals.shape.total', {
        total: typedShape.per_set * typedShape.sets_per_session * typedShape.sessions_per_period,
        unit: form.unit,
      })
    : null

  async function draft(goalText) {
    setError(null)
    setResponse(null)
    setDrafting(true)
    try {
      const result = await draftSkillGoal({
        text: goalText,
        skillName: skill?.name ?? null,
        skills: picksSkill ? mySkills.map((other) => other.name) : null,
        existingGoals: goals,
        language,
      })
      if (result.outcome === 'goal') {
        if (picksSkill) setSkillName(result.goal.skill_name ?? '')
        setForm(applyKindRules({
          ...formFromGoal(result.goal, today),
          started_on: today,
        }))
        setFromAi(true)
        setStep('review')
      } else {
        setResponse(result)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setDrafting(false)
    }
  }

  function handleDraft(e) {
    e.preventDefault()
    if (text.trim()) draft(text.trim())
  }

  function chooseOption(option) {
    setText(option)
    draft(option)
  }

  function setUpManually() {
    setError(null)
    setResponse(null)
    setFromAi(false)
    setForm({ ...emptyForm(today), title: text.trim().slice(0, 200) })
    setStep('review')
  }

  async function handleSave(e) {
    e.preventDefault()
    setError(null)
    const title = form.title.trim()
    const question = form.tracker_question.trim()
    const unit = form.unit.trim()
    if (!title) return setError(t('skillGoals.errorTitle'))
    if (!unit) return setError(t('skillGoals.errorUnit'))
    if (!question) return setError(t('skillGoals.errorQuestion'))
    const target = parseTarget(form)
    if (target.errorKey) return setError(t(target.errorKey))
    const { shape, errorKey: shapeError } = parseShape(form)
    if (shapeError) return setError(t(shapeError, { max: DAYS_IN_PERIOD[form.period] }))
    if (!isEdit && (!form.started_on || form.started_on > today)) return setError(t('skillGoals.errorDate'))
    if (picksSkill && !skillName.trim()) return setError(t('skillGoals.errorSkill'))

    const shared = {
      title,
      tracker_question: question,
      // With sets, the period's total follows from them: 3 x 100 x 4 = 1200.
      target_value: shape ? shape.per_set * shape.sets_per_session * shape.sessions_per_period : target.value,
      target_date: form.target_date || null,
      log_every_days: form.log_every_days ? Number(form.log_every_days) : null,
      per_set: shape?.per_set ?? null,
      sets_per_session: shape?.sets_per_session ?? null,
      sessions_per_period: shape?.sessions_per_period ?? null,
    }
    setSaving(true)
    try {
      if (isEdit) {
        await updateSkillGoal(goal, shared)
      } else {
        // From Home: the skill they chose, or a new one made for this goal.
        // Its goals are read so the new goal's measure lines up with theirs.
        let goalSkill = skill
        let skillGoals = goals
        if (picksSkill) {
          goalSkill = matchingSkill ?? (await findOrCreatePersonalSkill(userId, skillName.trim())).skill
          skillGoals = await listSkillGoals(goalSkill.id)
        }
        const created = await createSkillGoal(goalSkill.id, {
          ...shared,
          original_text: fromAi ? text.trim().slice(0, 1000) : null,
          metric: form.metric,
          measure_kind: kind,
          unit,
          direction: form.direction,
          aggregation: form.aggregation,
          period: form.aggregation === 'total' ? form.period || null : null,
          started_on: form.started_on,
        }, skillGoals)
        await onSaved(created)
        return
      }
      await onSaved()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  async function runAction(action) {
    setError(null)
    setSaving(true)
    try {
      await action(goal.id)
      await onSaved()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  const heading = isEdit ? t('skillGoals.editTitle') : t('skillGoals.addTitle')

  return (
    <AccessibleDialog
      labelledBy="skill-goal-dialog-title"
      onClose={onClose}
      panelClassName="w-full max-w-lg bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
      <h2 id="skill-goal-dialog-title" className="font-display text-2xl text-ink mb-1">{heading}</h2>
      {skill ? (
        <p className="text-sm text-secondary mb-4 break-words">{skill.name}</p>
      ) : (
        <div className="mb-4" />
      )}

      {step === 'describe' && (
        <form onSubmit={handleDraft} className="space-y-3">
          <div>
            <label htmlFor="skill-goal-text" className="block text-sm text-secondary mb-1">{t('skillGoals.describeLabel')}</label>
            <textarea
              id="skill-goal-text"
              rows={3}
              maxLength={1000}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('skillGoals.describePlaceholder')}
              className={INPUT_CLASS}
            />
            <p className="text-xs text-secondary mt-1">{t('skillGoals.describeHint')}</p>
            {listening && <p role="status" className="text-xs text-secondary mt-1">{t('quickLog.voice.listening')}</p>}
          </div>

          {response && (
            <div role="status" className="rounded-md border border-hairline bg-paper p-3">
              <p className="text-sm text-ink">{response.message}</p>
              {response.options?.length > 0 && (
                <div className="flex flex-col items-start gap-2 mt-2">
                  {response.options.map((option) => (
                    <button
                      key={option}
                      type="button"
                      disabled={drafting}
                      onClick={() => chooseOption(option)}
                      className="text-left text-sm rounded-md border border-hairline bg-card px-3 py-2 text-ink hover:border-moss/60 disabled:opacity-60"
                    >
                      {option}
                    </button>
                  ))}
                </div>
              )}
              {response.outcome === 'level_target' && onSetLevelTarget && (
                <button
                  type="button"
                  onClick={onSetLevelTarget}
                  className="mt-2 rounded-md bg-moss text-paper text-xs font-medium px-3 py-1.5 hover:opacity-90"
                >
                  {t('skillGoals.setLevelTarget')}
                </button>
              )}
            </div>
          )}

          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={drafting || !text.trim()}
              className="rounded-md bg-moss text-paper text-sm font-medium px-4 py-2 hover:opacity-90 disabled:opacity-60"
            >
              {drafting ? t('skillGoals.drafting') : t('skillGoals.draftButton')}
            </button>
            <VoiceInputButton text={text} onText={setText} onError={setError} onListeningChange={setListening} disabled={drafting} />
            <button type="button" onClick={setUpManually} disabled={drafting} className="text-sm text-moss font-medium px-2 py-2 hover:underline">
              {t('skillGoals.setUpManually')}
            </button>
            <button type="button" onClick={onClose} disabled={drafting} className="text-sm text-secondary hover:text-ink px-2 py-2 ml-auto">
              {t('skillGoals.cancel')}
            </button>
          </div>
        </form>
      )}

      {step === 'review' && (
        <form onSubmit={handleSave} className="space-y-3">
          {fromAi && <p className="rounded-md bg-moss/10 px-3 py-2 text-sm text-ink">{t('skillGoals.reviewHint')}</p>}

          <div>
            <label htmlFor="skill-goal-title" className="block text-sm text-secondary mb-1">{t('skillGoals.titleLabel')}</label>
            <input id="skill-goal-title" maxLength={200} value={form.title} onChange={update('title')} className={INPUT_CLASS} />
          </div>

          {picksSkill && (
            <div>
              <label htmlFor="skill-goal-skill" className="block text-sm text-secondary mb-1">{t('skillGoals.skillLabel')}</label>
              <input
                id="skill-goal-skill"
                list="skill-goal-skill-options"
                maxLength={120}
                value={skillName}
                onChange={(e) => setSkillName(e.target.value)}
                aria-describedby="skill-goal-skill-hint"
                className={INPUT_CLASS}
              />
              <datalist id="skill-goal-skill-options">
                {mySkills.map((other) => <option key={other.id} value={other.name} />)}
              </datalist>
              <p id="skill-goal-skill-hint" className="text-xs text-secondary mt-1">
                {skillName.trim() && !matchingSkill
                  ? t('skillGoals.newSkillNote', { name: skillName.trim() })
                  : t('skillGoals.skillHint')}
              </p>
            </div>
          )}

          {!isEdit && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="skill-goal-kind" className="block text-sm text-secondary mb-1">{t('skillGoals.kindLabel')}</label>
                  <select id="skill-goal-kind" value={kind} onChange={update('measure_kind')} className={INPUT_CLASS}>
                    {MEASURE_KINDS.map((value) => (
                      <option key={value} value={value}>{t(`skillGoals.kind.${value}`)}</option>
                    ))}
                  </select>
                </div>
                {(kind === 'count' || kind === 'number') && (
                  <div>
                    <label htmlFor="skill-goal-unit" className="block text-sm text-secondary mb-1">{t('skillGoals.unitLabel')}</label>
                    <input id="skill-goal-unit" maxLength={40} value={form.unit} onChange={update('unit')} placeholder={t('skillGoals.unitPlaceholder')} className={INPUT_CLASS} />
                  </div>
                )}
                {kind === 'pace' && (
                  <div>
                    <label htmlFor="skill-goal-pace-unit" className="block text-sm text-secondary mb-1">{t('skillGoals.unitLabel')}</label>
                    <select id="skill-goal-pace-unit" value={form.unit} onChange={update('unit')} className={INPUT_CLASS}>
                      <option value="min/km">min/km</option>
                      <option value="min/mi">min/mi</option>
                    </select>
                  </div>
                )}
              </div>

              {!isDerivedKind(kind) && kind !== 'pace' && (
                <div>
                  <label htmlFor="skill-goal-aggregation" className="block text-sm text-secondary mb-1">{t('skillGoals.aggregationLabel')}</label>
                  <select id="skill-goal-aggregation" value={form.aggregation} onChange={update('aggregation')} className={INPUT_CLASS}>
                    <option value="best">{t('skillGoals.aggregation.best')}</option>
                    <option value="total">{t('skillGoals.aggregation.total')}</option>
                  </select>
                </div>
              )}

              {form.aggregation === 'best' && kind !== 'pace' && (
                <div>
                  <label htmlFor="skill-goal-direction" className="block text-sm text-secondary mb-1">{t('skillGoals.directionLabel')}</label>
                  <select id="skill-goal-direction" value={form.direction} onChange={update('direction')} className={INPUT_CLASS}>
                    <option value="higher">{t('skillGoals.direction.higher')}</option>
                    <option value="lower">{t('skillGoals.direction.lower')}</option>
                  </select>
                </div>
              )}

              {form.aggregation === 'total' && (
                <div>
                  <label htmlFor="skill-goal-period" className="block text-sm text-secondary mb-1">{t('skillGoals.periodLabel')}</label>
                  <select id="skill-goal-period" value={form.period} onChange={update('period')} className={INPUT_CLASS}>
                    <option value="">{t('skillGoals.period.none')}</option>
                    {PERIODS.map((value) => (
                      <option key={value} value={value}>{t(`skillGoals.period.${value}`)}</option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}

          {takesShape(form) && (
            <fieldset className="rounded-md border border-hairline p-3">
              <legend className="px-1 text-sm text-secondary">{t('skillGoals.shape.legend')}</legend>
              <div className="grid grid-cols-3 gap-2">
                {[
                  ['per_set', t('skillGoals.shape.perSet', { unit: form.unit || '' })],
                  ['sets_per_session', t('skillGoals.shape.sets')],
                  ['sessions_per_period', t(`skillGoals.shape.sessions.${form.period}`)],
                ].map(([key, label]) => (
                  <div key={key}>
                    <label htmlFor={`skill-goal-${key}`} className="block text-xs text-secondary mb-1">{label}</label>
                    <input
                      id={`skill-goal-${key}`}
                      type="number"
                      inputMode="numeric"
                      min="1"
                      step="1"
                      value={form[key]}
                      onChange={update(key)}
                      className={INPUT_CLASS}
                    />
                  </div>
                ))}
              </div>
              <p className="text-xs text-secondary mt-2">{t('skillGoals.shape.hint')}</p>
            </fieldset>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="skill-goal-target" className="block text-sm text-secondary mb-1">
                {clockKind ? t('skillGoals.targetTimeLabel') : t('skillGoals.targetLabel', { unit: form.unit || '' })}
              </label>
              {shapePreview ? (
                <p id="skill-goal-target" className="py-2 text-sm text-ink">{shapePreview}</p>
              ) : (
                <>
                  <input
                    id="skill-goal-target"
                    inputMode={clockKind ? 'numeric' : 'decimal'}
                    placeholder={clockKind ? '5:00' : ''}
                    value={form.target}
                    onChange={update('target')}
                    className={INPUT_CLASS}
                  />
                  <p className="text-xs text-secondary mt-1">{t('skillGoals.targetHint')}</p>
                </>
              )}
            </div>
            <div>
              <label htmlFor="skill-goal-date" className="block text-sm text-secondary mb-1">{t('skillGoals.targetDateLabel')}</label>
              <input id="skill-goal-date" type="date" value={form.target_date} onChange={update('target_date')} className={INPUT_CLASS} />
            </div>
          </div>

          {!isEdit && (
            <div>
              <label htmlFor="skill-goal-started" className="block text-sm text-secondary mb-1">{t('skillGoals.startedLabel')}</label>
              <input id="skill-goal-started" type="date" max={today} value={form.started_on} onChange={update('started_on')} className={INPUT_CLASS} />
              <p className="text-xs text-secondary mt-1">{t('skillGoals.startedHint')}</p>
            </div>
          )}

          <div>
            <label htmlFor="skill-goal-question" className="block text-sm text-secondary mb-1">{t('skillGoals.questionLabel')}</label>
            <input
              id="skill-goal-question"
              maxLength={300}
              value={form.tracker_question}
              onChange={update('tracker_question')}
              placeholder={t('skillGoals.questionPlaceholder')}
              className={INPUT_CLASS}
            />
          </div>

          <div>
            <label htmlFor="skill-goal-rhythm" className="block text-sm text-secondary mb-1">{t('skillGoals.rhythmLabel')}</label>
            <select id="skill-goal-rhythm" value={form.log_every_days} onChange={update('log_every_days')} className={INPUT_CLASS}>
              <option value="">{t('skillGoals.rhythmNone')}</option>
              {RHYTHMS.map((days) => (
                <option key={days} value={String(days)}>{t(`skillGoals.rhythm.days${days}`)}</option>
              ))}
              {form.log_every_days && !RHYTHMS.includes(Number(form.log_every_days)) && (
                <option value={form.log_every_days}>{t('skillGoals.rhythmCustom', { days: form.log_every_days })}</option>
              )}
            </select>
          </div>

          {isEdit && <p className="text-xs text-secondary">{t('skillGoals.editHistoryHint')}</p>}

          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-moss text-paper text-sm font-medium px-4 py-2 hover:opacity-90 disabled:opacity-60"
            >
              {saving ? t('skillGoals.saving') : isEdit ? t('skillGoals.saveChanges') : t('skillGoals.confirmGoal')}
            </button>
            {!isEdit && (
              <button type="button" disabled={saving} onClick={() => setStep('describe')} className="text-sm text-moss font-medium px-2 py-2 hover:underline">
                {t('skillGoals.back')}
              </button>
            )}
            <button type="button" onClick={onClose} disabled={saving} className="text-sm text-secondary hover:text-ink px-2 py-2 ml-auto">
              {t('skillGoals.cancel')}
            </button>
          </div>

          {isEdit && (
            <div className="border-t border-hairline pt-3 mt-3">
              {confirmDelete ? (
                <div>
                  <p className="text-sm text-ink">{t('skillGoals.confirmDeleteGoal')}</p>
                  <div className="flex gap-3 mt-2">
                    <button type="button" disabled={saving} onClick={() => runAction(deleteSkillGoal)} className="text-sm text-red-700 font-medium hover:underline disabled:opacity-60">
                      {t('skillGoals.confirmDelete')}
                    </button>
                    <button type="button" disabled={saving} onClick={() => setConfirmDelete(false)} className="text-sm text-secondary hover:text-ink">
                      {t('skillGoals.cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-4">
                  <button type="button" disabled={saving} onClick={() => runAction(stopSkillGoal)} className="text-sm text-moss font-medium hover:underline disabled:opacity-60">
                    {t('skillGoals.stopGoal')}
                  </button>
                  <button type="button" disabled={saving} onClick={() => setConfirmDelete(true)} className="text-sm text-red-700 font-medium hover:underline disabled:opacity-60">
                    {t('skillGoals.deleteGoal')}
                  </button>
                </div>
              )}
            </div>
          )}
        </form>
      )}
    </AccessibleDialog>
  )
}
