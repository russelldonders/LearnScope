import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import ConfirmDialog from './ConfirmDialog'
import ConnectionTeamInviteControl from './ConnectionTeamInviteControl'
import GrowthRing from './GrowthRing'
import { EventRow } from './ConnectionsActivityFeed'
import { describeRelationships } from '../lib/connectionRelationships'
import { groupConnectionsActivity } from '../lib/connectionsActivity'
import { disconnectConnection, listConnections, listConnectionsActivity, listMyPeerRatings } from '../lib/connections'
import { listMyLineManagementWithConnections } from '../lib/employerManagement'
import {
  createManagerTeam,
  createManagerWorkspace,
  inviteConnectionToManagerTeam,
  listMyLedManagerTeams,
  listMySharedTeamsByConnection,
} from '../lib/managerTeams'
import { formatFullDate } from '../lib/dates'
import { LEVEL_LABELS } from '../lib/levels'

const ACTIVITY_EVENTS = 20

// Level changes are already the profile's "Recent growth" section; this lists
// everything else they've been doing.
const SHOWN_HERE = (event) => event.event_type !== 'skill_confirmed'

// "You and {name}" on a connection's profile page: how the two of you relate
// (management at an employer, teams you share and who leads them), what
// they've been up to, the ratings you've exchanged, and the actions on the
// connection itself -- adding them to a team, disconnecting. The People list
// only sums these up; this is where they live in full. Shows nothing for
// someone you aren't connected to.
export default function ConnectionPanel({ userId, name }) {
  const { user, refreshWorkspaces } = useAuth()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [state, setState] = useState(null)
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let active = true
    async function load() {
      const connections = await listConnections(user.id)
      if (!connections.some((c) => c.id === userId)) return { connected: false }
      // Each part is optional: a failure leaves that part out, not the panel.
      const settle = (promise, fallback) => promise.catch(() => fallback)
      const [teams, lines, ratings, ledTeams, activity] = await Promise.all([
        settle(listMySharedTeamsByConnection(), []),
        settle(listMyLineManagementWithConnections(), []),
        settle(listMyPeerRatings(), []),
        settle(listMyLedManagerTeams(), []),
        settle(listConnectionsActivity(ACTIVITY_EVENTS * 2, userId), []),
      ])
      return {
        connected: true,
        teams: teams.filter((team) => team.connectionUserId === userId),
        lines: lines.filter((line) => line.connectionUserId === userId),
        ratings: ratings
          .filter((r) => (r.rater_id === user.id ? r.skill_owner_id : r.rater_id) === userId)
          .sort((a, b) => new Date(b.rated_at) - new Date(a.rated_at)),
        ledTeams: ledTeams.filter((team) => team.status === 'active'),
        activity: groupConnectionsActivity(activity.filter(SHOWN_HERE)).slice(0, ACTIVITY_EVENTS),
      }
    }
    load()
      .then((result) => { if (active) setState(result) })
      .catch(() => { if (active) setState({ connected: false }) })
    return () => { active = false }
  }, [user.id, userId])

  if (!state?.connected) return null

  const relationships = describeRelationships({ lines: state.lines, teams: state.teams })
  const activeTeams = state.teams.filter((team) => team.membershipStatus !== 'pending')

  async function handleCreateTeam(teamName) {
    const workspaceId = await createManagerWorkspace()
    const id = await createManagerTeam(workspaceId, { name: teamName })
    const team = { id, name: teamName, status: 'active' }
    setState((current) => ({ ...current, ledTeams: [...current.ledTeams, team] }))
    await refreshWorkspaces?.().catch(() => {})
    return team
  }

  async function handleDisconnect() {
    setDisconnecting(true)
    setError(null)
    try {
      await disconnectConnection(userId)
      navigate('/connections', { state: { disconnectedName: name } })
    } catch (err) {
      setError(err.message)
      setDisconnecting(false)
      setConfirmingDisconnect(false)
    }
  }

  const heading = 'font-display text-lg text-ink mb-2'

  return (
    <section aria-labelledby="connection-panel-heading" className="bg-card border border-hairline rounded-lg p-6 mb-6 space-y-6">
      <h2 id="connection-panel-heading" className="font-display text-xl text-ink">{t('connections.panel.heading', { name })}</h2>

      <div>
        {relationships.length > 0 ? (
          <ul className="space-y-1">
            {relationships.map((phrase) => (
              <li key={phrase.key} className="text-sm text-ink">{t(`connections.relation.${phrase.key}`, phrase.params)}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-secondary">{t('connections.panel.noTies')}</p>
        )}
        {state.teams.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1" aria-label={t('connections.sharedTeams')}>
            {state.teams.map((team) => (
              <li key={team.teamId}>
                <Link to={`/connections?section=teams&team=${team.teamId}`} className="text-sm text-moss font-medium hover:underline">
                  {team.teamName}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {activeTeams.length === 0 && (
          <ConnectionTeamInviteControl
            connection={{ id: userId, name }}
            teams={state.ledTeams}
            onInvite={inviteConnectionToManagerTeam}
            onCreateTeam={handleCreateTeam}
          />
        )}
      </div>

      {state.activity.length > 0 && (
        <div>
          <h3 className={heading}>{t('connections.recentActivity')}</h3>
          <ul className="divide-y divide-hairline/40">
            {state.activity.map((event, i) => (
              <EventRow key={`${event.event_type}-${event.event_at}-${i}`} event={event} name={name} isNew={false} />
            ))}
          </ul>
        </div>
      )}

      {state.ratings.length > 0 && (
        <div>
          <h3 className={heading}>{t('connections.ratingsBetweenYou')}</h3>
          <ul className="space-y-3">
            {state.ratings.map((r) => (
              <li key={r.id ?? `${r.skill_name}-${r.rated_at}`} className="flex items-center gap-3">
                <GrowthRing level={r.level} size={28} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink">
                    {t(r.rater_id === user.id ? 'connections.panel.youRated' : 'connections.panel.theyRated', {
                      skill: r.skill_name, level: LEVEL_LABELS[r.level],
                    })}
                  </p>
                  <p className="text-xs text-secondary">{formatFullDate(r.rated_at)}</p>
                  {r.comments && <p className="text-sm text-secondary mt-0.5">{r.comments}</p>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="pt-4 border-t border-hairline flex flex-wrap items-center justify-between gap-3">
        {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : <span />}
        <button
          type="button"
          onClick={() => setConfirmingDisconnect(true)}
          aria-label={t('connections.disconnectFrom', { name })}
          className="text-sm text-red-700 font-medium hover:underline"
        >
          {t('connections.disconnect')}
        </button>
      </div>

      {confirmingDisconnect && (
        <ConfirmDialog
          message={t('connections.disconnectConfirm', { name })}
          confirmLabel={t('connections.disconnect')}
          onConfirm={handleDisconnect}
          onCancel={() => setConfirmingDisconnect(false)}
          confirming={disconnecting}
        />
      )}
    </section>
  )
}
