import { useState } from 'react'
import MutationFeedback from '../../../components/MutationFeedback'
import { formatAbsoluteDate } from '../../../lib/dates'

const STATUS_LABELS = {
  pending: 'Awaiting response',
  accepted: 'Linked',
}

// Employer-side roster for a role profile -- each row is a proposed or
// accepted assignment, never the employee's full profile. Assigning here
// only *proposes* the role (mirrors addEmployerMember's add-by-email
// pattern in EmployerConsole.jsx): the employee still has to accept it
// themselves from their own side (see
// src/pages/roles/employer-link/PendingAssignmentsPanel.jsx) before it
// shows as "Linked" -- this panel can never accept on their behalf, only
// propose (onAssignEmployee) or withdraw (onWithdrawAssignment) either
// state.
export default function RoleProfileLinkedEmployeesPanel({
  employees,
  assigning = false,
  error = null,
  onAssignEmployee,
  onWithdrawAssignment,
}) {
  const [email, setEmail] = useState('')

  function handleAssign(e) {
    e.preventDefault()
    const trimmed = email.trim()
    if (!trimmed) return
    onAssignEmployee?.(trimmed)
    setEmail('')
  }

  return (
    <div className="bg-card border border-hairline rounded-lg p-6">
      <h3 className="font-display text-lg text-ink mb-1">Linked employees</h3>
      <p className="text-sm text-secondary mb-4">
        Employees assigned to this role profile. Assigning proposes the role -- an employee must accept it
        themselves before it's linked, and it never overwrites their own current role.
      </p>

      {employees.length === 0 ? (
        <p className="text-sm text-secondary py-2">No employees assigned to this role profile yet.</p>
      ) : (
        <ul className="divide-y divide-hairline mb-4">
          {employees.map((employee) => (
            <li key={employee.assignmentId} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="text-sm text-ink truncate" title={employee.name}>
                  {employee.name}
                </p>
                <p className="text-xs text-secondary truncate" title={employee.email}>
                  {employee.email} · {STATUS_LABELS[employee.status] ?? employee.status} ·{' '}
                  {formatAbsoluteDate(employee.assignedAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onWithdrawAssignment?.(employee.assignmentId)}
                disabled={assigning}
                className="text-xs font-medium text-red-700 hover:underline disabled:opacity-60 whitespace-nowrap"
              >
                Withdraw
              </button>
            </li>
          ))}
        </ul>
      )}

      <MutationFeedback status="error" message={error} className="mb-3" />

      <form onSubmit={handleAssign} className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[10rem]">
          <label htmlFor="role-profile-assign-email" className="block text-xs text-secondary mb-1">
            Assign by email
          </label>
          <input
            id="role-profile-assign-email"
            type="email"
            value={email}
            disabled={assigning}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@company.example"
            className="w-full rounded-md border border-hairline bg-paper px-2 py-1.5 text-sm text-ink"
          />
        </div>
        <button
          type="submit"
          disabled={assigning || !email.trim()}
          className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
        >
          {assigning ? 'Assigning…' : 'Assign'}
        </button>
      </form>
    </div>
  )
}
