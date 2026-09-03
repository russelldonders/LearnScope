import { useState } from 'react'
import MutationFeedback from '../../../components/MutationFeedback'

// Create/edit form for a role profile's name and description only --
// required skills, training and linked employees are managed by the
// sibling panels (RoleProfileSkillsPanel, RoleProfileTrainingPanel,
// RoleProfileLinkedEmployeesPanel), not here. `roleProfile` omitted/null
// means create mode; `onCancel` is optional since an in-place edit form
// (as opposed to one opened fresh) may have nothing to cancel back to.
export default function RoleProfileDetailsForm({ roleProfile = null, saving = false, error = null, onSave, onCancel }) {
  const [name, setName] = useState(roleProfile?.name ?? '')
  const [description, setDescription] = useState(roleProfile?.description ?? '')
  const isEditing = Boolean(roleProfile)
  const trimmedName = name.trim()

  function handleSubmit(e) {
    e.preventDefault()
    if (!trimmedName) return
    onSave?.({ name: trimmedName, description: description.trim() })
  }

  return (
    <form onSubmit={handleSubmit} className="bg-card border border-hairline rounded-lg p-6 space-y-4">
      <h3 className="font-display text-lg text-ink">{isEditing ? 'Edit role profile' : 'New role profile'}</h3>

      <div>
        <label htmlFor="role-profile-name" className="block text-xs text-secondary mb-1">
          Name
        </label>
        <input
          id="role-profile-name"
          type="text"
          value={name}
          disabled={saving}
          onChange={(e) => setName(e.target.value)}
          required
          className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
        />
      </div>

      <div>
        <label htmlFor="role-profile-description" className="block text-xs text-secondary mb-1">
          Description
        </label>
        <textarea
          id="role-profile-description"
          value={description}
          disabled={saving}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
        />
      </div>

      <MutationFeedback status="error" message={error} />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={saving || !trimmedName}
          className="rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90 disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-md border border-hairline text-ink py-2 px-4 text-sm font-medium hover:bg-paper disabled:opacity-60"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}
