import { useEffect, useState } from 'react'
import {
  listLtiTools,
  createLtiTool,
  updateLtiTool,
  updateLtiToolSecret,
  deleteLtiTool,
} from '../lib/courseContent'
import ConfirmDialog from './ConfirmDialog'

const EMPTY_FORM = { name: '', launchUrl: '', consumerKey: '', consumerSecret: '' }

// Org-scoped config for the external tools LearnScope can launch as an LTI
// 1.1 consumer (see the lti_consumer migration) -- admin-only, mirroring
// ProviderCataloguesSection's own create/manage shape. The consumer secret
// is deliberately write-only here: lti_tool_secrets has no select policy
// for anyone, including this org's own admins, so there's nothing to
// prefill an edit form with -- "Update secret" always starts blank.
export default function ProviderLtiToolsSection({ organisationId, userId }) {
  const [tools, setTools] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState(EMPTY_FORM)
  const [secretEditingId, setSecretEditingId] = useState(null)
  const [newSecret, setNewSecret] = useState('')
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    load()
  }, [organisationId])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      setTools(await listLtiTools(organisationId))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await createLtiTool(organisationId, userId, form)
      setForm(EMPTY_FORM)
      setShowCreateForm(false)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  function startEdit(tool) {
    setEditingId(tool.id)
    setEditForm({ name: tool.name, launchUrl: tool.launch_url, consumerKey: tool.consumer_key, consumerSecret: '' })
    setError(null)
  }

  async function handleSaveEdit(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await updateLtiTool(editingId, editForm)
      setEditingId(null)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveSecret(e, toolId) {
    e.preventDefault()
    if (!newSecret.trim()) return
    setSaving(true)
    setError(null)
    try {
      await updateLtiToolSecret(toolId, newSecret)
      setSecretEditingId(null)
      setNewSecret('')
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
      await deleteLtiTool(pendingDelete.id)
      setPendingDelete(null)
      await load()
    } catch (err) {
      // The FK on content_resources.lti_tool_id has no ON DELETE action, so
      // a still-in-use tool surfaces as a raw Postgres constraint error --
      // this is the one place that's worth translating into plain language.
      setError(
        err.message?.includes('foreign key')
          ? `"${pendingDelete.name}" is still used by at least one course resource -- remove those first.`
          : err.message
      )
      setDeleting(false)
    }
  }

  return (
    <section aria-labelledby="provider-lti-tools-heading">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <h2 id="provider-lti-tools-heading" className="font-display text-lg text-ink">LTI tools</h2>
        <button
          type="button"
          onClick={() => setShowCreateForm((v) => !v)}
          className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 shrink-0"
        >
          {showCreateForm ? 'Cancel' : '+ Add tool'}
        </button>
      </div>
      <p className="text-sm text-secondary mb-5 max-w-2xl">
        External tools your organisation can launch as course resources (LTI 1.1). Set one up once here, then
        attach it to as many courses as you like from the Training tab. The shared secret is never shown again
        after you set it -- use "Update secret" to replace it.
      </p>

      {error && <p role="alert" className="text-sm text-red-700 mb-4">{error}</p>}

      {showCreateForm && (
        <form onSubmit={handleCreate} className="bg-card border border-hairline rounded-lg p-4 mb-6">
          <h3 className="text-sm font-medium text-ink mb-3">Add an LTI tool</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-xs text-secondary">
              Name
              <input required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="mt-1 w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss" />
            </label>
            <label className="text-xs text-secondary">
              Launch URL
              <input required type="url" placeholder="https://…" value={form.launchUrl} onChange={(e) => setForm((f) => ({ ...f, launchUrl: e.target.value }))} className="mt-1 w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss" />
            </label>
            <label className="text-xs text-secondary">
              Consumer key
              <input required value={form.consumerKey} onChange={(e) => setForm((f) => ({ ...f, consumerKey: e.target.value }))} className="mt-1 w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss" />
            </label>
            <label className="text-xs text-secondary">
              Consumer secret
              <input required type="password" autoComplete="off" value={form.consumerSecret} onChange={(e) => setForm((f) => ({ ...f, consumerSecret: e.target.value }))} className="mt-1 w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss" />
            </label>
          </div>
          <div className="flex gap-2 mt-3">
            <button disabled={saving} className="rounded-md bg-moss px-3 py-1.5 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-50">
              {saving ? 'Saving…' : 'Add tool'}
            </button>
            <button type="button" onClick={() => { setShowCreateForm(false); setForm(EMPTY_FORM) }} className="rounded-md border border-hairline px-3 py-1.5 text-sm text-ink hover:bg-paper">Cancel</button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-secondary">Loading…</p>
      ) : tools.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-hairline rounded-lg">
          <p className="text-secondary">No LTI tools set up yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tools.map((tool) => (
            <div key={tool.id} className="bg-card border border-hairline rounded-lg p-4">
              {editingId === tool.id ? (
                <form onSubmit={handleSaveEdit} className="space-y-3">
                  <div className="grid sm:grid-cols-2 gap-3">
                    <label className="text-xs text-secondary">
                      Name
                      <input required value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} className="mt-1 w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss" />
                    </label>
                    <label className="text-xs text-secondary">
                      Launch URL
                      <input required type="url" value={editForm.launchUrl} onChange={(e) => setEditForm((f) => ({ ...f, launchUrl: e.target.value }))} className="mt-1 w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss" />
                    </label>
                    <label className="text-xs text-secondary">
                      Consumer key
                      <input required value={editForm.consumerKey} onChange={(e) => setEditForm((f) => ({ ...f, consumerKey: e.target.value }))} className="mt-1 w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss" />
                    </label>
                  </div>
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
                    <p className="text-sm font-medium text-ink">{tool.name}</p>
                    <p className="text-xs text-secondary truncate mt-0.5">{tool.launch_url}</p>
                    <p className="text-xs text-secondary mt-0.5">Consumer key: <span className="font-mono">{tool.consumer_key}</span></p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button type="button" onClick={() => startEdit(tool)} className="text-xs font-medium text-moss hover:underline">Edit</button>
                    <button type="button" onClick={() => { setSecretEditingId(tool.id); setNewSecret('') }} className="text-xs font-medium text-moss hover:underline">Update secret</button>
                    <button type="button" onClick={() => setPendingDelete(tool)} className="text-xs font-medium text-red-700 hover:underline">Delete</button>
                  </div>
                </div>
              )}

              {secretEditingId === tool.id && (
                <form onSubmit={(e) => handleSaveSecret(e, tool.id)} className="mt-3 flex flex-wrap items-end gap-2 border-t border-hairline pt-3">
                  <label className="flex-1 min-w-[200px] text-xs text-secondary">
                    New consumer secret
                    <input required type="password" autoComplete="off" value={newSecret} onChange={(e) => setNewSecret(e.target.value)} className="mt-1 w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss" />
                  </label>
                  <button disabled={saving} className="rounded-md bg-moss px-3 py-1.5 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-50">
                    {saving ? 'Saving…' : 'Save secret'}
                  </button>
                  <button type="button" onClick={() => setSecretEditingId(null)} className="rounded-md border border-hairline px-3 py-1.5 text-sm text-ink hover:bg-paper">Cancel</button>
                </form>
              )}
            </div>
          ))}
        </div>
      )}

      {pendingDelete && (
        <ConfirmDialog
          message={`Delete "${pendingDelete.name}"? This can't be undone.`}
          confirmLabel="Delete"
          confirming={deleting}
          onConfirm={handleDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </section>
  )
}
