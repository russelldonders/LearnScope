import { useEffect, useState } from 'react'
import AdminLayout from './AdminLayout'
import MutationFeedback from '../../components/MutationFeedback'
import { listAllOnboardingSteps, setOnboardingStepEnabled, reorderOnboardingStep } from '../../lib/admin/onboardingSteps'

export default function AdminOnboarding() {
  const [steps, setSteps] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [actioningKey, setActioningKey] = useState(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      setSteps(await listAllOnboardingSteps())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleToggle(step) {
    setActioningKey(step.key)
    setError(null)
    try {
      await setOnboardingStepEnabled(step.key, !step.enabled)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setActioningKey(null)
    }
  }

  async function handleMove(step, direction) {
    setActioningKey(step.key)
    setError(null)
    try {
      await reorderOnboardingStep(step.key, direction)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setActioningKey(null)
    }
  }

  const enabledSteps = steps.filter((s) => s.enabled)
  const allDisabled = steps.length > 0 && enabledSteps.length === 0

  return (
    <AdminLayout>
      <div className="space-y-4">
        <h2 className="font-display text-base text-ink">First Login Journey</h2>
        <p className="text-sm text-secondary">
          Choose which steps appear in the first-login wizard new learners see right after signing
          up, and the order they appear in. Disabling every step skips the wizard entirely — new
          learners land straight on the dashboard.
        </p>
        <p className="text-xs text-secondary">
          Changes apply the next time the wizard loads. They won't disrupt a wizard a learner
          already has open in their browser — but the wizard doesn't save progress between visits,
          so if that learner reloads the page or comes back later, they'll start from step one
          under whatever configuration is current at that point, not the one they started with.
        </p>

        <MutationFeedback status="error" message={error} />

        {allDisabled && (
          <p role="alert" className="text-sm text-red-700">
            Every step is disabled — new learners skip the wizard entirely and land straight on the
            dashboard.
          </p>
        )}

        {loading ? (
          <p className="text-secondary">Loading…</p>
        ) : (
          <ol className="bg-card border border-hairline rounded-lg divide-y divide-hairline">
            {steps.map((step, index) => {
              const isFirst = index === 0
              const isLast = index === steps.length - 1
              const busy = actioningKey === step.key
              return (
                <li key={step.key} className="flex items-center justify-between gap-3 p-3">
                  <span className="text-ink text-sm">
                    <span className="text-secondary mr-2">{index + 1}.</span>
                    {step.label}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleMove(step, 'up')}
                        disabled={isFirst || busy}
                        aria-label={`Move ${step.label} up`}
                        className="flex h-8 w-8 items-center justify-center rounded border border-hairline text-secondary text-[10px] leading-none hover:text-ink disabled:opacity-30"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMove(step, 'down')}
                        disabled={isLast || busy}
                        aria-label={`Move ${step.label} down`}
                        className="flex h-8 w-8 items-center justify-center rounded border border-hairline text-secondary text-[10px] leading-none hover:text-ink disabled:opacity-30"
                      >
                        ▼
                      </button>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleToggle(step)}
                      className={`rounded-md border border-hairline py-1 px-3 text-xs font-medium hover:bg-paper disabled:opacity-50 ${
                        step.enabled ? 'text-moss' : 'text-secondary'
                      }`}
                    >
                      {step.enabled ? 'Enabled' : 'Disabled'}
                    </button>
                  </div>
                </li>
              )
            })}
            {steps.length === 0 && <p className="p-4 text-center text-secondary">No steps configured.</p>}
          </ol>
        )}

        {!loading && steps.length > 0 && (
          <div>
            <h3 className="font-display text-sm text-ink mb-2">Preview: what a new learner sees</h3>
            {enabledSteps.length === 0 ? (
              <p className="text-sm text-secondary">
                No steps enabled — new learners land straight on the dashboard, no wizard shown.
              </p>
            ) : (
              <ol className="text-sm text-ink list-decimal list-inside space-y-1 bg-card border border-hairline rounded-lg p-4">
                {enabledSteps.map((step) => (
                  <li key={step.key}>{step.label}</li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
    </AdminLayout>
  )
}
