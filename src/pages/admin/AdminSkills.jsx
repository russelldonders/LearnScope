import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import AdminLayout from './AdminLayout'
import { listAllLibrarySkills, updateLibrarySkill, setLibrarySkillStatus } from '../../lib/admin/skills'
import { useSortedPage } from '../../lib/useSortedPage'
import { SortableTh, TablePagination } from '../../components/TableControls'

const TYPE_LABELS = { global: 'Global', personal: 'Personal', provider: 'Provider' }

const SKILL_SORT_ACCESSORS = {
  name: (s) => s.name?.toLowerCase() ?? '',
  code: (s) => s.skill_code?.toLowerCase() ?? '',
  type: (s) => TYPE_LABELS[s.type] ?? s.type ?? '',
  status: (s) => s.status ?? '',
}

export default function AdminSkills() {
  const [skills, setSkills] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({ category: '', description: '' })
  const [saving, setSaving] = useState(false)
  const [actioningId, setActioningId] = useState(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      setSkills(await listAllLibrarySkills())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function startEdit(skill) {
    setEditingId(skill.id)
    setEditForm({ category: skill.category ?? '', description: skill.description ?? '' })
  }

  async function handleSaveEdit(skill) {
    setSaving(true)
    setError(null)
    try {
      await updateLibrarySkill(skill.id, {
        category: editForm.category.trim() || null,
        description: editForm.description.trim() || null,
      })
      setEditingId(null)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleStatus(skill) {
    setActioningId(skill.id)
    setError(null)
    try {
      await setLibrarySkillStatus(skill.id, skill.status === 'active' ? 'inactive' : 'active')
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setActioningId(null)
    }
  }

  const q = query.trim().toLowerCase()
  const filtered = q ? skills.filter((s) => s.name.toLowerCase().includes(q)) : skills

  const { sortKey, sortDir, toggleSort, page, setPage, pageSize, setPageSize, pageItems, totalItems } =
    useSortedPage(filtered, SKILL_SORT_ACCESSORS)

  return (
    <AdminLayout>
      <div className="space-y-4">
        <input
          aria-label="Search skills"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search skills…"
          className="w-full rounded-md border border-hairline bg-card px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
        />

        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

        {loading ? (
          <p role="status" className="text-secondary">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-hairline rounded-lg">
            <p className="text-secondary">No skills match.</p>
          </div>
        ) : (
          <div className="bg-card border border-hairline rounded-lg">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-hairline text-left text-secondary">
                    <SortableTh label="Skill" columnKey="name" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortableTh label="Code" columnKey="code" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="whitespace-nowrap" />
                    <SortableTh label="Type" columnKey="type" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="whitespace-nowrap" />
                    <SortableTh label="Status" columnKey="status" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="whitespace-nowrap" />
                    <th className="px-4 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((skill) => (
                    <SkillRow
                      key={skill.id}
                      skill={skill}
                      editing={editingId === skill.id}
                      editForm={editForm}
                      onEditFormChange={setEditForm}
                      saving={saving}
                      actioning={actioningId === skill.id}
                      onStartEdit={() => startEdit(skill)}
                      onCancelEdit={() => setEditingId(null)}
                      onSaveEdit={() => handleSaveEdit(skill)}
                      onToggleStatus={() => handleToggleStatus(skill)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <TablePagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} totalItems={totalItems} idPrefix="admin-skills" />
          </div>
        )}
      </div>
    </AdminLayout>
  )
}

function SkillRow({ skill, editing, editForm, onEditFormChange, saving, actioning, onStartEdit, onCancelEdit, onSaveEdit, onToggleStatus }) {
  return (
    <>
      <tr className="border-b border-hairline last:border-0 align-top">
        <td className="px-4 py-3">
          <p className="text-ink font-medium">
            <Link to={`/admin/skills/${skill.id}`} className="hover:text-moss hover:underline">
              {skill.name}
            </Link>
            {skill.is_private && (
              <span className="ml-1.5 font-mono text-[10px] uppercase tracking-wide text-secondary border border-hairline rounded-full px-1.5 py-0.5">
                Private
              </span>
            )}
          </p>
          <p className="text-xs text-secondary mt-0.5">
            {skill.category || 'No category'}
            {skill.description ? ` — ${skill.description}` : ''}
          </p>
        </td>
        <td className="px-4 py-3 font-mono text-xs text-secondary whitespace-nowrap">{skill.skill_code}</td>
        <td className="px-4 py-3 text-secondary whitespace-nowrap">
          {TYPE_LABELS[skill.type]}
          {skill.ownerName ? ` · ${skill.ownerName}` : ''}
        </td>
        <td className="px-4 py-3 whitespace-nowrap">
          <span
            className={`font-mono text-[10px] uppercase tracking-wide rounded-full px-2 py-0.5 border ${
              skill.status === 'inactive' ? 'border-red-300 text-red-700' : 'border-hairline text-secondary'
            }`}
          >
            {skill.status}
          </span>
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2 justify-end">
            <button type="button" onClick={onStartEdit} className="rounded-md border border-hairline text-ink py-1 px-3 text-xs font-medium hover:bg-paper whitespace-nowrap">
              Edit
            </button>
            <button
              type="button"
              disabled={actioning}
              onClick={onToggleStatus}
              className="rounded-md border border-hairline text-ink py-1 px-3 text-xs font-medium hover:bg-paper disabled:opacity-50 whitespace-nowrap"
            >
              {skill.status === 'active' ? 'Deactivate' : 'Reactivate'}
            </button>
          </div>
        </td>
      </tr>
      {editing && (
        <tr className="border-b border-hairline last:border-0">
          <td colSpan={5} className="px-4 pb-4 pt-1">
            <div className="space-y-2 border-t border-hairline pt-3">
              <div>
                <label className="block text-xs text-secondary mb-1">Category</label>
                <input
                  value={editForm.category}
                  onChange={(e) => onEditFormChange((f) => ({ ...f, category: e.target.value }))}
                  className="w-full rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                />
              </div>
              <div>
                <label className="block text-xs text-secondary mb-1">Description</label>
                <textarea
                  rows={2}
                  value={editForm.description}
                  onChange={(e) => onEditFormChange((f) => ({ ...f, description: e.target.value }))}
                  className="w-full rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={onSaveEdit}
                  className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button type="button" onClick={onCancelEdit} className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm hover:bg-paper">
                  Cancel
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
