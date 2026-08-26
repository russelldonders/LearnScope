import { useState } from 'react'

// Shown when a skill is marked "part of my current role" but the learner
// has more than one ongoing job -- rather than silently linking to all of
// them, this asks which one(s) it actually applies to.
export default function CurrentRoleSelectModal({ roles, onConfirm, onCancel }) {
  const [selected, setSelected] = useState(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleConfirm() {
    setError(null)
    setSaving(true)
    try {
      await onConfirm([...selected])
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  async function handleCancel() {
    setError(null)
    setSaving(true)
    try {
      await onCancel()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={handleCancel}>
      <div
        className="w-full max-w-md bg-card border border-hairline rounded-lg p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-xl text-ink mb-2">Which current role is this part of?</h2>
        <p className="text-sm text-secondary mb-4">
          You have more than one ongoing role on your Experience timeline — pick which one(s)
          this skill applies to.
        </p>

        <div className="space-y-2 mb-4">
          {roles.map((role) => (
            <label
              key={role.id}
              className="flex items-center gap-3 border border-hairline rounded-md p-2.5 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.has(role.id)}
                onChange={() => toggle(role.id)}
                className="rounded border-hairline"
              />
              <span className="text-sm text-ink">
                {role.title}
                {role.organization ? ` · ${role.organization}` : ''}
              </span>
            </label>
          ))}
        </div>

        {error && <p className="text-sm text-red-700 mb-3">{error}</p>}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={saving || selected.size === 0}
            className="rounded-md bg-moss text-paper py-2 px-4 font-medium hover:opacity-90 disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Apply'}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            disabled={saving}
            className="rounded-md border border-hairline text-ink py-2 px-4 hover:bg-paper disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
