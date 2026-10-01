import { requestedDataSummary } from '../../lib/employerDataAccess'
import RequestDataAccessDialog from './RequestDataAccessDialog'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import AccessibleDialog from '../../components/AccessibleDialog'
import ConfirmDialog from '../../components/ConfirmDialog'
import TrainingTeamAccessDialog from './TrainingTeamAccessDialog'
import { listEmployerMembers, addEmployerMember, removeEmployerMember, listEmployerCatalogueCourses, assignCourseToEmployerMembers, listEmployerCourseAssignments, requestEmployerDataAccess, listEmployerDataAccessRequests, suggestSkillToEmployerMembers, listEmployerSkillSuggestions, listFieldDefinitionsForEmployer, listEmployerMemberFieldValues, upsertEmployerMemberFieldValue } from '../../lib/admin/employers'
import EmployerMemberFieldsModal from '../../components/EmployerMemberFieldsModal'
import EmployerMemberFieldInputs from '../../components/EmployerMemberFieldInputs'
import EmployerMemberDetailModal from '../../components/EmployerMemberDetailModal'
import EmployerMemberRoleProfilesModal from './EmployerMemberRoleProfilesModal'
import EmployerRosterUploadPanel from './EmployerRosterUploadPanel'
import { listOrganisationMembers } from '../../lib/admin/organisations'
import { listLibrarySkills } from '../../lib/skillLibrary'
import { listEmployerRoleProfiles, assignEmployerRoleProfile } from '../../lib/employerRoleProfiles'
import { LEVELS, LEVEL_LABELS } from '../../lib/levels'
import { useColumnPreferences, useSortedPage, useRowSelection, useUrlParam, writeUrlParams } from '../../lib/useSortedPage'
import { ColumnCustomizer, SortableTh, TablePagination, SelectionTh, BulkActionBar } from '../../components/TableControls'
import MutationFeedback from '../../components/MutationFeedback'
import StatusBadge from '../../components/StatusBadge'

const LEARNER_SORT_ACCESSORS = {
  id: (m) => m.userCode ?? '',
  email: (m) => (m.email || m.user_id || '').toLowerCase(),
  role: (m) => m.role ?? '',
  status: (m) => m.status ?? '',
}

const ASSIGNMENT_SORT_ACCESSORS = {
  course: (a) => a.course_catalogue?.name?.toLowerCase() ?? '',
  learner: (a) => (a.learnerEmail || '').toLowerCase(),
  status: (a) => a.status ?? '',
  created_at: (a) => a.created_at ?? '',
}

const ASSIGNMENT_STATUS_LABELS = {
  assigned: 'Assigned',
  enrolled: 'Started',
  dismissed: 'Dismissed',
}

const SKILL_SUGGESTION_SORT_ACCESSORS = {
  skill: (s) => s.skill_name?.toLowerCase() ?? '',
  learner: (s) => (s.learnerEmail || '').toLowerCase(),
  status: (s) => s.status ?? '',
  created_at: (s) => s.created_at ?? '',
}

const SKILL_SUGGESTION_STATUS_LABELS = {
  suggested: 'Suggested',
  adopted: 'Added by learner',
  dismissed: 'Dismissed',
}

// Customizable data columns only -- the leading selection checkbox stays
// pinned outside this list (EmployerLearnersPanel has no trailing actions
// column). "Training access" only exists at all when attachedProviderOrg is
// truthy, so it's built conditionally into the array itself rather than
// left always-visible-and-toggleable -- mirrors AdminEmployers.jsx's
// employerColumns(organisationById) factory, just with two closed-over
// values (attachedProviderOrg, dataAccessByLearner) instead of one.
function employerLearnerColumns(attachedProviderOrg, dataAccessByLearner) {
  const trainingAccessColumn = {
    key: 'training_access',
    label: 'Training access',
    sortable: false,
    thClassName: 'whitespace-nowrap',
    cellClassName: 'px-4 py-2 text-xs whitespace-nowrap',
    renderCell: (m) =>
      m.trainingAccess
        ? `${m.trainingAccess.role === 'admin' ? 'Admin' : 'Trainer'}${m.trainingAccess.status === 'pending' ? ' (pending)' : ''}`
        : 'None',
  }
  return [
    {
      key: 'id',
      label: 'ID',
      sortable: true,
      thClassName: 'whitespace-nowrap',
      cellClassName: 'px-4 py-2 font-mono text-xs text-secondary whitespace-nowrap',
      renderCell: (m) => m.userCode || '—',
    },
    {
      key: 'email',
      label: 'User',
      sortable: true,
      cellClassName: 'px-4 py-2 text-ink text-xs truncate max-w-[220px]',
      renderCell: (m) => m.email || m.user_id,
    },
    {
      key: 'role',
      label: 'Role',
      sortable: true,
      thClassName: 'whitespace-nowrap',
      cellClassName: 'px-4 py-2 whitespace-nowrap',
      renderCell: (m) => (
        <StatusBadge label={!m.employerMember ? 'Training team' : m.role === 'admin' ? 'Admin' : 'Member'} tone="neutral" />
      ),
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      thClassName: 'whitespace-nowrap',
      cellClassName: 'px-4 py-2 whitespace-nowrap',
      renderCell: (m) => (
        <StatusBadge
          label={m.status === 'pending' ? 'Pending' : m.status === 'inactive' ? 'Inactive' : 'Active'}
          tone={m.status === 'inactive' ? 'danger' : 'neutral'}
        />
      ),
    },
    ...(attachedProviderOrg ? [trainingAccessColumn] : []),
    {
      key: 'data_access',
      label: 'Data access',
      sortable: false,
      thClassName: 'whitespace-nowrap',
      cellClassName: 'px-4 py-2 text-xs max-w-[220px]',
      renderCell: (m) => {
        const dataAccess = dataAccessByLearner[m.user_id]
        return (
          <div className="flex flex-col gap-1 items-start">
            <StatusBadge
              label={!m.employerMember ? 'Not applicable' : dataAccess ? DATA_ACCESS_STATUS_LABELS[dataAccess.status] : 'No request yet'}
              tone={dataAccess?.status === 'declined' || dataAccess?.status === 'revoked' ? 'danger' : 'neutral'}
            />
            {dataAccess && (
              <p className="text-[10px] text-secondary leading-snug">
                Requested: {requestedDataSummary(dataAccess)}
                {dataAccess.status === 'approved' && (
                  <>. Approved: {(dataAccess.approved_data || ['skills']).join(', ')}</>
                )}
              </p>
            )}
          </div>
        )
      },
    },
  ]
}

// Customizable data columns only -- the trailing "Unlink" actions column
// stays pinned outside this list, same as AdminEmployers.jsx's "Add admin"
// column. No external dependency needed, so a plain constant rather than a
// factory function.

const DATA_ACCESS_STATUS_LABELS = {
  pending: 'Access requested',
  approved: 'Access granted',
  declined: 'Access declined',
  revoked: 'Access revoked',
}

export function EmployerLearnersPanel({ employer, searchParams, setSearchParams, attachedProviderOrg }) {
  const { isPlatformAdmin, user } = useAuth()
  const [members, setMembers] = useState([])
  const [trainingStaff, setTrainingStaff] = useState([])
  const [trainingStaffError, setTrainingStaffError] = useState(null)
  const [trainingStaffLoading, setTrainingStaffLoading] = useState(Boolean(attachedProviderOrg))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Keyed by field_definition_id, same shape EmployerMemberFieldsModal
  // already uses for editing an existing member -- the add form captures
  // every roster field up front now instead of leaving them for a separate
  // "Edit details" pass afterward.
  const [addValues, setAddValues] = useState({})
  const [role, setRole] = useState('member')
  const [adding, setAdding] = useState(false)
  const [message, setMessage] = useState(null)
  const [removeTarget, setRemoveTarget] = useState(null)
  const [removing, setRemoving] = useState(false)
  const showAddUsers = searchParams.get('usersView') === 'add'
  const addParams = new URLSearchParams(searchParams)
  addParams.set('usersView', 'add')
  const listParams = new URLSearchParams(searchParams)
  listParams.delete('usersView')

  // Assign training/Assign skill used to be their own top-level tabs, each
  // with its own copy of this same learner roster to pick targets from --
  // folded into bulk actions on this one roster instead (select learners
  // here, then choose which to run), so there's a single place to manage
  // who's covered by this employer and a single selection model for acting
  // on them. 'assignModal' is which picker dialog (if any) is open;
  // 'assignResult' surfaces the last run's outcome (assigned/skipped) the
  // same way the old panels' inline result banner did.
  const [assignModal, setAssignModal] = useState(null)
  const [assignResult, setAssignResult] = useState(null)

  // Phase 5: employer-side view of each member's data-access consent state.
  // Keyed by learner_id -- there's at most one row per (employer, learner)
  // pair (unique constraint), so a plain map is enough.
  const [dataAccessByLearner, setDataAccessByLearner] = useState({})
  const [dataAccessRequestingId, setDataAccessRequestingId] = useState(null)
  const [dataAccessError, setDataAccessError] = useState(null)

  // Roster field values (20260911130000) -- the employer's own record about
  // each member, separate from their actual LearnScope profile. Keyed by
  // employer_member_id (not user_id) since that's what the values table
  // itself is keyed to.
  const [fieldDefinitions, setFieldDefinitions] = useState([])
  const [fieldValuesByMember, setFieldValuesByMember] = useState({})
  const [editingFieldsMember, setEditingFieldsMember] = useState(null)
  const [viewingMember, setViewingMember] = useState(null)
  const [managingRoleProfilesMember, setManagingRoleProfilesMember] = useState(null)
  // The base 'email' field (20260911150000's seed) is what actually invites
  // the account -- the add form has no separate email input of its own
  // anymore, it's just this field rendered like every other one.
  const emailFieldId = fieldDefinitions.find((f) => f.key === 'email')?.id

  // Pre-fills a fresh add form's language/status the same way a brand-new
  // employer_members row already defaults to -- only when addValues is
  // still empty, so this never overwrites what an admin is mid-typing (it
  // re-fires after a successful add, once fieldDefinitions is refetched by
  // load(), re-priming the form for the next one).
  useEffect(() => {
    if (fieldDefinitions.length === 0) return
    setAddValues((prev) => {
      if (Object.keys(prev).length > 0) return prev
      const defaults = {}
      const languageField = fieldDefinitions.find((f) => f.key === 'language')
      if (languageField) defaults[languageField.id] = 'English'
      const statusField = fieldDefinitions.find((f) => f.key === 'employment_status')
      if (statusField) defaults[statusField.id] = 'Active'
      return defaults
    })
  }, [fieldDefinitions])

  const EMPLOYER_LEARNER_COLUMNS = useMemo(
    () => employerLearnerColumns(attachedProviderOrg, dataAccessByLearner),
    [attachedProviderOrg, dataAccessByLearner]
  )
  const { columns, visibleColumns, toggleColumn, moveColumn, resetToDefault } =
    useColumnPreferences('employer-learners', EMPLOYER_LEARNER_COLUMNS)

  // Search/sort/page all live in the URL (?q=&sort=&dir=&page=&pageSize=),
  // same convention as AdminCatalogue.jsx/AdminTags.jsx -- this is this
  // panel's own "primary" table, so it uses the plain param names.
  const [query, setQuery] = useUrlParam(searchParams, setSearchParams, 'q', '', { resetParams: ['page'] })
  const q = query.trim().toLowerCase()
  const users = useMemo(() => {
    const staffById = new Map(trainingStaff.map((staff) => [staff.user_id, staff]))
    const employerUserIds = new Set(members.map((member) => member.user_id))
    return [
      ...members.map((member) => ({ ...member, employerMember: true, trainingAccess: staffById.get(member.user_id) })),
      ...trainingStaff.filter((staff) => !employerUserIds.has(staff.user_id)).map((staff) => ({
        ...staff, role: null, employerMember: false, trainingAccess: staff,
      })),
    ]
  }, [members, trainingStaff])

  useEffect(() => {
    let cancelled = false
    setTrainingStaff([])
    setTrainingStaffError(null)
    setTrainingStaffLoading(Boolean(attachedProviderOrg))
    if (attachedProviderOrg) {
      listOrganisationMembers(attachedProviderOrg.id)
        .then((staff) => { if (!cancelled) setTrainingStaff(staff) })
        .catch((err) => { if (!cancelled) setTrainingStaffError(err.message) })
        .finally(() => { if (!cancelled) setTrainingStaffLoading(false) })
    }
    return () => { cancelled = true }
  }, [attachedProviderOrg])

  const filteredMembers = useMemo(
    () => (q ? users.filter((m) => (m.email || m.user_id || '').toLowerCase().includes(q)) : users),
    [users, q]
  )
  const filtersActive = query !== ''

  function resetFilters() {
    writeUrlParams(searchParams, setSearchParams, { q: null, page: null })
  }

  const { sortKey, sortDir, toggleSort, page, setPage, pageSize, setPageSize, pageItems, totalItems } =
    useSortedPage(filteredMembers, LEARNER_SORT_ACCESSORS, { urlSync: { searchParams, setSearchParams } })

  // Staff access can be managed for any listed user; learning actions still
  // require an active employer membership for every selected user.
  const eligibleMembers = filteredMembers
  const selection = useRowSelection(eligibleMembers.map((m) => m.user_id))
  const eligiblePageIds = pageItems.map((m) => m.user_id)
  const selectedOnPage = eligiblePageIds.filter((id) => selection.selected.has(id)).length
  const selectedMembers = useMemo(
    () => eligibleMembers.filter((m) => selection.selected.has(m.user_id)),
    [eligibleMembers, selection.selected]
  )

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the listed values change; the loaders are recreated every render
  }, [employer.id])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [membersData, dataAccessData, fields, values] = await Promise.all([
        listEmployerMembers(employer.id),
        listEmployerDataAccessRequests(employer.id),
        listFieldDefinitionsForEmployer(employer.id),
        listEmployerMemberFieldValues(employer.id),
      ])
      setMembers(membersData)
      setDataAccessByLearner(Object.fromEntries(dataAccessData.map((r) => [r.learner_id, r])))
      setFieldDefinitions(fields)
      const byMember = {}
      for (const v of values) {
        byMember[v.employer_member_id] = { ...byMember[v.employer_member_id], [v.field_definition_id]: v.value }
      }
      setFieldValuesByMember(byMember)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Saves every field one at a time (not a single batched call) so a
  // failure on one field doesn't silently drop edits to the others -- same
  // Promise.allSettled reasoning as handleBulkRequestDataAccess above.
  async function handleSaveMemberFields(values) {
    const results = await Promise.allSettled(
      fieldDefinitions.map((f) => upsertEmployerMemberFieldValue(editingFieldsMember.id, f.id, values[f.id] || null, user.id))
    )
    const failed = results.find((r) => r.status === 'rejected')
    if (failed) throw new Error(failed.reason?.message || 'Some fields failed to save.')
    setFieldValuesByMember((prev) => ({ ...prev, [editingFieldsMember.id]: values }))
  }

  const requestableMembers = selectedMembers.filter((m) => m.employerMember && m.status === 'active' && (!dataAccessByLearner[m.user_id] || ['declined', 'revoked'].includes(dataAccessByLearner[m.user_id].status)))
  // Same "active employer member" eligibility rule as the buttons' own
  // disabled condition previously enforced by blocking the whole action --
  // now the action narrows to just the eligible subset instead, matching
  // requestableMembers' own pattern above, so a mixed selection doesn't
  // force manually deselecting the ineligible rows first.
  const assignableMembers = selectedMembers.filter((m) => m.employerMember && m.status === 'active')
  const assignSkippedCount = selectedMembers.length - assignableMembers.length

  async function handleBulkRequestDataAccess(options) {
    setDataAccessError(null)
    setDataAccessRequestingId('bulk')
    const results = await Promise.allSettled(requestableMembers.map(async (member) => {
      const row = await requestEmployerDataAccess(employer.id, member.user_id, options)
      setDataAccessByLearner((prev) => ({ ...prev, [member.user_id]: row }))
    }))
    const failures = results.flatMap((r, i) => r.status === 'rejected' ? [requestableMembers[i].email + ': ' + (r.reason?.message || 'Request failed')] : [])
    setMessage((results.length - failures.length) + ' data access request(s) sent. ' + (selectedMembers.length - results.length) + ' ineligible user(s) skipped.')
    setDataAccessError(failures.join('; ') || null)
    setDataAccessRequestingId(null)
    if (failures.length && failures.length === results.length) throw new Error(failures.join('; '))
    setAssignModal(null)
  }

  async function handleAdd(e) {
    e.preventDefault()
    setAdding(true)
    setMessage(null)
    setError(null)
    try {
      const email = (addValues[emailFieldId] || '').trim()
      const missing = fieldDefinitions.find((f) => f.required && !String(addValues[f.id] ?? '').trim())
      if (missing) throw new Error(`"${missing.label}" is required.`)
      const result = await addEmployerMember(employer.id, email, role, addValues)
      setMessage(
        result.alreadyExisted
          ? `${email} added, pending their acceptance (see their Actions page).`
          : `${email} invited. They'll get access once they accept the invite email.`
      )
      setAddValues({})
      await load()
      // Back to the roster on success -- message stays set, so the list
      // view's own MutationFeedback shows the same confirmation there.
      setSearchParams(listParams)
    } catch (err) {
      setError(err.message)
    } finally {
      setAdding(false)
    }
  }

  async function handleRemove() {
    setError(null)
    setRemoving(true)
    try {
      const results = await Promise.allSettled(removeTarget.map((m) => removeEmployerMember(m.id)))
      const failures = results.flatMap((r, i) => r.status === 'rejected' ? [removeTarget[i].email + ': ' + (r.reason?.message || 'Removal failed')] : [])
      setMessage((results.length - failures.length) + ' user(s) removed.')
      selection.clear()
      setRemoveTarget(null)
      await load()
      setError(failures.join('; ') || null)
    } catch (err) {
      setError(err.message)
    } finally {
      setRemoving(false)
    }
  }

  function handleAssignDone(result) {
    setAssignModal(null)
    setAssignResult(result)
    selection.clear()
  }

  if (showAddUsers) return (
    <section aria-labelledby="employer-add-users-heading" className="max-w-3xl">
      <Link
        to={`?${listParams}`}
        className="inline-block mb-4 rounded-md border border-hairline px-3 py-1.5 text-sm font-medium text-ink hover:bg-card"
      >
        ← Back to people
      </Link>
      <h2 id="employer-add-users-heading" className="font-display text-lg text-ink mb-5">Add staff</h2>
      <MutationFeedback status="success" message={message} size="xs" className="mb-3" />
      <MutationFeedback status="error" message={error} size="xs" className="mb-3" />
      <form onSubmit={handleAdd} className="bg-card border border-hairline rounded-lg p-4 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <EmployerMemberFieldInputs
            fields={fieldDefinitions}
            values={addValues}
            onChange={(fieldId, value) => setAddValues((prev) => ({ ...prev, [fieldId]: value }))}
          />
          <label className="block text-xs text-secondary">
            Role
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="mt-1 w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </label>
        </div>
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={adding}
            className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
          >
            {adding ? 'Saving…' : 'Save'}
          </button>
          <Link
            to={`?${listParams}`}
            className="rounded-md border border-hairline px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper"
          >
            Cancel
          </Link>
        </div>
      </form>

      <EmployerRosterUploadPanel employerId={employer.id} fields={fieldDefinitions} onImported={load} />
    </section>
  )

  return (
    <section aria-labelledby="employer-learners-heading">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <h2 id="employer-learners-heading" className="font-display text-lg text-ink">People</h2>
        <div className="flex items-center gap-2">
          {isPlatformAdmin && (
            <ColumnCustomizer
              idPrefix="employer-learners"
              columns={columns}
              onToggle={toggleColumn}
              onMove={moveColumn}
              onReset={resetToDefault}
            />
          )}
          {selection.selected.size === 0 && <Link to={`?${addParams}`} className="rounded-md bg-moss text-paper px-3 py-2 text-sm font-medium hover:opacity-90">Add staff</Link>}
        </div>
      </div>

      <MutationFeedback status="success" message={message} size="xs" className="mb-3" />
      <MutationFeedback status="error" message={error} size="xs" className="mb-3" />
      <MutationFeedback status="error" message={dataAccessError} size="xs" className="mb-3" />

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          aria-label="Search staff"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by email…"
          className="flex-1 min-w-[220px] rounded-md border border-hairline bg-card px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
        />
        {filtersActive && (
          <button
            type="button"
            onClick={resetFilters}
            className="text-xs text-secondary hover:text-ink py-1.5 px-2 whitespace-nowrap"
          >
            Reset filters
          </button>
        )}
      </div>

      <MutationFeedback status="error" message={trainingStaffError ? `Could not load training team access: ${trainingStaffError}` : null} size="xs" />

      <BulkActionBar
        count={selection.selected.size}
        busy={Boolean(dataAccessRequestingId) || removing}
        onClear={selection.clear}
        actions={[
          { label: 'Request data access', title: "Ask selected active users for permission to view their learning data. Pending or granted requests are skipped.", onClick: () => setAssignModal('data-access'), disabled: requestableMembers.length === 0 },
          { label: 'Assign training', title: "Assign a course to the selected users. Only active employer members are eligible; others in the selection are skipped.", onClick: () => setAssignModal('training'), disabled: assignableMembers.length === 0 },
          { label: 'Assign skill', title: "Suggest a skill and target level to the selected users. Only active employer members are eligible; others in the selection are skipped.", onClick: () => setAssignModal('skill'), disabled: assignableMembers.length === 0 },
          ...(attachedProviderOrg ? [{ label: 'Training team access', title: "Manage the selected users’ administrator or trainer access to the training catalogue.", onClick: () => setAssignModal('access'), disabled: trainingStaffLoading || Boolean(trainingStaffError) }] : []),
          { label: 'Assign role profile', title: "Propose a role profile for the selected users to review and accept. Only active employer members are eligible; others in the selection are skipped.", onClick: () => setAssignModal('role'), disabled: assignableMembers.length === 0 },
          { label: 'Remove', title: "Remove the selected users from this employer after confirmation. Only employer members can be removed.", onClick: () => setRemoveTarget([...selectedMembers]), variant: 'danger', disabled: selectedMembers.some((m) => !m.employerMember) },
        ]}
      />

      {assignResult && (
        <div className="bg-card border border-hairline rounded-lg p-3 mb-3 text-xs">
          <MutationFeedback
            status="success"
            message={
              assignResult.kind === 'training'
                ? `${assignResult.count} learner(s) assigned this course.`
                : assignResult.kind === 'role'
                  ? `${assignResult.count} learner(s) proposed this role profile.`
                  : `${assignResult.count} learner(s) assigned this skill.`
            }
            size="xs"
          />
          {assignResult.skippedEmails.length > 0 && (
            <p className="text-secondary mt-1">
              Skipped ({assignResult.kind === 'training'
                ? 'already had a live assignment for this course'
                : assignResult.kind === 'role'
                  ? 'already linked to this role, or not an eligible learner'
                  : 'already had a live suggestion for this skill'}):{' '}
              {assignResult.skippedEmails.join(', ')}
            </p>
          )}
        </div>
      )}

      {loading ? (
        <p className="text-xs text-secondary">Loading learners…</p>
      ) : filteredMembers.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-hairline rounded-lg">
          <p className="text-secondary">{users.length === 0 ? 'No users yet.' : 'No users match your search.'}</p>
        </div>
      ) : (
        <div className="bg-card border border-hairline rounded-lg">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-secondary">
                  <SelectionTh
                    idPrefix="employer-learners"
                    checked={selection.isAllSelected(eligiblePageIds)}
                    indeterminate={selectedOnPage > 0 && selectedOnPage < eligiblePageIds.length}
                    onChange={() => selection.toggleAll(eligiblePageIds)}
                  />
                  {visibleColumns.map((col) =>
                    col.sortable ? (
                      <SortableTh key={col.key} label={col.label} columnKey={col.key} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className={col.thClassName} />
                    ) : (
                      <th key={col.key} className={`px-4 py-2 font-medium ${col.thClassName || ''}`}>{col.label}</th>
                    )
                  )}
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((m) => {
                  return (
                    <tr key={m.id} className="border-b border-hairline last:border-0">
                      <td className="px-4 py-2">
                        <input
                          type="checkbox"
                          checked={selection.selected.has(m.user_id)}
                          onChange={() => selection.toggle(m.user_id)}
                          aria-label={`Select ${m.email || m.user_id}`}
                          className="rounded border-hairline accent-moss disabled:opacity-30"
                        />
                      </td>
                      {visibleColumns.map((col) => (
                        <td key={col.key} className={col.cellClassName}>
                          {col.renderCell(m)}
                        </td>
                      ))}
                      <td className="px-4 py-2 text-right whitespace-nowrap space-x-3">
                        {m.employerMember && (
                          <>
                            <button
                              type="button"
                              onClick={() => setViewingMember(m)}
                              className="text-xs font-medium text-moss hover:underline"
                            >
                              View
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingFieldsMember(m)}
                              className="text-xs font-medium text-moss hover:underline"
                            >
                              Edit details
                            </button>
                            <button
                              type="button"
                              onClick={() => setManagingRoleProfilesMember(m)}
                              className="text-xs font-medium text-moss hover:underline"
                            >
                              Role profiles
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <TablePagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} totalItems={totalItems} idPrefix={`employer-learners-${employer.id}`} />
        </div>
      )}

      {removeTarget && (
        <ConfirmDialog
          confirmLabel="Remove"
          message={`Remove ${removeTarget.length === 1 ? (removeTarget[0].email || removeTarget[0].userCode) : `${removeTarget.length} selected users`} from ${employer.name}? They'll lose their employer access.`}
          onConfirm={handleRemove}
          onCancel={() => setRemoveTarget(null)}
          confirming={removing}
        />
      )}

      {editingFieldsMember && (
        <EmployerMemberFieldsModal
          memberLabel={editingFieldsMember.email || editingFieldsMember.user_id}
          fields={fieldDefinitions}
          initialValues={fieldValuesByMember[editingFieldsMember.id] || {}}
          onSave={handleSaveMemberFields}
          onClose={() => setEditingFieldsMember(null)}
        />
      )}

      {viewingMember && (
        <EmployerMemberDetailModal
          member={viewingMember}
          fields={fieldDefinitions}
          values={fieldValuesByMember[viewingMember.id] || {}}
          dataAccessLabel={dataAccessByLearner[viewingMember.user_id] ? DATA_ACCESS_STATUS_LABELS[dataAccessByLearner[viewingMember.user_id].status] : 'No request yet'}
          dataAccessSummary={dataAccessByLearner[viewingMember.user_id] ? requestedDataSummary(dataAccessByLearner[viewingMember.user_id]) : null}
          onClose={() => setViewingMember(null)}
          onEdit={() => { setEditingFieldsMember(viewingMember); setViewingMember(null) }}
        />
      )}

      {managingRoleProfilesMember && (
        <EmployerMemberRoleProfilesModal
          employer={employer}
          member={managingRoleProfilesMember}
          onClose={() => setManagingRoleProfilesMember(null)}
        />
      )}

      {assignModal === 'data-access' && <RequestDataAccessDialog count={requestableMembers.length} onSubmit={handleBulkRequestDataAccess} onClose={() => setAssignModal(null)} />}
      {assignModal === 'access' && attachedProviderOrg && (
        <TrainingTeamAccessDialog
          organisation={attachedProviderOrg}
          members={selectedMembers}
          onClose={() => setAssignModal(null)}
          onUpdated={async () => {
            try {
              setTrainingStaff(await listOrganisationMembers(attachedProviderOrg.id))
              setTrainingStaffError(null)
            } catch (err) {
              setTrainingStaffError(err.message)
            }
          }}
        />
      )}
      {assignModal === 'training' && (
        <AssignTrainingModal
          employer={employer}
          members={assignableMembers}
          skippedCount={assignSkippedCount}
          onClose={() => setAssignModal(null)}
          onAssigned={handleAssignDone}
        />
      )}
      {assignModal === 'skill' && (
        <AssignSkillModal
          employer={employer}
          members={assignableMembers}
          skippedCount={assignSkippedCount}
          onClose={() => setAssignModal(null)}
          onAssigned={handleAssignDone}
        />
      )}
      {assignModal === 'role' && (
        <AssignRoleModal
          employer={employer}
          members={assignableMembers}
          skippedCount={assignSkippedCount}
          onClose={() => setAssignModal(null)}
          onAssigned={handleAssignDone}
        />
      )}
    </section>
  )
}

// Course picker for the "Assign training" bulk action on the Users tab's
// learner roster (EmployerLearnersPanel) -- used to be its own top-level
// tab with its own copy of the learner picker; folded into a modal opened
// from a selection made on that one roster instead, so there's a single
// place to pick "who" (see EmployerLearnersPanel) and this only has to ask
// "which course". Course choices are scoped to courses actually published
// in this employer's enabled catalogues (listEmployerCatalogueCourses --
// the RPC re-validates this server-side regardless, this is only the
// picker's convenience list). Assigning never enrols anyone by itself --
// assign_course_to_employer_members only creates a course_assignments row;
// the learner still has to click "Start" on their own /actions page
// (respondToCourseAssignment) to create the real enrolment.
function AssignTrainingModal({ employer, members, skippedCount = 0, onClose, onAssigned }) {
  const [historyParams, setHistoryParams] = useState(() => new URLSearchParams())
  const [courses, setCourses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedCourseId, setSelectedCourseId] = useState('')
  const [assigning, setAssigning] = useState(false)

  useEffect(() => {
    listEmployerCatalogueCourses(employer.id)
      .then(setCourses)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [employer.id])

  async function handleAssign(e) {
    e.preventDefault()
    if (!selectedCourseId) return
    setAssigning(true)
    setError(null)
    try {
      const requestedIds = members.map((m) => m.user_id)
      const inserted = await assignCourseToEmployerMembers(employer.id, selectedCourseId, requestedIds)
      const insertedIds = new Set(inserted.map((row) => row.assigned_to))
      // Everyone passed in here already cleared the roster's own "active"
      // filter -- the only reason the RPC would still skip one is an
      // existing live assignment for this course (on conflict do nothing).
      const skippedEmails = requestedIds
        .filter((id) => !insertedIds.has(id))
        .map((id) => members.find((m) => m.user_id === id)?.email || id)
      onAssigned({ kind: 'training', count: inserted.length, skippedEmails })
    } catch (err) {
      setError(err.message)
      setAssigning(false)
    }
  }

  return (
    <AccessibleDialog
      labelledBy="assign-training-dialog-title"
      onClose={assigning ? undefined : onClose}
      closeOnBackdrop={!assigning}
      panelClassName="w-full max-w-3xl bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
      <h2 id="assign-training-dialog-title" className="font-display text-xl text-ink mb-1">Assign training</h2>
      <p className="text-sm text-secondary mb-4">
        Push a course from {employer.name}'s own catalogue to {members.length} selected learner{members.length === 1 ? '' : 's'}.
        They'll see it on their Actions page and choose whether to start it -- this doesn't enrol anyone
        automatically.
      </p>
      {skippedCount > 0 && (
        <p className="text-xs text-secondary mb-4">
          {skippedCount} of the selected user{skippedCount === 1 ? '' : 's'} {skippedCount === 1 ? 'is' : 'are'} not an active employer member and won't be included.
        </p>
      )}

      <MutationFeedback status="error" message={error} size="xs" className="mb-3" />

      {loading ? (
        <p className="text-sm text-secondary">Loading courses…</p>
      ) : courses.length === 0 ? (
        <p className="text-sm text-secondary">
          No enabled courses yet. Publish courses in your main provider’s catalogues or approve a provider sharing connection.
        </p>
      ) : (
        <form onSubmit={handleAssign} className="space-y-4">
          <div>
            <label className="block text-xs text-secondary mb-1" htmlFor="employerAssignCourse">
              Course
            </label>
            <select
              id="employerAssignCourse"
              required
              value={selectedCourseId}
              onChange={(e) => setSelectedCourseId(e.target.value)}
              className="w-full rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            >
              <option value="">Choose a course…</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={assigning}
              className="rounded-md border border-hairline text-ink py-2 px-4 text-sm font-medium hover:bg-paper disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!selectedCourseId || assigning}
              className="rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90 disabled:opacity-60"
            >
              {assigning ? 'Assigning…' : `Assign to ${members.length}`}
            </button>
          </div>
        </form>
      )}
      <section aria-labelledby="employer-training-history-heading" className="mt-6 border-t border-hairline pt-6">
        <EmployerTrainingAssignmentsHistory
          employer={employer}
          members={members}
          searchParams={historyParams}
          setSearchParams={setHistoryParams}
        />
      </section>
    </AccessibleDialog>
  )
}

// Assignment history for the selected users in the matching assignment dialog.

function EmployerTrainingAssignmentsHistory({ employer, members, searchParams, setSearchParams }) {
  const [assignments, setAssignments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the listed values change; the loaders are recreated every render
  }, [employer.id, members])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const rows = await listEmployerCourseAssignments(employer.id)
      const selectedUserIds = new Set(members.map((member) => member.user_id))
      setAssignments(rows.filter((row) => selectedUserIds.has(row.assigned_to)))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const emailByUserId = useMemo(() => new Map(members.map((m) => [m.user_id, m.email || m.user_id])), [members])
  const assignmentsWithEmail = useMemo(
    () => assignments.map((a) => ({ ...a, learnerEmail: emailByUserId.get(a.assigned_to) })),
    [assignments, emailByUserId]
  )
  const [assignmentQuery, setAssignmentQuery] = useUrlParam(searchParams, setSearchParams, 'aq', '', { resetParams: ['aPage'] })
  const aq = assignmentQuery.trim().toLowerCase()
  const filteredAssignments = useMemo(
    () =>
      aq
        ? assignmentsWithEmail.filter(
            (a) => a.course_catalogue?.name?.toLowerCase().includes(aq) || (a.learnerEmail || '').toLowerCase().includes(aq)
          )
        : assignmentsWithEmail,
    [assignmentsWithEmail, aq]
  )
  const assignmentFiltersActive = assignmentQuery !== ''

  function resetAssignmentFilters() {
    writeUrlParams(searchParams, setSearchParams, { aq: null, aPage: null })
  }

  const {
    sortKey: aSortKey,
    sortDir: aSortDir,
    toggleSort: aToggleSort,
    page: aPage,
    setPage: aSetPage,
    pageSize: aPageSize,
    setPageSize: aSetPageSize,
    pageItems: aPageItems,
    totalItems: aTotalItems,
  } = useSortedPage(filteredAssignments, ASSIGNMENT_SORT_ACCESSORS, {
    defaultSortKey: 'created_at',
    defaultSortDir: 'desc',
    urlSync: { searchParams, setSearchParams, paramNames: { sort: 'aSort', dir: 'aDir', page: 'aPage', pageSize: 'aPageSize' } },
  })

  return (
    <div>
      <h3 id="employer-training-history-heading" className="font-display text-base text-ink mb-3">Training assigned so far</h3>
      <MutationFeedback status="error" message={error} size="xs" className="mb-3" />
      {loading ? (
        <p className="text-xs text-secondary">Loading…</p>
      ) : assignments.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-hairline rounded-lg">
          <p className="text-secondary">No training assigned to the selected users yet.</p>
        </div>
      ) : (
        <div className="bg-card border border-hairline rounded-lg">
          <div className="flex flex-wrap items-center gap-2 p-3">
            <input
              aria-label="Search assignments"
              type="text"
              value={assignmentQuery}
              onChange={(e) => setAssignmentQuery(e.target.value)}
              placeholder="Search by course or learner…"
              className="flex-1 min-w-[220px] rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
            />
            {assignmentFiltersActive && (
              <button
                type="button"
                onClick={resetAssignmentFilters}
                className="text-xs text-secondary hover:text-ink py-1.5 px-2 whitespace-nowrap"
              >
                Reset filters
              </button>
            )}
          </div>
          {filteredAssignments.length === 0 ? (
            <p className="text-center text-xs text-secondary py-8">No assignments match your search.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-hairline text-left text-secondary">
                      <SortableTh label="Course" columnKey="course" sortKey={aSortKey} sortDir={aSortDir} onSort={aToggleSort} />
                      <SortableTh label="Learner" columnKey="learner" sortKey={aSortKey} sortDir={aSortDir} onSort={aToggleSort} />
                      <SortableTh label="Status" columnKey="status" sortKey={aSortKey} sortDir={aSortDir} onSort={aToggleSort} className="whitespace-nowrap" />
                      <SortableTh label="Assigned" columnKey="created_at" sortKey={aSortKey} sortDir={aSortDir} onSort={aToggleSort} className="whitespace-nowrap" />
                    </tr>
                  </thead>
                  <tbody>
                    {aPageItems.map((a) => (
                      <tr key={a.id} className="border-b border-hairline last:border-0">
                        <td className="px-4 py-2 text-ink text-xs truncate max-w-[220px]">{a.course_catalogue?.name || 'Deleted course'}</td>
                        <td className="px-4 py-2 text-secondary text-xs truncate max-w-[220px]">{a.learnerEmail || a.assigned_to}</td>
                        <td className="px-4 py-2 whitespace-nowrap">
                          <StatusBadge label={ASSIGNMENT_STATUS_LABELS[a.status] || a.status} tone={a.status === 'dismissed' ? 'danger' : 'neutral'} />
                        </td>
                        <td className="px-4 py-2 text-secondary text-xs whitespace-nowrap">{new Date(a.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TablePagination page={aPage} setPage={aSetPage} pageSize={aPageSize} setPageSize={aSetPageSize} totalItems={aTotalItems} idPrefix={`employer-assignments-${employer.id}`} />
            </>
          )}
        </div>
      )}
    </div>
  )
}

// Skill (+ optional target level/date) picker for the "Assign skill" bulk
// action on the Users tab's learner roster (EmployerLearnersPanel) -- used
// to be its own top-level "Suggest skills" tab with its own copy of the
// learner picker; folded into a modal opened from a selection made on that
// one roster instead, mirroring AssignTrainingModal's shape exactly.
// Suggesting never creates or modifies anyone's actual skills/skill_targets
// rows by itself -- suggest_skill_to_employer_members only creates an
// employer_skill_suggestions row; the learner still has to click "Add to my
// skills" on their own /actions page (adoptSkillSuggestion) to create the
// real skill (and, if they choose, a target) via the same unmodified
// findOrCreatePersonalSkill/skill_targets path any other learner-initiated
// skill-add already uses. Skill choices come from listLibrarySkills
// (src/lib/skillLibrary.js) -- the same active, public-or-own-private
// library search every learner-facing "Find skill" flow already uses,
// rather than the platform-admin-only listAllLibrarySkills
// (src/lib/admin/skills.js), which surfaces inactive/moderated entries and
// pulls in owner-identity fields that have no place in this picker.
function AssignSkillModal({ employer, members, skippedCount = 0, onClose, onAssigned }) {
  const [historyParams, setHistoryParams] = useState(() => new URLSearchParams())
  const [librarySkills, setLibrarySkills] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [skillQuery, setSkillQuery] = useState('')
  const [selectedSkill, setSelectedSkill] = useState(null)
  const [targetLevel, setTargetLevel] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [comments, setComments] = useState('')
  const [assigning, setAssigning] = useState(false)

  useEffect(() => {
    listLibrarySkills()
      .then(setLibrarySkills)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const skillMatches = useMemo(() => {
    const q = skillQuery.trim().toLowerCase()
    if (!q) return []
    return librarySkills.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 20)
  }, [librarySkills, skillQuery])

  function chooseSkill(skill) {
    setSelectedSkill(skill)
    setSkillQuery(skill.name)
  }

  function clearSkill() {
    setSelectedSkill(null)
    setSkillQuery('')
  }

  async function handleAssign(e) {
    e.preventDefault()
    if (!selectedSkill) return
    if (targetLevel && !targetDate) {
      setError('A target date is required when a target level is set.')
      return
    }
    setAssigning(true)
    setError(null)
    try {
      const requestedIds = members.map((m) => m.user_id)
      const inserted = await suggestSkillToEmployerMembers(
        employer.id,
        selectedSkill.id,
        selectedSkill.name,
        requestedIds,
        {
          targetLevel: targetLevel ? Number(targetLevel) : null,
          targetDate: targetDate || null,
          comments: comments.trim() || null,
        }
      )
      const insertedIds = new Set(inserted.map((row) => row.learner_id))
      // Everyone passed in here already cleared the roster's own "active"
      // filter -- the only reason the RPC would still skip one is an
      // existing live ('suggested'/'adopted') suggestion for this skill.
      const skippedEmails = requestedIds
        .filter((id) => !insertedIds.has(id))
        .map((id) => members.find((m) => m.user_id === id)?.email || id)
      onAssigned({ kind: 'skill', count: inserted.length, skippedEmails })
    } catch (err) {
      setError(err.message)
      setAssigning(false)
    }
  }

  return (
    <AccessibleDialog
      labelledBy="assign-skill-dialog-title"
      onClose={assigning ? undefined : onClose}
      closeOnBackdrop={!assigning}
      panelClassName="w-full max-w-3xl bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
      <h2 id="assign-skill-dialog-title" className="font-display text-xl text-ink mb-1">Assign skill</h2>
      <p className="text-sm text-secondary mb-4">
        Suggest a skill (and optionally a target level/date) to {members.length} selected learner{members.length === 1 ? '' : 's'}.
        They'll see it on their Actions page and decide whether to add it to their own profile -- this doesn't
        touch their skills automatically.
      </p>
      {skippedCount > 0 && (
        <p className="text-xs text-secondary mb-4">
          {skippedCount} of the selected user{skippedCount === 1 ? '' : 's'} {skippedCount === 1 ? 'is' : 'are'} not an active employer member and won't be included.
        </p>
      )}

      <MutationFeedback status="error" message={error} size="xs" className="mb-3" />

      {loading ? (
        <p className="text-sm text-secondary">Loading the skill library…</p>
      ) : (
        <form onSubmit={handleAssign} className="space-y-3">
          <div className="relative">
            <label className="block text-xs text-secondary mb-1" htmlFor="employerAssignSkill">
              Skill
            </label>
            <input
              id="employerAssignSkill"
              value={skillQuery}
              onChange={(e) => {
                setSkillQuery(e.target.value)
                if (selectedSkill) setSelectedSkill(null)
              }}
              placeholder="Search the skill library…"
              autoComplete="off"
              className="w-full rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            />
            {selectedSkill && (
              <button
                type="button"
                onClick={clearSkill}
                className="mt-1 text-xs text-secondary hover:text-ink hover:underline"
              >
                Change
              </button>
            )}
            {!selectedSkill && skillQuery.trim() && (
              <div className="absolute z-10 mt-1 w-full bg-card border border-hairline rounded-md shadow-sm max-h-56 overflow-y-auto">
                {skillMatches.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-secondary">No matching skills.</p>
                ) : (
                  skillMatches.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => chooseSkill(s)}
                      className="block w-full text-left px-3 py-2 text-sm text-ink hover:bg-paper"
                    >
                      {s.name}
                      {s.category && <span className="text-xs text-secondary ml-1.5">({s.category})</span>}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-3">
            <div>
              <label className="block text-xs text-secondary mb-1" htmlFor="employerAssignLevel">
                Target level (optional)
              </label>
              <select
                id="employerAssignLevel"
                value={targetLevel}
                onChange={(e) => setTargetLevel(e.target.value)}
                className="rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              >
                <option value="">No specific level</option>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>{LEVEL_LABELS[l]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-secondary mb-1" htmlFor="employerAssignDate">
                Target date {targetLevel ? '' : '(optional)'}
              </label>
              <input
                id="employerAssignDate"
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className="rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-secondary mb-1" htmlFor="employerAssignComments">
              Why this matters (optional)
            </label>
            <textarea
              id="employerAssignComments"
              rows={2}
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              className="w-full rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={assigning}
              className="rounded-md border border-hairline text-ink py-2 px-4 text-sm font-medium hover:bg-paper disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!selectedSkill || assigning}
              className="rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90 disabled:opacity-60"
            >
              {assigning ? 'Assigning…' : `Assign to ${members.length}`}
            </button>
          </div>
        </form>
      )}
      <section aria-labelledby="employer-skill-history-heading" className="mt-6 border-t border-hairline pt-6">
        <EmployerSkillAssignmentsHistory
          employer={employer}
          members={members}
          searchParams={historyParams}
          setSearchParams={setHistoryParams}
        />
      </section>
    </AccessibleDialog>
  )
}

// Role profile picker for the "Assign role profile" bulk action on the Users
// tab's learner roster (EmployerLearnersPanel) -- mirrors AssignTrainingModal/
// AssignSkillModal's shape, except assign_employer_role_profile only takes
// one employer_member_id at a time (no bulk RPC, unlike course/skill
// assignment), so this calls it once per selected member via
// Promise.allSettled and reports failures as skipped, same partial-failure
// shape as EmployerRosterUploadPanel's CSV import. Assigning only
// *proposes* the role (same as RoleProfileLinkedEmployeesPanel's own
// onAssignEmployees) -- each employee still has to accept it themselves and
// link it to one of their own current roles before it's linked. The RPC
// also only accepts an active employer_members row with role='member', so a
// selected employer admin always lands in the skipped bucket -- selection
// here isn't filtered to exclude them (the roster's own "active" filter is
// shared across all three bulk actions), so that's reported the same way as
// an already-live assignment rather than distinguished.
function AssignRoleModal({ employer, members, skippedCount = 0, onClose, onAssigned }) {
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [assignDates, setAssignDates] = useState({ start: '', end: '' })
  const [assigning, setAssigning] = useState(false)

  useEffect(() => {
    listEmployerRoleProfiles(employer.id)
      .then(setProfiles)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [employer.id])

  async function handleAssign(e) {
    e.preventDefault()
    if (!selectedProfileId) return
    setAssigning(true)
    setError(null)
    try {
      const results = await Promise.allSettled(
        members.map((member) => assignEmployerRoleProfile(
          selectedProfileId,
          member.id,
          assignDates.start || null,
          assignDates.end || null
        ))
      )
      const skippedEmails = members
        .filter((_, index) => results[index].status === 'rejected')
        .map((member) => member.email || member.user_id)
      onAssigned({ kind: 'role', count: results.length - skippedEmails.length, skippedEmails })
    } catch (err) {
      setError(err.message)
      setAssigning(false)
    }
  }

  return (
    <AccessibleDialog
      labelledBy="assign-role-dialog-title"
      onClose={assigning ? undefined : onClose}
      closeOnBackdrop={!assigning}
      panelClassName="w-full max-w-md bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
      <h2 id="assign-role-dialog-title" className="font-display text-xl text-ink mb-1">Assign role profile</h2>
      <p className="text-sm text-secondary mb-4">
        Propose one of {employer.name}'s role profiles to {members.length} selected learner{members.length === 1 ? '' : 's'}.
        They'll see it on their Actions page and choose whether to link it to one of their own current roles --
        this doesn't change their profile automatically.
      </p>
      {skippedCount > 0 && (
        <p className="text-xs text-secondary mb-4">
          {skippedCount} of the selected user{skippedCount === 1 ? '' : 's'} {skippedCount === 1 ? 'is' : 'are'} not an active employer member and won't be included.
        </p>
      )}

      <MutationFeedback status="error" message={error} size="xs" className="mb-3" />

      {loading ? (
        <p className="text-sm text-secondary">Loading role profiles…</p>
      ) : profiles.length === 0 ? (
        <p className="text-sm text-secondary">
          No role profiles yet -- create one from the Role profiles tab first.
        </p>
      ) : (
        <form onSubmit={handleAssign} className="space-y-4">
          <div>
            <label className="block text-xs text-secondary mb-1" htmlFor="employerAssignRoleProfile">
              Role profile
            </label>
            <select
              id="employerAssignRoleProfile"
              required
              value={selectedProfileId}
              onChange={(e) => setSelectedProfileId(e.target.value)}
              className="w-full rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            >
              <option value="">Choose a role profile…</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-secondary">
              Start date (optional)
              <input
                type="date"
                value={assignDates.start}
                disabled={assigning}
                onChange={(e) => setAssignDates((prev) => ({ ...prev, start: e.target.value }))}
                className="mt-1 block rounded-md border border-hairline bg-paper px-2 py-1 text-sm text-ink"
              />
            </label>
            <label className="text-xs text-secondary">
              End date (optional)
              <input
                type="date"
                value={assignDates.end}
                disabled={assigning}
                onChange={(e) => setAssignDates((prev) => ({ ...prev, end: e.target.value }))}
                className="mt-1 block rounded-md border border-hairline bg-paper px-2 py-1 text-sm text-ink"
              />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={assigning}
              className="rounded-md border border-hairline text-ink py-2 px-4 text-sm font-medium hover:bg-paper disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!selectedProfileId || assigning}
              className="rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90 disabled:opacity-60"
            >
              {assigning ? 'Assigning…' : `Propose to ${members.length}`}
            </button>
          </div>
        </form>
      )}
    </AccessibleDialog>
  )
}

// Assignment history for the selected users in the matching assignment dialog.

function EmployerSkillAssignmentsHistory({ employer, members, searchParams, setSearchParams }) {
  const [suggestions, setSuggestions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the listed values change; the loaders are recreated every render
  }, [employer.id, members])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const rows = await listEmployerSkillSuggestions(employer.id)
      const selectedUserIds = new Set(members.map((member) => member.user_id))
      setSuggestions(rows.filter((row) => selectedUserIds.has(row.learner_id)))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const emailByUserId = useMemo(() => new Map(members.map((m) => [m.user_id, m.email || m.user_id])), [members])
  const suggestionsWithEmail = useMemo(
    () => suggestions.map((s) => ({ ...s, learnerEmail: emailByUserId.get(s.learner_id) })),
    [suggestions, emailByUserId]
  )
  const [suggestionQuery, setSuggestionQuery] = useUrlParam(searchParams, setSearchParams, 'sq', '', { resetParams: ['sPage'] })
  const sq = suggestionQuery.trim().toLowerCase()
  const filteredSuggestions = useMemo(
    () =>
      sq
        ? suggestionsWithEmail.filter(
            (s) => s.skill_name?.toLowerCase().includes(sq) || (s.learnerEmail || '').toLowerCase().includes(sq)
          )
        : suggestionsWithEmail,
    [suggestionsWithEmail, sq]
  )
  const suggestionFiltersActive = suggestionQuery !== ''

  function resetSuggestionFilters() {
    writeUrlParams(searchParams, setSearchParams, { sq: null, sPage: null })
  }

  const {
    sortKey: sSortKey,
    sortDir: sSortDir,
    toggleSort: sToggleSort,
    page: sPage,
    setPage: sSetPage,
    pageSize: sPageSize,
    setPageSize: sSetPageSize,
    pageItems: sPageItems,
    totalItems: sTotalItems,
  } = useSortedPage(filteredSuggestions, SKILL_SUGGESTION_SORT_ACCESSORS, {
    defaultSortKey: 'created_at',
    defaultSortDir: 'desc',
    urlSync: { searchParams, setSearchParams, paramNames: { sort: 'sSort', dir: 'sDir', page: 'sPage', pageSize: 'sPageSize' } },
  })

  return (
    <div>
      <h3 id="employer-skill-history-heading" className="font-display text-base text-ink mb-3">Skills assigned so far</h3>
      <MutationFeedback status="error" message={error} size="xs" className="mb-3" />
      {loading ? (
        <p className="text-xs text-secondary">Loading…</p>
      ) : suggestions.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-hairline rounded-lg">
          <p className="text-secondary">No skills assigned to the selected users yet.</p>
        </div>
      ) : (
        <div className="bg-card border border-hairline rounded-lg">
          <div className="flex flex-wrap items-center gap-2 p-3">
            <input
              aria-label="Search suggestions"
              type="text"
              value={suggestionQuery}
              onChange={(e) => setSuggestionQuery(e.target.value)}
              placeholder="Search by skill or learner…"
              className="flex-1 min-w-[220px] rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
            />
            {suggestionFiltersActive && (
              <button
                type="button"
                onClick={resetSuggestionFilters}
                className="text-xs text-secondary hover:text-ink py-1.5 px-2 whitespace-nowrap"
              >
                Reset filters
              </button>
            )}
          </div>
          {filteredSuggestions.length === 0 ? (
            <p className="text-center text-xs text-secondary py-8">No suggestions match your search.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-hairline text-left text-secondary">
                      <SortableTh label="Skill" columnKey="skill" sortKey={sSortKey} sortDir={sSortDir} onSort={sToggleSort} />
                      <SortableTh label="Learner" columnKey="learner" sortKey={sSortKey} sortDir={sSortDir} onSort={sToggleSort} />
                      <th className="px-4 py-2 font-medium whitespace-nowrap">Target</th>
                      <SortableTh label="Status" columnKey="status" sortKey={sSortKey} sortDir={sSortDir} onSort={sToggleSort} className="whitespace-nowrap" />
                      <SortableTh label="Suggested" columnKey="created_at" sortKey={sSortKey} sortDir={sSortDir} onSort={sToggleSort} className="whitespace-nowrap" />
                    </tr>
                  </thead>
                  <tbody>
                    {sPageItems.map((s) => (
                      <tr key={s.id} className="border-b border-hairline last:border-0">
                        <td className="px-4 py-2 text-ink text-xs truncate max-w-[220px]">{s.skill_name}</td>
                        <td className="px-4 py-2 text-secondary text-xs truncate max-w-[220px]">{s.learnerEmail || s.learner_id}</td>
                        <td className="px-4 py-2 text-secondary text-xs whitespace-nowrap">
                          {s.suggested_target_level ? LEVEL_LABELS[s.suggested_target_level] : '—'}
                          {s.target_date ? ` by ${new Date(`${s.target_date}T00:00:00`).toLocaleDateString()}` : ''}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap">
                          <StatusBadge label={SKILL_SUGGESTION_STATUS_LABELS[s.status] || s.status} tone={s.status === 'dismissed' ? 'danger' : 'neutral'} />
                        </td>
                        <td className="px-4 py-2 text-secondary text-xs whitespace-nowrap">{new Date(s.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TablePagination page={sPage} setPage={sSetPage} pageSize={sPageSize} setPageSize={sSetPageSize} totalItems={sTotalItems} idPrefix={`employer-skill-suggestions-${employer.id}`} />
            </>
          )}
        </div>
      )}
    </div>
  )
}
