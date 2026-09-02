import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import AdminLayout from './AdminLayout'
import ConfirmDialog from '../../components/ConfirmDialog'
import StatusBadge from '../../components/StatusBadge'
import { listAllLibrarySkills, updateLibrarySkill, setLibrarySkillStatus } from '../../lib/admin/skills'
import { SKILL_TYPE_LABELS } from '../../lib/statusLabels'
import { useColumnPreferences, useRowSelection, useSortedPage } from '../../lib/useSortedPage'
import { BulkActionBar, ColumnCustomizer, SelectionTh, SortableTh, TablePagination } from '../../components/TableControls'

const SKILL_SORT_ACCESSORS = {
  code: (s) => s.skill_code?.toLowerCase() ?? '',
  name: (s) => s.name?.toLowerCase() ?? '',
  category: (s) => s.category?.toLowerCase() ?? '',
  description: (s) => s.description?.toLowerCase() ?? '',
  visibility: (s) => (s.is_private ? 'Private' : 'Public'),
  type: (s) => SKILL_TYPE_LABELS[s.type] ?? s.type ?? '',
  owner: (s) => s.ownerName?.toLowerCase() ?? '',
  status: (s) => s.status ?? '',
}

// Customizable data columns only -- the selection checkbox (first) and the
// per-row action buttons (last) stay pinned outside this list.
const SKILL_COLUMNS = [
  {
    key: 'code',
    label: 'ID',
    sortable: true,
    thClassName: 'whitespace-nowrap',
    cellClassName: 'px-4 py-3 font-mono text-xs text-secondary whitespace-nowrap',
    renderCell: (s) => s.skill_code,
  },
  {
    key: 'name',
    label: 'Skill',
    sortable: true,
    cellClassName: 'px-4 py-3 text-ink font-medium whitespace-nowrap',
    renderCell: (s) => (
      <Link to={`/admin/skills/${s.id}`} className="hover:text-moss hover:underline">
        {s.name}
      </Link>
    ),
  },
  {
    key: 'category',
    label: 'Category',
    sortable: true,
    thClassName: 'whitespace-nowrap',
    cellClassName: 'px-4 py-3 text-secondary whitespace-nowrap',
    renderCell: (s) => s.category || '—',
  },
  {
    key: 'description',
    label: 'Description',
    sortable: true,
    cellClassName: 'px-4 py-3 text-secondary truncate max-w-[220px]',
    renderCell: (s) => s.description || '—',
  },
  {
    key: 'visibility',
    label: 'Visibility',
    sortable: true,
    thClassName: 'whitespace-nowrap',
    cellClassName: 'px-4 py-3 text-secondary whitespace-nowrap',
    renderCell: (s) => (s.is_private ? 'Private' : 'Public'),
  },
  {
    key: 'type',
    label: 'Type',
    sortable: true,
    thClassName: 'whitespace-nowrap',
    cellClassName: 'px-4 py-3 text-secondary whitespace-nowrap',
    renderCell: (s) => SKILL_TYPE_LABELS[s.type],
  },
  {
    key: 'owner',
    label: 'Owner',
    sortable: true,
    thClassName: 'whitespace-nowrap',
    cellClassName: 'px-4 py-3 text-secondary whitespace-nowrap',
    renderCell: (s) => s.ownerName || '—',
  },
  {
    key: 'status',
    label: 'Status',
    sortable: true,
    thClassName: 'whitespace-nowrap',
    cellClassName: 'px-4 py-3 whitespace-nowrap',
    renderCell: (s) => (
      <StatusBadge label={s.status} tone={s.status === 'inactive' ? 'danger' : 'neutral'} />
    ),
  },
]

export default function AdminSkills() {
  const [skills, setSkills] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({ category: '', description: '' })
  const [saving, setSaving] = useState(false)
  const [actioningId, setActioningId] = useState(null)
  const [bulkAction, setBulkAction] = useState(null)
  const [bulkActing, setBulkActing] = useState(false)

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

  async function handleBulkStatusChange() {
    const { targets, status } = bulkAction
    setBulkActing(true)
    setError(null)
    try {
      const results = await Promise.allSettled(targets.map((skill) => setLibrarySkillStatus(skill.id, status)))
      const failures = results
        .map((result, index) => ({ result, skill: targets[index] }))
        .filter(({ result }) => result.status === 'rejected')
      const succeededIds = targets
        .filter((_, index) => results[index].status === 'fulfilled')
        .map((skill) => skill.id)
      setBulkAction(null)
      // Full success clears the whole selection; a partial failure keeps
      // the still-unchanged skills selected so they're easy to retry.
      if (failures.length > 0) selection.clearIds(succeededIds)
      else selection.clear()
      await load()
      if (failures.length > 0) {
        setError(
          `${failures.length} of ${targets.length} skills couldn't be updated: ` +
            failures.map(({ skill, result }) => `"${skill.name}" (${result.reason?.message ?? 'unknown error'})`).join('; ')
        )
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBulkActing(false)
    }
  }

  const q = query.trim().toLowerCase()
  const filtered = q ? skills.filter((s) => s.name.toLowerCase().includes(q)) : skills

  const { sortKey, sortDir, toggleSort, page, setPage, pageSize, setPageSize, pageItems, totalItems } =
    useSortedPage(filtered, SKILL_SORT_ACCESSORS)
  const { columns, visibleColumns, toggleColumn, moveColumn, resetToDefault } =
    useColumnPreferences('admin-skills', SKILL_COLUMNS)
  const selection = useRowSelection(filtered.map((s) => s.id))
  const selectedSkills = useMemo(() => filtered.filter((s) => selection.selected.has(s.id)), [filtered, selection.selected])
  const selectedToActivate = useMemo(() => selectedSkills.filter((s) => s.status !== 'active'), [selectedSkills])
  const selectedToDeactivate = useMemo(() => selectedSkills.filter((s) => s.status === 'active'), [selectedSkills])
  const pageIds = pageItems.map((s) => s.id)
  const selectedOnPage = pageIds.filter((id) => selection.selected.has(id)).length

  return (
    <AdminLayout>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <input
            aria-label="Search skills"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search skills…"
            className="w-full rounded-md border border-hairline bg-card px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
          />
          <ColumnCustomizer
            idPrefix="admin-skills"
            columns={columns}
            onToggle={toggleColumn}
            onMove={moveColumn}
            onReset={resetToDefault}
          />
        </div>

        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

        {loading ? (
          <p role="status" className="text-secondary">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-hairline rounded-lg">
            <p className="text-secondary">No skills match.</p>
          </div>
        ) : (
          <div className="bg-card border border-hairline rounded-lg">
            <div className="p-3 pb-0">
              <BulkActionBar
                count={selection.selected.size}
                onClear={selection.clear}
                busy={bulkActing}
                actions={[
                  {
                    label: `Activate selected (${selectedToActivate.length})`,
                    disabled: selectedToActivate.length === 0,
                    title: selectedToActivate.length === 0 ? 'Every selected skill is already active' : undefined,
                    onClick: () => setBulkAction({ targets: selectedToActivate, status: 'active' }),
                  },
                  {
                    label: `Deactivate selected (${selectedToDeactivate.length})`,
                    disabled: selectedToDeactivate.length === 0,
                    title: selectedToDeactivate.length === 0 ? 'None of the selected skills are active' : undefined,
                    onClick: () => setBulkAction({ targets: selectedToDeactivate, status: 'inactive' }),
                  },
                ]}
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-hairline text-left text-secondary">
                    <SelectionTh
                      idPrefix="admin-skills"
                      checked={selection.isAllSelected(pageIds)}
                      indeterminate={selectedOnPage > 0 && selectedOnPage < pageIds.length}
                      onChange={() => selection.toggleAll(pageIds)}
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
                  {pageItems.map((skill) => (
                    <SkillRow
                      key={skill.id}
                      skill={skill}
                      visibleColumns={visibleColumns}
                      selected={selection.selected.has(skill.id)}
                      onToggleSelected={() => selection.toggle(skill.id)}
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

      {bulkAction && (
        <ConfirmDialog
          message={
            bulkAction.status === 'active'
              ? `Activate ${bulkAction.targets.length} ${bulkAction.targets.length === 1 ? 'skill' : 'skills'}?`
              : `Deactivate ${bulkAction.targets.length} ${bulkAction.targets.length === 1 ? 'skill' : 'skills'}?`
          }
          confirmLabel={bulkAction.status === 'active' ? 'Activate' : 'Deactivate'}
          confirming={bulkActing}
          onConfirm={handleBulkStatusChange}
          onCancel={() => setBulkAction(null)}
        />
      )}
    </AdminLayout>
  )
}

function SkillRow({ skill, visibleColumns, selected, onToggleSelected, editing, editForm, onEditFormChange, saving, actioning, onStartEdit, onCancelEdit, onSaveEdit, onToggleStatus }) {
  return (
    <>
      <tr className="border-b border-hairline last:border-0">
        <td className="px-4 py-3">
          <label className="sr-only" htmlFor={`select-skill-${skill.id}`}>Select {skill.name}</label>
          <input
            id={`select-skill-${skill.id}`}
            type="checkbox"
            checked={selected}
            onChange={onToggleSelected}
            className="rounded border-hairline accent-moss"
          />
        </td>
        {visibleColumns.map((col) => (
          <td key={col.key} className={col.cellClassName}>
            {col.renderCell(skill)}
          </td>
        ))}
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
          <td colSpan={visibleColumns.length + 2} className="px-4 pb-4 pt-1">
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
