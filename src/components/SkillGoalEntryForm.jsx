import { useState } from 'react'
import EvidenceFields from './EvidenceFields'
import { useLanguage } from '../context/LanguageContext'
import { activityName, formatClock, measurementsFromStatement } from '../lib/xapiStatement'
import {
  computeGoalProgress,
  distanceUnitFromPace,
  formatNumber,
  goalReadings,
  localDateString,
  parseClock,
  validateEntryInput,
} from '../lib/skillGoalProgress'

const INPUT_CLASS =
  'w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss'

function initialFields(goal, row, statements, prefillFrom = null) {
  const fields = { value: '', distance: '', time: '', minutes: '', title: '', note: '' }
  if (!row && prefillFrom) {
    // Same values as last time; the note stays empty since it was about that day.
    return { ...initialFields(goal, prefillFrom, statements), note: '' }
  }
  if (row) {
    const measurement = measurementsFromStatement(row.statement).find(
      (m) => m.kind === goal.measure_kind,
    )
    fields.note = row.statement.object?.definition?.description?.['en-US'] ?? ''
    if (goal.measure_kind === 'activities') fields.title = activityName(row.statement)
    if (measurement) {
      if (goal.measure_kind === 'count' || goal.measure_kind === 'number') fields.value = String(measurement.value)
      if (goal.measure_kind === 'duration') fields.time = formatClock(measurement.value)
      if (goal.measure_kind === 'pace') {
        fields.distance = String(measurement.inputs?.distance ?? '')
        fields.time = measurement.inputs?.durationSeconds ? formatClock(measurement.inputs.durationSeconds) : ''
      }
      if (goal.measure_kind === 'practice_time') fields.minutes = String(measurement.value)
    }
    return fields
  }
  // Runners tend to repeat a distance, so start from the last one they logged.
  if (goal.measure_kind === 'pace') {
    const readings = goalReadings(goal, statements)
    const last = readings[readings.length - 1]
    const previous = last && measurementsFromStatement(last.row.statement).find((m) => m.metric === goal.metric)
    if (previous?.inputs?.distance) fields.distance = String(previous.inputs.distance)
  }
  return fields
}

// Both the card's quick entry and correcting an existing entry. It asks only
// for what this goal measures, and hands back parsed values; saving is up to
// the caller. A correction leaves evidence alone, since it isn't changing that.
export default function SkillGoalEntryForm({ goal, row = null, prefillFrom = null, statements, idPrefix, submitLabel, onSubmit, onCancel }) {
  const { t } = useLanguage()
  const today = localDateString()
  const [fields, setFields] = useState(() => initialFields(goal, row, statements, prefillFrom))
  const [date, setDate] = useState(row ? localDateString(new Date(row.recorded_at)) : today)
  const [showMore, setShowMore] = useState(Boolean(row && fields.note))
  const [evidenceUrl, setEvidenceUrl] = useState('')
  const [evidenceFiles, setEvidenceFiles] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const set = (key) => (e) => setFields((current) => ({ ...current, [key]: e.target.value }))
  const kind = goal.measure_kind
  // Which set this is today, for a goal done in sets ("Set 2 of 3 today").
  const sessions = goal.aggregation === 'total' && !row ? computeGoalProgress(goal, statements).sessions : null
  // Once today's sets are done, a further one is an extra, not "Set 4 of 3".
  const entryHint = !sessions
    ? t('skillGoals.eachEntryAdds')
    : sessions.todaySets >= sessions.setsPerSession
      ? t('skillGoals.shape.entryHintExtra', { perSet: formatNumber(sessions.perSet), unit: goal.unit })
      : t('skillGoals.shape.entryHint', { next: sessions.todaySets + 1, sets: sessions.setsPerSession, perSet: formatNumber(sessions.perSet), unit: goal.unit })

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    const input = {
      value: fields.value.trim(),
      distance: fields.distance.trim(),
      durationSeconds:
        kind === 'practice_time' ? Number(fields.minutes) * 60 || null : parseClock(fields.time),
    }
    const problem = validateEntryInput(goal, input)
    if (problem) {
      setError(t(problem))
      return
    }
    if (!date || date > today) {
      setError(t('skillGoals.errorDate'))
      return
    }
    setSaving(true)
    try {
      await onSubmit({
        input,
        date,
        note: fields.note.trim(),
        activityTitle: kind === 'activities' ? fields.title.trim() : '',
        evidence: { evidenceUrl: evidenceUrl.trim(), files: evidenceFiles },
      })
      if (!row) {
        setFields(initialFieldsAfterSave(fields))
        setEvidenceUrl('')
        setEvidenceFiles([])
        setDate(today)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const field = (key) => `${idPrefix}-${key}`

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {(kind === 'count' || kind === 'number') && (
          <div>
            <label htmlFor={field('value')} className="block text-xs text-secondary mb-1">{goal.unit}</label>
            <input
              id={field('value')}
              type="number"
              inputMode={kind === 'count' ? 'numeric' : 'decimal'}
              min="0"
              step={kind === 'count' ? '1' : 'any'}
              value={fields.value}
              onChange={set('value')}
              aria-describedby={goal.aggregation === 'total' ? field('each-entry-hint') : undefined}
              className={INPUT_CLASS}
            />
            {/* A total is built from entries, so one set is one entry, not the
                day's total across sets. */}
            {goal.aggregation === 'total' && (
              <p id={field('each-entry-hint')} className="text-xs text-secondary mt-1">{entryHint}</p>
            )}
          </div>
        )}
        {kind === 'pace' && (
          <div>
            <label htmlFor={field('distance')} className="block text-xs text-secondary mb-1">
              {t('skillGoals.distanceLabel', { unit: distanceUnitFromPace(goal.unit) })}
            </label>
            <input
              id={field('distance')}
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={fields.distance}
              onChange={set('distance')}
              className={INPUT_CLASS}
            />
          </div>
        )}
        {(kind === 'duration' || kind === 'pace') && (
          <div>
            <label htmlFor={field('time')} className="block text-xs text-secondary mb-1">{t('skillGoals.timeLabel')}</label>
            <input
              id={field('time')}
              inputMode="numeric"
              placeholder="25:30"
              value={fields.time}
              onChange={set('time')}
              className={INPUT_CLASS}
            />
          </div>
        )}
        {kind === 'practice_time' && (
          <div>
            <label htmlFor={field('minutes')} className="block text-xs text-secondary mb-1">{t('skillGoals.minutesLabel')}</label>
            <input
              id={field('minutes')}
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              value={fields.minutes}
              onChange={set('minutes')}
              className={INPUT_CLASS}
            />
          </div>
        )}
        {kind === 'activities' && (
          <div>
            <label htmlFor={field('title')} className="block text-xs text-secondary mb-1">{t('skillGoals.activityTitleLabel')}</label>
            <input id={field('title')} value={fields.title} onChange={set('title')} maxLength={200} className={INPUT_CLASS} />
          </div>
        )}
        <div>
          <label htmlFor={field('date')} className="block text-xs text-secondary mb-1">{t('skillGoals.dateLabel')}</label>
          <input
            id={field('date')}
            type="date"
            max={today}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={INPUT_CLASS}
          />
        </div>
      </div>

      {showMore ? (
        <div className="space-y-2">
          <div>
            <label htmlFor={field('note')} className="block text-xs text-secondary mb-1">{t('skillGoals.noteLabel')}</label>
            <textarea id={field('note')} rows={2} value={fields.note} onChange={set('note')} maxLength={2000} className={INPUT_CLASS} />
          </div>
          {!row && (
            <EvidenceFields
              evidenceUrl={evidenceUrl}
              onEvidenceUrlChange={setEvidenceUrl}
              files={evidenceFiles}
              onFilesChange={setEvidenceFiles}
            />
          )}
        </div>
      ) : (
        <button type="button" onClick={() => setShowMore(true)} className="text-xs text-moss font-medium hover:underline">
          {row ? t('skillGoals.addNote') : t('skillGoals.addNoteOrEvidence')}
        </button>
      )}

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-moss text-paper text-sm font-medium px-4 py-2 hover:opacity-90 disabled:opacity-60"
        >
          {saving ? t('skillGoals.saving') : submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={saving} className="text-sm text-secondary hover:text-ink px-2 py-2">
            {t('skillGoals.cancel')}
          </button>
        )}
      </div>
    </form>
  )
}

// After a quick entry only the distance is worth keeping for next time.
function initialFieldsAfterSave(fields) {
  return { value: '', distance: fields.distance, time: '', minutes: '', title: '', note: '' }
}
