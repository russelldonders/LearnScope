import { supabase } from './supabaseClient'

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
  }))
}

export async function listPendingManagerTeamInvites(teamId) {
  const { data, error } = await supabase.from('manager_team_memberships')
    .select('id, invited_email, invited_at').eq('team_id', teamId)
    .eq('role', 'member').eq('status', 'pending').order('invited_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((row) => ({ id: row.id, email: row.invited_email, sentAt: row.invited_at }))
}

export async function inviteConnectionToManagerTeam(teamId, memberUserId) {
  const { data, error } = await supabase.rpc('invite_connection_to_manager_team', {
    p_team_id: teamId, p_member_user_id: memberUserId,
  })
  if (error) throw error
  return data
}

export async function inviteConnectionToManagerTeamByEmail(teamId, email) {
  const { data, error } = await supabase.rpc('invite_connection_to_manager_team_by_email', {
    p_team_id: teamId, p_email: email,
  })
  if (error) throw error
  return data
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

export async function listManagerTeamMemberSummaries(teamId) {
  const { data, error } = await supabase.rpc('list_manager_team_member_summaries', { p_team_id: teamId })
  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.id, name: row.name, avatarUrl: row.avatar_url, teamSince: row.team_since,
    sharedSkills: row.shared_skills ?? [],
    collaborativeLearningCount: Number(row.collaborative_learning_count ?? 0),
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
