import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import AppHeader from '../../components/AppHeader'
import ConfirmDialog from '../../components/ConfirmDialog'
import ResourceLibrarySection from '../../components/ResourceLibrarySection'
import { ProviderTrainingSection, ProviderCataloguesSection } from '../provider/ProviderConsole'
import { listEmployers, listEmployerMembers, addEmployerMember, removeEmployerMember } from '../../lib/admin/employers'
import { useSortedPage } from '../../lib/useSortedPage'
import { SortableTh, TablePagination } from '../../components/TableControls'

const SECTIONS = [
  { key: 'training', label: 'Training' },
  { key: 'learners', label: 'Learners' },
]

const LEARNER_SORT_ACCESSORS = {
  id: (m) => m.id ?? '',
  email: (m) => (m.email || m.user_id || '').toLowerCase(),
  role: (m) => m.role ?? '',
  status: (m) => m.status ?? '',
}

// Phase 1 foundation console for an employer's own admin (employer_members
// role = 'admin', gated by EmployerAdminRoute). Training reuses the
// existing provider console components verbatim, scoped to the employer's
// own auto-provisioned attached provider organisation (create_employer,
// 20260902090000) -- no forked authoring UI. Learners is a separate, new
// roster of the employer's own managed learners (employer_members), not
// provider staff -- deliberately kept to one-at-a-time add-by-email here;
// bulk import, course assignment and any learner-facing UI are explicitly
// later phases.
export default function EmployerConsole() {
  const { user, employerMemberships } = useAuth()
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
                    <ProviderTrainingSection
                      key={`${selectedEmployer.id}-training`}
                      organisation={{ id: selectedEmployer.provider_organisation_id }}
                      userId={user.id}
                      canViewParticipants
                    />
                    <ProviderCataloguesSection
                      key={`${selectedEmployer.id}-catalogues`}
                      organisation={{ id: selectedEmployer.provider_organisation_id }}
                      userId={user.id}
                      canCreate
                    />
                    <ResourceLibrarySection
                      key={`${selectedEmployer.id}-resources`}
                      organisationId={selectedEmployer.provider_organisation_id}
                      userId={user.id}
                    />
                  </div>
                )}
                {activeSection === 'learners' && (
                  <EmployerLearnersPanel key={selectedEmployer.id} employer={selectedEmployer} />
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
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

  const { sortKey, sortDir, toggleSort, page, setPage, pageSize, setPageSize, pageItems, totalItems } =
    useSortedPage(members, LEARNER_SORT_ACCESSORS)

  useEffect(() => {
    load()
  }, [employer.id])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      setMembers(await listEmployerMembers(employer.id))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleAdd(e) {
    e.preventDefault()
    setAdding(true)
    setMessage(null)
    setError(null)
    try {
      await addEmployerMember(employer.id, email.trim(), role)
      setMessage(`${email.trim()} added.`)
      setEmail('')
      await load()
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
          People managed under {employer.name}. Add someone who already has a LearnScope account by email -- bulk
          import isn't available yet.
        </p>
      </div>

      <form onSubmit={handleAdd} className="bg-card border border-hairline rounded-lg p-4 flex flex-wrap items-end gap-2 mb-4">
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs text-secondary mb-1" htmlFor="employerMemberEmail">
            Add an existing user by email
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
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((m) => (
                  <tr key={m.id} className="border-b border-hairline last:border-0">
                    <td className="px-4 py-2 font-mono text-[10px] text-secondary whitespace-nowrap">{m.id.slice(0, 8)}</td>
                    <td className="px-4 py-2 text-ink text-xs truncate max-w-[220px]">{m.email || m.user_id}</td>
                    <td className="px-4 py-2 text-secondary text-xs whitespace-nowrap">{m.role}</td>
                    <td className="px-4 py-2 text-secondary text-xs whitespace-nowrap">{m.status === 'pending' ? 'Pending' : 'Active'}</td>
                    <td className="px-4 py-2 text-right">
                      <button type="button" onClick={() => setRemoveTarget(m)} className="text-xs text-red-700 hover:underline whitespace-nowrap">
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
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
