import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  listEmployerMembers,
  listEmployerCourseAssignments,
  listEmployerDataAccessRequests,
  listEmployerSkillSuggestions,
  listEmployerLinkedProviders,
} from '../../lib/admin/employers'

const DEFAULT_LOADERS = {
  members: listEmployerMembers,
  assignments: listEmployerCourseAssignments,
  accessRequests: listEmployerDataAccessRequests,
  skillSuggestions: listEmployerSkillSuggestions,
  linkedProviders: listEmployerLinkedProviders,
}

const TILE_DEFINITIONS = [
  {
    key: 'learners',
    label: 'Active learners',
    section: 'learners',
    count: (rows) => rows.filter((row) => row.role === 'member' && row.status === 'active').length,
    describe: (count) => `${count} learner${count === 1 ? '' : 's'} currently connected to this employer`,
  },
  {
    key: 'pendingInvites',
    label: 'Pending learner invitations',
    section: 'learners',
    source: 'members',
    count: (rows) => rows.filter((row) => row.status === 'pending').length,
    describe: (count) => `${count} invitation${count === 1 ? '' : 's'} waiting for a response`,
  },
  {
    key: 'assignedTraining',
    label: 'Training awaiting completion',
    section: 'assign',
    source: 'assignments',
    count: (rows) => rows.filter((row) => ['assigned', 'enrolled'].includes(row.status)).length,
    describe: (count) => `${count} active assignment${count === 1 ? '' : 's'} across the learner group`,
  },
  {
    key: 'pendingAccess',
    label: 'Profile access requests',
    section: 'learners',
    source: 'accessRequests',
    count: (rows) => rows.filter((row) => row.status === 'pending').length,
    describe: (count) => `${count} consent request${count === 1 ? '' : 's'} awaiting a learner decision`,
  },
  {
    key: 'openSuggestions',
    label: 'Open skill suggestions',
    section: 'suggest-skills',
    source: 'skillSuggestions',
    count: (rows) => rows.filter((row) => row.status === 'suggested').length,
    describe: (count) => `${count} suggestion${count === 1 ? '' : 's'} not yet adopted or dismissed`,
  },
]

export default function EmployerOverviewPanel({ employer, loaders = DEFAULT_LOADERS }) {
  const [loading, setLoading] = useState(true)
  const [results, setResults] = useState({})

  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.allSettled(Object.entries(loaders).map(async ([key, load]) => [key, await load(employer.id)]))
      .then((settled) => {
        if (!active) return
        const next = {}
        settled.forEach((result) => {
          if (result.status === 'fulfilled') {
            const [key, rows] = result.value
            next[key] = { status: 'done', rows }
          } else {
            const key = Object.keys(loaders)[settled.indexOf(result)]
            next[key] = { status: 'error', error: result.reason?.message || 'Failed to load' }
          }
        })
        setResults(next)
        setLoading(false)
      })
    return () => { active = false }
  }, [employer.id, loaders])

  const tiles = useMemo(() => TILE_DEFINITIONS.map((definition) => {
    const source = definition.source ?? 'members'
    const result = results[source]
    return {
      ...definition,
      result: result?.status === 'done'
        ? { status: 'done', count: definition.count(result.rows) }
        : result,
    }
  }), [results])

  const providers = results.linkedProviders

  return (
    <section aria-labelledby="employer-overview-heading" className="space-y-8">
      <div>
        <h2 id="employer-overview-heading" className="font-display text-lg text-ink">Overview</h2>
        <p className="text-sm text-secondary mt-1">Your people, learning activity, and provider network at a glance.</p>
      </div>

      {loading ? (
        <p role="status" className="text-secondary">Loading employer overview…</p>
      ) : (
        <>
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {tiles.map((tile) => (
              <li key={tile.key}>
                <Link
                  to={`?employer=${employer.id}&section=${tile.section}`}
                  className="block h-full rounded-lg border border-hairline bg-card p-4 hover:border-moss transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss"
                >
                  {tile.result?.status === 'error' ? (
                    <>
                      <p role="alert" className="text-sm font-medium text-red-700">Couldn't load this count</p>
                      <p className="text-sm text-ink mt-1">{tile.label}</p>
                      <p className="text-xs text-secondary mt-1 break-words">{tile.result.error}</p>
                    </>
                  ) : (
                    <>
                      <p className="font-display text-2xl text-ink tabular-nums">{tile.result?.count ?? '—'}</p>
                      <p className="text-sm font-medium text-ink">{tile.label}</p>
                      <p className="text-xs text-secondary mt-1">{tile.result ? tile.describe(tile.result.count) : ''}</p>
                    </>
                  )}
                </Link>
              </li>
            ))}
          </ul>

          <div>
            <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
              <div>
                <h3 className="font-display text-base text-ink">Linked training providers</h3>
                <p className="text-sm text-secondary mt-1">Providers this employer has chosen to keep within reach.</p>
              </div>
              <Link
                to={`?employer=${employer.id}&section=providers`}
                className="text-sm font-medium text-moss underline underline-offset-4 hover:text-ink"
              >
                Manage linked providers
              </Link>
            </div>

            {providers?.status === 'error' ? (
              <div className="rounded-lg border border-hairline bg-card p-4">
                <p role="alert" className="text-sm font-medium text-red-700">Couldn't load linked providers.</p>
                <p className="text-xs text-secondary mt-1 break-words">{providers.error}</p>
              </div>
            ) : providers?.rows.length ? (
              <ul className="divide-y divide-hairline rounded-lg border border-hairline bg-card px-4">
                {providers.rows.slice(0, 4).map((provider) => (
                  <li key={provider.id} className="py-3 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink truncate" title={provider.organisations?.name}>
                        {provider.organisations?.name || 'Unnamed provider'}
                      </p>
                      {provider.organisations?.org_code && (
                        <p className="text-xs text-secondary truncate">{provider.organisations.org_code}</p>
                      )}
                    </div>
                    <span className="text-xs text-secondary shrink-0">Linked</span>
                  </li>
                ))}
              </ul>
            ) : (
              <Link
                to={`?employer=${employer.id}&section=providers`}
                className="block rounded-lg border border-dashed border-hairline p-6 text-center hover:border-moss transition-colors"
              >
                <p className="text-sm font-medium text-ink">No additional providers linked yet.</p>
                <p className="text-xs text-secondary mt-1">Open Providers to connect trusted training organisations.</p>
              </Link>
            )}
          </div>
        </>
      )}
    </section>
  )
}
