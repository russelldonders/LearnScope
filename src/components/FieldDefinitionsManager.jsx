import { useState } from 'react'
import ConfirmDialog from './ConfirmDialog'

const FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Long text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'select', label: 'Choice list' },
  { value: 'boolean', label: 'Yes/no' },
  { value: 'email', label: 'Email' },
]

function slugify(label) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

const EMPTY_FORM = { label: '', fieldType: 'text', required: false, optionsText: '' }

function formToPayload(form) {
  return {
    label: form.label.trim(),
    fieldType: form.fieldType,
    required: form.required,
    options: form.fieldType === 'select'
      ? form.optionsText.split('\n').map((o) => o.trim()).filter(Boolean)
      : null,
  }
}

// Shared schema-builder UI for both tiers of employer roster fields
// (20260911130000): platform admin's global "base" fields (AdminEmployers.jsx)
// and one employer's own additional fields (EmployerMemberFieldsSection.jsx).
// Deliberately one component -- the create/edit/delete/reorder shape is
// identical for both; only which rows/callbacks the caller passes in differ.
export default function FieldDefinitionsManager({ fields, scopeLabel, onCreate, onUpdate, onDelete, onReorder }) {
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState(EMPTY_FORM)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [reordering, setReordering] = useState(false)

  async function handleCreate(e) {
    e.preventDefault()
    if (!form.label.trim()) return
    setSaving(true)
    setError(null)
    try {
      await onCreate({ key: slugify(form.label), ...formToPayload(form) })
      setForm(EMPTY_FORM)
      setShowCreateForm(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  function startEdit(field) {
    setEditingId(field.id)
    setEditForm({
      label: field.label,
      fieldType: field.field_type,
      required: field.required,
      optionsText: (field.options ?? []).join('\n'),
    })
    setError(null)
  }

  async function handleSaveEdit(e) {
    e.preventDefault()
    if (!editForm.label.trim()) return
    setSaving(true)
    setError(null)
    try {
      await onUpdate(editingId, formToPayload(editForm))
      setEditingId(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    setError(null)
    try {
      await onDelete(pendingDelete.id)
      setPendingDelete(null)
    } catch (err) {
      setError(err.message)
      setDeleting(false)
    }
  }

  async function move(index, direction) {
    const target = index + direction
    if (target < 0 || target >= fields.length) return
    setReordering(true)
    setError(null)
    try {
      const a = fields[index]
      const b = fields[target]
      await onReorder([{ id: a.id, sortOrder: b.sort_order }, { id: b.id, sortOrder: a.sort_order }])
    } catch (err) {
      setError(err.message)
    } finally {
      setReordering(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <p className="text-sm text-secondary">
          {fields.length === 0 ? `No ${scopeLabel}s yet.` : `${fields.length} ${scopeLabel}${fields.length === 1 ? '' : 's'}.`}
        </p>
        <button
          type="button"
          onClick={() => setShowCreateForm((v) => !v)}
          className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 shrink-0"
        >
          {showCreateForm ? 'Cancel' : `+ Add ${scopeLabel}`}
        </button>
      </div>

      {error && <p role="alert" className="text-sm text-red-700 mb-3">{error}</p>}

      {showCreateForm && (
        <form onSubmit={handleCreate} className="bg-card border border-hairline rounded-lg p-4 mb-4 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-xs text-secondary">
              Field label
              <input required value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} className="mt-1 w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss" />
            </label>
            <label className="text-xs text-secondary">
              Type
              <select value={form.fieldType} onChange={(e) => setForm((f) => ({ ...f, fieldType: e.target.value }))} className="mt-1 w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss">
                {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
          </div>
          {form.fieldType === 'select' && (
            <label className="text-xs text-secondary block">
              Choices (one per line)
              <textarea rows={3} value={form.optionsText} onChange={(e) => setForm((f) => ({ ...f, optionsText: e.target.value }))} className="mt-1 w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss" />
            </label>
          )}
          <label className="flex items-center gap-2 text-xs text-secondary">
            <input type="checkbox" checked={form.required} onChange={(e) => setForm((f) => ({ ...f, required: e.target.checked }))} />
            Required
          </label>
          <div className="flex gap-2">
            <button disabled={saving} className="rounded-md bg-moss px-3 py-1.5 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-50">
              {saving ? 'Saving…' : 'Add field'}
            </button>
            <button type="button" onClick={() => { setShowCreateForm(false); setForm(EMPTY_FORM) }} className="rounded-md border border-hairline px-3 py-1.5 text-sm text-ink hover:bg-paper">Cancel</button>
          </div>
        </form>
      )}

      {fields.length > 0 && (
        <div className="space-y-2">
          {fields.map((field, index) => (
            <div key={field.id} className="bg-card border border-hairline rounded-lg p-3">
              {editingId === field.id ? (
                <form onSubmit={handleSaveEdit} className="space-y-3">
                  <div className="grid sm:grid-cols-2 gap-3">
                    <label className="text-xs text-secondary">
                      Field label
                      <input required value={editForm.label} onChange={(e) => setEditForm((f) => ({ ...f, label: e.target.value }))} className="mt-1 w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss" />
                    </label>
                    <label className="text-xs text-secondary">
                      Type
                      <select value={editForm.fieldType} onChange={(e) => setEditForm((f) => ({ ...f, fieldType: e.target.value }))} className="mt-1 w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss">
                        {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </label>
                  </div>
                  {editForm.fieldType === 'select' && (
                    <label className="text-xs text-secondary block">
                      Choices (one per line)
                      <textarea rows={3} value={editForm.optionsText} onChange={(e) => setEditForm((f) => ({ ...f, optionsText: e.target.value }))} className="mt-1 w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss" />
                    </label>
                  )}
                  <label className="flex items-center gap-2 text-xs text-secondary">
                    <input type="checkbox" checked={editForm.required} onChange={(e) => setEditForm((f) => ({ ...f, required: e.target.checked }))} />
                    Required
                  </label>
                  <div className="flex gap-2">
                    <button disabled={saving} className="rounded-md bg-moss px-3 py-1.5 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-50">
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                    <button type="button" onClick={() => setEditingId(null)} className="rounded-md border border-hairline px-3 py-1.5 text-sm text-ink hover:bg-paper">Cancel</button>
                  </div>
                </form>
              ) : (
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">
                      {field.label}
                      {field.required && <span className="ml-1.5 text-xs text-secondary">(required)</span>}
                    </p>
                    <p className="text-xs text-secondary mt-0.5">
                      {FIELD_TYPES.find((t) => t.value === field.field_type)?.label ?? field.field_type}
                      {field.field_type === 'select' && field.options?.length > 0 && ` — ${field.options.join(', ')}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button type="button" disabled={reordering || index === 0} onClick={() => move(index, -1)} className="text-xs text-secondary hover:text-ink disabled:opacity-30" aria-label={`Move ${field.label} up`}>↑</button>
                    <button type="button" disabled={reordering || index === fields.length - 1} onClick={() => move(index, 1)} className="text-xs text-secondary hover:text-ink disabled:opacity-30" aria-label={`Move ${field.label} down`}>↓</button>
                    <button type="button" onClick={() => startEdit(field)} className="text-xs font-medium text-moss hover:underline ml-2">Edit</button>
                    <button type="button" onClick={() => setPendingDelete(field)} className="text-xs font-medium text-red-700 hover:underline">Delete</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {pendingDelete && (
        <ConfirmDialog
          message={`Delete "${pendingDelete.name || pendingDelete.label}"? Any values already recorded for it will be deleted too. This can't be undone.`}
          confirmLabel="Delete"
          confirming={deleting}
          onConfirm={handleDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}
