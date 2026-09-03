// Snapshot tiles for the manager console, mirroring ProviderOverviewPanel
// .jsx's tile layout -- unlike that panel, this one doesn't fetch anything
// itself: counts are derived from the same view-model arrays (`team`,
// `learningRecords`, `collaborationRecords`, `pendingInvites`) the other
// three section panels already receive as props, so this stays a pure
// function of props rather than its own data source.
export default function ManagerOverviewPanel({
  team = [],
  learningRecords = [],
  collaborationRecords = [],
  pendingInvites = [],
  loading = false,
}) {
  const inProgressLearning = learningRecords.filter((r) => r.status === 'in_progress').length
  const totalSharedSkills = team.reduce((sum, m) => sum + (m.sharedSkills?.length ?? 0), 0)

  const tiles = [
    {
      key: 'teamSize',
      heading: 'Team members',
      count: team.length,
      describe: (n) => (n === 0 ? 'No team members yet' : `${n} member${n === 1 ? '' : 's'} on your team`),
    },
    {
      key: 'pendingInvites',
      heading: 'Pending team invites',
      count: pendingInvites.length,
      describe: (n) => `${n} invite${n === 1 ? '' : 's'} not yet accepted`,
    },
    {
      key: 'sharedSkills',
      heading: 'Explicitly shared skills',
      count: totalSharedSkills,
      describe: (n) => `${n} skill${n === 1 ? '' : 's'} shared with you across your team`,
    },
    {
      key: 'inProgressLearning',
      heading: 'Collaborative learning in progress',
      count: inProgressLearning,
      describe: (n) => `${n} team-scoped learning record${n === 1 ? '' : 's'} in progress`,
    },
    {
      key: 'collaborationRecords',
      heading: 'Collaboration records',
      count: collaborationRecords.length,
      describe: (n) => `${n} note${n === 1 ? '' : 's'} and goal${n === 1 ? '' : 's'} logged with your team`,
    },
  ]

  return (
    <section aria-labelledby="manager-overview-heading">
      <div className="mb-5">
        <h2 id="manager-overview-heading" className="font-display text-lg text-ink">Overview</h2>
        <p className="text-sm text-secondary mt-1">
          A snapshot of your team and the collaborative learning and notes you share with them.
        </p>
      </div>

      {loading ? (
        <p role="status" className="text-secondary">Loading…</p>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {tiles.map((tile) => (
            <li key={tile.key} className="rounded-lg border border-hairline bg-card p-4">
              <p className="font-display text-2xl text-ink">{tile.count}</p>
              <p className="text-sm text-ink font-medium">{tile.heading}</p>
              <p className="text-xs text-secondary mt-1">{tile.describe(tile.count)}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
