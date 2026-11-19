import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import ConfirmDialog from './ConfirmDialog'
import ConnectionTeamInviteControl from './ConnectionTeamInviteControl'
import GrowthRing from './GrowthRing'
import { EventRow } from './ConnectionsActivityFeed'
import { describeRelationships, tieKindOf } from '../lib/connectionRelationships'
import TieIcon from './TieIcon'
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
import { handleTabListKeyDown } from '../lib/tabsKeyboard'

const ACTIVITY_EVENTS = 20

// Level changes are already the profile's "Recent growth" section; this lists
// everything else they've been doing.
const SHOWN_HERE = (event) => event.event_type !== 'skill_confirmed'

const TAB_KEYS = ['you', 'skills', 'activity']

// A connection's profile page, in three tabs:
//   You and {name} -- how the two of you relate (management at an employer,
//                     teams you share and who leads them), the ratings you've
//                     exchanged, and the actions on the connection itself --
//                     adding them to a team, disconnecting
//   Skills         -- the skills they share (skills, from the profile page)
//   Activity       -- what they've been up to, then their recent growth
//                     (growth, from the profile page)
// The People list only sums these up; this is where they live in full. For
// someone you aren't connected to there's no "you and them", so the page
// shows its own skills and growth untabbed (fallback).
export default function ConnectionPanel({ userId, name, skills = null, growth = null, fallback = null }) {
  const { user, refreshWorkspaces } = useAuth()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [state, setState] = useState(null)
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('you')
  const tabRefs = useRef({})

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

  if (!state) return null
  if (!state.connected) return fallback

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
  const tabs = [
    { key: 'you', label: t('connections.panel.heading', { name }) },
    { key: 'skills', label: t('connections.panel.tabs.skills') },
    { key: 'activity', label: t('connections.panel.tabs.activity') },
  ]

  return (
    <div>
      <div role="tablist" aria-label={name} className="flex items-center gap-1 mb-6 border-b border-hairline overflow-x-auto">
        {tabs.map((tab) => (
          <button key={tab.key} type="button" role="tab"
            ref={(element) => { tabRefs.current[tab.key] = element }}
            id={`connection-tab-${tab.key}`}
            aria-selected={activeTab === tab.key}
            aria-controls={`connection-panel-${tab.key}`}
            tabIndex={activeTab === tab.key ? 0 : -1}
            onClick={() => setActiveTab(tab.key)}
            onKeyDown={(event) => handleTabListKeyDown(event, {
              keys: TAB_KEYS, activeKey: activeTab, refs: tabRefs, onChange: setActiveTab,
            })}
            className={`text-sm px-3 py-2 -mb-px border-b-2 whitespace-nowrap ${activeTab === tab.key
              ? 'border-moss text-ink font-medium'
              : 'border-transparent text-secondary hover:text-ink'}`}>
            {tab.label}
          </button>
        ))}
      </div>

      <div id={`connection-panel-${activeTab}`} role="tabpanel" aria-labelledby={`connection-tab-${activeTab}`} tabIndex={0}
        className="focus:outline-none">
        {activeTab === 'you' && (
          <section aria-labelledby="connection-panel-heading" className="bg-card border border-hairline rounded-lg p-6 mb-6 space-y-6">
            <h2 id="connection-panel-heading" className="sr-only">{t('connections.panel.heading', { name })}</h2>

            <div>
              {relationships.length > 0 ? (
                <ul className="space-y-1.5">
                  {relationships.map((phrase) => (
                    <li key={phrase.key} className="flex items-center gap-2 text-sm text-ink">
                      <TieIcon kind={tieKindOf(phrase.key)} />
                      {t(`connections.relation.${phrase.key}`, phrase.params)}
                    </li>
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
          </section>
        )}

        {activeTab === 'skills' && skills}

        {activeTab === 'activity' && (
          <div className="space-y-8">
            {state.activity.length > 0 && (
              <section aria-labelledby="connection-activity-heading" className="bg-card border border-hairline rounded-lg p-6">
                <h2 id="connection-activity-heading" className={heading}>{t('connections.recentActivity')}</h2>
                <ul className="divide-y divide-hairline/40">
                  {state.activity.map((event, i) => (
                    <EventRow key={`${event.event_type}-${event.event_at}-${i}`} event={event} name={name} isNew={false} />
                  ))}
                </ul>
              </section>
            )}
            {growth}
            {state.activity.length === 0 && !growth && (
              <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
                <p className="text-secondary">{t('connections.panel.noActivity', { name })}</p>
              </div>
            )}
          </div>
        )}
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
    </div>
  )
}
