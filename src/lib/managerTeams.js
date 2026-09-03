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
  const { data, error } = await supabase
    .from('manager_team_memberships')
    .select('id, team_id, role, status, invited_at, manager_teams(id, name, workspace_id)')
    .eq('status', 'pending')
    .order('invited_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function inviteConnectionToManagerTeam(teamId, memberUserId) {
  const { data, error } = await supabase.rpc('invite_connection_to_manager_team', {
    p_team_id: teamId, p_member_user_id: memberUserId,
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
