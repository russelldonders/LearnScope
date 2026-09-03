import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { WORKSPACE_TYPES } from '../lib/workspaces'
import ProtectedRoute from './ProtectedRoute'

export default function ManagerRoute({ children }) {
  return <ProtectedRoute><RequireManagerWorkspace>{children}</RequireManagerWorkspace></ProtectedRoute>
}

function RequireManagerWorkspace({ children }) {
  const { workspaces } = useAuth()
  if (workspaces === null) {
    return <div className="min-h-screen flex items-center justify-center bg-paper text-secondary">Loading…</div>
  }
  if (!workspaces.some((workspace) => workspace.kind === WORKSPACE_TYPES.MANAGER)) {
    return <Navigate to="/dashboard" replace />
  }
  return children
}
