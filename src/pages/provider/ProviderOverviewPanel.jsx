import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  countDraftCourses,
  countRejectedCourses,
  countPendingApprovalCourses,
  countPendingStaffInvitations,
  countDraftResources,
} from '../../lib/admin/providerOverview'

// Work-queue tiles for the currently selected organisation -- mirrors
// AdminOverview.jsx's QUEUE_TILES shape (heading/to/load/describe) so the
// two Overview pages read as the same pattern, just scoped to one
// organisation_id instead of the whole platform. `to` reuses
// ProviderTrainingSection's own ?status= param scheme (Phase 3 Slice 1) so
// a click lands straight on the filtered, actionable view.
function buildTiles(organisationId, role) {
  const tiles = [
    {
      key: 'draftCourses',
      heading: 'Draft training',
      to: `/provider?org=${organisationId}&section=training&status=draft`,
      load: () => countDraftCourses(organisationId),
      describe: (n) => `${n} draft course${n === 1 ? '' : 's'} not yet submitted for approval`,
    },
    {
      key: 'rejectedCourses',
      heading: 'Rejected training awaiting revision',
      to: `/provider?org=${organisationId}&section=training&status=rejected`,
      load: () => countRejectedCourses(organisationId),
      describe: (n) => `${n} rejected course${n === 1 ? '' : 's'} not yet revised and resubmitted`,
    },
    {
      key: 'pendingApprovalCourses',
      heading: 'Training pending approval',
      to: `/provider?org=${organisationId}&section=training&status=pending_approval`,
      load: () => countPendingApprovalCourses(organisationId),
      describe: (n) => `${n} course${n === 1 ? '' : 's'} waiting for a catalogue approver's decision`,
    },
    {
      key: 'draftResources',
      heading: 'Draft resources',
      to: `/provider?org=${organisationId}&section=resources`,
      load: () => countDraftResources(organisationId),
      describe: (n) => `${n} resource${n === 1 ? '' : 's'} in draft, not yet published into the library`,
    },
  ]

  // Pending invitations only ever land on the Users tab, and that tab only
  // renders for an org admin (SECTIONS' adminOnly flag in
  // ProviderConsole.jsx) -- a trainer would see the tile but hit an access
  // wall clicking it, so it's omitted entirely for that role rather than
  // shown without a link (a dead tile is worse than one fewer tile).
  if (role === 'admin') {
    tiles.push({
      key: 'pendingInvitations',
      heading: 'Pending staff invitations',
      to: `/provider?org=${organisationId}&section=staff`,
      load: () => countPendingStaffInvitations(organisationId),
      describe: (n) => `${n} invitation${n === 1 ? '' : 's'} not yet accepted`,
    })
  }

  return tiles
}

// Provider console equivalent of AdminOverview.jsx, scoped to whichever
// organisation is currently selected in ProviderConsole.jsx's own ?org=
// tablist rather than the whole platform -- render with key={organisation.id}
// (as ProviderConsole.jsx already does for every other section) so switching
// organisations remounts this panel and re-fetches, instead of showing the
// previous org's stale counts.
export default function ProviderOverviewPanel({ organisation, role }) {
  const [loading, setLoading] = useState(true)
  const [tileResults, setTileResults] = useState({})

  const tiles = buildTiles(organisation.id, role)

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organisation.id, role])

  async function load() {
    setLoading(true)
    const settled = await Promise.allSettled(tiles.map((t) => t.load()))
    const results = {}
    tiles.forEach((t, i) => {
      const r = settled[i]
      results[t.key] =
        r.status === 'fulfilled' ? { status: 'done', count: r.value } : { status: 'error', error: r.reason?.message || 'Failed to load' }
    })
    setTileResults(results)
    setLoading(false)
  }

  const allSettledOk = tiles.every((t) => tileResults[t.key]?.status === 'done')
  const zeroAttention = !loading && allSettledOk && tiles.every((t) => tileResults[t.key].count === 0)

  return (
    <section aria-labelledby="provider-overview-heading">
      <div className="mb-5">
        <h2 id="provider-overview-heading" className="font-display text-lg text-ink">Overview</h2>
        <p className="text-sm text-secondary mt-1">What needs your attention in {organisation.name} right now.</p>
      </div>

      {loading ? (
        <p role="status" className="text-secondary">Loading…</p>
      ) : zeroAttention ? (
        <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
          <p className="text-ink font-medium mb-1">Nothing needs your attention right now.</p>
          <p className="text-sm text-secondary">No draft or rejected training, nothing pending approval, and no outstanding work.</p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {tiles.map((tile) => {
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
    </section>
  )
}
