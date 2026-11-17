import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import AdminLayout from './AdminLayout'
import {
  countCoursesAwaitingApproval,
  countOpenResourceReports,
  countRejectedCourses,
  countBlockedUsers,
  countInactiveProviders,
  countPendingStaffInvitations,
  countRecentCourseSubmissions,
} from '../../lib/admin/overview'
import { listAllOnboardingSteps } from '../../lib/admin/onboardingSteps'

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

// Each tile is one count query (see overview.js) plus a link straight to the
// filtered view where it can be dealt with. Grouped by who has to act:
//   - needs your action: decisions only a platform admin can make;
//   - waiting on others: open items someone else has to finish;
//   - current status: states worth knowing about, not tasks.
const TILE_GROUPS = [
  {
    key: 'action',
    heading: 'Needs your action',
    tiles: [
      {
        key: 'coursesAwaitingApproval',
        heading: 'Courses awaiting approval',
        to: '/admin/courses?status=pending_approval',
        load: countCoursesAwaitingApproval,
        describe: (n) => `${plural(n, 'course')} submitted for approval or for the global catalogue`,
      },
      {
        key: 'reportedResources',
        heading: 'Reported resources',
        to: '/admin/reported-resources',
        load: countOpenResourceReports,
        describe: (n) => `${plural(n, 'shared resource')} reported by learners`,
      },
    ],
  },
  {
    key: 'waiting',
    heading: 'Waiting on others',
    tiles: [
      {
        key: 'rejectedCourses',
        heading: 'Rejected courses awaiting revision',
        to: '/admin/courses?status=rejected',
        load: countRejectedCourses,
        describe: (n) => `${plural(n, 'course')} a provider hasn't revised yet`,
      },
      {
        key: 'pendingInvitations',
        heading: 'Pending staff invitations',
        to: '/admin/organisations?invites=pending',
        load: countPendingStaffInvitations,
        describe: (n) => `${plural(n, 'organisation access invitation')} not yet accepted`,
      },
    ],
  },
  {
    key: 'status',
    heading: 'Current status',
    tiles: [
      {
        key: 'blockedUsers',
        heading: 'Blocked users',
        to: '/admin/users?status=blocked',
        load: countBlockedUsers,
        describe: (n) => `${plural(n, 'account')} currently blocked`,
      },
      {
        key: 'inactiveProviders',
        heading: 'Inactive organisations',
        to: '/admin/organisations?status=inactive',
        load: countInactiveProviders,
        describe: (n) => `${plural(n, 'organisation')} marked inactive`,
      },
    ],
  },
]

const ALL_TILES = TILE_GROUPS.flatMap((group) => group.tiles)

function TileError({ tile, result }) {
  return (
    <>
      <p role="alert" className="text-sm text-red-700 font-medium mb-1">Couldn't load this count</p>
      <p className="text-sm text-ink">{tile.heading}</p>
      <p className="text-xs text-secondary mt-1">{result.error}</p>
    </>
  )
}

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
      Promise.allSettled(ALL_TILES.map((t) => t.load())),
      Promise.allSettled([countRecentCourseSubmissions(7)]),
      Promise.allSettled([listAllOnboardingSteps()]),
    ])

    const results = {}
    ALL_TILES.forEach((t, i) => {
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

  const [actionGroup, ...otherGroups] = TILE_GROUPS
  const nothingToAction = actionGroup.tiles.every(
    (t) => tileResults[t.key]?.status === 'done' && tileResults[t.key].count === 0
  )

  return (
    <AdminLayout>
      <div className="space-y-8">
        <div>
          <h2 className="font-display text-lg text-ink mb-1">Overview</h2>
          <p className="text-sm text-secondary">What needs your attention right now.</p>
        </div>

        {loading ? (
          <p className="text-secondary">Loading…</p>
        ) : (
          <>
            <section aria-labelledby="overview-action-heading">
              <h3 id="overview-action-heading" className="font-display text-base text-ink mb-2">{actionGroup.heading}</h3>
              {nothingToAction ? (
                <div className="text-center py-10 border border-dashed border-hairline rounded-lg">
                  <p className="text-ink font-medium mb-1">Nothing needs your action right now.</p>
                  <p className="text-sm text-secondary">No courses awaiting approval and no reported resources.</p>
                </div>
              ) : (
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {actionGroup.tiles.map((tile) => {
                    const result = tileResults[tile.key]
                    const hasItems = result?.status === 'done' && result.count > 0
                    return (
                      <li key={tile.key}>
                        <Link
                          to={tile.to}
                          className={`block h-full rounded-lg border bg-card p-4 hover:border-moss transition-colors ${
                            hasItems ? 'border-moss/60' : 'border-hairline'
                          }`}
                        >
                          {result?.status === 'error' ? (
                            <TileError tile={tile} result={result} />
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
            </section>

            {otherGroups.map((group) => (
              <section key={group.key} aria-labelledby={`overview-${group.key}-heading`}>
                <h3 id={`overview-${group.key}-heading`} className="font-display text-base text-ink mb-2">{group.heading}</h3>
                <ul className="divide-y divide-hairline rounded-lg border border-hairline bg-card">
                  {group.tiles.map((tile) => {
                    const result = tileResults[tile.key]
                    return (
                      <li key={tile.key}>
                        <Link to={tile.to} className="flex items-center gap-4 px-4 py-3 hover:bg-paper">
                          {result?.status === 'error' ? (
                            <span className="min-w-0"><TileError tile={tile} result={result} /></span>
                          ) : (
                            <>
                              <span className="w-10 shrink-0 font-display text-xl text-ink">{result?.count ?? '—'}</span>
                              <span className="min-w-0">
                                <span className="block text-sm text-ink font-medium">{tile.heading}</span>
                                <span className="block text-xs text-secondary">{result ? tile.describe(result.count) : ''}</span>
                              </span>
                            </>
                          )}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </>
        )}

        <div>
          <h3 className="font-display text-base text-ink mb-2">Settings</h3>
          <Link
            to="/admin/settings#first-login-journey"
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
              to="/admin/courses"
              className="block rounded-lg border border-hairline bg-card p-4 hover:border-moss transition-colors max-w-md"
            >
              <p className="text-sm text-ink">
                {plural(recentSubmissions, 'course')} submitted in the last 7 days
              </p>
            </Link>
          </div>
        )}
      </div>
    </AdminLayout>
  )
}
