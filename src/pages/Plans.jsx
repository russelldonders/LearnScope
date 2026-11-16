import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import AppHeader from '../components/AppHeader'
import PlanProgressBar from '../components/PlanProgressBar'
import { createPlan, listPlans, loadPlanContext } from '../lib/learnerPlans'
import { planItemStatus, summariseProgress, timeElapsedPercent } from '../lib/planProgress'
import { formatFullDate } from '../lib/dates'

export default function Plans() {
  const { user } = useAuth()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [plans, setPlans] = useState([])
  const [context, setContext] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [creating, setCreating] = useState(false)
  const [showArchived, setShowArchived] = useState(false)

  useEffect(() => {
    listPlans()
      .then(async (loaded) => {
        setPlans(loaded)
        // One load for every plan's skills and goals, so the list shows the
        // same progress as each plan's own page.
        setContext(await loadPlanContext(user.id, loaded.flatMap((plan) => plan.items)))
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [user.id])

  const visible = plans.filter((plan) => showArchived || plan.status !== 'archived')
  const archivedCount = plans.filter((plan) => plan.status === 'archived').length

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />
      <main id="main-content" tabIndex={-1} className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-8">
          <div className="max-w-2xl">
            <h1 className="font-display text-3xl sm:text-4xl text-ink">{t('plans.heading')}</h1>
            <p className="text-secondary mt-2">{t('plans.subheading')}</p>
          </div>
          {!creating && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="shrink-0 rounded-md bg-moss text-paper text-sm font-medium px-4 py-2 hover:opacity-90"
            >
              {t('plans.newPlan')}
            </button>
          )}
        </div>

        {creating && (
          <div className="mb-8 rounded-lg border border-hairline bg-card p-4">
            <h2 className="font-display text-xl text-ink mb-3">{t('plans.newPlan')}</h2>
            <PlanDetailsForm
              submitLabel={t('plans.createPlan')}
              onCancel={() => setCreating(false)}
              onSubmit={async (values) => {
                const id = await createPlan(user.id, values)
                navigate(`/plans/${id}`)
              }}
            />
          </div>
        )}

        {error && <p role="alert" className="text-sm text-red-700 mb-4">{error}</p>}
        {loading ? (
          <p className="text-secondary">{t('plans.loading')}</p>
        ) : visible.length === 0 && !creating ? (
          <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
            <p className="text-secondary max-w-md mx-auto">{t('plans.emptyState')}</p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {visible.map((plan) => {
              const progress = context
                ? summariseProgress(plan.items.map((item) => planItemStatus(item, context)))
                : { percent: 0, done: 0, total: plan.items.length }
              const elapsed = timeElapsedPercent(plan)
              return (
                <li key={plan.id}>
                  <Link
                    to={`/plans/${plan.id}`}
                    className="block h-full rounded-lg border border-hairline bg-card p-4 hover:border-moss focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-moss"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="font-medium text-ink line-clamp-2">{plan.title}</h2>
                      {plan.status !== 'active' && (
                        <span className="shrink-0 rounded-full border border-hairline px-2 py-0.5 text-[11px] text-secondary">
                          {t(`plans.status.${plan.status}`)}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-secondary">
                      {plan.target_on ? t('plans.byDate', { date: formatFullDate(plan.target_on) }) : t('plans.noEndDate')}
                      {' · '}
                      {t('plans.itemCount', { count: plan.items.length })}
                    </p>
                    <PlanProgressBar className="mt-3" percent={progress.percent} elapsed={elapsed} label={t('plans.progressLabel', { title: plan.title })} />
                    {context && progress.total > 0 && (
                      <p className="mt-1.5 text-xs text-secondary">{t('plans.doneCount', { done: progress.done, total: progress.total })}</p>
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
        )}

        {archivedCount > 0 && (
          <button type="button" onClick={() => setShowArchived((v) => !v)} className="mt-4 text-sm text-moss font-medium hover:underline">
            {showArchived ? t('plans.hideArchived') : t('plans.showArchived', { count: archivedCount })}
          </button>
        )}
      </main>
    </div>
  )
}

// Title, description and timeframe, for a new plan or editing one.
export function PlanDetailsForm({ plan = null, submitLabel, onSubmit, onCancel }) {
  const { t } = useLanguage()
  const [title, setTitle] = useState(plan?.title ?? '')
  const [description, setDescription] = useState(plan?.description ?? '')
  const [startsOn, setStartsOn] = useState(plan?.starts_on ?? '')
  const [targetOn, setTargetOn] = useState(plan?.target_on ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const inputClass = 'mt-1 w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-moss'

  async function handleSubmit(event) {
    event.preventDefault()
    if (!title.trim()) return setError(t('plans.errorTitle'))
    if (startsOn && targetOn && targetOn < startsOn) return setError(t('plans.errorDates'))
    setError(null)
    setSaving(true)
    try {
      await onSubmit({ title, description, startsOn, targetOn })
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-3">
      <div>
        <label htmlFor="plan-title" className="text-xs text-secondary">{t('plans.titleLabel')}</label>
        <input id="plan-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder={t('plans.titlePlaceholder')} className={inputClass} />
      </div>
      <div>
        <label htmlFor="plan-description" className="text-xs text-secondary">{t('plans.descriptionLabel')}</label>
        <textarea id="plan-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} rows={2} className={inputClass} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="plan-starts" className="text-xs text-secondary">{t('plans.startsLabel')}</label>
          <input id="plan-starts" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor="plan-target" className="text-xs text-secondary">{t('plans.targetLabel')}</label>
          <input id="plan-target" type="date" value={targetOn} onChange={(e) => setTargetOn(e.target.value)} className={inputClass} />
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-3">
        <button type="submit" disabled={saving} className="rounded-md bg-moss text-paper text-sm font-medium px-4 py-2 hover:opacity-90 disabled:opacity-60">
          {saving ? t('plans.saving') : submitLabel}
        </button>
        <button type="button" onClick={onCancel} disabled={saving} className="text-sm text-secondary hover:text-ink">
          {t('plans.cancel')}
        </button>
      </div>
    </form>
  )
}
