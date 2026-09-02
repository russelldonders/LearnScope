import { useEffect, useState } from 'react'
import AdminLayout from './AdminLayout'
import { listAllOnboardingSteps, setOnboardingStepEnabled } from '../../lib/admin/onboardingSteps'

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

  return (
    <AdminLayout>
      <div className="space-y-4">
        <h2 className="font-display text-base text-ink">First Login Journey</h2>
        <p className="text-sm text-secondary">
          Choose which steps appear in the first-login wizard new learners see right after signing
          up. Disabling every step skips the wizard entirely — new learners land straight on the
          dashboard.
        </p>

        {error && <p className="text-sm text-red-700">{error}</p>}

        {loading ? (
          <p className="text-secondary">Loading…</p>
        ) : (
          <div className="bg-card border border-hairline rounded-lg divide-y divide-hairline">
            {steps.map((step) => (
              <div key={step.key} className="flex items-center justify-between gap-3 p-3">
                <span className="text-ink text-sm">{step.label}</span>
                <button
                  type="button"
                  disabled={actioningKey === step.key}
                  onClick={() => handleToggle(step)}
                  className={`rounded-md border border-hairline py-1 px-3 text-xs font-medium hover:bg-paper disabled:opacity-50 ${
                    step.enabled ? 'text-moss' : 'text-secondary'
                  }`}
                >
                  {step.enabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>
            ))}
            {steps.length === 0 && <p className="p-4 text-center text-secondary">No steps configured.</p>}
          </div>
        )}
      </div>
    </AdminLayout>
  )
}
