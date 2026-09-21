import { useCallback, useEffect, useMemo, useState } from 'react'
import ConfirmDialog from '../../components/ConfirmDialog'
import MutationFeedback from '../../components/MutationFeedback'
import StatusBadge from '../../components/StatusBadge'
import { listEmployerMembers } from '../../lib/admin/employers'
import {
  createEmployerManagementRelationship,
  endEmployerManagementRelationship,
  listEmployerManagementRelationships,
  updateEmployerManagementRelationship,
} from '../../lib/employerManagement'

const RELATIONSHIP_TYPES = [
  { value: 'primary', label: 'Primary', description: 'Line management and formal reporting.' },
  { value: 'functional', label: 'Functional', description: 'Discipline or professional oversight.' },
  { value: 'project', label: 'Project', description: 'Oversight limited to project work.' },
  { value: 'delegate', label: 'Delegate', description: 'Temporary cover for another manager.' },
]

const ACCESS_SCOPES = [
  { value: 'employment', label: 'Employment details', description: 'Employer-owned roster fields.' },
  { value: 'role_assignments', label: 'Role assignments', description: 'Employer-assigned role profiles.' },
  { value: 'training_assignments', label: 'Training assignments', description: 'Training assigned by this employer.' },
  { value: 'skill_management', label: 'Skill management', description: 'Employer skill suggestions and confirmations.' },
  { value: 'shared_skills', label: 'Shared skills', description: 'Learner-owned skills shared with this employer.' },
  { value: 'shared_skill_evidence', label: 'Shared skill evidence', description: 'Evidence shared with this employer. Shared skills is also required.' },
  { value: 'shared_training', label: 'Shared personal training', description: 'Personal training shared with this employer.' },
  { value: 'shared_experience', label: 'Shared experience', description: 'Experience shared with this employer.' },
]

const DEFAULT_SCOPES = {
  primary: ['employment', 'role_assignments', 'training_assignments', 'skill_management', 'shared_skills'],
  functional: ['employment', 'role_assignments', 'skill_management', 'shared_skills'],
  project: ['training_assignments', 'skill_management', 'shared_skills'],
  delegate: ['employment', 'role_assignments', 'training_assignments'],
}

const EMPTY_FORM = {
  managerMemberId: '',
  employeeMemberId: '',
  relationshipType: 'primary',
  isPrimary: true,
  includeIndirectReports: false,
  accessScope: DEFAULT_SCOPES.primary,
  validFrom: localToday(),
  validUntil: '',
}

const SCOPE_LABELS = Object.fromEntries(ACCESS_SCOPES.map((scope) => [scope.value, scope.label]))
const TYPE_LABELS = Object.fromEntries(RELATIONSHIP_TYPES.map((type) => [type.value, type.label]))
const DEFAULT_SERVICES = {
  createRelationship: createEmployerManagementRelationship,
  endRelationship: endEmployerManagementRelationship,
  listMembers: listEmployerMembers,
  listRelationships: listEmployerManagementRelationships,
  updateRelationship: updateEmployerManagementRelationship,
}

function localToday() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function relationshipStatus(relationship, membersById) {
  if (membersById) {
    const manager = membersById.get(relationship.manager_member_id)
    const employee = membersById.get(relationship.employee_member_id)
    if (manager?.status !== 'active' || employee?.status !== 'active') return 'inactive'
  }
  const today = localToday()
  if (relationship.valid_from > today) return 'scheduled'
  if (relationship.valid_until && relationship.valid_until <= today) return 'ended'
  return 'active'
}

function memberLabel(member) {
  return member.email || member.userCode || member.user_id || 'Unknown member'
}

function formForRelationship(relationship) {
  return {
    managerMemberId: relationship.manager_member_id,
    employeeMemberId: relationship.employee_member_id,
    relationshipType: relationship.relationship_type,
    isPrimary: relationship.is_primary,
    includeIndirectReports: relationship.include_indirect_reports,
    accessScope: relationship.access_scope,
    validFrom: relationship.valid_from,
    validUntil: relationship.valid_until || '',
  }
}

export default function EmployerManagementSection({ employer, services = DEFAULT_SERVICES }) {
  const [members, setMembers] = useState([])
  const [relationships, setRelationships] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [editingRelationship, setEditingRelationship] = useState(null)
  const [endingRelationship, setEndingRelationship] = useState(null)
  const [saving, setSaving] = useState(false)
  const [ending, setEnding] = useState(false)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('active')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [memberRows, relationshipRows] = await Promise.all([
        services.listMembers(employer.id),
        services.listRelationships(employer.id),
      ])
      setMembers(memberRows)
      setRelationships(relationshipRows)
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setLoading(false)
    }
  }, [employer.id, services])

  useEffect(() => {
    load()
  }, [load])

  const membersById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members])
  const activeMembers = useMemo(() => members.filter((member) => member.status === 'active'), [members])
  const activeRelationships = useMemo(
    () => relationships.filter((relationship) => relationshipStatus(relationship, membersById) === 'active'),
    [membersById, relationships]
  )
  const managerCount = useMemo(
    () => new Set(activeRelationships.map((relationship) => relationship.manager_member_id)).size,
    [activeRelationships]
  )
  const staffWithManagerCount = useMemo(
    () => new Set(activeRelationships.map((relationship) => relationship.employee_member_id)).size,
    [activeRelationships]
  )
  const uncoveredCount = Math.max(0, activeMembers.length - staffWithManagerCount)

  const filteredRelationships = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return relationships.filter((relationship) => {
      const manager = memberLabel(membersById.get(relationship.manager_member_id) || {}).toLowerCase()
      const employee = memberLabel(membersById.get(relationship.employee_member_id) || {}).toLowerCase()
      const matchesQuery = !normalizedQuery || manager.includes(normalizedQuery) || employee.includes(normalizedQuery)
      const matchesType = typeFilter === 'all' || relationship.relationship_type === typeFilter
      const matchesStatus = statusFilter === 'all' || relationshipStatus(relationship, membersById) === statusFilter
      return matchesQuery && matchesType && matchesStatus
    })
  }, [membersById, query, relationships, statusFilter, typeFilter])

  function beginCreate() {
    setMessage(null)
    setError(null)
    setEditingRelationship(null)
    setForm({ ...EMPTY_FORM, accessScope: [...EMPTY_FORM.accessScope] })
    setShowCreateForm(true)
  }

  function beginEdit(relationship) {
    setMessage(null)
    setError(null)
    setShowCreateForm(false)
    setEditingRelationship(relationship)
    setForm(formForRelationship(relationship))
  }

  function closeForm() {
    setShowCreateForm(false)
    setEditingRelationship(null)
    setForm({ ...EMPTY_FORM, accessScope: [...EMPTY_FORM.accessScope] })
  }

  async function handleSave(event) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      if (editingRelationship) {
        await services.updateRelationship(editingRelationship.id, form)
        setMessage('Management relationship updated.')
      } else {
        await services.createRelationship({ employerId: employer.id, ...form })
        setMessage('Management relationship created.')
      }
      closeForm()
      await load()
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleEnd() {
    setEnding(true)
    setError(null)
    setMessage(null)
    try {
      await services.endRelationship(endingRelationship.id)
      setEndingRelationship(null)
      setMessage('Management relationship ended. Access has been removed.')
      await load()
    } catch (endError) {
      setError(endError.message)
    } finally {
      setEnding(false)
    }
  }

  if (loading) return <ManagementSkeleton />

  return (
    <section aria-labelledby="management-heading">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h2 id="management-heading" className="font-display text-lg text-ink">Reporting &amp; management</h2>
          <p className="mt-1 max-w-2xl text-sm text-secondary">
            Define reporting lines inside {employer.name}. Managers only see employer-managed information and learner data shared with this employer.
          </p>
        </div>
        {!showCreateForm && !editingRelationship && (
          <button type="button" onClick={beginCreate} className="rounded-md bg-moss px-3 py-2 text-sm font-medium text-paper hover:opacity-90 active:translate-y-px">
            Add relationship
          </button>
        )}
      </div>

      <div className="mb-5 rounded-lg border border-hairline bg-card p-4">
        <p className="text-sm font-medium text-ink">The learner data fence remains in place</p>
        <p className="mt-1 text-xs leading-relaxed text-secondary">
          A management relationship never grants access to a learner's full LearnScope profile. Shared scopes only become available after the learner has shared that category with this employer.
        </p>
      </div>

      <MutationFeedback status="success" message={message} size="xs" className="mb-3" />
      <MutationFeedback status="error" message={error} size="xs" className="mb-3" />

      {(showCreateForm || editingRelationship) && (
        <RelationshipForm
          form={form}
          setForm={setForm}
          members={activeMembers}
          editing={Boolean(editingRelationship)}
          saving={saving}
          onSubmit={handleSave}
          onCancel={closeForm}
        />
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 mb-5" aria-label="Reporting summary">
        <SummaryMetric value={managerCount} label="Active managers" />
        <SummaryMetric value={activeRelationships.length} label="Active relationships" />
        <SummaryMetric value={uncoveredCount} label="Active staff without a manager" />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          aria-label="Search reporting relationships"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search manager or employee"
          className="min-w-[220px] flex-1 rounded-md border border-hairline bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
        />
        <select aria-label="Filter by relationship type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="rounded-md border border-hairline bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss">
          <option value="all">All relationship types</option>
          {RELATIONSHIP_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
        </select>
        <select aria-label="Filter by relationship status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-md border border-hairline bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss">
          <option value="active">Active</option>
          <option value="scheduled">Scheduled</option>
          <option value="ended">Ended</option>
          <option value="inactive">Inactive memberships</option>
          <option value="all">All statuses</option>
        </select>
      </div>

      {filteredRelationships.length === 0 ? (
        <div className="rounded-lg border border-dashed border-hairline bg-card px-5 py-8 text-center">
          <p className="text-sm font-medium text-ink">
            {relationships.length === 0 ? 'No reporting relationships yet.' : 'No relationships match these filters.'}
          </p>
          <p className="mt-1 text-xs text-secondary">
            {relationships.length === 0 ? 'Add a relationship to define who can manage employer-owned work for each employee.' : 'Change the search or filters to see more results.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-hairline bg-card">
          <table className="w-full min-w-[900px] table-fixed text-left text-sm">
            <thead className="border-b border-hairline text-xs text-secondary">
              <tr>
                <th scope="col" className="w-[17%] px-3 py-3 font-medium">Manager</th>
                <th scope="col" className="w-[17%] px-3 py-3 font-medium">Employee</th>
                <th scope="col" className="w-[18%] px-3 py-3 font-medium">Relationship</th>
                <th scope="col" className="w-[20%] px-3 py-3 font-medium">Access scope</th>
                <th scope="col" className="w-[13%] px-3 py-3 font-medium">Effective dates</th>
                <th scope="col" className="w-[7%] px-3 py-3 font-medium">Status</th>
                <th scope="col" className="w-[8%] px-3 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {filteredRelationships.map((relationship) => {
                const status = relationshipStatus(relationship, membersById)
                return (
                  <tr key={relationship.id}>
                    <td className="break-words px-3 py-3 text-xs text-ink">{memberLabel(membersById.get(relationship.manager_member_id) || {})}</td>
                    <td className="break-words px-3 py-3 text-xs text-ink">{memberLabel(membersById.get(relationship.employee_member_id) || {})}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge label={TYPE_LABELS[relationship.relationship_type]} tone="neutral" />
                        {relationship.is_primary && <StatusBadge label="Designated primary" tone="success" />}
                      </div>
                      {relationship.include_indirect_reports && <p className="mt-1 text-[11px] text-secondary">Includes primary-report subtree</p>}
                    </td>
                    <td className="px-3 py-3 text-xs text-secondary">
                      {relationship.access_scope.map((scope) => SCOPE_LABELS[scope] || scope).join(', ')}
                    </td>
                    <td className="px-3 py-3 text-xs text-secondary">
                      <span>{relationship.valid_from}</span>
                      <span className="mx-1">to</span>
                      <span>{relationship.valid_until || 'No end date'}</span>
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge label={status} tone={status === 'active' ? 'success' : status === 'scheduled' ? 'warning' : 'danger'} />
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col items-end gap-1.5">
                        {(status === 'active' || status === 'scheduled') && (
                          <>
                            <button type="button" onClick={() => beginEdit(relationship)} className="rounded-md border border-hairline px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-paper">Edit</button>
                            {status === 'active' && <button type="button" onClick={() => setEndingRelationship(relationship)} className="rounded-md border border-hairline px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-paper">End</button>}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {endingRelationship && (
        <ConfirmDialog
          message={`End the ${TYPE_LABELS[endingRelationship.relationship_type].toLowerCase()} management relationship between ${memberLabel(membersById.get(endingRelationship.manager_member_id) || {})} and ${memberLabel(membersById.get(endingRelationship.employee_member_id) || {})}? Their manager access through this relationship will stop immediately.`}
          confirmLabel="End relationship"
          confirming={ending}
          onConfirm={handleEnd}
          onCancel={() => setEndingRelationship(null)}
        />
      )}
    </section>
  )
}

function SummaryMetric({ value, label }) {
  return (
    <div className="rounded-lg border border-hairline bg-card px-4 py-3">
      <p className="font-mono text-xl tabular-nums text-ink">{value}</p>
      <p className="mt-0.5 text-xs text-secondary">{label}</p>
    </div>
  )
}

function RelationshipForm({ form, setForm, members, editing, saving, onSubmit, onCancel }) {
  const selectedType = RELATIONSHIP_TYPES.find((type) => type.value === form.relationshipType)

  function setRelationshipType(relationshipType) {
    setForm((current) => ({
      ...current,
      relationshipType,
      isPrimary: relationshipType === 'primary' ? current.isPrimary : false,
      accessScope: [...DEFAULT_SCOPES[relationshipType]],
    }))
  }

  function toggleScope(scope) {
    setForm((current) => {
      const selected = current.accessScope.includes(scope)
      let accessScope = selected
        ? current.accessScope.filter((item) => item !== scope)
        : [...current.accessScope, scope]
      if (scope === 'shared_skill_evidence' && !selected && !accessScope.includes('shared_skills')) {
        accessScope = [...accessScope, 'shared_skills']
      }
      if (scope === 'shared_skills' && selected) {
        accessScope = accessScope.filter((item) => item !== 'shared_skill_evidence')
      }
      return { ...current, accessScope }
    })
  }

  return (
    <form onSubmit={onSubmit} className="mb-6 rounded-lg border border-hairline bg-card p-4" aria-labelledby="relationship-form-heading">
      <div className="mb-4">
        <h3 id="relationship-form-heading" className="font-display text-base text-ink">{editing ? 'Edit management relationship' : 'Add management relationship'}</h3>
        <p className="mt-1 text-xs text-secondary">Both people must be active members of this employer.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="text-xs text-secondary">
          Manager
          <select required disabled={editing || saving} value={form.managerMemberId} onChange={(event) => setForm((current) => ({ ...current, managerMemberId: event.target.value }))} className="mt-1 w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss disabled:opacity-60">
            <option value="">Select a manager</option>
            {members.filter((member) => member.id !== form.employeeMemberId).map((member) => <option key={member.id} value={member.id}>{memberLabel(member)}</option>)}
          </select>
        </label>
        <label className="text-xs text-secondary">
          Employee
          <select required disabled={editing || saving} value={form.employeeMemberId} onChange={(event) => setForm((current) => ({ ...current, employeeMemberId: event.target.value }))} className="mt-1 w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss disabled:opacity-60">
            <option value="">Select an employee</option>
            {members.filter((member) => member.id !== form.managerMemberId).map((member) => <option key={member.id} value={member.id}>{memberLabel(member)}</option>)}
          </select>
        </label>
        <label className="text-xs text-secondary">
          Relationship type
          <select value={form.relationshipType} disabled={saving} onChange={(event) => setRelationshipType(event.target.value)} className="mt-1 w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss disabled:opacity-60">
            {RELATIONSHIP_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
          </select>
          <span className="mt-1 block leading-relaxed">{selectedType.description}</span>
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-xs text-secondary">
            Starts
            <input required type="date" value={form.validFrom} disabled={saving} onChange={(event) => setForm((current) => ({ ...current, validFrom: event.target.value }))} className="mt-1 w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss disabled:opacity-60" />
          </label>
          <label className="text-xs text-secondary">
            Ends
            <input type="date" min={form.validFrom || undefined} value={form.validUntil} disabled={saving} onChange={(event) => setForm((current) => ({ ...current, validUntil: event.target.value }))} className="mt-1 w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss disabled:opacity-60" />
          </label>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {form.relationshipType === 'primary' && (
          <label className="flex gap-2 rounded-md border border-hairline bg-paper p-3 text-sm text-ink">
            <input type="checkbox" checked={form.isPrimary} disabled={saving} onChange={(event) => setForm((current) => ({ ...current, isPrimary: event.target.checked }))} className="mt-0.5 accent-moss" />
            <span><span className="block font-medium">Designated primary manager</span><span className="mt-0.5 block text-xs text-secondary">Only one designated primary manager can be effective at a time.</span></span>
          </label>
        )}
        <label className="flex gap-2 rounded-md border border-hairline bg-paper p-3 text-sm text-ink">
          <input type="checkbox" checked={form.includeIndirectReports} disabled={saving} onChange={(event) => setForm((current) => ({ ...current, includeIndirectReports: event.target.checked }))} className="mt-0.5 accent-moss" />
          <span><span className="block font-medium">Include indirect reports</span><span className="mt-0.5 block text-xs text-secondary">Follow primary reporting lines below this employee. Matrix relationships do not expand unless selected here.</span></span>
        </label>
      </div>

      <fieldset className="mt-5">
        <legend className="text-sm font-medium text-ink">Manager access scope</legend>
        <p className="mt-1 text-xs text-secondary">Select at least one. Personal categories still require the learner's explicit share with this employer.</p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {ACCESS_SCOPES.map((scope) => (
            <label key={scope.value} className="flex gap-2 rounded-md border border-hairline bg-paper p-3 text-sm text-ink">
              <input type="checkbox" checked={form.accessScope.includes(scope.value)} disabled={saving} onChange={() => toggleScope(scope.value)} className="mt-0.5 accent-moss" />
              <span><span className="block font-medium">{scope.label}</span><span className="mt-0.5 block text-xs text-secondary">{scope.description}</span></span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={saving} className="rounded-md border border-hairline px-4 py-2 text-sm font-medium text-ink hover:bg-paper disabled:opacity-60">Cancel</button>
        <button type="submit" disabled={saving || !form.managerMemberId || !form.employeeMemberId || form.accessScope.length === 0} className="rounded-md bg-moss px-4 py-2 text-sm font-medium text-paper hover:opacity-90 active:translate-y-px disabled:opacity-60">
          {saving ? 'Saving...' : editing ? 'Save changes' : 'Add relationship'}
        </button>
      </div>
    </form>
  )
}

function ManagementSkeleton() {
  return (
    <section aria-label="Loading reporting and management" aria-busy="true">
      <div className="h-6 w-56 rounded bg-hairline/30" />
      <div className="mt-2 h-4 w-full max-w-xl rounded bg-hairline/20" />
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((item) => <div key={item} className="h-16 rounded-lg border border-hairline bg-card" />)}
      </div>
      <div className="mt-5 h-56 rounded-lg border border-hairline bg-card" />
    </section>
  )
}
