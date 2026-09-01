import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  listOrganisationOfferedSkills,
  createProviderLibrarySkill,
  addOfferedSkill,
  removeOfferedSkill,
} from '../lib/admin/providerSkills'
import { listLibrarySkills, isDuplicateLibrarySkillError, duplicateLibrarySkillMessage } from '../lib/skillLibrary'
import { useSortedPage } from '../lib/useSortedPage'
import { SortableTh, TablePagination } from './TableControls'

const EMPTY_FORM = { name: '', category: '', description: '' }

const OFFERED_SKILL_SORT_ACCESSORS = {
  skillCode: (item) => item.skillCode?.toLowerCase() ?? '',
  name: (item) => item.name?.toLowerCase() ?? '',
  category: (item) => item.category?.toLowerCase() ?? '',
  description: (item) => item.description?.toLowerCase() ?? '',
  source: (item) => (item.isOwnOrgSkill ? 'Your organisation' : 'Shared library'),
}

// The provider console's "Skills" tab: the primary list is this org's
// offered-skills roster (organisation_offered_skills, 0076) -- skills
// already created/linked, not a raw browse-everything view. "+ Add global
// skill" opens a search over the shared public library to add more; "+
// Create skill" adds a brand-new organisation-only skill (auto-added to the
// roster on creation, since only this org can ever see it otherwise).
export default function ProviderSkillsSection({ organisationId, userId }) {
  const [offered, setOffered] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [showCreateForm, setShowCreateForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [creating, setCreating] = useState(false)

  const [showAddGlobal, setShowAddGlobal] = useState(false)
  const [globalSkills, setGlobalSkills] = useState([])
  const [globalLoading, setGlobalLoading] = useState(false)
  const [globalQuery, setGlobalQuery] = useState('')
  const [addingId, setAddingId] = useState(null)

  const [removingId, setRemovingId] = useState(null)
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')

  useEffect(() => {
    load()
  }, [organisationId])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      setOffered(await listOrganisationOfferedSkills(organisationId))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleOpenAddGlobal() {
    const opening = !showAddGlobal
    setShowAddGlobal(opening)
    if (opening && globalSkills.length === 0) {
      setGlobalLoading(true)
      try {
        setGlobalSkills(await listLibrarySkills())
      } catch (err) {
        setError(err.message)
      } finally {
        setGlobalLoading(false)
      }
    }
  }

  async function handleCreate(e) {
    e.preventDefault()
    if (!form.name.trim()) return
    setCreating(true)
    setError(null)
    try {
      await createProviderLibrarySkill(userId, organisationId, form)
      setForm(EMPTY_FORM)
      setShowCreateForm(false)
      await load()
    } catch (err) {
      setError(isDuplicateLibrarySkillError(err) ? duplicateLibrarySkillMessage(err, form.name) : err.message)
    } finally {
      setCreating(false)
    }
  }

  async function handleAddGlobal(skill) {
    setAddingId(skill.id)
    setError(null)
    try {
      await addOfferedSkill(organisationId, skill.id, userId)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setAddingId(null)
    }
  }

  async function handleRemove(item) {
    setRemovingId(item.skillLibraryId)
    setError(null)
    try {
      await removeOfferedSkill(organisationId, item.skillLibraryId)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setRemovingId(null)
    }
  }

  const offeredIds = new Set(offered.map((o) => o.skillLibraryId))
  const gq = globalQuery.trim().toLowerCase()
  const globalResults = globalSkills
    .filter((s) => !offeredIds.has(s.id))
    .filter((s) => !gq || s.name.toLowerCase().includes(gq))
  const categories = useMemo(
    () => [...new Set(offered.map((item) => item.category).filter(Boolean))].sort(),
    [offered]
  )
  const filteredOffered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return offered.filter(
      (item) =>
        (categoryFilter === 'all' || item.category === categoryFilter) &&
        (!needle || [item.name, item.category, item.description].filter(Boolean).some((value) => value.toLowerCase().includes(needle)))
    )
  }, [offered, query, categoryFilter])

  const { sortKey, sortDir, toggleSort, page, setPage, pageSize, setPageSize, pageItems, totalItems } =
    useSortedPage(filteredOffered, OFFERED_SKILL_SORT_ACCESSORS)

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <h3 className="font-display text-lg text-ink">Skills</h3>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleOpenAddGlobal}
            className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper"
          >
            {showAddGlobal ? 'Cancel' : '+ Add global skill'}
          </button>
          <button
            type="button"
            onClick={() => setShowCreateForm((v) => !v)}
            className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90"
          >
            {showCreateForm ? 'Cancel' : '+ Create skill'}
          </button>
        </div>
      </div>
      <p className="text-sm text-secondary mb-4">
        The skills your organisation offers training in. Add existing skills from the shared library, or create one
        specific to your organisation.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_220px] gap-2 mb-4" role="search">
        <label className="sr-only" htmlFor="providerSkillSearch">Search skills</label>
        <input
          id="providerSkillSearch"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search skills…"
          className="w-full rounded-md border border-hairline bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
        />
        <label className="sr-only" htmlFor="providerSkillCategoryFilter">Filter skills by category</label>
        <select
          id="providerSkillCategoryFilter"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="w-full rounded-md border border-hairline bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
        >
          <option value="all">All categories</option>
          {categories.map((category) => <option key={category} value={category}>{category}</option>)}
        </select>
      </div>

      {showAddGlobal && (
        <div className="bg-card border border-hairline rounded-lg p-4 mb-4">
          <input
            type="text"
            value={globalQuery}
            onChange={(e) => setGlobalQuery(e.target.value)}
            placeholder="Search the shared skill library…"
            className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-moss"
          />
          {globalLoading ? (
            <p className="text-sm text-secondary">Loading…</p>
          ) : globalResults.length === 0 ? (
            <p className="text-sm text-secondary">No matching skills.</p>
          ) : (
            <ul className="divide-y divide-hairline max-h-64 overflow-y-auto">
              {globalResults.slice(0, 50).map((skill) => (
                <li key={skill.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="text-ink truncate">{skill.name}</p>
                    {skill.category && <p className="text-xs text-secondary">{skill.category}</p>}
                  </div>
                  <button
                    type="button"
                    disabled={addingId === skill.id}
                    onClick={() => handleAddGlobal(skill)}
                    className="rounded-md border border-hairline text-ink py-1 px-3 text-xs font-medium hover:bg-paper disabled:opacity-50 shrink-0"
                  >
                    {addingId === skill.id ? 'Adding…' : 'Add'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {showCreateForm && (
        <form onSubmit={handleCreate} className="bg-card border border-hairline rounded-lg p-4 space-y-3 mb-4">
          <p className="text-xs text-secondary">
            Only your organisation can see and offer a skill created here — it won't appear in the public library.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-secondary mb-1" htmlFor="providerSkillName">
                Name
              </label>
              <input
                id="providerSkillName"
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              />
            </div>
            <div>
              <label className="block text-sm text-secondary mb-1" htmlFor="providerSkillCategory">
                Category
              </label>
              <input
                id="providerSkillCategory"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm text-secondary mb-1" htmlFor="providerSkillDescription">
                Description
              </label>
              <textarea
                id="providerSkillDescription"
                rows={2}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              />
            </div>
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
      ) : offered.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-hairline rounded-lg">
          <p className="text-secondary">No skills added yet.</p>
        </div>
      ) : filteredOffered.length === 0 ? (
        <div className="text-center py-10 border border-dashed border-hairline rounded-lg">
          <p className="text-secondary">No skills match these filters.</p>
        </div>
      ) : (
        <div className="bg-card border border-hairline rounded-lg">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-secondary">
                  <SortableTh label="ID" columnKey="skillCode" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="whitespace-nowrap" />
                  <SortableTh label="Skill" columnKey="name" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Category" columnKey="category" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="whitespace-nowrap" />
                  <SortableTh label="Description" columnKey="description" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Source" columnKey="source" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="whitespace-nowrap" />
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((item) => (
                  <tr key={item.offeredId} className="border-b border-hairline last:border-0">
                    <td className="px-4 py-3 font-mono text-xs text-secondary whitespace-nowrap">{item.skillCode}</td>
                    <td className="px-4 py-3 text-ink font-medium whitespace-nowrap">{item.name}</td>
                    <td className="px-4 py-3 text-secondary whitespace-nowrap">{item.category || '—'}</td>
                    <td className="px-4 py-3 text-secondary truncate max-w-[220px]">{item.description || '—'}</td>
                    <td className="px-4 py-3 text-secondary whitespace-nowrap">{item.isOwnOrgSkill ? 'Your organisation' : 'Shared library'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3 justify-end">
                        <Link
                          to={`/provider/organisations/${organisationId}/skills/${item.skillLibraryId}`}
                          className="text-xs font-medium text-moss hover:underline whitespace-nowrap"
                        >
                          Manage alignment
                        </Link>
                        <button
                          type="button"
                          disabled={removingId === item.skillLibraryId}
                          onClick={() => handleRemove(item)}
                          className="text-xs text-red-700 hover:underline disabled:opacity-50 whitespace-nowrap"
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} totalItems={totalItems} idPrefix="provider-skills" />
        </div>
      )}

    </div>
  )
}
