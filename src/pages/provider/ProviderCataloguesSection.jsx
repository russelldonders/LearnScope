import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import ConfirmDialog from '../../components/ConfirmDialog'
import {
  createProviderCatalogue,
  deleteProviderCatalogue,
} from '../../lib/catalogues'
// listProviderCatalogues attaches courseCount (course_catalogue_publications
// count) to each row, which the bulk-delete confirmation below needs to warn
// accurately about live courses.
import { listProviderCatalogues, listLinkableCatalogues, linkCatalogueToOrganisation, unlinkCatalogueFromOrganisation } from '../../lib/admin/providerCatalogues'
import { useRowSelection, useSortedPage } from '../../lib/useSortedPage'
import { BulkActionBar, SelectionTh, SortableTh, TablePagination } from '../../components/TableControls'

import { CATALOGUE_SORT_ACCESSORS, buildBulkCatalogueDeleteMessage } from '../../lib/providerTraining'

// Exported so the employer console (src/pages/employer/EmployerConsole.jsx)
// can reuse the same catalogue-authoring UI verbatim, scoped to the
// employer's own auto-provisioned attached provider organisation -- this
// component only ever reads/writes off organisation.id, so no fork is
// needed.
export default function ProviderCataloguesSection({ organisation, userId, canCreate, readOnly = false, detailContext = '' }) {
  // readOnly (employer console reuse) always wins over canCreate -- an
  // employer admin genuinely has the provider org role canCreate is
  // derived from, but authoring here is disabled regardless; see
  // ProviderTrainingSection's identical canModerate/showCreateUI pattern
  // below for the same reasoning.
  const showCreateUI = canCreate && !readOnly
  const [catalogues, setCatalogues] = useState([])
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', learnerVisible: false })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [bulkDeleteTargets, setBulkDeleteTargets] = useState(null)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  // Search-and-link widget for offering another provider's existing
  // catalogue alongside this org's own (catalogue_links, 20260905180000) --
  // local state only, mirrors EmployerProvidersPanel's identical "search
  // organisations to link" widget in EmployerConsole.jsx.
  const [linkQuery, setLinkQuery] = useState('')
  const [linkMatches, setLinkMatches] = useState([])
  const [linkingId, setLinkingId] = useState(null)
  const [unlinkTarget, setUnlinkTarget] = useState(null)
  const [unlinking, setUnlinking] = useState(false)

  const { sortKey, sortDir, toggleSort, page, setPage, pageSize, setPageSize, pageItems, totalItems } =
    useSortedPage(catalogues, CATALOGUE_SORT_ACCESSORS)
  // Only this org's own catalogues are selectable for bulk delete -- a
  // linked one belongs to another org (RLS would reject deleting it
  // anyway), it only ever gets unlinked, one at a time, below.
  const selection = useRowSelection(catalogues.filter((c) => c.isOwn).map((c) => c.id))
  const pageOwnIds = pageItems.filter((c) => c.isOwn).map((c) => c.id)
  const selectedOnPage = pageOwnIds.filter((id) => selection.selected.has(id)).length

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the listed values change; the loaders are recreated every render
  }, [organisation.id])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      setCatalogues(await listProviderCatalogues(organisation.id))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    setError(null)
    try {
      await createProviderCatalogue(userId, organisation.id, form)
      setForm({ name: '', description: '', learnerVisible: false })
      setShowCreateForm(false)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // "Link a catalogue" -- searches every provider's own catalogues (already
  // fully readable by any authenticated user, 0111) except this org's own
  // and any it's already linked (listLinkableCatalogues excludes both
  // server-side); no debounce, matching every other inline search box in
  // this console.
  useEffect(() => {
    const q = linkQuery.trim()
    if (!q) {
      setLinkMatches([])
      return
    }
    let cancelled = false
    listLinkableCatalogues(organisation.id, q)
      .then((matches) => {
        if (!cancelled) setLinkMatches(matches)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [linkQuery, organisation.id])

  async function handleLink(catalogue) {
    setLinkingId(catalogue.id)
    setError(null)
    try {
      await linkCatalogueToOrganisation(catalogue.id, organisation.id, userId)
      setLinkQuery('')
      setLinkMatches([])
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setLinkingId(null)
    }
  }

  async function handleUnlink() {
    setUnlinking(true)
    setError(null)
    try {
      await unlinkCatalogueFromOrganisation(unlinkTarget.linkId)
      setUnlinkTarget(null)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setUnlinking(false)
    }
  }

  async function handleBulkDelete() {
    const targets = bulkDeleteTargets
    setBulkDeleting(true)
    setError(null)
    try {
      const results = await Promise.allSettled(targets.map((catalogue) => deleteProviderCatalogue(catalogue.id)))
      const failures = results
        .map((result, index) => ({ result, catalogue: targets[index] }))
        .filter(({ result }) => result.status === 'rejected')
      const succeededIds = targets
        .filter((_, index) => results[index].status === 'fulfilled')
        .map((catalogue) => catalogue.id)
      setBulkDeleteTargets(null)
      // Full success clears the whole selection; a partial failure keeps
      // the still-undeleted catalogues selected so they're easy to retry.
      if (failures.length > 0) selection.clearIds(succeededIds)
      else selection.clear()
      await load()
      if (failures.length > 0) {
        setError(
          `${failures.length} of ${targets.length} catalogues couldn't be deleted: ` +
            failures
              .map(({ catalogue, result }) => `"${catalogue.name}" (${result.reason?.message ?? 'unknown error'})`)
              .join('; ')
        )
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBulkDeleting(false)
    }
  }

  return (
    <section aria-labelledby="provider-catalogues-heading">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <h2 id="provider-catalogues-heading" className="font-display text-lg text-ink">Provider catalogues</h2>
        {showCreateUI && (
          <button
            type="button"
            onClick={() => setShowCreateForm((v) => !v)}
            className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 shrink-0"
          >
            {showCreateForm ? 'Cancel' : '+ Create catalogue'}
          </button>
        )}
      </div>
      <p className="text-sm text-secondary mb-5 max-w-2xl">
        Organise published training into named collections. Your catalogues and the platform-managed Global catalogue are available whenever a course is submitted. Each catalogue can have its own approvers, picked from your organisation's own users, so training destined for it can be approved without a platform admin.
      </p>

      {error && <p role="alert" className="text-sm text-red-700 mb-4">{error}</p>}

      {showCreateUI && showCreateForm && <form onSubmit={handleSubmit} className="bg-card border border-hairline rounded-lg p-4 mb-6">
        <h3 className="text-sm font-medium text-ink mb-3">Create a catalogue</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-xs text-secondary">
            Name
            <input required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className="mt-1 w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss" />
          </label>
          <label className="text-xs text-secondary">
            Description (optional)
            <input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} className="mt-1 w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss" />
          </label>
        </div>
        <label className="flex items-start gap-2 mt-3 text-sm text-ink">
          <input
            type="checkbox"
            checked={form.learnerVisible}
            onChange={(event) => setForm((current) => ({ ...current, learnerVisible: event.target.checked }))}
            className="mt-0.5 rounded border-hairline accent-moss"
          />
          <span>
            Learner-facing
            <span className="block text-xs text-secondary">
              Its courses can appear on your public provider profile. Leave unchecked to keep this catalogue
              backend-only, for admin-driven assignment only.
            </span>
          </span>
        </label>
        <div className="flex gap-2 mt-3">
          <button disabled={saving || !form.name.trim()} className="rounded-md bg-moss px-3 py-1.5 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-50">
            {saving ? 'Saving…' : 'Create catalogue'}
          </button>
          <button type="button" onClick={() => { setShowCreateForm(false); setForm({ name: '', description: '', learnerVisible: false }) }} className="rounded-md border border-hairline px-3 py-1.5 text-sm text-ink hover:bg-paper">Cancel</button>
        </div>
      </form>}

      {showCreateUI && (
        <div className="bg-card border border-hairline rounded-lg p-4 mb-6 relative">
          <label className="block text-xs text-secondary mb-1" htmlFor="providerLinkCatalogueSearch">
            Link a catalogue from another provider
          </label>
          <input
            id="providerLinkCatalogueSearch"
            value={linkQuery}
            onChange={(event) => setLinkQuery(event.target.value)}
            placeholder="Search catalogues by name…"
            autoComplete="off"
            className="w-full max-w-md rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
          />
          {linkQuery.trim() && (
            <div className="mt-1 w-full max-w-md bg-card border border-hairline rounded-md max-h-56 overflow-y-auto">
              {linkMatches.length === 0 ? (
                <p className="px-3 py-2 text-xs text-secondary">No matching catalogues to link.</p>
              ) : (
                linkMatches.map((match) => (
                  <div key={match.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm border-b border-hairline last:border-0">
                    <div className="min-w-0">
                      <p className="text-ink truncate">{match.name}</p>
                      <p className="text-[10px] text-secondary truncate">{match.organisations?.name || 'Unknown provider'}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleLink(match)}
                      disabled={linkingId === match.id}
                      className="text-xs text-moss hover:underline disabled:opacity-60 shrink-0"
                    >
                      {linkingId === match.id ? 'Linking…' : 'Link'}
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <p role="status" className="text-sm text-secondary">Loading catalogues…</p>
      ) : catalogues.length === 0 ? (
        <div className="rounded-lg border border-dashed border-hairline py-10 text-center">
          <p className="text-sm text-secondary">No provider catalogues yet.</p>
        </div>
      ) : (
        <div className="bg-card border border-hairline rounded-lg">
          {!readOnly && (
            <div className="p-3 pb-0">
              <BulkActionBar
                count={selection.selected.size}
                onClear={selection.clear}
                busy={bulkDeleting}
                actions={[
                  {
                    label: `Delete selected (${selection.selected.size})`,
                    variant: 'danger',
                    onClick: () => setBulkDeleteTargets(catalogues.filter((c) => selection.selected.has(c.id))),
                  },
                ]}
              />
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-secondary">
                  {!readOnly && (
                    <SelectionTh
                      idPrefix="provider-catalogues"
                      checked={selection.isAllSelected(pageOwnIds)}
                      indeterminate={selectedOnPage > 0 && selectedOnPage < pageOwnIds.length}
                      onChange={() => selection.toggleAll(pageOwnIds)}
                    />
                  )}
                  <SortableTh label="ID" columnKey="id" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="whitespace-nowrap" />
                  <SortableTh label="Catalogue" columnKey="name" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <th className="px-4 py-2 font-medium whitespace-nowrap">Source</th>
                  <th className="px-4 py-2 font-medium whitespace-nowrap">Visibility</th>
                  <SortableTh label="Description" columnKey="description" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <th className="px-4 py-2 font-medium whitespace-nowrap">Courses</th>
                  <th className="px-4 py-2 font-medium whitespace-nowrap">Users</th>
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((catalogue) => (
                  <tr key={catalogue.id} className="border-b border-hairline last:border-0">
                    {!readOnly && (
                      <td className="px-4 py-3">
                        {catalogue.isOwn && (
                          <>
                            <label className="sr-only" htmlFor={`select-catalogue-${catalogue.id}`}>Select {catalogue.name}</label>
                            <input
                              id={`select-catalogue-${catalogue.id}`}
                              type="checkbox"
                              checked={selection.selected.has(catalogue.id)}
                              onChange={() => selection.toggle(catalogue.id)}
                              className="rounded border-hairline accent-moss"
                            />
                          </>
                        )}
                      </td>
                    )}
                    <td className="px-4 py-3 font-mono text-xs text-secondary whitespace-nowrap">{catalogue.id.slice(0, 8)}</td>
                    <td className="px-4 py-3 text-ink font-medium whitespace-nowrap">{catalogue.name}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {catalogue.isOwn ? (
                        <span className="text-xs text-secondary">Own</span>
                      ) : (
                        <span className="text-xs text-gold" title={`Linked from ${catalogue.ownerOrganisationName || 'another provider'}`}>
                          Linked{catalogue.ownerOrganisationName ? ` · ${catalogue.ownerOrganisationName}` : ''}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-secondary">
                      {catalogue.learner_visible ? 'Learner-facing' : 'Backend only'}
                    </td>
                    <td className="px-4 py-3 text-secondary truncate max-w-xs">{catalogue.description || '—'}</td>
                    <td className="px-4 py-3 text-secondary whitespace-nowrap">{catalogue.courseCount}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {/* Straight to the "Manage users & approvers" settings panel (under
                          the catalogue's cog menu) -- this is a catalogue's own admins/
                          approvers (who can approve courses into it), not learners. */}
                      <Link to={`/organisation/catalogues/${catalogue.id}?tab=users${detailContext}`} className="text-xs font-medium text-moss hover:underline">
                        {catalogue.userCount} user{catalogue.userCount === 1 ? '' : 's'}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-x-3 whitespace-nowrap">
                        <Link to={`/organisation/catalogues/${catalogue.id}${detailContext ? `?${detailContext.slice(1)}` : ''}`} className="text-xs font-medium text-moss hover:underline">
                          Open catalogue →
                        </Link>
                        {!catalogue.isOwn && !readOnly && (
                          <button
                            type="button"
                            onClick={() => setUnlinkTarget(catalogue)}
                            className="text-xs font-medium text-red-700 hover:underline"
                          >
                            Unlink
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} totalItems={totalItems} idPrefix="provider-catalogues" />
        </div>
      )}

      {unlinkTarget && (
        <ConfirmDialog
          message={`Unlink "${unlinkTarget.name}" from ${organisation.name || 'your organisation'}? It stays owned by ${unlinkTarget.ownerOrganisationName || 'the other provider'} — this only stops offering it alongside your own catalogues.`}
          confirmLabel="Unlink"
          onConfirm={handleUnlink}
          onCancel={() => setUnlinkTarget(null)}
          confirming={unlinking}
        />
      )}

      {bulkDeleteTargets && (
        <ConfirmDialog
          message={buildBulkCatalogueDeleteMessage(bulkDeleteTargets)}
          confirmLabel="Delete"
          onConfirm={handleBulkDelete}
          onCancel={() => setBulkDeleteTargets(null)}
          confirming={bulkDeleting}
        />
      )}
    </section>
  )
}
