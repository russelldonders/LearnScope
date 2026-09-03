import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { WORKSPACE_TYPES } from '../lib/workspaces'
import ProtectedRoute from './ProtectedRoute'
import { createManagerWorkspace } from '../lib/managerTeams'

export default function ManagerRoute({ children }) {
  return <ProtectedRoute><RequireManagerWorkspace>{children}</RequireManagerWorkspace></ProtectedRoute>
}

function RequireManagerWorkspace({ children }) {
  const { workspaces, refreshWorkspaces } = useAuth()
  const [setupError, setSetupError] = useState(null)
  const hasManagerWorkspace = workspaces?.some((workspace) => workspace.kind === WORKSPACE_TYPES.MANAGER)

  useEffect(() => {
    if (workspaces === null || hasManagerWorkspace || setupError) return
    let cancelled = false
    createManagerWorkspace()
      .then(() => refreshWorkspaces())
      .catch((error) => { if (!cancelled) setSetupError(error.message || 'Could not create your manager workspace.') })
    return () => { cancelled = true }
  }, [workspaces, hasManagerWorkspace, refreshWorkspaces, setupError])

  if (setupError) {
    return <div className="min-h-screen flex items-center justify-center bg-paper text-secondary">{setupError}</div>
  }
  if (workspaces === null || !hasManagerWorkspace) {
    return <div className="min-h-screen flex items-center justify-center bg-paper text-secondary">Loading…</div>
  }
  return children
}
