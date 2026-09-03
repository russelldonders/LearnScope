import { formatAbsoluteDate } from '../../../lib/dates'

// Read-only -- the employer can see who's linked to a role profile, but
// consent flows the other way: only the learner can create or remove the
// link (see src/pages/roles/employer-link/RoleProfileLinkPicker.jsx and
// RoleAlignmentSummary.jsx's disconnect action), so this panel has no
// mutation callbacks of its own.
export default function RoleProfileLinkedEmployeesPanel({ employees, loading = false, error = null }) {
  return (
    <div className="bg-card border border-hairline rounded-lg p-6">
      <h3 className="font-display text-lg text-ink mb-1">Linked employees</h3>
      <p className="text-sm text-secondary mb-4">
        People who've linked their current role to this role profile. They control the link -- it isn't
        assigned from here.
      </p>

      {loading && <p className="text-sm text-secondary">Loading…</p>}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      {!loading && !error && employees.length === 0 && (
        <p className="text-sm text-secondary py-2">No employees have linked to this role profile yet.</p>
      )}

      {!loading && employees.length > 0 && (
        <ul className="divide-y divide-hairline">
          {employees.map((employee) => (
            <li key={employee.id} className="py-2">
              <p className="text-sm text-ink truncate" title={employee.name}>
                {employee.name}
              </p>
              <p className="text-xs text-secondary truncate" title={employee.email}>
                {employee.email} · linked {formatAbsoluteDate(employee.linkedAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
