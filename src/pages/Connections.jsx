import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import AppHeader from '../components/AppHeader'
import ConfirmDialog from '../components/ConfirmDialog'
import DropdownNavMenu from '../components/DropdownNavMenu'
import PersonAvatar from '../components/PersonAvatar'
import ConnectionsTeams from '../components/ConnectionsTeams'
import InviteConnectModal from '../components/InviteConnectModal'
import { isRecent, summariseActivity } from '../lib/connectionsActivity'
import { LEVEL_LABELS } from '../lib/levels'
import { handleTabListKeyDown } from '../lib/tabsKeyboard'
import {
  listMyPeerRatings,
  listConnections,
  listConnectionsActivity,
  listSentInvites,
  getProfiles,
  getConnectionSkills,
  sendInviteEmail,
  revokeInvite,
} from '../lib/connections'
import { formatFullDate } from '../lib/dates'
import {
  listMySharedTeamsByConnection,
} from '../lib/managerTeams'
import { listMyLineManagementWithConnections } from '../lib/employerManagement'
import { describeRelationships, tieKindOf } from '../lib/connectionRelationships'
import TieIcon from '../components/TieIcon'

// Enough recent events to sum up each connection's last month, not just the
// few most active people's.
const ACTIVITY_LIMIT = 300

const activitySeenKey = (userId) => `learnscope:connectionsActivitySeen:${userId}`

function readActivitySeen(userId) {
  try {
    const value = window.localStorage.getItem(activitySeenKey(userId))
    const date = value ? new Date(value) : null
    return date && !Number.isNaN(date.getTime()) ? date : null
  } catch {
    return null
  }
}

function writeActivitySeen(userId) {
  try {
    window.localStorage.setItem(activitySeenKey(userId), new Date().toISOString())
  } catch {
    // Private windows can refuse storage; nothing is marked new next time.
  }
}

export default function Connections() {
  const { user } = useAuth()
  const { t } = useLanguage()
  const [searchParams, setSearchParams] = useSearchParams()
  // People this learner manages at an organisation are on the Teams tab,
  // chosen in its switcher; the old ?section=team (My team) opens it there.
  const sectionKeys = ['people', 'teams']
  const sectionParam = searchParams.get('section') === 'team' ? 'teams' : searchParams.get('section')
  const activeSection = sectionKeys.includes(sectionParam) ? sectionParam : 'people'
  const tabRefs = useRef({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [ratings, setRatings] = useState([])
  const [allConnectionIds, setAllConnectionIds] = useState([])
  const [invites, setInvites] = useState([])
  const [profiles, setProfiles] = useState({})
  const [connectionSkills, setConnectionSkills] = useState({})
  const [linesByConnection, setLinesByConnection] = useState({})
  const [copiedId, setCopiedId] = useState(null)
  const [resendingId, setResendingId] = useState(null)
  const [resentId, setResentId] = useState(null)
  const [resendError, setResendError] = useState(null)
  const [revokingId, setRevokingId] = useState(null)
  const [revokeError, setRevokeError] = useState(null)
  const [pendingRevoke, setPendingRevoke] = useState(null)
  // Disconnecting happens on the person's own page (ConnectionPanel), which
  // comes back here saying so.
  const location = useLocation()
  const disconnectedName = location.state?.disconnectedName ?? null
  const [sharedTeamsByConnection, setSharedTeamsByConnection] = useState({})
  const [activity, setActivity] = useState([])
  const [activityError, setActivityError] = useState(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  // When the learner last saw the feed on this device, to mark what's new.
  // Kept in the browser only: it's a convenience, not part of their record.
  const [activityLastSeen] = useState(() => readActivitySeen(user.id))

  useEffect(() => {
    load()
    loadActivity()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the listed values change; the loaders are recreated every render
  }, [])

  // Loaded apart from the rest of the page: this is the one query here that
  // reads other people's records, so a failure only shows a retry in place of
  // the feed rather than hiding the connection list.
  async function loadActivity() {
    try {
      setActivity(await listConnectionsActivity(ACTIVITY_LIMIT))
      setActivityError(null)
      writeActivitySeen(user.id)
    } catch (err) {
      setActivity([])
      setActivityError(err.message || 'Something went wrong.')
    }
  }

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [ratingsData, connectionsData, invitesData, sharedTeamsData, linesData] = await Promise.all([
        listMyPeerRatings(),
        listConnections(user.id),
        listSentInvites(),
        listMySharedTeamsByConnection(),
        listMyLineManagementWithConnections(),
      ])
      setRatings(ratingsData)
      setAllConnectionIds(connectionsData.map((c) => c.id))
      setInvites(invitesData)
      const byConnection = (rows) => {
        const grouped = {}
        for (const row of rows) (grouped[row.connectionUserId] ??= []).push(row)
        return grouped
      }
      setSharedTeamsByConnection(byConnection(sharedTeamsData))
      setLinesByConnection(byConnection(linesData))
      const otherIds = ratingsData.map((r) => (r.rater_id === user.id ? r.skill_owner_id : r.rater_id))
      const connectionIds = [...new Set([...connectionsData.map((c) => c.id), ...otherIds])]
      const [profilesData, connectionSkillsData] = await Promise.all([
        getProfiles([...otherIds, ...connectionsData.map((c) => c.id), user.id]),
        getConnectionSkills(user.id, connectionIds),
      ])
      setProfiles(profilesData)
      setConnectionSkills(connectionSkillsData)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const connections = useMemo(() => {
    const map = new Map()

    // Every connection appears at least once, even one formed purely via an
    // accepted request with no peer-rating history yet.
    for (const id of allConnectionIds) {
      map.set(id, { id, name: profiles[id]?.name || 'Someone', avatarUrl: profiles[id]?.avatarUrl || null, events: [] })
    }

    for (const r of ratings) {
      const gaveRating = r.rater_id === user.id
      const otherId = gaveRating ? r.skill_owner_id : r.rater_id
      const otherName = gaveRating
        ? profiles[otherId]?.name || 'Someone'
        : r.rater_name || r.rater_email || 'Someone'

      if (!map.has(otherId)) {
        map.set(otherId, { id: otherId, name: otherName, avatarUrl: profiles[otherId]?.avatarUrl || null, events: [] })
      }
      map.get(otherId).events.push({
        direction: gaveRating ? 'given' : 'received',
        skillName: r.skill_name,
        skillCategory: r.skill_category,
        level: r.level,
        comments: r.comments,
        date: r.rated_at,
      })
    }

    // What each person has been up to, from the activity feed (newest first).
    const activityByPerson = new Map()
    for (const event of activity) {
      if (!activityByPerson.has(event.actor_id)) activityByPerson.set(event.actor_id, [])
      activityByPerson.get(event.actor_id).push(event)
    }

    const list = Array.from(map.values())
    for (const c of list) {
      c.events.sort((a, b) => new Date(b.date) - new Date(a.date))
      c.activity = activityByPerson.get(c.id) ?? []
      c.summary = summariseActivity(c.activity.filter((event) => isRecent(event.event_at)))
      c.lastSeenAt = activityLastSeen
      c.hasNew = activityLastSeen != null && c.activity.some((event) => new Date(event.event_at) > activityLastSeen)
      const latest = [c.activity[0]?.event_at, c.events[0]?.date].filter(Boolean).map((date) => new Date(date).getTime())
      c.latestAt = latest.length > 0 ? Math.max(...latest) : null
    }
    // Whoever's been up to something most recently first; the rest by name.
    list.sort((a, b) => (b.latestAt ?? 0) - (a.latestAt ?? 0) || (a.name ?? '').localeCompare(b.name ?? ''))
    return list
  }, [ratings, allConnectionIds, profiles, user.id, activity, activityLastSeen])

  const pendingInvites = useMemo(
    () => invites.filter((i) => i.status === 'pending' && i.invitee_email),
    [invites]
  )

  const [connectionQuery, setConnectionQuery] = useState('')
  const [skillFilter, setSkillFilter] = useState('')
  const [teamFilter, setTeamFilter] = useState('')

  // What there is to filter by: every skill a connection shows on their
  // profile, and every team you share with one.
  const skillOptions = useMemo(() => {
    const byId = new Map()
    for (const skills of Object.values(connectionSkills)) {
      for (const skill of skills) if (!byId.has(skill.libraryId)) byId.set(skill.libraryId, skill.name)
    }
    return [...byId].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
  }, [connectionSkills])
  const teamOptions = useMemo(() => {
    const byId = new Map()
    for (const teams of Object.values(sharedTeamsByConnection)) {
      for (const team of teams) if (team.membershipStatus !== 'pending') byId.set(team.teamId, team.teamName)
    }
    return [...byId].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
  }, [sharedTeamsByConnection])

  // A filter whose option has gone (after a disconnect, say) stops applying.
  const activeSkillFilter = skillOptions.some((o) => o.value === skillFilter) ? skillFilter : ''
  const activeTeamFilter = teamOptions.some((o) => o.value === teamFilter) ? teamFilter : ''
  const filtering = Boolean(activeSkillFilter || activeTeamFilter)

  const filteredConnections = useMemo(() => {
    const q = connectionQuery.trim().toLowerCase()
    return connections.filter((c) =>
      (!q || c.name?.toLowerCase().includes(q))
      && (!activeSkillFilter || (connectionSkills[c.id] ?? []).some((skill) => skill.libraryId === activeSkillFilter))
      && (!activeTeamFilter || (sharedTeamsByConnection[c.id] ?? []).some((team) =>
        team.teamId === activeTeamFilter && team.membershipStatus !== 'pending')))
  }, [connections, connectionQuery, activeSkillFilter, activeTeamFilter, connectionSkills, sharedTeamsByConnection])

  // Invitations aren't about a skill or team you share, so a filter on either
  // leaves them out; the search still finds them by email.
  const filteredInvites = useMemo(() => {
    if (filtering) return []
    const q = connectionQuery.trim().toLowerCase()
    return q ? pendingInvites.filter((i) => i.invitee_email?.toLowerCase().includes(q)) : pendingInvites
  }, [pendingInvites, connectionQuery, filtering])

  function handleCopy(invite) {
    navigator.clipboard.writeText(invite.url)
    setCopiedId(invite.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  async function handleResend(invite) {
    setResendError(null)
    setResendingId(invite.id)
    try {
      await sendInviteEmail({
        toEmail: invite.invitee_email,
        inviterName: profiles[user.id]?.name || user.email,
        skillName: invite.skills?.name,
        shareUrl: invite.url,
        emailType: { recommend: 'recommend', connect: 'connect' }[invite.invite_type] ?? 'invite',
      })
      setResentId(invite.id)
      setTimeout(() => setResentId(null), 2000)
    } catch (err) {
      setResendError({ id: invite.id, message: err.message })
    } finally {
      setResendingId(null)
    }
  }

  async function handleRevoke(invite) {
    setRevokeError(null)
    setRevokingId(invite.id)
    try {
      await revokeInvite(invite.id)
      setInvites((prev) => prev.filter((i) => i.id !== invite.id))
    } catch (err) {
      setRevokeError({ id: invite.id, message: err.message })
    } finally {
      setRevokingId(null)
      setPendingRevoke(null)
    }
  }

  function selectSection(section) {
    // Each tab starts from its own defaults rather than inheriting another
    // tab's selection (a team id, an employer) from the URL.
    const next = new URLSearchParams()
    if (section !== 'people') next.set('section', section)
    setSearchParams(next)
  }

  const sections = [
    { key: 'people', label: t('connections.tabs.connections'), count: loading ? null : connections.length || null },
    { key: 'teams', label: t('connections.tabs.teams') },
  ]

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />

      <main id="main-content" tabIndex={-1} className="max-w-4xl mx-auto px-4 py-8">
        <div className="max-w-2xl mb-6">
          <h1 className="font-display text-3xl sm:text-4xl text-ink text-balance">{t('connections.heading')}</h1>
          <p className="text-secondary mt-2 text-pretty">{t('connections.subheading')}</p>
        </div>

        <div role="tablist" aria-label={t('connections.heading')} className="flex items-center gap-1 mb-8 border-b border-hairline overflow-x-auto">
          {sections.map((section) => (
            <button key={section.key} type="button" role="tab"
              ref={(element) => { tabRefs.current[section.key] = element }}
              id={`connections-tab-${section.key}`}
              aria-selected={activeSection === section.key}
              aria-controls={`connections-panel-${section.key}`}
              tabIndex={activeSection === section.key ? 0 : -1}
              onClick={() => selectSection(section.key)}
              onKeyDown={(event) => handleTabListKeyDown(event, {
                keys: sectionKeys, activeKey: activeSection, refs: tabRefs, onChange: selectSection,
              })}
              className={`text-sm px-3 py-2 -mb-px border-b-2 whitespace-nowrap ${activeSection === section.key
                ? 'border-moss text-ink font-medium'
                : 'border-transparent text-secondary hover:text-ink'}`}>
              {section.label}
              {section.count != null && (
                <span className="ml-1.5 tabular-nums text-xs text-secondary">{section.count}</span>
              )}
            </button>
          ))}
        </div>

        <div id={`connections-panel-${activeSection}`} role="tabpanel"
          aria-labelledby={`connections-tab-${activeSection}`} tabIndex={0}>
        {activeSection === 'teams' && (
          <ConnectionsTeams
            connections={connections.filter((connection) => allConnectionIds.includes(connection.id))}
            currentUserName={profiles[user.id]?.name || user.email}
            initialTeamId={searchParams.get('team')}
          />
        )}
        {activeSection === 'people' && <div>
          <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="font-display text-xl text-ink">{t('connections.yourConnections')}</h2>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={() => setInviteOpen(true)}
                className="shrink-0 rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90"
              >
                {t('connections.inviteSomeone')}
              </button>
            </div>
          </div>

          {!loading && connections.length > 0 && (
            <div className="flex flex-col gap-2 mb-4 sm:flex-row sm:flex-wrap sm:items-center">
              <input
                type="search"
                aria-label="Search connections"
                value={connectionQuery}
                onChange={(e) => setConnectionQuery(e.target.value)}
                placeholder="Search by name…"
                className="w-full sm:w-56 rounded-md border border-hairline bg-card px-3 py-2 text-ink text-base sm:text-sm placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-moss"
              />
              {skillOptions.length > 0 && (
                <select
                  aria-label={t('connections.filterBySkill')}
                  value={activeSkillFilter}
                  onChange={(e) => setSkillFilter(e.target.value)}
                  className="w-full sm:w-48 rounded-md border border-hairline bg-card px-3 py-2 text-ink text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-moss"
                >
                  <option value="">{t('connections.allSkills')}</option>
                  {skillOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              )}
              {teamOptions.length > 0 && (
                <select
                  aria-label={t('connections.filterByTeam')}
                  value={activeTeamFilter}
                  onChange={(e) => setTeamFilter(e.target.value)}
                  className="w-full sm:w-48 rounded-md border border-hairline bg-card px-3 py-2 text-ink text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-moss"
                >
                  <option value="">{t('connections.allTeams')}</option>
                  {teamOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              )}
              {filtering && (
                <button
                  type="button"
                  onClick={() => { setSkillFilter(''); setTeamFilter('') }}
                  className="text-sm text-moss font-medium hover:underline sm:ml-1"
                >
                  {t('connections.clearFilters')}
                </button>
              )}
            </div>
          )}

          {/* The activity behind each summary is loaded on its own -- it's the
              one query here that reads other people's records -- so a failure
              only costs the summaries, never the list. */}
          {activityError && !error && (
            <div className="flex items-center justify-between gap-3 bg-card border border-hairline rounded-lg px-4 py-3 mb-4">
              <p className="text-sm text-secondary">{t('connections.activityError')}</p>
              <button
                type="button"
                onClick={loadActivity}
                className="shrink-0 text-sm text-moss font-medium hover:opacity-90"
              >
                {t('connections.retry')}
              </button>
            </div>
          )}

          {loading && <p className="text-secondary">Loading…</p>}
          {/* A failed load says so plainly and offers to try again, rather than
              showing the browser's own message over an empty list. */}
          {error && (
            <div role="alert" className="flex items-center justify-between gap-3 bg-card border border-hairline rounded-lg px-4 py-3 mb-4">
              <p className="text-sm text-secondary">{t('connections.loadError')}</p>
              <button
                type="button"
                onClick={() => { load(); loadActivity() }}
                className="shrink-0 text-sm text-moss font-medium hover:opacity-90"
              >
                {t('connections.retry')}
              </button>
            </div>
          )}
          {disconnectedName && (
            <p role="status" className="text-sm text-moss mb-4">{t('connections.disconnected', { name: disconnectedName })}</p>
          )}

          {!loading && !error && connections.length === 0 && (
            <div className="text-center py-16 px-4 border border-dashed border-hairline rounded-lg">
              <p className="text-secondary max-w-md mx-auto text-pretty">
                {t('connections.emptyState')}
              </p>
            </div>
          )}

          {!loading && connections.length > 0 && filteredConnections.length === 0 && filteredInvites.length === 0 && (
            <div className="text-center py-12 border border-dashed border-hairline rounded-lg">
              <p className="text-sm text-secondary">
                {filtering ? t('connections.noFilterMatches') : `No connections match "${connectionQuery}".`}
              </p>
            </div>
          )}

          <div className="space-y-3">
            {filteredConnections.map((c) => (
              <ConnectionCard
                key={c.id}
                connection={c}
                sharedSkills={(connectionSkills[c.id] ?? []).filter((skill) => skill.shared).map((skill) => skill.name)}
                sharedTeams={sharedTeamsByConnection[c.id] ?? []}
                lines={linesByConnection[c.id] ?? []}
              />
            ))}
          </div>

          {/* Invitations still waiting for a reply: people who may become
              connections, so they're listed with them, kept compact. */}
          {!loading && filteredInvites.length > 0 && (
            <section aria-labelledby="pending-invites-heading" className="mt-8">
              <h2 id="pending-invites-heading" className="text-xs font-medium uppercase tracking-wide text-secondary mb-2">
                {t('connections.pendingInvites')}
                <span className="ml-1.5 tabular-nums normal-case tracking-normal">{filteredInvites.length}</span>
              </h2>
              <ul className="bg-card border border-hairline rounded-lg divide-y divide-hairline/40">
                {filteredInvites.map((invite) => (
                  <li key={invite.id} className="px-4 py-3 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-ink break-words">
                        {invite.invite_type === 'connect' ? (
                          t('connections.connectInviteSentTo', { email: invite.invitee_email })
                        ) : (
                          <>
                            {invite.invite_type === 'recommend' ? 'Recommended' : 'Rate'}{' '}
                            <strong>{invite.skills?.name}</strong> — sent to {invite.invitee_email}
                          </>
                        )}
                      </p>
                      <p className="text-xs text-secondary mt-0.5">
                        Sent {formatFullDate(invite.created_at)}
                        {/* What just happened, as the menu closes on choosing. */}
                        <span role="status" className="text-moss">
                          {resendingId === invite.id ? ' · Sending…'
                            : resentId === invite.id ? ' · Email sent'
                              : copiedId === invite.id ? ' · Link copied'
                                : revokingId === invite.id ? ' · Revoking…' : ''}
                        </span>
                      </p>
                      {resendError?.id === invite.id && <p className="text-xs text-red-700 mt-1">{resendError.message}</p>}
                      {revokeError?.id === invite.id && <p className="text-xs text-red-700 mt-1">{revokeError.message}</p>}
                    </div>
                    {/* One small button, top right, holds the actions. */}
                    <div className="shrink-0 -mt-1 -mr-1">
                      <DropdownNavMenu
                        variant="more"
                        align="right"
                        menuWidthClass="w-44"
                        label={`Options for the invite to ${invite.invitee_email}`}
                        items={[
                          { key: 'resend', label: 'Resend email', keepFocus: true, onSelect: () => handleResend(invite) },
                          { key: 'copy', label: 'Copy link', keepFocus: true, onSelect: () => handleCopy(invite) },
                          { key: 'revoke', label: 'Revoke', danger: true, onSelect: () => setPendingRevoke(invite) },
                        ]}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>}

        </div>
      </main>

      {inviteOpen && (
        <InviteConnectModal
          onClose={() => setInviteOpen(false)}
          onSent={(invite) => setInvites((current) => [invite, ...current])}
        />
      )}

      {pendingRevoke && (
        <ConfirmDialog
          message={`Revoke the invite to ${pendingRevoke.invitee_email}? They'll no longer be able to use this link.`}
          onConfirm={() => handleRevoke(pendingRevoke)}
          onCancel={() => setPendingRevoke(null)}
          confirming={revokingId === pendingRevoke.id}
        />
      )}
    </div>
  )
}

// The level in a summary phrase arrives as a number (see summariseActivity).
function summaryText(part, t) {
  const params = { ...part.params }
  if (params.level != null) params.level = LEVEL_LABELS[params.level] ?? params.level
  return t(`connectionsActivity.summary.${part.key}`, params)
}

// Shared skills named on the card; every skill is on their page.
const SHOWN_SHARED_SKILLS = 3

// One person, kept to a few short lines: how you relate (who manages whom at
// an employer, which teams you share and who leads them), what they've been
// up to lately, and the skills you share. The whole card opens their page,
// where everything else about the connection lives (ConnectionPanel).
function ConnectionCard({ connection: c, sharedSkills, sharedTeams, lines }) {
  const { t } = useLanguage()
  const relationships = describeRelationships({ lines, teams: sharedTeams })
  const { parts, more } = c.summary ?? { parts: [], more: 0 }
  const shownSkills = sharedSkills.slice(0, SHOWN_SHARED_SKILLS)
  const moreSkills = sharedSkills.length - shownSkills.length

  return (
    <div className="relative bg-card border border-hairline rounded-lg p-4 hover:border-moss/50 focus-within:ring-2 focus-within:ring-moss">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {/* Stretched over the whole card, so anywhere on it opens their page. */}
          <Link
            to={`/skills-profile/${c.id}`}
            className="flex items-center gap-2 group w-fit focus:outline-none after:absolute after:inset-0 after:rounded-lg"
          >
            <PersonAvatar name={c.name} avatarUrl={c.avatarUrl} />
            <span className="font-display text-lg text-ink group-hover:text-moss group-hover:underline">
              {c.name}
            </span>
          </Link>

          {/* pl-10 lines these up with the name, past the avatar (w-8 + gap-2). */}
          {parts.length > 0 && (
            <p className="mt-1.5 pl-10 text-sm text-ink text-pretty">
              {parts.map((part) => summaryText(part, t)).join(' · ')}
              {more > 0 && <span className="text-secondary"> · {t('connectionsActivity.moreSkills', { count: more })}</span>}
            </p>
          )}

          {sharedSkills.length > 0 && (
            <p className="mt-1 pl-10 text-xs text-secondary text-pretty">
              {t('connections.sharedSkillsLine', { skills: shownSkills.join(', ') })}
              {moreSkills > 0 && ` ${t('connectionsActivity.moreSkills', { count: moreSkills })}`}
            </p>
          )}
        </div>

        {/* Top right: just the icons for how you relate; the words are their
            tooltip (and what a screen reader hears), and in full on the
            person's page. Raised above the card's stretched link so the
            tooltips show on hover. */}
        {(relationships.length > 0 || c.hasNew) && (
          <div className="shrink-0 flex items-center gap-1.5">
            {relationships.length > 0 && (
              <ul className="relative z-10 flex flex-wrap justify-end gap-1.5">
                {relationships.map((phrase) => {
                  const text = t(`connections.relation.${phrase.key}`, phrase.params)
                  return (
                    <li key={phrase.key} title={text} className="flex items-center">
                      <TieIcon kind={tieKindOf(phrase.key)} />
                      <span className="sr-only">{text}</span>
                    </li>
                  )
                })}
              </ul>
            )}
            {c.hasNew && (
              <>
                <span aria-hidden="true" className="block w-2 h-2 rounded-full bg-moss" />
                <span className="sr-only">{t('connectionsActivity.newLabel')}</span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
