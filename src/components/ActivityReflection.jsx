import { useState } from 'react'
import { useLanguage } from '../context/LanguageContext'
import { activityName } from '../lib/xapiStatement'
import { saveReflection } from '../lib/quickActivityLog'

const INPUT_CLASS =
  'w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss'

// One optional question after saving. The answer goes into the activity's
// own note, so it lives with the activity rather than somewhere separate.
export default function ActivityReflection({ rows, promptKey }) {
  const { t } = useLanguage()
  const [rowId, setRowId] = useState(rows[0]?.id ?? '')
  const [answer, setAnswer] = useState('')
  const [state, setState] = useState('open')
  const [error, setError] = useState(null)
  const [savedTitle, setSavedTitle] = useState('')

  if (rows.length === 0 || state === 'skipped') return null
  if (state === 'saved') {
    return <p role="status" className="mt-2 text-sm text-moss">{t('quickLog.reflect.saved', { title: savedTitle })}</p>
  }

  const question = t(promptKey)

  async function handleSubmit(e) {
    e.preventDefault()
    const row = rows.find((other) => other.id === rowId)
    if (!row || !answer.trim()) return
    setState('saving')
    setError(null)
    try {
      await saveReflection(row, question, answer)
      setSavedTitle(activityName(row.statement))
      setState('saved')
    } catch (err) {
      setError(err.message)
      setState('open')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 rounded-lg border border-hairline bg-card p-3 space-y-2">
      <label htmlFor="quick-log-reflection" className="block text-sm text-ink font-medium">
        {question} <span className="font-normal text-secondary">{t('quickLog.reflect.optional')}</span>
      </label>
      {rows.length > 1 && (
        <div>
          <label htmlFor="quick-log-reflection-activity" className="block text-xs text-secondary mb-1">
            {t('quickLog.reflect.about')}
          </label>
          <select id="quick-log-reflection-activity" value={rowId} onChange={(e) => setRowId(e.target.value)} className={INPUT_CLASS}>
            {rows.map((row) => (
              <option key={row.id} value={row.id}>{activityName(row.statement)}</option>
            ))}
          </select>
        </div>
      )}
      <textarea
        id="quick-log-reflection"
        rows={2}
        maxLength={1000}
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        className={INPUT_CLASS}
      />
      <p className="text-xs text-secondary">{t('quickLog.reflect.visibility')}</p>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={state === 'saving' || !answer.trim()}
          className="rounded-md bg-moss text-paper text-sm font-medium px-4 py-2 hover:opacity-90 disabled:opacity-60"
        >
          {state === 'saving' ? t('quickLog.saving') : t('quickLog.reflect.addButton')}
        </button>
        <button type="button" onClick={() => setState('skipped')} className="text-sm text-secondary hover:text-ink">
          {t('quickLog.reflect.skip')}
        </button>
      </div>
    </form>
  )
}
