import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import AdminLayout from './AdminLayout'
import { listAllLibrarySkills, updateLibrarySkill, setLibrarySkillStatus } from '../../lib/admin/skills'

const TYPE_LABELS = { global: 'Global', personal: 'Personal', provider: 'Provider' }

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
        ) : (
          <div className="bg-card border border-hairline rounded-lg divide-y divide-hairline">
            {filtered.map((skill) => (
              <div key={skill.id} className="p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
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
                    <p className="font-mono text-[10px] uppercase tracking-wide text-secondary mt-1">
                      {TYPE_LABELS[skill.type]}
                      {skill.ownerName ? ` · ${skill.ownerName}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`font-mono text-[10px] uppercase tracking-wide rounded-full px-2 py-0.5 border ${
                        skill.status === 'inactive' ? 'border-red-300 text-red-700' : 'border-hairline text-secondary'
                      }`}
                    >
                      {skill.status}
                    </span>
                    <button
                      type="button"
                      onClick={() => startEdit(skill)}
                      className="rounded-md border border-hairline text-ink py-1 px-3 text-xs font-medium hover:bg-paper"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={actioningId === skill.id}
                      onClick={() => handleToggleStatus(skill)}
                      className="rounded-md border border-hairline text-ink py-1 px-3 text-xs font-medium hover:bg-paper disabled:opacity-50"
                    >
                      {skill.status === 'active' ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </div>
                </div>

                {editingId === skill.id && (
                  <div className="mt-3 space-y-2 border-t border-hairline pt-3">
                    <div>
                      <label className="block text-xs text-secondary mb-1">Category</label>
                      <input
                        value={editForm.category}
                        onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))}
                        className="w-full rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-secondary mb-1">Description</label>
                      <textarea
                        rows={2}
                        value={editForm.description}
                        onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                        className="w-full rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => handleSaveEdit(skill)}
                        className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
                      >
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm hover:bg-paper"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {filtered.length === 0 && (
              <p className="p-4 text-center text-secondary">No skills match.</p>
            )}
          </div>
        )}
      </div>
    </AdminLayout>
  )
}
