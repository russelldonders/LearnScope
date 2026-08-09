import { useState } from 'react'
import GrowthRing from './GrowthRing'
import { LEVELS, LEVEL_LABELS } from '../lib/levels'

export default function SkillModal({ skill, categories, onSave, onDelete, onClose }) {
  const isEditing = Boolean(skill?.id)
  const [name, setName] = useState(skill?.name ?? '')
  const [category, setCategory] = useState(skill?.category ?? '')
  const [level, setLevel] = useState(skill?.level ?? 1)
  const [notes, setNotes] = useState(skill?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim() || !category.trim()) {
      setError('Name and category are required.')
      return
    }
    setError(null)
    setSaving(true)
    try {
      await onSave({
        id: skill?.id,
        name: name.trim(),
        category: category.trim(),
        level,
        notes: notes.trim() || null,
      })
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete "${skill.name}"? This can't be undone.`)) return
    setSaving(true)
    try {
      await onDelete(skill.id)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-ink/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        className="w-full max-w-md bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-2xl text-ink mb-4">
          {isEditing ? 'Edit skill' : 'Add a skill'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-secondary mb-1" htmlFor="name">
              Name
            </label>
            <input
              id="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            />
          </div>

          <div>
            <label className="block text-sm text-secondary mb-1" htmlFor="category">
              Category
            </label>
            <input
              id="category"
              required
              list="category-options"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            />
            <datalist id="category-options">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>

          <div>
            <span className="block text-sm text-secondary mb-2">Level</span>
            <div className="flex items-center justify-between">
              {LEVELS.map((l) => (
                <button
                  type="button"
                  key={l}
                  onClick={() => setLevel(l)}
                  className={`flex flex-col items-center gap-1 rounded-md px-1 py-1 ${
                    level === l ? 'bg-moss/10' : ''
                  }`}
                >
                  <GrowthRing level={l} size={40} />
                  <span className="font-mono text-[10px] text-secondary">{LEVEL_LABELS[l]}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm text-secondary mb-1" htmlFor="notes">
              Notes
            </label>
            <textarea
              id="notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Courses, projects, evidence…"
              className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            />
          </div>

          {error && <p className="text-sm text-red-700">{error}</p>}

          <div className="flex items-center gap-2 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-md bg-moss text-paper py-2 font-medium hover:opacity-90 disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-hairline text-ink py-2 px-4 hover:bg-paper"
            >
              Cancel
            </button>
            {isEditing && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={saving}
                className="rounded-md border border-hairline text-red-700 py-2 px-4 hover:bg-paper disabled:opacity-60"
              >
                Delete
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
