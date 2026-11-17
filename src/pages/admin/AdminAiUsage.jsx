import { useEffect, useState } from 'react'
import AdminLayout from './AdminLayout'
import { getAiUsageDashboard } from '../../lib/admin/aiUsage'

const RANGES = [7, 30, 90]
const FEATURE_LABELS = {
  baseline_assessment: 'Baseline assessment',
  activity_drafting: 'Activity drafting',
  activity_skill_suggestions: 'Activity skill suggestions',
  course_draft_generation: 'Course builder',
  cv_parsing: 'CV import',
  diagnostic_quiz_generation: 'Knowledge checks',
  experience_skill_recommendations: 'Experience skill recommendations',
  goal_drafting: 'Goal drafting',
  interview_plan: 'Interview preparation',
  interview_turn: 'Interview turns',
  level_guide_generation: 'Level guidance',
  role_profile_skill_suggestions: 'Role profile skill suggestions',
  skill_validation: 'Skill validation',
  tag_suggestions: 'Tag suggestions',
}

const numberFormat = new Intl.NumberFormat('en-GB')
const compactNumberFormat = new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 })

function formatUsd(microUsd) {
  const dollars = Number(microUsd ?? 0) / 1_000_000
  if (dollars === 0) return '$0.00'
  if (dollars < 0.01) return `$${dollars.toFixed(4)}`
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(dollars)
}

function formatDuration(milliseconds) {
  const value = Number(milliseconds ?? 0)
  if (value < 1000) return `${numberFormat.format(value)} ms`
  return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)} s`
}

function featureLabel(feature) {
  return FEATURE_LABELS[feature] ?? feature.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase())
}

function LoadingState() {
  return (
    <div aria-label="Loading AI usage" className="space-y-6 animate-pulse">
      <div className="grid grid-cols-2 gap-6 border-y border-hairline py-5 sm:grid-cols-4">
        {[1, 2, 3, 4].map((item) => <div key={item} className="h-12 rounded-md bg-hairline" />)}
      </div>
      <div className="h-56 rounded-md bg-hairline" />
    </div>
  )
}

function BreakdownTable({ rows, firstHeading, firstValue }) {
  if (!rows.length) return <p className="py-6 text-sm text-secondary">No usage in this period.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="border-b border-hairline text-xs text-secondary">
          <tr>
            <th scope="col" className="pb-2 pr-4 font-medium">{firstHeading}</th>
            <th scope="col" className="px-4 pb-2 text-right font-medium">Requests</th>
            <th scope="col" className="px-4 pb-2 text-right font-medium">Tokens</th>
            <th scope="col" className="pl-4 pb-2 text-right font-medium">Estimated cost</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {rows.map((row) => (
            <tr key={firstValue(row)}>
              <th scope="row" className="py-3 pr-4 font-medium text-ink">{firstValue(row)}</th>
              <td className="px-4 py-3 text-right tabular-nums text-secondary">{numberFormat.format(row.requests)}</td>
              <td className="px-4 py-3 text-right tabular-nums text-secondary">{compactNumberFormat.format(row.tokens)}</td>
              <td className="pl-4 py-3 text-right tabular-nums text-ink">{formatUsd(row.estimatedCostMicroUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function AdminAiUsage() {
  const [days, setDays] = useState(30)
  const [state, setState] = useState({ status: 'loading', data: null, error: null })
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    setState((current) => ({ ...current, status: 'loading', error: null }))
    getAiUsageDashboard(days)
      .then((data) => {
        if (active) setState({ status: 'done', data, error: null })
      })
      .catch((error) => {
        if (active) setState({ status: 'error', data: null, error: error.message || 'Failed to load AI usage.' })
      })
    return () => { active = false }
  }, [days, reloadKey])

  const data = state.data
  const totals = data?.totals
  const errorRate = totals?.requests ? (Number(totals.errors) / Number(totals.requests)) * 100 : 0

  return (
    <AdminLayout>
      <div className="space-y-9">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-display text-lg text-ink">AI usage</h2>
            <p className="mt-1 max-w-[70ch] text-sm text-secondary">
              Token volume, estimated Anthropic cost and reliability across LearnScope’s AI features.
            </p>
          </div>
          <fieldset>
            <legend className="sr-only">Usage period</legend>
            <div className="inline-flex rounded-md border border-hairline p-0.5">
              {RANGES.map((range) => (
                <button
                  key={range}
                  type="button"
                  aria-pressed={days === range}
                  onClick={() => setDays(range)}
                  className={`rounded px-3 py-1.5 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-gold ${
                    days === range ? 'bg-moss font-medium text-paper' : 'text-secondary hover:bg-paper hover:text-ink'
                  }`}
                >
                  {range} days
                </button>
              ))}
            </div>
          </fieldset>
        </header>

        {state.status === 'loading' ? <LoadingState /> : state.status === 'error' ? (
          <div role="alert" className="rounded-md border border-red-700 bg-red-50 p-4 text-sm text-red-800">
            <p className="font-medium">AI usage could not be loaded.</p>
            <p className="mt-1">{state.error}</p>
            <button type="button" onClick={() => setReloadKey((key) => key + 1)} className="mt-3 rounded-md border border-red-700 px-3 py-1.5 font-medium hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-gold">
              Try again
            </button>
          </div>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-5 border-y border-hairline py-5 sm:grid-cols-4">
              <div>
                <dt className="text-xs text-secondary">Estimated cost</dt>
                <dd className="mt-1 font-display text-2xl tabular-nums text-ink">{formatUsd(totals.estimatedCostMicroUsd)}</dd>
              </div>
              <div>
                <dt className="text-xs text-secondary">Total tokens</dt>
                <dd className="mt-1 font-display text-2xl tabular-nums text-ink">{compactNumberFormat.format(totals.totalTokens)}</dd>
              </div>
              <div>
                <dt className="text-xs text-secondary">Requests</dt>
                <dd className="mt-1 font-display text-2xl tabular-nums text-ink">{numberFormat.format(totals.requests)}</dd>
              </div>
              <div>
                <dt className="text-xs text-secondary">Provider error rate</dt>
                <dd className="mt-1 font-display text-2xl tabular-nums text-ink">{errorRate.toFixed(1)}%</dd>
              </div>
            </dl>

            {Number(totals.requests) === 0 ? (
              <div className="rounded-lg border border-dashed border-hairline py-14 text-center">
                <p className="font-medium text-ink">No AI calls have been recorded in this period.</p>
                <p className="mt-1 text-sm text-secondary">Usage begins accumulating after the tracking release is deployed.</p>
              </div>
            ) : (
              <>
                <section aria-labelledby="ai-feature-usage">
                  <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <h3 id="ai-feature-usage" className="font-display text-base text-ink">Usage by feature</h3>
                      <p className="mt-1 text-sm text-secondary">Where tokens and cost are being consumed inside the app.</p>
                    </div>
                    <p className="text-xs text-secondary">Average response: {formatDuration(totals.averageDurationMs)}</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-left text-sm">
                      <thead className="border-b border-hairline text-xs text-secondary">
                        <tr>
                          <th scope="col" className="pb-2 pr-4 font-medium">Feature</th>
                          <th scope="col" className="px-4 pb-2 text-right font-medium">Requests</th>
                          <th scope="col" className="px-4 pb-2 text-right font-medium">Tokens</th>
                          <th scope="col" className="px-4 pb-2 text-right font-medium">Errors</th>
                          <th scope="col" className="px-4 pb-2 text-right font-medium">Average response</th>
                          <th scope="col" className="pl-4 pb-2 text-right font-medium">Estimated cost</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-hairline">
                        {data.byFeature.map((row) => (
                          <tr key={row.feature}>
                            <th scope="row" className="py-3 pr-4 font-medium text-ink">{featureLabel(row.feature)}</th>
                            <td className="px-4 py-3 text-right tabular-nums text-secondary">{numberFormat.format(row.requests)}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-secondary">{compactNumberFormat.format(row.tokens)}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-secondary">{numberFormat.format(row.errors)}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-secondary">{formatDuration(row.averageDurationMs)}</td>
                            <td className="pl-4 py-3 text-right tabular-nums text-ink">{formatUsd(row.estimatedCostMicroUsd)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <div className="grid gap-8 lg:grid-cols-2">
                  <section aria-labelledby="ai-model-usage">
                    <h3 id="ai-model-usage" className="font-display text-base text-ink">By model</h3>
                    <BreakdownTable rows={data.byModel} firstHeading="Model" firstValue={(row) => row.model} />
                  </section>
                  <section aria-labelledby="ai-organisation-usage">
                    <h3 id="ai-organisation-usage" className="font-display text-base text-ink">By organisation</h3>
                    <BreakdownTable rows={data.byOrganisation} firstHeading="Organisation" firstValue={(row) => row.organisationName} />
                  </section>
                </div>

                {data.recentErrors.length > 0 && (
                  <section aria-labelledby="ai-recent-errors">
                    <h3 id="ai-recent-errors" className="font-display text-base text-ink">Recent provider errors</h3>
                    <ul className="mt-3 divide-y divide-hairline border-y border-hairline">
                      {data.recentErrors.map((error, index) => (
                        <li key={`${error.occurredAt}-${error.requestId ?? index}`} className="flex flex-col gap-1 py-3 text-sm sm:flex-row sm:items-baseline sm:justify-between">
                          <span className="font-medium text-ink">{featureLabel(error.feature)} · {error.errorCode || 'Unknown error'}</span>
                          <span className="text-xs text-secondary">{new Date(error.occurredAt).toLocaleString('en-GB')}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}

            <p className="border-t border-hairline pt-4 text-xs leading-relaxed text-secondary">
              Costs are estimates calculated from the model, billable token counts and the pricing snapshot stored with each request. Anthropic’s invoice remains the billing source of truth. Prompts and generated content are not stored in this ledger.
            </p>
          </>
        )}
      </div>
    </AdminLayout>
  )
}
