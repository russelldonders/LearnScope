import { useState } from 'react'
import AccessibleDialog from './AccessibleDialog'
import SkillGoalEntryForm from './SkillGoalEntryForm'
import { useLanguage } from '../context/LanguageContext'
import { formatFullDate } from '../lib/dates'
import { activityName, measurementsFromStatement } from '../lib/xapiStatement'
import { formatGoalValue, goalReadings, isDerivedKind, localDateString } from '../lib/skillGoalProgress'
import { correctGoalEntry, deleteGoalEntry } from '../lib/skillGoals'

function entryLabel(goal, reading) {
  if (goal.measure_kind === 'activities') return activityName(reading.row.statement)
  return formatGoalValue(goal, reading.value)
}

// Lists what's been logged towards a goal, newest first. Only entries made
// through a goal's tracker can be corrected or deleted here. An activities or
// practice goal also lists ordinary activities and Strava imports, which belong
// to the wider activity log rather than to this goal.
export default function SkillGoalEntriesModal({ goal, statements, onChanged, onClose }) {
  const { t } = useLanguage()
  const [editingId, setEditingId] = useState(null)
  const [confirmingId, setConfirmingId] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState(null)
  // A past goal is a record: it lists only what happened while it was running,
  // and entries are changed from the goal they're still part of.
  const isPast = goal.status !== 'active'
  const readings = goalReadings(goal, statements)
    .filter((r) => !isPast || (localDateString(r.date) >= goal.started_on && localDateString(r.date) <= goal.closed_on))
    .reverse()

  async function handleCorrect(row, values) {
    await correctGoalEntry({ row, goal, ...values })
    await onChanged()
    setEditingId(null)
  }

  async function handleDelete(row) {
    setError(null)
    setDeleting(true)
    try {
      await deleteGoalEntry(row)
    } catch (err) {
      setError(err.message)
    } finally {
      // Reload either way: the entry may be gone even if its files weren't.
      await onChanged()
      setConfirmingId(null)
      setDeleting(false)
    }
  }

  return (
    <AccessibleDialog
      labelledBy="goal-entries-dialog-title"
      onClose={onClose}
      panelClassName="w-full max-w-lg bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h2 id="goal-entries-dialog-title" className="font-display text-2xl text-ink">{t('skillGoals.entriesTitle')}</h2>
          <p className="text-sm text-secondary break-words">{goal.title}</p>
        </div>
        <button type="button" onClick={onClose} className="text-secondary hover:text-ink text-sm shrink-0">
          {t('skillGoals.close')}
        </button>
      </div>

      {error && <p role="alert" className="text-sm text-red-700 mb-3">{error}</p>}
      {readings.length === 0 && <p className="text-sm text-secondary">{t('skillGoals.noEntries')}</p>}

      <ul className="space-y-2">
        {readings.map((reading) => {
          const { row } = reading
          // Course records can't be edited, so only entries logged here qualify.
          const canChange = !isPast && row.resource_id == null && measurementsFromStatement(row.statement).some((m) =>
            isDerivedKind(goal.measure_kind) ? m.kind === goal.measure_kind : m.metric === goal.metric,
          )
          const note = row.statement.object?.definition?.description?.['en-US']
          const corrected = measurementsFromStatement(row.statement).some((m) => m.corrections?.length > 0)
          return (
            <li key={row.id} className="rounded-md border border-hairline bg-paper p-3">
              {editingId === row.id ? (
                <SkillGoalEntryForm
                  goal={goal}
                  row={row}
                  statements={statements}
                  idPrefix={`goal-entry-${row.id}`}
                  submitLabel={t('skillGoals.saveCorrection')}
                  onSubmit={(values) => handleCorrect(row, values)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <p className="text-sm font-medium text-ink break-words min-w-0">
                      {entryLabel(goal, reading)}
                      {corrected && <span className="font-mono text-[10px] uppercase tracking-wide text-secondary"> · {t('skillGoals.corrected')}</span>}
                    </p>
                    <p className="font-mono text-xs text-secondary">{formatFullDate(row.recorded_at)}</p>
                  </div>
                  {note && <p className="text-sm text-secondary mt-1 whitespace-pre-wrap break-words">{note}</p>}
                  {canChange && confirmingId !== row.id && (
                    <div className="flex gap-3 mt-2">
                      <button type="button" onClick={() => { setConfirmingId(null); setEditingId(row.id) }} className="text-xs text-moss font-medium hover:underline">
                        {t('skillGoals.correct')}
                      </button>
                      <button type="button" onClick={() => setConfirmingId(row.id)} className="text-xs text-red-700 font-medium hover:underline">
                        {t('skillGoals.delete')}
                      </button>
                    </div>
                  )}
                  {confirmingId === row.id && (
                    <div className="mt-2">
                      <p className="text-sm text-ink">{t('skillGoals.confirmDeleteEntry')}</p>
                      <div className="flex gap-3 mt-1">
                        <button type="button" disabled={deleting} onClick={() => handleDelete(row)} className="text-xs text-red-700 font-medium hover:underline disabled:opacity-60">
                          {t('skillGoals.confirmDelete')}
                        </button>
                        <button type="button" disabled={deleting} onClick={() => setConfirmingId(null)} className="text-xs text-secondary hover:text-ink">
                          {t('skillGoals.cancel')}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </li>
          )
        })}
      </ul>
    </AccessibleDialog>
  )
}
