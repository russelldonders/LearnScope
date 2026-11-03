import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { usePendingActions } from '../context/PendingActionsContext'
import { uploadEvidenceFiles } from '../lib/skillEvidence'
import { handleTabListKeyDown } from '../lib/tabsKeyboard'
import { writeUrlParams } from '../lib/useSortedPage'
import {
  createManagerWorkspace, createManagerTeam, listMyLedManagerTeams, listMyArchivedManagerTeams,
  listMyManagerTeamRelationships, listManagerTeamMembers, listManagerTeamRoster, inviteConnectionToManagerTeam,
  inviteManagerTeamMemberByEmail, transferManagerTeamLeadership, listManagerTeamMemberSummaries,
  listManagerTeamLearningRecords, listManagerCollaborationRecords, createManagerCollaborationRecord,
  createManagerTeamSkillAssessment, setManagerTeamSkillAssessmentEvidence, listManagerTeamSkillAssessments,
  getManagerTeamSkillDetail, setManagerTeamSkillTarget, archiveManagerTeam, restoreManagerTeam,
  listMyManagerShareableSkills, setManagerTeamSharedSkills, leaveManagerTeam,
  listManagerTeamPendingMembers, revokeManagerTeamInvite, suggestManagerTeamSkill,
  listManagerTeamSkills, addManagerTeamSkill, removeManagerTeamSkill, decideManagerTeamInvite,
  resendManagerTeamInvite, updateManagerTeamDetails, listManagerTeamSkillsForMember,
} from '../lib/managerTeams'
import MutationFeedback from './MutationFeedback'
import ConfirmDialog from './ConfirmDialog'
import ManagerSkillsPanel from '../pages/manager/ManagerSkillsPanel'
import ManagerTeamPanel from '../pages/manager/ManagerTeamPanel'
import ManagerLearningPanel from '../pages/manager/ManagerLearningPanel'
import ManagerCollaborationPanel from '../pages/manager/ManagerCollaborationPanel'
import ManagerTeamSharingPanel from '../pages/manager/learner/ManagerTeamSharingPanel'
import { useLanguage } from '../context/LanguageContext'

const fieldClass = 'mt-1 block w-full rounded-md border border-hairline bg-card px-3 py-2 text-sm text-ink'
const buttonClass = 'rounded-md border border-hairline px-3 py-2 text-sm font-medium text-ink hover:bg-card disabled:opacity-60'

// A team leader (formerly a separate "manager console" at /manager) is the
// same concept as a Connections team's leader -- merged here so leading a
// team, from creating it through to rating shared skills, all happens in one
// place instead of handing off to a second console. PANELS mirrors the old
// console's own section shape (Skills/Members/Learning/Collaboration)
// exactly, reusing its panels verbatim; only the shell around them (this
// component) and where their data loads from changed.
const PANEL_KEYS = ['skills', 'members', 'learning', 'collaboration', 'settings']

// Builds "Alex", "Alex and Sam", or "Alex, Sam and Jo" from the leader's own
// name plus whoever is currently checked in the create-team member picker --
// only ever used to seed the (still-editable) name field's initial value.
function buildDefaultTeamName(selfName, memberNames, t) {
  const names = [selfName, ...memberNames].filter(Boolean)
  if (names.length <= 1) return names[0] || ''
  return t('teams.defaultName', { names: names.slice(0, -1).join(', '), last: names[names.length - 1] })
}

// Every team a person is part of -- whether they lead it or joined someone
// else's -- lives in one selector now (previously a "Team you lead" dropdown
// plus a wholly separate "joined or invited" list at the bottom, each with
// its own detail view). `key` disambiguates a led team from a joined one
// sharing the same underlying team id (never actually possible for the same
// person, but keeps option values unique/stable regardless). Archived teams
// sort last within each group so the active, actionable ones stay on top.
function buildTeamOptions(ledTeams, archivedLedTeams, relationships) {
  const led = [...ledTeams, ...archivedLedTeams].map((t) => ({
    key: `lead:${t.id}`, id: t.id, name: t.name, description: t.description ?? null, role: 'leader', teamStatus: t.status,
  }))
  const joined = relationships
    .filter((r) => r.status === 'active')
    .map((r) => ({
      key: `member:${r.teamId}`, id: r.teamId, name: r.teamName, role: 'member',
      teamStatus: r.teamStatus, membership: r,
    }))
  return [...led, ...joined].sort((a, b) => {
    if ((a.teamStatus === 'archived') !== (b.teamStatus === 'archived')) {
      return a.teamStatus === 'archived' ? 1 : -1
    }
    return a.name.localeCompare(b.name)
  })
}

// A led team is the more actionable role, so it wins as the default view;
// otherwise the first active team of any kind, falling back to whatever's
// there (possibly archived) rather than showing nothing selectable.
function pickDefaultKey(options) {
  return options.find((t) => t.role === 'leader' && t.teamStatus === 'active')?.key
    ?? options.find((t) => t.teamStatus === 'active')?.key
    ?? options[0]?.key ?? ''
}

export default function ConnectionsTeams({ connections = [], currentUserName = '', initialTeamId = null }) {
  const { user, refreshWorkspaces } = useAuth()
  const { t } = useLanguage()
  const [ledTeams, setLedTeams] = useState([])
  const [archivedLedTeams, setArchivedLedTeams] = useState([])
  const [relationships, setRelationships] = useState([])
  const [mySkills, setMySkills] = useState([])
  const [selectedKey, setSelectedKey] = useState('')
  const [members, setMembers] = useState([])
  const [roster, setRoster] = useState([])
  const [teamMemberSummaries, setTeamMemberSummaries] = useState([])
  const [pendingMembers, setPendingMembers] = useState([])
  const [teamSkills, setTeamSkills] = useState([])
  const [revokeTarget, setRevokeTarget] = useState(null)
  const [revoking, setRevoking] = useState(false)
  const [learningRecords, setLearningRecords] = useState([])
  const [collaborationRecords, setCollaborationRecords] = useState([])
  const [searchParams, setSearchParams] = useSearchParams()
  const { refreshPendingActionCount } = usePendingActions()
  // ?tab= is only honoured on first load (for whichever team that lands
  // on); after that each team remembers its own last-used tab, below.
  const initialPanel = useRef(PANEL_KEYS.includes(searchParams.get('tab')) ? searchParams.get('tab') : null)
  const [activePanel, setActivePanel] = useState(initialPanel.current ?? 'skills')
  const panelTabRefs = useRef({})
  // Last tab a leader deliberately picked per team id -- switching away and
  // back returns there instead of always bouncing to Skills. A team with no
  // entry here yet is still "undecided", which lets loadTeamDetail steer an
  // empty team towards Members (see below) without ever overriding a tab
  // the leader actually chose.
  const lastPanelByTeam = useRef({})
  const currentTeamId = useRef('')
  const [decidingInviteId, setDecidingInviteId] = useState(null)
  const [inviteDecisionError, setInviteDecisionError] = useState(null)
  const [shareOnOpenKey, setShareOnOpenKey] = useState(null)
  const [successorId, setSuccessorId] = useState('')
  const [transferOpen, setTransferOpen] = useState(false)
  const [membersError, setMembersError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [membersLoading, setMembersLoading] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false)
  const [memberRoster, setMemberRoster] = useState([])
  const [memberAssessments, setMemberAssessments] = useState([])
  const [memberTeamSkills, setMemberTeamSkills] = useState([])
  const [detailsName, setDetailsName] = useState('')
  const [detailsDescription, setDetailsDescription] = useState('')
  const [detailsSaving, setDetailsSaving] = useState(false)
  const [memberDetailLoading, setMemberDetailLoading] = useState(false)
  const [memberDetailError, setMemberDetailError] = useState(false)
  const [memberSaving, setMemberSaving] = useState(false)
  const [memberActionError, setMemberActionError] = useState(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [nameEdited, setNameEdited] = useState(false)
  const [initialMemberIds, setInitialMemberIds] = useState(new Set())
  const [memberQuery, setMemberQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    Promise.all([
      listMyLedManagerTeams(), listMyArchivedManagerTeams(),
      listMyManagerTeamRelationships(), listMyManagerShareableSkills(user.id),
    ])
      .then(([led, archivedLed, relationshipRows, skills]) => {
        if (!active) return
        setLedTeams(led)
        setArchivedLedTeams(archivedLed)
        setRelationships(relationshipRows)
        setMySkills(skills)
        // Picked in the same update as the lists themselves (rather than a
        // separate effect reacting to them) so a fresh load never renders a
        // frame where the options are known but nothing is selected yet --
        // prefer the first active option so a brand-new or returning visitor
        // lands somewhere actionable rather than wherever archived teams
        // happen to sort. Keeps the current selection if it's still valid
        // (e.g. after archiving/restoring the very team being viewed).
        const options = buildTeamOptions(led, archivedLed, relationshipRows)
        setSelectedKey((previous) => {
          if (options.some((t) => t.key === previous)) return previous
          const fromUrl = initialTeamId && options.find((t) => t.id === initialTeamId)
          return fromUrl?.key ?? pickDefaultKey(options)
        })
      })
      .catch((err) => { if (active) setError(err.message || t('teams.loadError')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads its inputs once when opened, by design
  }, [user.id, retry])

  const teamOptions = useMemo(
    () => buildTeamOptions(ledTeams, archivedLedTeams, relationships),
    [ledTeams, archivedLedTeams, relationships]
  )
  const pendingInvites = relationships.filter((r) => r.status === 'pending')

  const selected = teamOptions.find((t) => t.key === selectedKey) ?? null
  const teamId = selected?.role === 'leader' ? selected.id : ''

  // One led team's whole detail set -- membership roster (invite
  // eligibility), the leadership-transfer roster, the enriched member
  // summaries Skills/Members both read, and the Learning/Collaboration
  // records. Reloaded wholesale after any mutation below (invite, rating,
  // new record) the same way the old ManagerConsolePage did, rather than
  // each panel managing its own slice independently.
  //
  // Every result is dropped if the leader has since switched to another
  // team (currentTeamId) -- otherwise a slow load for team A resolving after
  // a click on team B would paint A's members and skills under B's name.
  const loadTeamDetail = useCallback(async (id) => {
    setMembersLoading(true)
    setMembersError(false)
    const isStale = () => currentTeamId.current !== id
    try {
      const [membershipRows, people, summaries, learning, collaboration, pending, tracked] = await Promise.all([
        listManagerTeamMembers(id), listManagerTeamRoster(id), listManagerTeamMemberSummaries(id),
        listManagerTeamLearningRecords(id), listManagerCollaborationRecords(id), listManagerTeamPendingMembers(id),
        listManagerTeamSkills(id),
      ])
      if (isStale()) return
      setMembers(membershipRows)
      setRoster(people)
      setTeamMemberSummaries(summaries)
      setLearningRecords(learning)
      setCollaborationRecords(collaboration)
      setPendingMembers(pending)
      setTeamSkills(tracked)
      // Nobody has joined yet, so every other tab would just be an empty
      // state -- land on Members (where inviting happens) instead, unless
      // the leader has already picked a tab for this team themselves.
      if (summaries.length === 0 && !lastPanelByTeam.current[id]) {
        lastPanelByTeam.current[id] = 'members'
        setActivePanel('members')
      }
    } catch (err) {
      if (isStale()) return
      setMembersError(true)
      setError(err.message || t('teams.membersLoadError'))
    } finally {
      if (!isStale()) setMembersLoading(false)
    }
  }, [t])

  // Switching to a team restores the tab last used on it (Skills for one
  // not visited yet). Archiving/restoring/retrying the *same* team (both
  // under Settings) doesn't change teamId, so it never bounces the leader
  // off the tab they're on. Keyed on selectedKey too so that a first
  // selection landing on a *joined* team still consumes ?tab=, rather than
  // it leaking onto whichever led team gets opened later.
  const previousTeamId = useRef(teamId)
  useEffect(() => {
    if (!selectedKey) return
    currentTeamId.current = teamId
    if (teamId && previousTeamId.current !== teamId) {
      if (initialPanel.current) lastPanelByTeam.current[teamId] ??= initialPanel.current
      setActivePanel(lastPanelByTeam.current[teamId] ?? 'skills')
    }
    initialPanel.current = null
    previousTeamId.current = teamId
  }, [teamId, selectedKey])

  // Keeps ?team=&tab= in step with what's on screen, so a refresh or a
  // shared link lands on the same team and tab. replace:true -- switching
  // teams/tabs is in-page navigation, not something Back should step
  // through one click at a time.
  const selectedTeamId = selected?.id ?? ''
  const urlTab = selected?.role === 'leader' ? activePanel : ''
  useEffect(() => {
    if (!selectedTeamId) return
    if (searchParams.get('team') === selectedTeamId && (searchParams.get('tab') ?? '') === urlTab) return
    writeUrlParams(searchParams, setSearchParams, { team: selectedTeamId, tab: urlTab })
  }, [selectedTeamId, urlTab, searchParams, setSearchParams])

  // Seeds Settings' "Team details" form from whichever led team is open --
  // and re-seeds after a save, so the form always shows what's stored.
  const selectedName = selected?.name ?? ''
  const selectedDescription = selected?.description ?? ''
  useEffect(() => {
    setDetailsName(selectedName)
    setDetailsDescription(selectedDescription)
  }, [teamId, selectedName, selectedDescription])

  function selectPanel(key) {
    lastPanelByTeam.current[teamId] = key
    setActivePanel(key)
  }

  function selectTeam(key) {
    setSelectedKey(key); setShareOnOpenKey(null); setNotice(''); setError(null)
  }

  useEffect(() => {
    setMembers([])
    setRoster([])
    setTeamMemberSummaries([])
    setLearningRecords([])
    setCollaborationRecords([])
    setPendingMembers([])
    setTeamSkills([])
    setSuccessorId('')
    setTransferOpen(false)
    setMembersError(false)
    if (teamId) loadTeamDetail(teamId)
  }, [teamId, retry, loadTeamDetail])

  // Mirrors loadTeamDetail above but for a team the user has joined, not
  // led -- just the roster (who else is on it) and this manager's own
  // ratings of the skills shared with them, the same slice
  // ManagerTeamSharingPanel showed on Profile > Privacy before it moved here.
  useEffect(() => {
    if (selected?.role !== 'member') return
    let active = true
    setMemberDetailLoading(true)
    setMemberDetailError(false)
    Promise.allSettled([
      listManagerTeamRoster(selected.id),
      listManagerTeamSkillAssessments(selected.membership.id),
      listManagerTeamSkillsForMember(selected.id),
    ]).then(([rosterResult, assessmentResult, teamSkillsResult]) => {
      if (!active) return
      setMemberRoster(rosterResult.status === 'fulfilled' ? rosterResult.value : [])
      setMemberAssessments(assessmentResult.status === 'fulfilled' ? assessmentResult.value : [])
      // Optional extra, not core to the panel -- a failure here just hides
      // the "skills this team is working on" list rather than flagging the
      // whole member view as broken.
      setMemberTeamSkills(teamSkillsResult.status === 'fulfilled' ? teamSkillsResult.value : [])
      if (rosterResult.status === 'rejected' || assessmentResult.status === 'rejected') setMemberDetailError(true)
    }).finally(() => { if (active) setMemberDetailLoading(false) })
    return () => { active = false }
  }, [selected?.role, selected?.id, selected?.membership?.id])

  // Opening the form -- with exactly one connection to choose from, there's
  // no real choice to make, so pre-check them and seed the name from both
  // people; with none or several, leave it to the member picker below rather
  // than guess who belongs on the team.
  function startCreating() {
    const onlyConnection = connections.length === 1 ? connections[0] : null
    const seeded = onlyConnection ? new Set([onlyConnection.id]) : new Set()
    setInitialMemberIds(seeded)
    setName(buildDefaultTeamName(currentUserName, onlyConnection ? [onlyConnection.name] : [], t))
    setNameEdited(false)
    setCreating(true)
    setNotice('')
    setMemberQuery('')
  }

  function toggleInitialMember(connectionId) {
    setInitialMemberIds((previous) => {
      const next = new Set(previous)
      if (next.has(connectionId)) next.delete(connectionId)
      else next.add(connectionId)
      if (!nameEdited) {
        const memberNames = connections.filter((c) => next.has(c.id)).map((c) => c.name)
        setName(buildDefaultTeamName(currentUserName, memberNames, t))
      }
      return next
    })
  }

  async function handleCreate(event) {
    event.preventDefault()
    if (!name.trim()) return
    setBusy(true); setError(null); setNotice('')
    try {
      const workspaceId = await createManagerWorkspace()
      const id = await createManagerTeam(workspaceId, { name: name.trim() })
      setLedTeams((previous) => [...previous, { id, name: name.trim(), status: 'active' }])
      setSelectedKey(`lead:${id}`); setCreating(false); setName(''); setNameEdited(false)
      await refreshWorkspaces().catch(() => {})
      const memberIds = [...initialMemberIds]
      setInitialMemberIds(new Set())
      if (memberIds.length > 0) {
        const results = await Promise.allSettled(memberIds.map((memberId) => inviteConnectionToManagerTeam(id, memberId)))
        const failureCount = results.filter((r) => r.status === 'rejected').length
        await loadTeamDetail(id)
        setNotice(
          failureCount > 0
            ? t('teams.notices.createdPartial', { failed: failureCount, total: memberIds.length })
            : t('teams.notices.createdWithMembers')
        )
      } else {
        setNotice(t('teams.notices.created'))
      }
    } catch (err) { setError(err.message || t('teams.errors.create')) }
    finally { setBusy(false) }
  }

  async function handleArchive() {
    setArchiving(true); setError(null)
    try {
      await archiveManagerTeam(teamId)
      setArchiveConfirmOpen(false)
      setRetry((n) => n + 1)
      setNotice(t('teams.notices.archived'))
    } catch (err) { setError(err.message || t('teams.errors.archive')) }
    finally { setArchiving(false) }
  }

  async function handleRestore() {
    setArchiving(true); setError(null)
    try {
      await restoreManagerTeam(teamId)
      setRetry((n) => n + 1)
      setNotice(t('teams.notices.restored'))
    } catch (err) { setError(err.message || t('teams.errors.restore')) }
    finally { setArchiving(false) }
  }

  async function handleTransfer(event) {
    event.preventDefault()
    if (!successorId) return
    setBusy(true); setError(null); setNotice('')
    try {
      await transferManagerTeamLeadership(teamId, successorId)
      setNotice(t('teams.notices.leaderChanged'))
      setLedTeams((previous) => previous.filter((team) => team.id !== teamId))
      setTransferOpen(false); setRetry((n) => n + 1)
    } catch (err) { setError(err.message || t('teams.errors.transfer')) }
    finally { setBusy(false) }
  }

  // Invites each address independently (one bad/duplicate address shouldn't
  // sink the rest of a batch) and reports per-email results back to the
  // dialog rather than throwing, so it can drop the ones that succeeded and
  // leave only the failed ones for the leader to fix and retry.
  async function handleInviteByEmail(emails) {
    const results = await Promise.allSettled(emails.map((email) => inviteManagerTeamMemberByEmail(teamId, email)))
    await loadTeamDetail(teamId)
    return emails.map((email, i) => {
      const result = results[i]
      return result.status === 'fulfilled'
        ? { email, ok: true }
        : { email, ok: false, error: result.reason?.message || t('teams.errors.sendInvitation') }
    })
  }

  // Same per-item shape as handleInviteByEmail above, for the invite
  // dialog's multi-select connection picker.
  async function handleInviteConnections(connectionIds) {
    const results = await Promise.allSettled(connectionIds.map((id) => inviteConnectionToManagerTeam(teamId, id)))
    await loadTeamDetail(teamId)
    return connectionIds.map((id, i) => {
      const result = results[i]
      return result.status === 'fulfilled'
        ? { id, ok: true }
        : { id, ok: false, error: result.reason?.message || t('teams.errors.sendInvitation') }
    })
  }

  // Answering here rather than sending the learner off to /actions -- same
  // decide_manager_team_invite call Actions.jsx makes. Accepting drops them
  // straight into that team with the share-skills picker already open,
  // since choosing what to share is the very next thing a new member does.
  async function handleInviteDecision(membership, accept) {
    setDecidingInviteId(membership.id); setInviteDecisionError(null); setNotice('')
    try {
      await decideManagerTeamInvite(membership.id, accept)
      setRelationships((current) => accept
        ? current.map((r) => (r.id === membership.id ? { ...r, status: 'active', joinedAt: new Date().toISOString() } : r))
        : current.filter((r) => r.id !== membership.id))
      if (accept) {
        const key = `member:${membership.teamId}`
        setSelectedKey(key)
        setShareOnOpenKey(key)
        setNotice(t('teams.notices.joined', { team: membership.teamName, manager: membership.managerName }))
      }
      refreshPendingActionCount?.()
    } catch (err) {
      setInviteDecisionError({ id: membership.id, message: err.message || t('teams.errors.respondToInvitation') })
    } finally {
      setDecidingInviteId(null)
    }
  }

  async function handleRevokeInvite() {
    setRevoking(true); setError(null)
    try {
      await revokeManagerTeamInvite(revokeTarget.id)
      setRevokeTarget(null)
      await loadTeamDetail(teamId)
    } catch (err) { setError(err.message || t('teams.errors.revoke')) }
    finally { setRevoking(false) }
  }

  async function handleResendInvite(person) {
    await resendManagerTeamInvite(person.id)
    await loadTeamDetail(teamId)
  }

  async function handleSaveDetails(event) {
    event.preventDefault()
    const nextName = detailsName.trim()
    if (!nextName) return
    const nextDescription = detailsDescription.trim() || null
    setDetailsSaving(true); setError(null); setNotice('')
    try {
      await updateManagerTeamDetails(teamId, { name: nextName, description: nextDescription })
      setLedTeams((previous) => previous.map((team) => (team.id === teamId ? { ...team, name: nextName, description: nextDescription } : team)))
      setNotice(t('teams.notices.detailsSaved'))
    } catch (err) { setError(err.message || t('teams.errors.saveDetails')) }
    finally { setDetailsSaving(false) }
  }

  async function handleCreateCollaborationRecord(record) {
    await createManagerCollaborationRecord(teamId, record)
    await loadTeamDetail(teamId)
  }

  // Same two-step shape as every other assessment-with-evidence flow (see
  // src/lib/skillEvidence.js): create the assessment first, then upload any
  // files keyed by its own id, under this leader's own storage folder (not
  // the member's), before attaching the resulting paths.
  async function handleRateSkill(membershipId, skillId, { level, comments, evidenceUrl, files }) {
    const assessmentId = await createManagerTeamSkillAssessment(membershipId, skillId, { level, comments, evidenceUrl })
    if (files?.length > 0) {
      const paths = await uploadEvidenceFiles(user.id, skillId, assessmentId, files)
      await setManagerTeamSkillAssessmentEvidence(assessmentId, paths)
    }
    await loadTeamDetail(teamId)
  }

  // Push, don't force: only ever creates a manager_skill_suggestions
  // row -- the member still has to explicitly adopt it (or not) from their
  // own Actions page, same as an employer's skill suggestion.
  async function handleSuggestSkill(membershipId, skillLibraryId, skillName, payload) {
    await suggestManagerTeamSkill(membershipId, skillLibraryId, skillName, payload)
  }

  // Tracks a skill on the team's own list, independent of any member --
  // reloads so it shows up as a matrix row immediately, even before anyone
  // has it shared or suggested.
  async function handleAddTeamSkill(skillLibraryId, skillName) {
    await addManagerTeamSkill(teamId, skillLibraryId, skillName)
    await loadTeamDetail(teamId)
  }

  async function handleRemoveTeamSkill(id) {
    await removeManagerTeamSkill(id)
    await loadTeamDetail(teamId)
  }

  async function handleManagerTeamShare(skillIds) {
    if (!selected?.membership) return
    setMemberActionError(null)
    setMemberSaving(true)
    try {
      await setManagerTeamSharedSkills(selected.membership.id, skillIds)
      setRelationships((current) => current.map((r) =>
        r.id === selected.membership.id ? { ...r, sharedSkillIds: skillIds } : r
      ))
    } catch (err) {
      setMemberActionError(err.message || t('teams.errors.saveShared'))
    } finally {
      setMemberSaving(false)
    }
  }

  async function handleLeaveTeam() {
    if (!selected?.membership) return
    setMemberActionError(null)
    setMemberSaving(true)
    try {
      await leaveManagerTeam(selected.membership.id)
      const nextRelationships = relationships.filter((r) => r.id !== selected.membership.id)
      setRelationships(nextRelationships)
      setSelectedKey(pickDefaultKey(buildTeamOptions(ledTeams, archivedLedTeams, nextRelationships)))
    } catch (err) {
      setMemberActionError(err.message || t('teams.errors.leave'))
    } finally {
      setMemberSaving(false)
    }
  }

  const collaborationMemberOptions = teamMemberSummaries.map((m) => ({ id: m.id, name: m.name }))
  const isArchived = selected?.teamStatus === 'archived'
  // Gives a leader an at-a-glance sense of which tabs actually have
  // anything in them before clicking through each one -- Settings has no
  // natural count, so it's just omitted (panelCounts[key] stays undefined).
  const panelCounts = {
    skills: teamSkills.length,
    members: teamMemberSummaries.length,
    learning: learningRecords.length,
    collaboration: collaborationRecords.length,
  }

  return <section aria-labelledby="connections-teams-title" className="space-y-4 border-b border-hairline pb-8">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="connections-teams-title" className="font-display text-xl text-ink">{t('teams.title')}</h2>
      {!creating && <button type="button" disabled={busy || loading} onClick={startCreating} className={buttonClass}>{t('teams.createTeam')}</button>}
    </div>
    <p className="text-sm text-secondary">{t('teams.intro')}</p>

    {/* Surfaced up here rather than at the bottom of the whole section --
        these need a response, unlike everything below them, and previously
        sat past a create-team form and a whole team's worth of tabs where
        it was easy to never scroll far enough to notice. */}
    {pendingInvites.length > 0 && (
      <div className="rounded-lg border border-gold/40 bg-gold/10 p-4 space-y-3">
        <h3 className="font-display text-lg text-ink">{t('teams.invitations.title')}</h3>
        <ul className="divide-y divide-hairline">{pendingInvites.map((membership) => (
          <li key={membership.id} className="flex flex-wrap items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
            <div><p className="text-sm font-medium text-ink">{membership.teamName}</p><p className="text-sm text-secondary">{t('teams.invitations.ledBy', { name: membership.managerName })}</p></div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={decidingInviteId !== null} onClick={() => handleInviteDecision(membership, true)}
                aria-label={t('teams.invitations.acceptLabel', { team: membership.teamName })}
                className="rounded-md bg-moss px-3 py-1.5 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-60">
                {decidingInviteId === membership.id ? t('teams.invitations.saving') : t('teams.invitations.accept')}
              </button>
              <button type="button" disabled={decidingInviteId !== null} onClick={() => handleInviteDecision(membership, false)}
                aria-label={t('teams.invitations.declineLabel', { team: membership.teamName })}
                className="rounded-md border border-hairline px-3 py-1.5 text-sm font-medium text-ink hover:bg-card disabled:opacity-60">
                {t('teams.invitations.decline')}
              </button>
            </div>
            {inviteDecisionError?.id === membership.id && (
              <MutationFeedback status="error" message={inviteDecisionError.message} className="w-full" />
            )}
          </li>
        ))}</ul>
      </div>
    )}

    {loading && <p role="status" className="text-sm text-secondary">{t('teams.loadingTeams')}</p>}
    <MutationFeedback status="error" message={error} />
    {error && <button type="button" disabled={busy} className={buttonClass} onClick={() => setRetry((n) => n + 1)}>{t('teams.reloadTeams')}</button>}
    <MutationFeedback status="success" message={notice} />
    {creating && <form onSubmit={handleCreate} className="max-w-lg space-y-3">
      <label className="block text-sm text-ink">{t('teams.createForm.teamName')}
        <input required maxLength={120} value={name} disabled={busy}
          onChange={(e) => { setName(e.target.value); setNameEdited(true) }} className={fieldClass} />
      </label>
      {connections.length > 0 && <fieldset>
        <legend className="text-sm text-ink">{t('teams.createForm.addMembers')}</legend>
        {connections.length > 6 && (
          <input type="text" value={memberQuery} disabled={busy} placeholder={t('teams.createForm.searchConnections')}
            onChange={(e) => setMemberQuery(e.target.value)}
            className="mt-1 mb-1 block w-full rounded-md border border-hairline bg-card px-3 py-1.5 text-sm text-ink" />
        )}
        <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-hairline bg-card divide-y divide-hairline">
          {connections
            .filter((connection) => connection.name?.toLowerCase().includes(memberQuery.trim().toLowerCase()))
            .map((connection) => (
              <label key={connection.id} className="flex items-center gap-2 px-3 py-1.5 text-sm text-ink">
                <input type="checkbox" checked={initialMemberIds.has(connection.id)} disabled={busy}
                  onChange={() => toggleInitialMember(connection.id)} className="rounded border-hairline accent-moss" />
                {connection.name}
              </label>
            ))}
        </div>
      </fieldset>}
      <div className="flex gap-2"><button type="submit" disabled={busy || !name.trim()} className={buttonClass}>{busy ? t('teams.createForm.creating') : t('teams.createForm.create')}</button>
        <button type="button" disabled={busy} className={buttonClass} onClick={() => setCreating(false)}>{t('teams.createForm.cancel')}</button></div>
    </form>}
    {!loading && teamOptions.length === 0 && pendingInvites.length === 0 && !creating && !error && (
      <p className="text-sm text-secondary">{t('teams.empty')}</p>
    )}

    {teamOptions.length > 0 && <div className="space-y-4">
      <TeamList options={teamOptions} selectedKey={selectedKey} disabled={busy} onSelect={selectTeam} />
      {selected && (
        <div>
          <h3 className="font-display text-lg text-ink">
            {isArchived ? t('teams.archivedName', { name: selected.name }) : selected.name}
          </h3>
          {selected.description && <p className="text-sm text-secondary">{selected.description}</p>}
        </div>
      )}

      {isArchived && (
        <p role="status" className="text-sm text-ink bg-gold/10 border border-gold/40 rounded-md px-3 py-2">
          {t('teams.archivedNotice')}
          {selected.role === 'leader' && ` ${t('teams.archivedNoticeLeader')}`}
        </p>
      )}

      {selected?.role === 'leader' && <div className={`space-y-4 ${isArchived ? 'opacity-75 border-l-2 border-gold/40 pl-4' : ''}`}>
        {!isArchived && !membersLoading && !membersError && (
          <TeamSetupChecklist members={teamMemberSummaries} pendingMembers={pendingMembers}
            onOpenPanel={selectPanel} />
        )}
        <div role="tablist" aria-label={t('teams.sectionLabel')} className="flex items-center flex-wrap gap-1 border-b border-hairline">
          {PANEL_KEYS.map((key) => ({ key, label: t(`teams.panels.${key}`) })).map((panel) => (
            <button key={panel.key} type="button" role="tab"
              ref={(el) => { panelTabRefs.current[panel.key] = el }}
              id={`team-panel-tab-${panel.key}`}
              aria-selected={activePanel === panel.key}
              aria-controls={`team-panel-${panel.key}`}
              aria-label={panel.label}
              tabIndex={activePanel === panel.key ? 0 : -1}
              onClick={() => selectPanel(panel.key)}
              onKeyDown={(event) => handleTabListKeyDown(event, {
                keys: PANEL_KEYS, activeKey: activePanel, refs: panelTabRefs, onChange: selectPanel,
              })}
              className={`text-sm px-3 py-2 -mb-px border-b-2 whitespace-nowrap ${activePanel === panel.key
                ? 'border-moss text-ink font-medium'
                : 'border-transparent text-secondary hover:text-ink'}`}>
              {panel.label}
              {panelCounts[panel.key] != null && <span aria-hidden="true"> ({panelCounts[panel.key]})</span>}
            </button>
          ))}
        </div>

        <div id={`team-panel-${activePanel}`} role="tabpanel" aria-labelledby={`team-panel-tab-${activePanel}`} tabIndex={0}>
          {activePanel === 'skills' && (
            <ManagerSkillsPanel members={teamMemberSummaries} teamSkills={teamSkills} loading={membersLoading} error={membersError ? error : null}
              onRateSkill={isArchived ? undefined : handleRateSkill} onLoadSkillAssessments={listManagerTeamSkillAssessments}
              onLoadSkillDetail={getManagerTeamSkillDetail} onSetTarget={isArchived ? undefined : setManagerTeamSkillTarget}
              onSuggestSkill={isArchived ? undefined : handleSuggestSkill}
              onAddSkill={isArchived ? undefined : handleAddTeamSkill}
              onRemoveTeamSkill={isArchived ? undefined : handleRemoveTeamSkill} />
          )}
          {activePanel === 'members' && (
            <ManagerTeamPanel members={teamMemberSummaries} pendingMembers={pendingMembers}
              loading={membersLoading} error={membersError ? error : null}
              onInvite={handleInviteByEmail} onInviteConnections={handleInviteConnections}
              onOpenCollaboration={() => selectPanel('collaboration')}
              onRevokeInvite={isArchived ? undefined : (person) => setRevokeTarget(person)}
              onResendInvite={isArchived ? undefined : handleResendInvite}
              connections={connections} teamMemberships={members} readOnly={isArchived}
              onRateSkill={isArchived ? undefined : handleRateSkill} onLoadSkillAssessments={listManagerTeamSkillAssessments}
              onLoadSkillDetail={getManagerTeamSkillDetail} onSetTarget={isArchived ? undefined : setManagerTeamSkillTarget} />
          )}
          {activePanel === 'learning' && (
            <ManagerLearningPanel records={learningRecords} loading={membersLoading} error={membersError ? error : null} />
          )}
          {activePanel === 'collaboration' && (
            <ManagerCollaborationPanel records={collaborationRecords} teamOptions={collaborationMemberOptions}
              loading={membersLoading} error={membersError ? error : null} onCreateRecord={handleCreateCollaborationRecord}
              readOnly={isArchived} />
          )}
          {activePanel === 'settings' && (
            <div className="space-y-6 max-w-lg">
              <div className="bg-card border border-hairline rounded-lg p-6">
                <h3 className="font-display text-lg text-ink mb-1">{t('teams.settings.detailsTitle')}</h3>
                {isArchived ? (
                  <p className="text-sm text-secondary">{t('teams.settings.detailsArchived')}</p>
                ) : (
                  <form onSubmit={handleSaveDetails} className="space-y-3">
                    <label className="block text-sm text-ink">{t('teams.settings.teamName')}
                      <input required maxLength={120} value={detailsName} disabled={detailsSaving}
                        onChange={(e) => setDetailsName(e.target.value)} className={fieldClass} />
                    </label>
                    <label className="block text-sm text-ink">{t('teams.settings.description')}
                      <textarea rows={2} maxLength={500} value={detailsDescription} disabled={detailsSaving}
                        onChange={(e) => setDetailsDescription(e.target.value)}
                        placeholder={t('teams.settings.descriptionPlaceholder')} className={fieldClass} />
                    </label>
                    <button type="submit" className={buttonClass}
                      disabled={detailsSaving || !detailsName.trim()
                        || (detailsName.trim() === selectedName && (detailsDescription.trim() || '') === (selectedDescription || ''))}>
                      {detailsSaving ? t('teams.settings.saving') : t('teams.settings.saveDetails')}
                    </button>
                  </form>
                )}
              </div>

              <div className="bg-card border border-hairline rounded-lg p-6">
                <h3 className="font-display text-lg text-ink mb-1">{t('teams.settings.leadershipTitle')}</h3>
                <p className="text-sm text-secondary mb-4">
                  {isArchived
                    ? t('teams.settings.leadershipArchived')
                    : t('teams.settings.leadershipDescription')}
                </p>
                {!isArchived && !transferOpen && (
                  <button type="button" disabled={busy || membersLoading || membersError} onClick={() => setTransferOpen(true)} className={buttonClass}>
                    {t('teams.settings.changeLeader')}
                  </button>
                )}
                {!isArchived && transferOpen && (
                  <form onSubmit={handleTransfer} className="space-y-3">
                    <label className="block text-sm text-ink">{t('teams.settings.newLeader')}
                      <select value={successorId} disabled={busy} onChange={(e) => setSuccessorId(e.target.value)} className={fieldClass}>
                        <option value="">{t('teams.settings.chooseMember')}</option>
                        {roster.filter((person) => person.role === 'member').map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
                      </select>
                    </label>
                    <p className="text-sm text-secondary">{t('teams.settings.newLeaderHint')}</p>
                    <div className="flex gap-2">
                      <button type="submit" disabled={busy || !successorId} className={buttonClass}>{busy ? t('teams.settings.changing') : t('teams.settings.transfer')}</button>
                      <button type="button" disabled={busy} onClick={() => setTransferOpen(false)} className={buttonClass}>{t('teams.settings.cancel')}</button>
                    </div>
                  </form>
                )}
              </div>

              <div className={`bg-card border rounded-lg p-6 ${isArchived ? 'border-hairline' : 'border-red-200'}`}>
                <h3 className="font-display text-lg text-ink mb-1">{isArchived ? t('teams.settings.restoreTitle') : t('teams.settings.archiveTitle')}</h3>
                <p className="text-sm text-secondary mb-4">
                  {isArchived
                    ? t('teams.settings.restoreDescription')
                    : t('teams.settings.archiveDescription')}
                </p>
                {isArchived ? (
                  <button type="button" disabled={archiving} onClick={handleRestore} className={buttonClass}>{archiving ? t('teams.settings.restoring') : t('teams.settings.restore')}</button>
                ) : (
                  <button type="button" disabled={archiving || membersLoading} onClick={() => setArchiveConfirmOpen(true)} className={`${buttonClass} text-red-700`}>{t('teams.settings.archive')}</button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>}

      {selected?.role === 'member' && memberDetailLoading && (
        <p className="text-sm text-secondary">{t('common.loading')}</p>
      )}
      {selected?.role === 'member' && !memberDetailLoading && (
        <ManagerTeamSharingPanel
          key={selected.key}
          initialEditOpen={shareOnOpenKey === selected.key}
          membership={selected.membership}
          availableSkills={mySkills}
          sharedSkillIds={selected.membership.sharedSkillIds}
          roster={memberRoster}
          assessments={memberAssessments}
          teamSkills={memberTeamSkills}
          saving={memberSaving}
          error={memberDetailError ? t('teams.memberDetailsLoadError') : memberActionError}
          onSave={handleManagerTeamShare}
          onLeaveTeam={handleLeaveTeam}
          readOnly={isArchived}
        />
      )}
    </div>}

    {archiveConfirmOpen && (
      <ConfirmDialog
        message={t('teams.confirmArchive', { name: selected?.name })}
        confirmLabel={t('teams.settings.archive')}
        onConfirm={handleArchive}
        onCancel={() => setArchiveConfirmOpen(false)}
        confirming={archiving}
      />
    )}

    {revokeTarget && (
      <ConfirmDialog
        message={t('teams.confirmRevoke', { name: revokeTarget.name })}
        confirmLabel={t('teams.revoke')}
        onConfirm={handleRevokeInvite}
        onCancel={() => setRevokeTarget(null)}
        confirming={revoking}
      />
    )}

  </section>
}

// Every team as a visible card rather than a <select> -- leading a team and
// merely belonging to one open genuinely different screens below (a 5-tab
// console vs. one sharing panel), so the role needs to be readable before
// choosing, not buried in an option's trailing text. Shown even for a
// single team so the layout doesn't change shape once a second one appears.
function TeamList({ options, selectedKey, disabled, onSelect }) {
  const { t } = useLanguage()
  return <ul aria-label={t('teams.list.label')} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
    {options.map((team) => {
      const isSelected = team.key === selectedKey
      const isArchived = team.teamStatus === 'archived'
      return <li key={team.key}>
        <button type="button" disabled={disabled} aria-pressed={isSelected} onClick={() => onSelect(team.key)}
          className={`w-full h-full rounded-lg border px-4 py-3 text-left disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-moss ${isSelected
            ? 'border-moss bg-moss/10'
            : 'border-hairline bg-card hover:bg-paper'}`}>
          <span className="block text-sm font-medium text-ink">{team.name}</span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-secondary">
            <span className={`rounded-full border px-2 py-0.5 ${team.role === 'leader' ? 'border-moss/40 text-ink' : 'border-hairline'}`}>
              {team.role === 'leader' ? t('teams.list.youLead') : t('teams.list.ledBy', { name: team.membership.managerName })}
            </span>
            {isArchived && <span className="rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 text-ink">{t('teams.list.archived')}</span>}
          </span>
        </button>
      </li>
    })}
  </ul>
}

// Getting a team going takes three steps, and until the third happens every
// tab but Members is an empty state -- so spell them out, with a shortcut to
// the tab that moves each one forward. Hides itself for good once someone
// has actually shared a skill; nothing here is persisted, it's derived
// entirely from the team's own loaded data.
function TeamSetupChecklist({ members, pendingMembers, onOpenPanel }) {
  const { t } = useLanguage()
  const steps = [
    { key: 'invite', done: members.length > 0 || pendingMembers.length > 0, panel: 'members' },
    { key: 'accept', done: members.length > 0, panel: 'members' },
    { key: 'share', done: members.some((m) => m.sharedSkills?.length > 0), panel: 'skills' },
  ]
  if (steps.every((step) => step.done)) return null
  const nextIndex = steps.findIndex((step) => !step.done)
  return <div className="rounded-lg border border-hairline bg-card p-4">
    <h4 className="text-sm font-medium text-ink">{t('teams.checklist.title')}</h4>
    <ol className="mt-2 space-y-1.5">
      {steps.map((step, index) => (
        <li key={step.key} className="flex flex-wrap items-center gap-2 text-sm">
          <span aria-hidden="true" className={`inline-flex size-5 items-center justify-center rounded-full text-xs ${step.done ? 'bg-moss text-paper' : 'border border-hairline text-secondary'}`}>
            {step.done ? '✓' : index + 1}
          </span>
          <span className={step.done ? 'text-secondary line-through' : 'text-ink'}>
            {t(`teams.checklist.${step.key}`)}<span className="sr-only">{step.done ? t('teams.checklist.done') : t('teams.checklist.toDo')}</span>
          </span>
          {index === nextIndex && (
            <button type="button" onClick={() => onOpenPanel(step.panel)} className="text-sm font-medium text-moss hover:underline">
              {t(`teams.checklist.${step.key}Action`)}
            </button>
          )}
        </li>
      ))}
    </ol>
  </div>
}
