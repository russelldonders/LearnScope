import { requestedDataSummary } from '../../lib/employerDataAccess'
import RequestDataAccessDialog from './RequestDataAccessDialog'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import ConfirmDialog from '../../components/ConfirmDialog'
import TrainingTeamAccessDialog from './TrainingTeamAccessDialog'
import { addEmployerMember, removeEmployerMember, requestEmployerDataAccess, upsertEmployerMemberFieldValue } from '../../lib/admin/employers'
import { useEmployerLearnersData } from './useEmployerLearnersData'
import EmployerMemberFieldsModal from '../../components/EmployerMemberFieldsModal'
import EmployerMemberFieldInputs from '../../components/EmployerMemberFieldInputs'
import EmployerMemberDetailModal from '../../components/EmployerMemberDetailModal'
import EmployerMemberRoleProfilesModal from './EmployerMemberRoleProfilesModal'
import EmployerRosterUploadPanel from './EmployerRosterUploadPanel'
import AssignTrainingModal from './AssignTrainingModal'
import AssignSkillModal from './AssignSkillModal'
import AssignRoleModal from './AssignRoleModal'
import { employerLearnerColumns } from './employerLearnerColumns'
import { listOrganisationMembers } from '../../lib/admin/organisations'
import { LEARNER_SORT_ACCESSORS, DATA_ACCESS_STATUS_LABELS } from '../../lib/employerLearnerTables'
import { useColumnPreferences, useSortedPage, useRowSelection, useUrlParam, writeUrlParams } from '../../lib/useSortedPage'
import { ColumnCustomizer, SortableTh, TablePagination, SelectionTh, BulkActionBar } from '../../components/TableControls'
import MutationFeedback from '../../components/MutationFeedback'

export function EmployerLearnersPanel({ employer, searchParams, setSearchParams, attachedProviderOrg }) {
  const { isPlatformAdmin, user } = useAuth()
  const {
    members,
    trainingStaff,
    setTrainingStaff,
    trainingStaffError,
    setTrainingStaffError,
    trainingStaffLoading,
    loading,
    error,
    setError,
    dataAccessByLearner,
    setDataAccessByLearner,
    fieldDefinitions,
    fieldValuesByMember,
    setFieldValuesByMember,
    load,
  } = useEmployerLearnersData(employer.id, attachedProviderOrg)

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

  const [dataAccessRequestingId, setDataAccessRequestingId] = useState(null)
  const [dataAccessError, setDataAccessError] = useState(null)

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
