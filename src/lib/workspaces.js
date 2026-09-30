import { supabase } from './supabaseClient'

export const WORKSPACE_TYPES = Object.freeze({
  PERSONAL: 'personal',
  MANAGER: 'manager',
  ORGANISATION: 'organisation',
  PLATFORM_ADMIN: 'platform_admin',
})

export function toWorkspaceViewModel(accessRow) {
  const workspace = accessRow?.workspaces
  if (!workspace) return null

  return {
    id: workspace.id,
    kind: workspace.workspace_type,
    organisationId: workspace.organisation_id ?? null,
    name: workspace.name,
    role: accessRow.access_role,
    status: workspace.status,
    requiresReauthentication: false,
    allowedActions: workspace.status === 'active' && accessRow.status === 'active' ? ['workspace:enter'] : [],
  }
}

export function chooseActiveWorkspace(workspaces, preferredId = null) {
  const available = (workspaces ?? []).filter(
    (workspace) => workspace.status === 'active' && workspace.allowedActions.includes('workspace:enter')
  )
  if (preferredId) {
    const preferred = available.find((workspace) => workspace.id === preferredId)
    if (preferred) return preferred
  }
  return available.find((workspace) => workspace.kind === WORKSPACE_TYPES.PERSONAL) ?? available[0] ?? null
}

export async function listAvailableWorkspaces() {
  const { data, error } = await supabase
    .from('workspace_access')
    .select('id, access_role, status, workspaces(id, workspace_type, name, organisation_id, status)')
    .eq('status', 'active')
    .order('granted_at')

  if (error) throw error
  return (data ?? []).map(toWorkspaceViewModel).filter(Boolean)
}
