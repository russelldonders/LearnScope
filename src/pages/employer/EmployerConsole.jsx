import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import AppHeader from '../../components/AppHeader'
import ConfirmDialog from '../../components/ConfirmDialog'
import ResourceLibrarySection from '../../components/ResourceLibrarySection'
import { ProviderTrainingSection, ProviderCataloguesSection } from '../provider/ProviderConsole'
import {
  listEmployers,
  listEmployerMembers,
  addEmployerMember,
  removeEmployerMember,
  listEmployerCatalogueCourses,
  assignCourseToEmployerMembers,
  listEmployerCourseAssignments,
  requestEmployerDataAccess,
  listEmployerDataAccessRequests,
} from '../../lib/admin/employers'
import { useSortedPage, useRowSelection } from '../../lib/useSortedPage'
import { SortableTh, TablePagination, SelectionTh, BulkActionBar } from '../../components/TableControls'

const SECTIONS = [
  { key: 'training', label: 'Training' },
  { key: 'learners', label: 'Learners' },
  { key: 'assign', label: 'Assign training' },
]

const LEARNER_SORT_ACCESSORS = {
  id: (m) => m.id ?? '',
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

// Foundation console for an employer's own admin (employer_members
// role = 'admin', gated by EmployerAdminRoute). Training reuses the
// existing provider console components verbatim (readOnly), scoped to the
// employer's own auto-provisioned attached provider organisation
// (create_employer, 20260902090000) -- no forked view-only UI. Authoring
// (create/edit/delete/publish) only happens in the standalone Provider
// console at /provider, where this employer admin's real organisation_
// members role on that same org already grants it -- this tab is purely a
// second, view-only window onto the same data, not a second place to
// change it. Learners is a separate, new roster of the employer's own
// managed learners (employer_members), not provider staff -- one-at-a-time
// add-by-email plus (Phase 2) bulk import; course assignment and any
// learner-facing UI are still later phases.
export default function EmployerConsole() {
  const { user, employerMemberships, organisationMemberships } = useAuth()
  const [employers, setEmployers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedEmployerId, setSelectedEmployerId] = useState(null)
  const [activeSection, setActiveSection] = useState('training')

  const myEmployerIds = useMemo(
    () => (employerMemberships ?? []).filter((m) => m.role === 'admin').map((m) => m.employer_id),
    [employerMemberships]
  )
  const myEmployers = useMemo(
    () => employers.filter((e) => myEmployerIds.includes(e.id)),
    [employers, myEmployerIds]
  )
  const selectedEmployer = myEmployers.find((e) => e.id === selectedEmployerId)
  // Training-tab authoring is gated by organisation_members on the
  // attached provider org (is_org_admin/is_org_member RLS), which is a
  // separate relationship from employer_members -- mirrors ProviderConsole
  // .jsx's own myRole, derived the same way from a real membership row
  // rather than assumed. addEmployerMember (api/admin/actions.js) upserts
  // this row whenever an employer admin is added, so in practice it's
  // present for every employer admin, but it's still the actual source of
  // truth for what they're allowed to do in the reused provider components.
  const myProviderRole = (organisationMemberships ?? []).find(
    (m) => m.organisation_id === selectedEmployer?.provider_organisation_id
  )?.role

  useEffect(() => {
    listEmployers()
      .then(setEmployers)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!selectedEmployerId && myEmployers.length > 0) {
      setSelectedEmployerId(myEmployers[0].id)
    }
  }, [myEmployers, selectedEmployerId])

  return (
    <div className="min-h-screen bg-paper">
      {/* hideNavLinks: same reasoning as ProviderConsole.jsx -- this is a
          distinct workspace from the learner-facing app. */}
      <AppHeader hideNavLinks />
      <main id="main-content" tabIndex={-1} className="max-w-5xl mx-auto px-4 py-8">
        <h1 className="font-display text-xl text-ink mb-1">Employer console</h1>
        <p className="text-sm text-secondary mb-6">
          Build out your organisation's own training and manage the people it covers.
        </p>

        {error && <p className="text-sm text-red-700 mb-4">{error}</p>}

        {loading ? (
          <p className="text-secondary">Loading…</p>
        ) : myEmployers.length === 0 ? (
          <p className="text-secondary">You're not an admin of any employer.</p>
        ) : (
          <>
            {myEmployers.length > 1 && (
              <div className="flex items-center flex-wrap gap-1 mb-4 border-b border-hairline">
                {myEmployers.map((employer) => (
                  <button
                    key={employer.id}
                    type="button"
                    onClick={() => setSelectedEmployerId(employer.id)}
                    className={`text-sm px-3 py-2 -mb-px border-b-2 whitespace-nowrap ${
                      selectedEmployerId === employer.id
                        ? 'border-moss text-ink font-medium'
                        : 'border-transparent text-secondary hover:text-ink'
                    }`}
                  >
                    {employer.name}
                  </button>
                ))}
              </div>
            )}

            {selectedEmployer && (
              <div>
                <div className="flex items-center flex-wrap gap-1 mb-6 border-b border-hairline">
                  {SECTIONS.map((section) => (
                    <button
                      key={section.key}
                      type="button"
                      onClick={() => setActiveSection(section.key)}
                      className={`text-sm px-3 py-2 -mb-px border-b-2 whitespace-nowrap ${
                        activeSection === section.key
                          ? 'border-moss text-ink font-medium'
                          : 'border-transparent text-secondary hover:text-ink'
                      }`}
                    >
                      {section.label}
                    </button>
                  ))}
                </div>

                {activeSection === 'training' && (
                  <div className="space-y-10">
                    <p className="text-sm text-secondary">
                      This view is read-only.{' '}
                      {myProviderRole ? (
                        <>
                          Manage courses, catalogues, and resources from the full{' '}
                          <Link to="/provider" className="text-moss hover:underline">
                            Provider console →
                          </Link>
                        </>
                      ) : (
                        "Ask an admin of this employer's provider organisation to manage courses, catalogues, and resources there."
                      )}
                    </p>
                    <ProviderTrainingSection
                      key={`${selectedEmployer.id}-training`}
                      organisation={{ id: selectedEmployer.provider_organisation_id }}
                      userId={user.id}
                      canViewParticipants={myProviderRole === 'admin'}
                      readOnly
                    />
                    <ProviderCataloguesSection
                      key={`${selectedEmployer.id}-catalogues`}
                      organisation={{ id: selectedEmployer.provider_organisation_id }}
                      userId={user.id}
                      readOnly
                    />
                    <ResourceLibrarySection
                      key={`${selectedEmployer.id}-resources`}
                      organisationId={selectedEmployer.provider_organisation_id}
                      userId={user.id}
                      readOnly
                    />
                  </div>
                )}
                {activeSection === 'learners' && (
                  <EmployerLearnersPanel key={selectedEmployer.id} employer={selectedEmployer} />
                )}
                {activeSection === 'assign' && (
                  <EmployerAssignTrainingPanel key={selectedEmployer.id} employer={selectedEmployer} />
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}

const DATA_ACCESS_STATUS_LABELS = {
  pending: 'Access requested',
  approved: 'Access granted',
  declined: 'Access declined',
  revoked: 'Access revoked',
}

function EmployerLearnersPanel({ employer }) {
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [email, setEmail] = useState('')
  const [role, setRole] = useState('member')
  const [adding, setAdding] = useState(false)
  const [message, setMessage] = useState(null)
  const [removeTarget, setRemoveTarget] = useState(null)
  const [removing, setRemoving] = useState(false)

  const [bulkEmails, setBulkEmails] = useState('')
  const [bulkRole, setBulkRole] = useState('member')
  const [bulkSubmitting, setBulkSubmitting] = useState(false)
  const [bulkResults, setBulkResults] = useState(null)

  // Phase 5: employer-side view of each member's data-access consent state.
  // Keyed by learner_id -- there's at most one row per (employer, learner)
  // pair (unique constraint), so a plain map is enough.
  const [dataAccessByLearner, setDataAccessByLearner] = useState({})
  const [dataAccessRequestingId, setDataAccessRequestingId] = useState(null)
  const [dataAccessError, setDataAccessError] = useState(null)

  const { sortKey, sortDir, toggleSort, page, setPage, pageSize, setPageSize, pageItems, totalItems } =
    useSortedPage(members, LEARNER_SORT_ACCESSORS)

  useEffect(() => {
    load()
  }, [employer.id])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [membersData, dataAccessData] = await Promise.all([
        listEmployerMembers(employer.id),
        listEmployerDataAccessRequests(employer.id),
      ])
      setMembers(membersData)
      setDataAccessByLearner(Object.fromEntries(dataAccessData.map((r) => [r.learner_id, r])))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleRequestDataAccess(member) {
    setDataAccessError(null)
    setDataAccessRequestingId(member.user_id)
    try {
      const row = await requestEmployerDataAccess(employer.id, member.user_id)
      setDataAccessByLearner((prev) => ({ ...prev, [member.user_id]: row }))
    } catch (err) {
      setDataAccessError({ id: member.user_id, message: err.message })
    } finally {
      setDataAccessRequestingId(null)
    }
  }

  async function handleAdd(e) {
    e.preventDefault()
    setAdding(true)
    setMessage(null)
    setError(null)
    try {
      const result = await addEmployerMember(employer.id, email.trim(), role)
      setMessage(
        result.alreadyExisted
          ? `${email.trim()} added, pending their acceptance (see their Actions page).`
          : `${email.trim()} invited. They'll get access once they accept the invite email.`
      )
      setEmail('')
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setAdding(false)
    }
  }

  // Bulk-invite path alongside the one-at-a-time form above -- one
  // addEmployerMember call per email via Promise.allSettled, same partial-
  // failure shape as ProviderConsole.jsx's own bulk handlers (e.g.
  // handleBulkDelete), just reporting per-row outcomes instead of only
  // failures since a successful add here can mean either "invited" (new
  // account) or "added, pending acceptance" (existing account) -- both
  // worth surfacing distinctly, not just "succeeded".
  async function handleBulkImport(e) {
    e.preventDefault()
    const emails = Array.from(new Set(bulkEmails.split(/[\n,]+/).map((entry) => entry.trim()).filter(Boolean)))
    if (emails.length === 0) return

    setBulkSubmitting(true)
    setBulkResults(null)
    setError(null)
    try {
      const results = await Promise.allSettled(emails.map((addr) => addEmployerMember(employer.id, addr, bulkRole)))
      setBulkResults(
        emails.map((addr, index) => {
          const result = results[index]
          if (result.status === 'fulfilled') {
            return result.value.alreadyExisted
              ? { email: addr, outcome: 'added', detail: 'Added -- pending their acceptance' }
              : { email: addr, outcome: 'invited', detail: 'Invited -- new account created' }
          }
          const reason = result.reason?.message ?? 'Unknown error'
          // addEmployerMember's own 409 message (api/admin/actions.js) --
          // matched here only to give this one expected failure its own
          // clearer label instead of lumping it in with unexpected ones.
          return reason === 'This person is already a member of this employer.'
            ? { email: addr, outcome: 'already-member', detail: 'Already a member' }
            : { email: addr, outcome: 'failed', detail: `Failed -- ${reason}` }
        })
      )
      setBulkEmails('')
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBulkSubmitting(false)
    }
  }

  async function handleRemove() {
    setError(null)
    setRemoving(true)
    try {
      await removeEmployerMember(removeTarget.id)
      setRemoveTarget(null)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setRemoving(false)
    }
  }

  return (
    <section aria-labelledby="employer-learners-heading">
      <div className="mb-5">
        <h2 id="employer-learners-heading" className="font-display text-lg text-ink">Learners</h2>
        <p className="text-sm text-secondary mt-1 max-w-2xl">
          People managed under {employer.name}. Invite someone by email below, or paste multiple emails to bulk
          import learners at once.
        </p>
      </div>

      <form onSubmit={handleAdd} className="bg-card border border-hairline rounded-lg p-4 flex flex-wrap items-end gap-2 mb-4">
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs text-secondary mb-1" htmlFor="employerMemberEmail">
            Add or invite by email
          </label>
          <input
            id="employerMemberEmail"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
          />
        </div>
        <div>
          <label className="block text-xs text-secondary mb-1" htmlFor="employerMemberRole">
            Role
          </label>
          <select
            id="employerMemberRole"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={adding}
          className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
        >
          {adding ? 'Adding…' : 'Add'}
        </button>
      </form>

      {message && <p className="text-xs text-moss mb-3">{message}</p>}
      {error && <p className="text-xs text-red-700 mb-3">{error}</p>}

      <details className="bg-card border border-hairline rounded-lg p-4 mb-4">
        <summary className="text-sm font-medium text-ink cursor-pointer">Bulk import learners</summary>
        <form onSubmit={handleBulkImport} className="mt-3 space-y-3">
          <div>
            <label className="block text-xs text-secondary mb-1" htmlFor="employerBulkEmails">
              Emails (one per line, or comma-separated)
            </label>
            <textarea
              id="employerBulkEmails"
              rows={4}
              value={bulkEmails}
              onChange={(e) => setBulkEmails(e.target.value)}
              placeholder={'jane@example.com\njohn@example.com'}
              className="w-full rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-xs text-secondary mb-1" htmlFor="employerBulkRole">
                Role
              </label>
              <select
                id="employerBulkRole"
                value={bulkRole}
                onChange={(e) => setBulkRole(e.target.value)}
                className="rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={bulkSubmitting || !bulkEmails.trim()}
              className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
            >
              {bulkSubmitting ? 'Importing…' : 'Bulk import'}
            </button>
          </div>
        </form>

        {bulkResults && (
          <div className="mt-3 border-t border-hairline pt-3">
            <p className="text-xs text-secondary mb-2">
              {bulkResults.length} {bulkResults.length === 1 ? 'result' : 'results'}:
            </p>
            <ul className="space-y-1">
              {bulkResults.map((r) => (
                <li key={r.email} className="text-xs flex flex-wrap gap-1">
                  <span className="font-mono text-ink">{r.email}</span>
                  <span
                    className={
                      r.outcome === 'failed'
                        ? 'text-red-700'
                        : r.outcome === 'already-member'
                          ? 'text-secondary'
                          : 'text-moss'
                    }
                  >
                    {r.detail}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </details>

      {loading ? (
        <p className="text-xs text-secondary">Loading learners…</p>
      ) : members.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-hairline rounded-lg">
          <p className="text-secondary">No learners yet.</p>
        </div>
      ) : (
        <div className="bg-card border border-hairline rounded-lg">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-secondary">
                  <SortableTh label="ID" columnKey="id" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="whitespace-nowrap" />
                  <SortableTh label="Learner" columnKey="email" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Role" columnKey="role" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="whitespace-nowrap" />
                  <SortableTh label="Status" columnKey="status" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="whitespace-nowrap" />
                  <th className="px-4 py-2 font-medium whitespace-nowrap">Data access</th>
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((m) => {
                  const dataAccess = dataAccessByLearner[m.user_id]
                  const canRequest = m.status === 'active' && (!dataAccess || dataAccess.status === 'declined' || dataAccess.status === 'revoked')
                  return (
                    <tr key={m.id} className="border-b border-hairline last:border-0">
                      <td className="px-4 py-2 font-mono text-[10px] text-secondary whitespace-nowrap">{m.id.slice(0, 8)}</td>
                      <td className="px-4 py-2 text-ink text-xs truncate max-w-[220px]">{m.email || m.user_id}</td>
                      <td className="px-4 py-2 text-secondary text-xs whitespace-nowrap">{m.role}</td>
                      <td className="px-4 py-2 text-secondary text-xs whitespace-nowrap">{m.status === 'pending' ? 'Pending' : 'Active'}</td>
                      <td className="px-4 py-2 text-xs whitespace-nowrap">
                        <div className="flex flex-col gap-1 items-start">
                          <span className="text-secondary">
                            {dataAccess ? DATA_ACCESS_STATUS_LABELS[dataAccess.status] : 'No request yet'}
                          </span>
                          {canRequest && (
                            <button
                              type="button"
                              onClick={() => handleRequestDataAccess(m)}
                              disabled={dataAccessRequestingId === m.user_id}
                              className="text-moss hover:underline disabled:opacity-60"
                            >
                              {dataAccessRequestingId === m.user_id ? 'Requesting…' : 'Request data access'}
                            </button>
                          )}
                          {dataAccessError?.id === m.user_id && (
                            <span className="text-red-700">{dataAccessError.message}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button type="button" onClick={() => setRemoveTarget(m)} className="text-xs text-red-700 hover:underline whitespace-nowrap">
                          Remove
                        </button>
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
          message={`Remove ${removeTarget.email || removeTarget.user_id} from ${employer.name}? They'll lose their ${removeTarget.role} access.`}
          onConfirm={handleRemove}
          onCancel={() => setRemoveTarget(null)}
          confirming={removing}
        />
      )}
    </section>
  )
}

// Phase 3: push training to specific learners rather than relying on 100%
// learner-initiated browse/enrol (courseCatalogue.js's listCatalogueCourses/
// enrolInCatalogueCourse, untouched by this phase). Course choices are
// scoped to courses actually published in one of this employer's own
// catalogues (listEmployerCatalogueCourses -- the RPC re-validates this
// server-side regardless, this is only the picker's convenience list).
// Assigning never enrols anyone by itself -- assign_course_to_employer_
// members only creates a course_assignments row; the learner still has to
// click "Start" on their own /actions page (respondToCourseAssignment) to
// create the real enrolment. Member selection reuses the same
// useRowSelection/SelectionTh/BulkActionBar primitives as ProviderConsole
// .jsx's own bulk "Push to catalogue" table, for a consistent picker feel
// across this console.
function EmployerAssignTrainingPanel({ employer }) {
  const [courses, setCourses] = useState([])
  const [members, setMembers] = useState([])
  const [assignments, setAssignments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [selectedCourseId, setSelectedCourseId] = useState('')
  const [assigning, setAssigning] = useState(false)
  const [assignResult, setAssignResult] = useState(null)

  useEffect(() => {
    load()
  }, [employer.id])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [coursesData, membersData, assignmentsData] = await Promise.all([
        listEmployerCatalogueCourses(employer.provider_organisation_id),
        listEmployerMembers(employer.id),
        listEmployerCourseAssignments(employer.id),
      ])
      setCourses(coursesData)
      setMembers(membersData)
      setAssignments(assignmentsData)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Only an active employer_members row is assignable -- mirrors the RPC's
  // own membership filter (status = 'active'), so the picker never offers a
  // pending invitee it would just silently skip.
  const activeMembers = useMemo(() => members.filter((m) => m.status === 'active'), [members])
  const emailByUserId = useMemo(() => new Map(members.map((m) => [m.user_id, m.email || m.user_id])), [members])

  const { sortKey, sortDir, toggleSort, page, setPage, pageSize, setPageSize, pageItems, totalItems } =
    useSortedPage(activeMembers, LEARNER_SORT_ACCESSORS)
  const selection = useRowSelection(activeMembers.map((m) => m.user_id))
  const pageUserIds = pageItems.map((m) => m.user_id)
  const selectedOnPage = pageUserIds.filter((id) => selection.selected.has(id)).length

  const assignmentsWithEmail = useMemo(
    () => assignments.map((a) => ({ ...a, learnerEmail: emailByUserId.get(a.assigned_to) })),
    [assignments, emailByUserId]
  )
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
  } = useSortedPage(assignmentsWithEmail, ASSIGNMENT_SORT_ACCESSORS, { defaultSortKey: 'created_at', defaultSortDir: 'desc' })

  async function handleAssign() {
    if (!selectedCourseId || selection.selected.size === 0) return
    setAssigning(true)
    setAssignResult(null)
    setError(null)
    try {
      const requestedIds = Array.from(selection.selected)
      const inserted = await assignCourseToEmployerMembers(employer.id, selectedCourseId, requestedIds)
      const insertedIds = new Set(inserted.map((row) => row.assigned_to))
      // The RPC silently skips anyone not an active member by the time it
      // ran, or already assigned this course (on conflict do nothing) --
      // report that explicitly rather than claiming every requested person
      // was assigned.
      const skippedEmails = requestedIds
        .filter((id) => !insertedIds.has(id))
        .map((id) => emailByUserId.get(id) || id)
      setAssignResult({ assignedCount: inserted.length, skippedEmails })
      selection.clear()
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setAssigning(false)
    }
  }

  return (
    <section aria-labelledby="employer-assign-training-heading">
      <div className="mb-5">
        <h2 id="employer-assign-training-heading" className="font-display text-lg text-ink">Assign training</h2>
        <p className="text-sm text-secondary mt-1 max-w-2xl">
          Push a course from {employer.name}'s own catalogue to specific learners. They'll see it on their Actions
          page and choose whether to start it -- assigning doesn't enrol anyone automatically.
        </p>
      </div>

      {error && <p className="text-sm text-red-700 mb-3">{error}</p>}

      {loading ? (
        <p className="text-secondary">Loading…</p>
      ) : (
        <>
          <div className="bg-card border border-hairline rounded-lg p-4 mb-4">
            <label className="block text-xs text-secondary mb-1" htmlFor="employerAssignCourse">
              Course
            </label>
            {courses.length === 0 ? (
              <p className="text-xs text-secondary">
                No published courses yet -- publish a course to one of this employer's own catalogues from the
                Training tab first.
              </p>
            ) : (
              <select
                id="employerAssignCourse"
                value={selectedCourseId}
                onChange={(e) => setSelectedCourseId(e.target.value)}
                className="w-full max-w-md rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              >
                <option value="">Choose a course…</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
          </div>

          {assignResult && (
            <div className="bg-card border border-hairline rounded-lg p-4 mb-4 text-xs">
              <p className="text-moss">{assignResult.assignedCount} learner(s) assigned.</p>
              {assignResult.skippedEmails.length > 0 && (
                <p className="text-secondary mt-1">
                  Skipped (not an active member, or already assigned this course): {assignResult.skippedEmails.join(', ')}
                </p>
              )}
            </div>
          )}

          {activeMembers.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-hairline rounded-lg mb-8">
              <p className="text-secondary">No active learners to assign training to yet.</p>
            </div>
          ) : (
            <div className="bg-card border border-hairline rounded-lg mb-8">
              <div className="p-3 pb-0">
                <BulkActionBar
                  count={selection.selected.size}
                  onClear={selection.clear}
                  busy={assigning}
                  actions={[
                    {
                      label: assigning ? 'Assigning…' : `Assign course (${selection.selected.size})`,
                      disabled: !selectedCourseId || selection.selected.size === 0,
                      title: !selectedCourseId ? 'Choose a course above first' : undefined,
                      onClick: handleAssign,
                    },
                  ]}
                />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-hairline text-left text-secondary">
                      <SelectionTh
                        idPrefix="employer-assign-members"
                        checked={selection.isAllSelected(pageUserIds)}
                        indeterminate={selectedOnPage > 0 && selectedOnPage < pageUserIds.length}
                        onChange={() => selection.toggleAll(pageUserIds)}
                      />
                      <SortableTh label="Learner" columnKey="email" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                      <SortableTh label="Role" columnKey="role" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="whitespace-nowrap" />
                    </tr>
                  </thead>
                  <tbody>
                    {pageItems.map((m) => (
                      <tr key={m.user_id} className="border-b border-hairline last:border-0">
                        <td className="px-4 py-2">
                          <input
                            type="checkbox"
                            checked={selection.selected.has(m.user_id)}
                            onChange={() => selection.toggle(m.user_id)}
                            aria-label={`Select ${m.email || m.user_id}`}
                            className="rounded border-hairline accent-moss"
                          />
                        </td>
                        <td className="px-4 py-2 text-ink text-xs truncate max-w-[220px]">{m.email || m.user_id}</td>
                        <td className="px-4 py-2 text-secondary text-xs whitespace-nowrap">{m.role}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TablePagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} totalItems={totalItems} idPrefix={`employer-assign-members-${employer.id}`} />
            </div>
          )}

          <div>
            <h3 className="font-display text-base text-ink mb-3">Assigned so far</h3>
            {assignments.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-hairline rounded-lg">
                <p className="text-secondary">No training assigned yet.</p>
              </div>
            ) : (
              <div className="bg-card border border-hairline rounded-lg">
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
                          <td className="px-4 py-2 text-secondary text-xs whitespace-nowrap">{ASSIGNMENT_STATUS_LABELS[a.status] || a.status}</td>
                          <td className="px-4 py-2 text-secondary text-xs whitespace-nowrap">{new Date(a.created_at).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <TablePagination page={aPage} setPage={aSetPage} pageSize={aPageSize} setPageSize={aSetPageSize} totalItems={aTotalItems} idPrefix={`employer-assignments-${employer.id}`} />
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}
