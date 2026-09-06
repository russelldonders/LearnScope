import { supabase } from './supabaseClient'
import { callAdminApi } from './admin/adminApi'
import { findOrCreatePersonalSkill } from './skillLibrary'

export async function listMyLedManagerTeams() {
  const { data, error } = await supabase.rpc('list_my_led_manager_teams')
  if (error) throw error
  return data ?? []
}

export async function listMyArchivedManagerTeams() {
  const { data, error } = await supabase.rpc('list_my_archived_manager_teams')
  if (error) throw error
  return data ?? []
}

export async function archiveManagerTeam(teamId) {
  const { error } = await supabase.rpc('archive_manager_team', { p_team_id: teamId })
  if (error) throw error
}

export async function restoreManagerTeam(teamId) {
  const { error } = await supabase.rpc('restore_manager_team', { p_team_id: teamId })
  if (error) throw error
}

export async function transferManagerTeamLeadership(teamId, membershipId) {
  const { error } = await supabase.rpc('transfer_manager_team_leadership', {
    p_team_id: teamId, p_membership_id: membershipId,
  })
  if (error) throw error
}

export async function getManagerTeamSkillDetail(membershipId, skillId) {
  const { data, error } = await supabase.rpc('get_manager_team_skill_detail', {
    p_membership_id: membershipId, p_skill_id: skillId,
  })
  if (error) throw error
  return data
}

export async function setManagerTeamSkillTarget(membershipId, skillId, { level, date, comments }) {
  const { data, error } = await supabase.rpc('set_manager_team_skill_target', {
    p_membership_id: membershipId, p_skill_id: skillId,
    p_target_level: level, p_target_date: date, p_comments: comments || null,
  })
  if (error) throw error
  return data
}

export async function createManagerWorkspace(name = 'My manager workspace') {
  const { data, error } = await supabase.rpc('create_manager_workspace', { p_name: name })
  if (error) throw error
  return data
}

export async function createManagerTeam(workspaceId, { name, description = null }) {
  const { data, error } = await supabase.rpc('create_manager_team', {
    p_workspace_id: workspaceId, p_name: name, p_description: description,
  })
  if (error) throw error
  return data
}

export async function listManagerTeams(workspaceId) {
  const { data, error } = await supabase
    .from('manager_teams')
    .select('id, workspace_id, name, description, status, created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at')
  if (error) throw error
  return data ?? []
}

export async function listMyManagerTeamInvites() {
  const relationships = await listMyManagerTeamRelationships()
  return relationships.filter((relationship) => relationship.status === 'pending')
}

export async function listMyManagerTeamRelationships() {
  const { data, error } = await supabase.rpc('list_my_manager_team_relationships')
  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.id,
    status: row.status,
    teamId: row.team_id,
    teamName: row.team_name,
    managerName: row.manager_name,
    invitedAt: row.invited_at,
    joinedAt: row.joined_at,
    sharedSkillIds: row.shared_skill_ids ?? [],
    teamStatus: row.team_status,
  }))
}

export async function listPendingManagerTeamInvites(teamId) {
  const { data, error } = await supabase.from('manager_team_memberships')
    .select('id, invited_email, invited_at').eq('team_id', teamId)
    .eq('role', 'member').eq('status', 'pending').order('invited_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((row) => ({ id: row.id, email: row.invited_email, sentAt: row.invited_at }))
}

// Any learner can freely become a manager (create_manager_workspace is
// idempotent and open to any authenticated user, not a granted role), so
// callers outside the Connections Teams tab itself -- e.g. "also invite them
// to your team" from a skill recommendation -- can resolve a target team
// without the user ever having visited it. Same fallback ConnectionsTeams.jsx
// itself uses when creating a team: reuse the first existing team, or create
// "My team" if there isn't one yet.
export async function getOrCreateMyDefaultManagerTeam() {
  const workspaceId = await createManagerWorkspace()
  const teams = await listMyLedManagerTeams()
  return teams[0]?.id ?? (await createManagerTeam(workspaceId, { name: 'My team' }))
}

export async function inviteConnectionToManagerTeam(teamId, memberUserId) {
  const { data, error } = await supabase.rpc('invite_connection_to_manager_team', {
    p_team_id: teamId, p_member_user_id: memberUserId,
  })
  if (error) throw error
  return data
}

// Genuinely invites someone by email -- an existing LearnScope account (no
// prior connection required) gets a pending team invite plus a notification
// email, and someone with no account yet gets a real Supabase sign-up
// invite. Needs the service-role key (creating an account isn't something a
// plain client-callable RPC can do), so this goes through the shared
// admin/org action dispatcher rather than supabase.rpc.
export async function inviteManagerTeamMemberByEmail(teamId, email) {
  return callAdminApi('inviteManagerTeamMemberByEmail', { teamId, email })
}

export async function decideManagerTeamInvite(membershipId, accept) {
  const { error } = await supabase.rpc('decide_manager_team_invite', {
    p_membership_id: membershipId, p_accept: accept,
  })
  if (error) throw error
}

export async function leaveManagerTeam(membershipId) {
  const { error } = await supabase.rpc('leave_manager_team', { p_membership_id: membershipId })
  if (error) throw error
}

export async function listMyManagerShareableSkills(userId) {
  const [{ data: skills, error: skillsError }, { data: assessments, error: assessmentsError }] = await Promise.all([
    supabase.from('skills').select('id, name, level').eq('user_id', userId).order('name'),
    supabase.from('skill_assessments').select('skill_id, evidence_paths').eq('user_id', userId),
  ])
  if (skillsError) throw skillsError
  if (assessmentsError) throw assessmentsError
  const evidenceBySkill = new Map()
  for (const assessment of assessments ?? []) {
    evidenceBySkill.set(
      assessment.skill_id,
      (evidenceBySkill.get(assessment.skill_id) ?? 0) + (assessment.evidence_paths?.length ?? 0)
    )
  }
  return (skills ?? []).map((skill) => ({
    id: skill.id,
    name: skill.name,
    level: skill.level,
    evidenceCount: evidenceBySkill.get(skill.id) ?? 0,
  }))
}

export async function listManagerTeamMembers(teamId) {
  const { data, error } = await supabase
    .from('manager_team_memberships')
    .select('id, team_id, member_user_id, role, status, invited_at, decided_at')
    .eq('team_id', teamId)
    .order('invited_at')
  if (error) throw error
  return data ?? []
}

export async function setManagerTeamSharedSkills(membershipId, skillIds) {
  const { error } = await supabase.rpc('set_manager_team_shared_skills', {
    p_membership_id: membershipId, p_skill_ids: skillIds,
  })
  if (error) throw error
}

export async function listManagerTeamSharedSkills(teamId) {
  const { data, error } = await supabase.rpc('list_manager_team_shared_skills', { p_team_id: teamId })
  if (error) throw error
  return data ?? []
}

export async function listManagerTeamRoster(teamId) {
  const { data, error } = await supabase.rpc('list_manager_team_roster', { p_team_id: teamId })
  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.id, name: row.name, avatarUrl: row.avatar_url, role: row.role, memberSince: row.member_since,
  }))
}

export async function listManagerTeamPendingMembers(teamId) {
  const { data, error } = await supabase.rpc('list_manager_team_pending_members', { p_team_id: teamId })
  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.id, name: row.name, avatarUrl: row.avatar_url, invitedAt: row.invited_at,
  }))
}

export async function revokeManagerTeamInvite(membershipId) {
  const { error } = await supabase.rpc('revoke_manager_team_invite', { p_membership_id: membershipId })
  if (error) throw error
}

export async function listManagerTeamMemberSummaries(teamId) {
  const { data, error } = await supabase.rpc('list_manager_team_member_summaries', { p_team_id: teamId })
  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.id, name: row.name, avatarUrl: row.avatar_url, teamSince: row.team_since,
    sharedSkills: row.shared_skills ?? [],
    collaborativeLearningCount: Number(row.collaborative_learning_count ?? 0),
  }))
}

// A manager's own rating of a skill a member has shared with them --
// deliberately separate from the member's own skill/skill_assessments
// history (see the migration): never overwrites it, always attributed to
// the manager, scoped to this team relationship. `createManagerTeamSkillAssessment`
// returns the new assessment id; when the caller also has evidence files,
// upload them (see src/lib/skillEvidence.js, keyed by that id, same as any
// other assessment-with-evidence flow) then attach the resulting paths with
// `setManagerTeamSkillAssessmentEvidence`.
export async function createManagerTeamSkillAssessment(membershipId, skillId, { level, comments = null, evidenceUrl = null }) {
  const { data, error } = await supabase.rpc('create_manager_team_skill_assessment', {
    p_membership_id: membershipId, p_skill_id: skillId, p_level: level,
    p_comments: comments, p_evidence_url: evidenceUrl,
  })
  if (error) throw error
  return data
}

export async function setManagerTeamSkillAssessmentEvidence(assessmentId, evidencePaths) {
  const { error } = await supabase.rpc('set_manager_team_skill_assessment_evidence', {
    p_assessment_id: assessmentId, p_evidence_paths: evidencePaths,
  })
  if (error) throw error
}

export async function listManagerTeamSkillAssessments(membershipId) {
  const { data, error } = await supabase.rpc('list_manager_team_skill_assessments', { p_membership_id: membershipId })
  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.id, skillId: row.skill_id, level: row.level, comments: row.comments,
    evidenceUrl: row.evidence_url, evidencePaths: row.evidence_paths ?? [],
    assessedByName: row.assessed_by_name, assessedAt: row.assessed_at,
  }))
}

export async function createManagerTeamActivity(teamId, activity) {
  const { data, error } = await supabase.rpc('create_manager_team_activity', {
    p_team_id: teamId,
    p_title: activity.title,
    p_catalogue_course_id: activity.catalogueCourseId ?? null,
    p_instructions: activity.instructions ?? null,
    p_due_at: activity.dueAt ?? null,
    p_membership_ids: activity.membershipIds ?? [],
  })
  if (error) throw error
  return data
}

export async function listManagerTeamActivities(teamId) {
  const { data, error } = await supabase
    .from('manager_team_learning_activities')
    .select('id, team_id, catalogue_course_id, title, instructions, due_at, status, created_at, manager_team_activity_participants(membership_id, status)')
    .eq('team_id', teamId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function listManagerTeamLearningRecords(teamId) {
  const { data, error } = await supabase.rpc('list_manager_team_learning_records', { p_team_id: teamId })
  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.id, title: row.title, kind: row.kind, status: row.status,
    memberIds: row.member_ids ?? [], memberNames: row.member_names ?? [], occurredAt: row.occurred_at,
  }))
}

export async function createManagerCollaborationRecord(teamId, { title, note, memberIds }) {
  const { data, error } = await supabase.rpc('create_manager_collaboration_record', {
    p_team_id: teamId, p_title: title, p_note: note, p_membership_ids: memberIds,
  })
  if (error) throw error
  return data
}

export async function listManagerCollaborationRecords(teamId) {
  const { data, error } = await supabase.rpc('list_manager_collaboration_records', { p_team_id: teamId })
  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.id, title: row.title, note: row.note,
    memberIds: row.member_ids ?? [], memberNames: row.member_names ?? [], createdAt: row.created_at,
  }))
}

// The team's own "working on together" list, independent of any specific
// member -- lets a leader add a skill with nobody suggested yet. Adding is
// idempotent (same team+skill twice just returns the existing row).
export async function addManagerTeamSkill(teamId, skillLibraryId, skillName) {
  const { data, error } = await supabase.rpc('add_manager_team_skill', {
    p_team_id: teamId, p_skill_library_id: skillLibraryId, p_skill_name: skillName,
  })
  if (error) throw error
  return {
    id: data.id, teamId: data.team_id, skillLibraryId: data.skill_library_id,
    skillName: data.skill_name, addedBy: data.added_by, createdAt: data.created_at,
  }
}

export async function listManagerTeamSkills(teamId) {
  const { data, error } = await supabase.rpc('list_manager_team_skills', { p_team_id: teamId })
  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.id, teamId: row.team_id, skillLibraryId: row.skill_library_id,
    skillName: row.skill_name, addedBy: row.added_by, createdAt: row.created_at,
  }))
}

export async function removeManagerTeamSkill(id) {
  const { error } = await supabase.rpc('remove_manager_team_skill', { p_id: id })
  if (error) throw error
}

// Leader side of a "push, don't force" skill suggestion (mirrors
// suggestSkillToEmployerMembers in src/lib/admin/employers.js) -- this only
// ever creates a manager_team_skill_suggestions row. It never touches the
// member's own skills/skill_targets; they still have to explicitly adopt it
// via /actions (adoptManagerTeamSkillSuggestion below).
export async function suggestManagerTeamSkill(membershipId, skillLibraryId, skillName, { targetLevel = null, targetDate = null, comments = null } = {}) {
  const { data, error } = await supabase.rpc('suggest_manager_team_skill', {
    p_membership_id: membershipId, p_skill_library_id: skillLibraryId, p_skill_name: skillName,
    p_target_level: targetLevel, p_target_date: targetDate, p_comments: comments,
  })
  if (error) throw error
  return data
}

// Learner side, surfaced on /actions alongside every other pending-action
// type. Pending ('suggested') suggestions only -- once adopted/dismissed
// they drop off this list.
export async function listMyManagerTeamSkillSuggestions() {
  const { data, error } = await supabase.rpc('list_my_manager_team_skill_suggestions')
  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.id, membershipId: row.membership_id, skillName: row.skill_name,
    suggestedTargetLevel: row.suggested_target_level, targetDate: row.target_date,
    comments: row.comments, status: row.status, createdAt: row.created_at,
    teamName: row.team_name, suggestedByName: row.suggested_by_name,
  }))
}

// "Add to my skills" -- resolves-or-creates the real skills row via the
// same unmodified findOrCreatePersonalSkill every other learner-initiated
// skill-add path uses (never a silent copy of the leader's suggested
// values), then -- only if the learner kept a target -- inserts a
// skill_targets row shaped exactly like SetTargetModal's own. Marking the
// suggestion 'adopted' purely drops it off the pending list; it's never
// itself the thing shown on the learner's skills profile.
export async function adoptManagerTeamSkillSuggestion(userId, suggestion, { targetLevel = null, targetDate = null, comments = null } = {}) {
  if (targetLevel != null && !targetDate) {
    throw new Error('Target date is required when setting a target level.')
  }

  const { skill } = await findOrCreatePersonalSkill(userId, suggestion.skillName)

  if (targetLevel != null) {
    const { error: targetError } = await supabase.from('skill_targets').insert({
      skill_id: skill.id,
      user_id: userId,
      target_level: targetLevel,
      target_date: targetDate,
      comments: comments?.trim() || null,
    })
    if (targetError) throw targetError
  }

  const { error } = await supabase
    .from('manager_team_skill_suggestions')
    .update({ status: 'adopted' })
    .eq('id', suggestion.id)
  if (error) throw error

  return skill
}

export async function dismissManagerTeamSkillSuggestion(suggestionId) {
  const { error } = await supabase
    .from('manager_team_skill_suggestions')
    .update({ status: 'dismissed' })
    .eq('id', suggestionId)
  if (error) throw error
}
