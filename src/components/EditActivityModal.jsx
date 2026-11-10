import { useState } from 'react'
import AccessibleDialog from './AccessibleDialog'
import { useLanguage } from '../context/LanguageContext'
import { XAPI_VERBS } from '../lib/xapiVerbs'
import { relatedSkillsFromStatement } from '../lib/xapiStatement'
import { localDateString } from '../lib/skillGoalProgress'
import { activityEditFields, applyActivityEdit, deleteActivity, updateActivity } from '../lib/activityEdits'

const INPUT_CLASS =
  'w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss'

// Changing or deleting an activity the learner logged. Which skills and role
// it's linked to, and its evidence, are shown as they are. onDone runs after a
// save or delete, so the page can reload what depends on it (goals, totals).
export default function EditActivityModal({ row, onDone, onClose }) {
  const { t } = useLanguage()
  const today = localDateString()
  const [fields, setFields] = useState(() => activityEditFields(row))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const skills = relatedSkillsFromStatement(row.statement)
  const set = (key) => (e) => setFields((current) => ({ ...current, [key]: e.target.value }))

  async function run(action) {
    setError(null)
    setBusy(true)
    try {
      await action()
      await onDone()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  function handleSave(e) {
    e.preventDefault()
    const edited = applyActivityEdit(row, fields, today)
    if (edited.error) {
      setError(t(edited.error))
      return
    }
    run(() => updateActivity(row, edited.statement, edited.recordedAt))
  }

  return (
    <AccessibleDialog
      labelledBy="edit-activity-title"
      onClose={onClose}
      panelClassName="w-full max-w-lg bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
      <h2 id="edit-activity-title" className="font-display text-2xl text-ink mb-1">{t('activity.edit.title')}</h2>
      {skills.length > 0 && (
        <p className="text-sm text-secondary mb-4 break-words">{skills.map((skill) => skill.name).join(', ')}</p>
      )}

      {confirmDelete ? (
        <div className="space-y-4">
          <p className="text-sm text-ink">{t('activity.edit.confirmDelete')}</p>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => deleteActivity(row))}
              className="rounded-md bg-red-700 text-paper text-sm font-medium px-4 py-2 hover:opacity-90 disabled:opacity-60"
            >
              {busy ? t('activity.edit.deleting') : t('activity.edit.deleteConfirm')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmDelete(false)}
              className="rounded-md border border-hairline text-ink text-sm px-4 py-2 hover:bg-paper"
            >
              {t('activity.edit.keep')}
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label htmlFor="edit-activity-name" className="block text-sm text-secondary mb-1">{t('activity.edit.what')}</label>
            <input id="edit-activity-name" maxLength={200} value={fields.title} onChange={set('title')} className={INPUT_CLASS} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="edit-activity-verb" className="block text-sm text-secondary mb-1">{t('activity.edit.type')}</label>
              <select id="edit-activity-verb" value={fields.verb} onChange={set('verb')} className={INPUT_CLASS}>
                {XAPI_VERBS.map((verb) => (
                  <option key={verb.value} value={verb.value}>{t(`activity.verbs.${verb.value}`)}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="edit-activity-date" className="block text-sm text-secondary mb-1">{t('activity.edit.when')}</label>
              <input id="edit-activity-date" type="date" max={today} value={fields.date} onChange={set('date')} className={INPUT_CLASS} />
            </div>
          </div>

          {fields.values.map((entry, position) => (
            <div key={entry.index}>
              <label htmlFor={`edit-activity-value-${entry.index}`} className="block text-sm text-secondary mb-1">{entry.unit}</label>
              <input
                id={`edit-activity-value-${entry.index}`}
                type="number"
                inputMode={entry.kind === 'count' ? 'numeric' : 'decimal'}
                min="0"
                step={entry.kind === 'count' ? '1' : 'any'}
                value={entry.value}
                onChange={(e) => setFields((current) => ({
                  ...current,
                  values: current.values.map((other, i) => (i === position ? { ...other, value: e.target.value } : other)),
                }))}
                className={INPUT_CLASS}
              />
            </div>
          ))}

          <fieldset>
            <legend className="block text-sm text-secondary mb-1">{t('activity.edit.duration')}</legend>
            <div className="flex items-center gap-2">
              <input
                type="number" min="0" inputMode="numeric" value={fields.hours} onChange={set('hours')} placeholder="0"
                aria-label={t('modals.recordActivity.hoursAriaLabel')} className={INPUT_CLASS}
              />
              <span className="text-sm text-secondary shrink-0">{t('modals.recordActivity.hoursUnit')}</span>
              <input
                type="number" min="0" max="59" inputMode="numeric" value={fields.minutes} onChange={set('minutes')} placeholder="0"
                aria-label={t('modals.recordActivity.minutesAriaLabel')} className={INPUT_CLASS}
              />
              <span className="text-sm text-secondary shrink-0">{t('modals.recordActivity.minutesUnit')}</span>
            </div>
          </fieldset>

          <div>
            <label htmlFor="edit-activity-note" className="block text-sm text-secondary mb-1">{t('activity.edit.note')}</label>
            <textarea id="edit-activity-note" rows={3} maxLength={2000} value={fields.note} onChange={set('note')} className={INPUT_CLASS} />
          </div>

          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button type="submit" disabled={busy} className="rounded-md bg-moss text-paper text-sm font-medium px-4 py-2 hover:opacity-90 disabled:opacity-60">
              {busy ? t('activity.edit.saving') : t('activity.edit.save')}
            </button>
            <button type="button" onClick={onClose} className="rounded-md border border-hairline text-ink text-sm px-4 py-2 hover:bg-paper">
              {t('activity.edit.cancel')}
            </button>
            <button
              type="button"
              onClick={() => { setError(null); setConfirmDelete(true) }}
              className="ml-auto text-sm text-red-700 hover:underline"
            >
              {t('activity.edit.delete')}
            </button>
          </div>
        </form>
      )}
    </AccessibleDialog>
  )
}
