import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  listOrganisationCatalogues,
  createCatalogue,
  deleteCatalogue,
  countPublishedCoursesInCatalogue,
  listCatalogueApprovers,
  addCatalogueApprover,
  removeCatalogueApprover,
} from '../lib/admin/catalogue'
import { listOrganisationMembers } from '../lib/admin/organisations'
import ConfirmDialog from './ConfirmDialog'

// Provider console admin-only tab (0111/0112): an org can own any number of
// its own named catalogues, in addition to always being able to publish
// into the platform-managed Global catalogue (not shown here -- it isn't
// this org's to manage). Each of an org's own catalogues gets its own
// approver list, picked from that org's own active users, so a course
// submitted to it can be approved/rejected/deactivated without a platform
// admin -- see publish_course_version's per-catalogue authorization.
export default function ProviderCataloguesSection({ organisationId }) {
  const { user } = useAuth()
  const [catalogues, setCatalogues] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [creating, setCreating] = useState(false)
  const [expandedId, setExpandedId] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteTargetPublishedCount, setDeleteTargetPublishedCount] = useState(0)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    load()
  }, [organisationId])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      setCatalogues(await listOrganisationCatalogues(organisationId))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate(e) {
    e.preventDefault()
    if (!name.trim()) return
    setCreating(true)
    setError(null)
    try {
      await createCatalogue(organisationId, { name, description }, user.id)
      setName('')
      setDescription('')
      setShowForm(false)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setCreating(false)
    }
  }

  async function handleStartDelete(catalogue) {
    setError(null)
    setDeleteTarget(catalogue)
    setDeleteTargetPublishedCount(0)
    try {
      setDeleteTargetPublishedCount(await countPublishedCoursesInCatalogue(catalogue.id))
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    setError(null)
    try {
      await deleteCatalogue(deleteTarget.id)
      if (expandedId === deleteTarget.id) setExpandedId(null)
      setDeleteTarget(null)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="font-display text-lg text-ink">Catalogues</h3>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90"
        >
          {showForm ? 'Cancel' : '+ Create catalogue'}
        </button>
      </div>
      <p className="text-sm text-secondary mb-3">
        Training can be submitted to the platform's Global catalogue and/or a catalogue of your own. Each of your
        own catalogues can have its own approvers, so training destined for it can be approved without a platform
        admin.
      </p>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-card border border-hairline rounded-lg p-4 space-y-3 mb-4">
          <div>
            <label className="block text-sm text-secondary mb-1" htmlFor="catalogueName">
              Name
            </label>
            <input
              id="catalogueName"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            />
          </div>
          <div>
            <label className="block text-sm text-secondary mb-1" htmlFor="catalogueDescription">
              Description
            </label>
            <textarea
              id="catalogueDescription"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            />
          </div>
          <button
            type="submit"
            disabled={creating}
            className="rounded-md bg-moss text-paper py-2 px-4 font-medium hover:opacity-90 disabled:opacity-60"
          >
            {creating ? 'Creating…' : 'Create'}
          </button>
        </form>
      )}

      {error && <p className="text-sm text-red-700 mb-3">{error}</p>}

      {loading ? (
        <p className="text-secondary">Loading…</p>
      ) : catalogues.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-hairline rounded-lg">
          <p className="text-secondary">No catalogues of your own yet -- training can still be submitted to the Global catalogue.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {catalogues.map((catalogue) => (
            <div key={catalogue.id} className="bg-card border border-hairline rounded-lg overflow-hidden">
              <div className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="text-ink font-medium">{catalogue.name}</p>
                  {catalogue.description && <p className="text-sm text-secondary mt-0.5">{catalogue.description}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setExpandedId((id) => (id === catalogue.id ? null : catalogue.id))}
                    className="rounded-md border border-hairline text-ink py-1 px-3 text-xs font-medium hover:bg-paper"
                  >
                    {expandedId === catalogue.id ? 'Hide approvers' : 'Manage approvers'}
                  </button>
                  <button type="button" onClick={() => handleStartDelete(catalogue)} className="text-xs text-red-700 hover:underline">
                    Delete
                  </button>
                </div>
              </div>
              {expandedId === catalogue.id && (
                <CatalogueApproversPanel catalogueId={catalogue.id} organisationId={organisationId} />
              )}
            </div>
          ))}
        </div>
      )}

      {deleteTarget && (
        <ConfirmDialog
          message={
            deleteTargetPublishedCount > 0
              ? `Delete the "${deleteTarget.name}" catalogue? ${deleteTargetPublishedCount} currently live ${
                  deleteTargetPublishedCount === 1 ? 'course is' : 'courses are'
                } published there -- ${
                  deleteTargetPublishedCount === 1 ? 'it' : 'they'
                } will disappear from it, and may become invisible to learners entirely if this was its only destination.`
              : `Delete the "${deleteTarget.name}" catalogue? Courses currently published there will no longer appear in it.`
          }
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
          confirming={deleting}
        />
      )}
    </div>
  )
}

function CatalogueApproversPanel({ catalogueId, organisationId }) {
  const { user } = useAuth()
  const [members, setMembers] = useState([])
  const [approvers, setApprovers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [togglingUserId, setTogglingUserId] = useState(null)

  useEffect(() => {
    load()
  }, [catalogueId])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [memberList, approverList] = await Promise.all([
        listOrganisationMembers(organisationId),
        listCatalogueApprovers(catalogueId),
      ])
      setMembers(memberList.filter((m) => m.status === 'active'))
      setApprovers(approverList)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleToggle(member, isApprover) {
    setTogglingUserId(member.user_id)
    setError(null)
    try {
      if (isApprover) {
        const row = approvers.find((a) => a.user_id === member.user_id)
        if (row) await removeCatalogueApprover(row.id)
      } else {
        await addCatalogueApprover(catalogueId, member.user_id, user.id)
      }
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setTogglingUserId(null)
    }
  }

  return (
    <div className="border-t border-hairline bg-paper p-4 space-y-2">
      {error && <p className="text-xs text-red-700">{error}</p>}
      {loading ? (
        <p className="text-xs text-secondary">Loading users…</p>
      ) : members.length === 0 ? (
        <p className="text-xs text-secondary">No users yet.</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {members.map((m) => {
            const isApprover = approvers.some((a) => a.user_id === m.user_id)
            return (
              <li key={m.user_id} className="flex items-center justify-between gap-2 text-sm py-2">
                <span className="text-ink text-xs truncate">{m.email || m.user_id}</span>
                <label className="flex items-center gap-1.5 text-xs text-secondary shrink-0">
                  <input
                    type="checkbox"
                    checked={isApprover}
                    disabled={togglingUserId === m.user_id}
                    onChange={() => handleToggle(m, isApprover)}
                    className="rounded border-hairline"
                  />
                  Approver
                </label>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
