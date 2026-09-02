import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import AdminLayout from './AdminLayout'
import {
  countPendingCourseApprovals,
  countRejectedCourses,
  countBlockedUsers,
  countInactiveProviders,
  countPendingStaffInvitations,
  countRecentCourseSubmissions,
} from '../../lib/admin/overview'
import { listAllOnboardingSteps } from '../../lib/admin/onboardingSteps'

// The work-queue tiles proper -- each a single efficient count query (see
// overview.js) plus a link using AdminUsers.jsx/AdminCatalogue.jsx's exact
// ?status= param scheme so a click lands straight on the actionable filtered
// view, not just the general list. "Inactive provider organisations" and
// "Pending staff invitations" both link to the plain /admin/providers list
// (no ?status= support there yet -- a later slice) rather than a filtered
// view; still an actionable destination, just a less sharp one.
const QUEUE_TILES = [
  {
    key: 'pendingApprovals',
    heading: 'Pending course approvals',
    to: '/admin/catalogue?status=pending_approval',
    load: countPendingCourseApprovals,
    describe: (n) => `${n} course${n === 1 ? '' : 's'} waiting for a decision`,
  },
  {
    key: 'rejectedCourses',
    heading: 'Rejected courses awaiting revision',
    to: '/admin/catalogue?status=rejected',
    load: countRejectedCourses,
    describe: (n) => `${n} rejected course${n === 1 ? '' : 's'} a provider hasn't revised yet`,
  },
  {
    key: 'blockedUsers',
    heading: 'Blocked users',
    to: '/admin/users?status=blocked',
    load: countBlockedUsers,
    describe: (n) => `${n} account${n === 1 ? '' : 's'} currently blocked`,
  },
  {
    key: 'inactiveProviders',
    heading: 'Inactive provider organisations',
    to: '/admin/providers',
    load: countInactiveProviders,
    describe: (n) => `${n} provider organisation${n === 1 ? '' : 's'} marked inactive`,
  },
  {
    key: 'pendingInvitations',
    heading: 'Pending staff invitations',
    to: '/admin/providers',
    load: countPendingStaffInvitations,
    describe: (n) => `${n} provider-staff invitation${n === 1 ? '' : 's'} not yet accepted`,
  },
]

export default function AdminOverview() {
  const [loading, setLoading] = useState(true)
  const [tileResults, setTileResults] = useState({})
  const [recentSubmissions, setRecentSubmissions] = useState(null)
  const [onboarding, setOnboarding] = useState({ status: 'loading' })

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)

    const [tileSettled, recentSettled, onboardingSettled] = await Promise.all([
      Promise.allSettled(QUEUE_TILES.map((t) => t.load())),
      Promise.allSettled([countRecentCourseSubmissions(7)]),
      Promise.allSettled([listAllOnboardingSteps()]),
    ])

    const results = {}
    QUEUE_TILES.forEach((t, i) => {
      const r = tileSettled[i]
      results[t.key] =
        r.status === 'fulfilled' ? { status: 'done', count: r.value } : { status: 'error', error: r.reason?.message || 'Failed to load' }
    })
    setTileResults(results)

    const recentResult = recentSettled[0]
    setRecentSubmissions(recentResult.status === 'fulfilled' ? recentResult.value : null)

    const onboardingResult = onboardingSettled[0]
    setOnboarding(
      onboardingResult.status === 'fulfilled'
        ? { status: 'done', steps: onboardingResult.value }
        : { status: 'error', error: onboardingResult.reason?.message || 'Failed to load' }
    )

    setLoading(false)
  }

  const allSettledOk = QUEUE_TILES.every((t) => tileResults[t.key]?.status === 'done')
  const zeroAttention = !loading && allSettledOk && QUEUE_TILES.every((t) => tileResults[t.key].count === 0)

  return (
    <AdminLayout>
      <div className="space-y-8">
        <div>
          <h2 className="font-display text-lg text-ink mb-1">Overview</h2>
          <p className="text-sm text-secondary">What needs your attention right now.</p>
        </div>

        {loading ? (
          <p className="text-secondary">Loading…</p>
        ) : zeroAttention ? (
          <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
            <p className="text-ink font-medium mb-1">Nothing needs your attention right now.</p>
            <p className="text-sm text-secondary">No pending approvals, blocked users, or outstanding invitations.</p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {QUEUE_TILES.map((tile) => {
              const result = tileResults[tile.key]
              return (
                <li key={tile.key}>
                  <Link
                    to={tile.to}
                    className="block h-full rounded-lg border border-hairline bg-card p-4 hover:border-moss transition-colors"
                  >
                    {result?.status === 'error' ? (
                      <>
                        <p role="alert" className="text-sm text-red-700 font-medium mb-1">
                          Couldn't load this count
                        </p>
                        <p className="text-sm text-ink">{tile.heading}</p>
                        <p className="text-xs text-secondary mt-1">{result.error}</p>
                      </>
                    ) : (
                      <>
                        <p className="font-display text-2xl text-ink">{result?.count ?? '—'}</p>
                        <p className="text-sm text-ink font-medium">{tile.heading}</p>
                        <p className="text-xs text-secondary mt-1">{result ? tile.describe(result.count) : ''}</p>
                      </>
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
        )}

        <div>
          <h3 className="font-display text-base text-ink mb-2">Settings</h3>
          <Link
            to="/admin/onboarding"
            className="block rounded-lg border border-hairline bg-card p-4 hover:border-moss transition-colors max-w-md"
          >
            {onboarding.status === 'loading' ? (
              <p className="text-sm text-secondary">Loading first-login journey status…</p>
            ) : onboarding.status === 'error' ? (
              <p role="alert" className="text-sm text-red-700">Couldn't load onboarding step status: {onboarding.error}</p>
            ) : (
              <>
                <p className="text-sm text-ink font-medium">
                  {onboarding.steps.filter((s) => s.enabled).length} of {onboarding.steps.length} first-login steps enabled
                </p>
                {onboarding.steps.length > 0 && onboarding.steps.every((s) => !s.enabled) && (
                  <p className="text-xs text-red-700 mt-1">
                    Every step is disabled — new learners skip the wizard entirely and land straight on the dashboard.
                  </p>
                )}
              </>
            )}
          </Link>
        </div>

        {recentSubmissions !== null && (
          <div>
            <h3 className="font-display text-base text-ink mb-2">Recent activity</h3>
            <Link
              to="/admin/catalogue"
              className="block rounded-lg border border-hairline bg-card p-4 hover:border-moss transition-colors max-w-md"
            >
              <p className="text-sm text-ink">
                {recentSubmissions} course{recentSubmissions === 1 ? '' : 's'} submitted to the catalogue in the last 7 days
              </p>
            </Link>
          </div>
        )}
      </div>
    </AdminLayout>
  )
}
