import { useMemo, useState } from 'react'
import MutationFeedback from '../../../components/MutationFeedback'
import StatusBadge from '../../../components/StatusBadge'
import { formatAbsoluteDate } from '../../../lib/dates'

const STATUS_LABELS = {
  pending: 'Awaiting response',
  accepted: 'Linked',
}

const TRAINING_STATUS_LABELS = {
  enrolled: 'Started',
  assigned: 'Assigned',
  dismissed: 'Dismissed',
}

// Employer-side roster for a role profile -- each row is a proposed or
// accepted assignment, never the employee's full profile. Assigning here
// only *proposes* the role (mirrors addEmployerMember's own semantics in
// EmployerConsole.jsx): the employee still has to accept it themselves from
// their own side (see src/pages/roles/employer-link/PendingAssignmentsPanel
// .jsx) before it shows as "Linked" -- this panel can never accept on their
// behalf, only propose (onAssignEmployees) or withdraw
// (onWithdrawAssignment) either state.
//
// Picks from this employer's own active roster (a real multi-select, not a
// free-text email one at a time) rather than typing an email -- there's
// already a definitive list of who's eligible (listEmployerMembers), so
// asking for a name to type and hope it resolves server-side was never
// actually necessary here the way it is for EmployerConsole's own "Add
// users" (which invites someone who may not have an account yet at all).
export default function RoleProfileLinkedEmployeesPanel({
  employees,
  members = [],
  requiredSkills = [],
  training = [],
  readiness = {},
  assigning = false,
  error = null,
  onAssignEmployees,
  onWithdrawAssignment,
}) {
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState(new Set())
  const hasRequirements = requiredSkills.length > 0 || training.length > 0

  const alreadyLinkedUserIds = useMemo(() => new Set(employees.map((e) => e.userId)), [employees])

  // Excludes anyone already proposed/linked -- re-proposing them isn't a
  // meaningful action here (they either already have this role pending or
  // accepted), so they're just not offered rather than left to fail server-
  // side.
  const assignableMembers = useMemo(() => {
    const q = search.trim().toLowerCase()
    return members.filter((m) =>
      m.status === 'active' &&
      !alreadyLinkedUserIds.has(m.user_id) &&
      (!q || m.email?.toLowerCase().includes(q) || m.userCode?.toLowerCase().includes(q))
    )
  }, [members, search, alreadyLinkedUserIds])

  function toggle(memberId) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(memberId)) next.delete(memberId)
      else next.add(memberId)
      return next
    })
  }

  function handleAssign(e) {
    e.preventDefault()
    if (selectedIds.size === 0) return
    onAssignEmployees?.([...selectedIds])
    setSelectedIds(new Set())
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
                {employee.status === 'accepted' && hasRequirements && (
                  <RoleReadinessDetail
                    requiredSkills={requiredSkills}
                    training={training}
                    readiness={readiness[employee.userId]}
                  />
                )}
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

      <form onSubmit={handleAssign}>
        <label htmlFor="role-profile-assign-search" className="block text-xs text-secondary mb-1">
          Add employees
        </label>
        <input
          id="role-profile-assign-search"
          type="text"
          value={search}
          disabled={assigning}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by email…"
          className="w-full rounded-md border border-hairline bg-paper px-2 py-1.5 text-sm text-ink mb-2"
        />
        <div className="border border-hairline rounded-md divide-y divide-hairline max-h-56 overflow-y-auto mb-2">
          {assignableMembers.length === 0 ? (
            <p className="text-sm text-secondary px-3 py-2">
              {search.trim() ? 'No matching active employees.' : 'No more active employees to add.'}
            </p>
          ) : (
            assignableMembers.map((m) => (
              <label key={m.id} className="flex items-center gap-2 px-3 py-1.5 text-sm text-ink hover:bg-paper cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedIds.has(m.id)}
                  disabled={assigning}
                  onChange={() => toggle(m.id)}
                  className="rounded border-hairline accent-moss"
                />
                {m.email}
                {m.userCode && <span className="text-xs text-secondary">({m.userCode})</span>}
              </label>
            ))
          )}
        </div>
        <button
          type="submit"
          disabled={assigning || selectedIds.size === 0}
          className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
        >
          {assigning ? 'Assigning…' : selectedIds.size > 0 ? `Assign ${selectedIds.size} selected` : 'Assign'}
        </button>
      </form>
    </div>
  )
}

// Readiness against this role's own required skills/training -- deliberately
// NOT the learner's full alignment (that stays the learner-facing view's job,
// see RoleProfileSkillsPanel.jsx's own comment). Skill levels only appear
// here for whatever the employee already chose to share with this employer
// (getEmployerRoleProfileReadiness relies on RLS to enforce that silently);
// training only reflects this employer's own assignment records
// (assigned/started/dismissed), never a completion reached independently.
function RoleReadinessDetail({ requiredSkills, training, readiness }) {
  const skillsMet = requiredSkills.filter((requirement) => {
    const level = readiness?.skills?.[requirement.skillId]
    return typeof level === 'number' && level >= requirement.targetLevel
  }).length
  const trainingStarted = training.filter((requirement) => readiness?.training?.[requirement.courseId] === 'enrolled').length

  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-xs text-secondary hover:text-ink">
        {requiredSkills.length > 0 && `${skillsMet}/${requiredSkills.length} skills met`}
        {requiredSkills.length > 0 && training.length > 0 && ' · '}
        {training.length > 0 && `${trainingStarted}/${training.length} training started`}
      </summary>
      <div className="mt-2 flex flex-col gap-1">
        {requiredSkills.map((requirement) => {
          const level = readiness?.skills?.[requirement.skillId]
          const met = typeof level === 'number' && level >= requirement.targetLevel
          return (
            <div key={`skill-${requirement.skillId}`} className="flex items-center gap-2 text-xs">
              <span className="text-secondary truncate max-w-[12rem]" title={requirement.name}>{requirement.name}</span>
              <StatusBadge
                label={typeof level !== 'number' ? 'Not shared' : met ? `Meets target (${level})` : `Below target (${level} of ${requirement.targetLevel})`}
                tone={typeof level !== 'number' ? 'neutral' : met ? 'success' : 'danger'}
              />
            </div>
          )
        })}
        {training.map((requirement) => {
          const status = readiness?.training?.[requirement.courseId]
          return (
            <div key={`training-${requirement.courseId}`} className="flex items-center gap-2 text-xs">
              <span className="text-secondary truncate max-w-[12rem]" title={requirement.title}>{requirement.title}</span>
              <StatusBadge
                label={TRAINING_STATUS_LABELS[status] ?? 'Not assigned'}
                tone={status === 'enrolled' ? 'success' : status === 'dismissed' ? 'danger' : 'neutral'}
              />
            </div>
          )
        })}
      </div>
    </details>
  )
}
