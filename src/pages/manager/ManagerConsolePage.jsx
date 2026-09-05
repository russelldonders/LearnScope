import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { WORKSPACE_TYPES } from '../../lib/workspaces'
import { uploadEvidenceFiles } from '../../lib/skillEvidence'
import {
  createManagerCollaborationRecord, createManagerTeam, createManagerTeamSkillAssessment,
  inviteConnectionToManagerTeamByEmail, listManagerCollaborationRecords, listManagerTeamLearningRecords,
  listManagerTeamMemberSummaries, listManagerTeamSkillAssessments, listManagerTeams,
  listPendingManagerTeamInvites, setManagerTeamSkillAssessmentEvidence,
} from '../../lib/managerTeams'
import ManagerConsole from './ManagerConsole'

export default function ManagerConsolePage() {
  const { user, workspaces } = useAuth()
  const workspace = useMemo(
    () => workspaces?.find((item) => item.kind === WORKSPACE_TYPES.MANAGER) ?? null,
    [workspaces]
  )
  const [teamId, setTeamId] = useState(null)
  const [team, setTeam] = useState([])
  const [learningRecords, setLearningRecords] = useState([])
  const [collaborationRecords, setCollaborationRecords] = useState([])
  const [pendingInvites, setPendingInvites] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    if (!workspace) return
    setLoading(true)
    setError(null)
    try {
      const teams = await listManagerTeams(workspace.id)
      const selectedTeamId = teams[0]?.id ?? await createManagerTeam(workspace.id, { name: 'My team' })
      setTeamId(selectedTeamId)
      const [members, learning, records, invites] = await Promise.all([
        listManagerTeamMemberSummaries(selectedTeamId), listManagerTeamLearningRecords(selectedTeamId),
        listManagerCollaborationRecords(selectedTeamId), listPendingManagerTeamInvites(selectedTeamId),
      ])
      setTeam(members)
      setLearningRecords(learning)
      setCollaborationRecords(records)
      setPendingInvites(invites)
    } catch (loadError) {
      setError(loadError.message || 'Could not load the manager console. Try again.')
    } finally {
      setLoading(false)
    }
  }, [workspace])

  useEffect(() => { load() }, [load])

  async function handleInvite(email) {
    await inviteConnectionToManagerTeamByEmail(teamId, email)
    await load()
  }

  async function handleCreateRecord(record) {
    await createManagerCollaborationRecord(teamId, record)
    await load()
  }

  // Creates the assessment first, then -- same two-step shape as every other
  // assessment-with-evidence flow in the app (see src/lib/skillEvidence.js)
  // -- uploads any files keyed by the new assessment's own id, under this
  // manager's own storage folder (not the learner's), before attaching the
  // resulting paths. Reloads afterwards so the "Your rating" badge on the
  // member-summary chip picks up the new rating.
  async function handleRateSkill(membershipId, skillId, { level, comments, evidenceUrl, files }) {
    const assessmentId = await createManagerTeamSkillAssessment(membershipId, skillId, {
      level, comments, evidenceUrl,
    })
    if (files?.length > 0) {
      const paths = await uploadEvidenceFiles(user.id, skillId, assessmentId, files)
      await setManagerTeamSkillAssessmentEvidence(assessmentId, paths)
    }
    await load()
  }

  return <ManagerConsole team={team} learningRecords={learningRecords}
    collaborationRecords={collaborationRecords} pendingInvites={pendingInvites}
    loading={loading} error={error} onInviteToTeam={handleInvite}
    onCreateCollaborationRecord={handleCreateRecord} onRateSkill={handleRateSkill}
    onLoadSkillAssessments={listManagerTeamSkillAssessments} />
}
