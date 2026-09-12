import { useState } from 'react'
import AccessibleDialog from './AccessibleDialog'
import EmployerMemberFieldInputs from './EmployerMemberFieldInputs'

// Edits one employer_member's roster field values (20260911130000) -- the
// employer's own record about this person (name/location/department/dates
// etc. as the employer knows them), entirely separate from their actual
// LearnScope profile, which stays learner-owned and untouched by this.
export default function EmployerMemberFieldsModal({ memberLabel, fields, initialValues, onSave, onClose }) {
  const [values, setValues] = useState(initialValues)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function setValue(fieldId, value) {
    setValues((prev) => ({ ...prev, [fieldId]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const missingRequired = fields.find((f) => f.required && !String(values[f.id] ?? '').trim())
    if (missingRequired) {
      setError(`"${missingRequired.label}" is required.`)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave(values)
      onClose()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <AccessibleDialog
      labelledBy="employer-member-fields-title"
      onClose={saving ? undefined : onClose}
      closeOnBackdrop={!saving}
      panelClassName="w-full max-w-lg bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
      <h2 id="employer-member-fields-title" className="font-display text-xl text-ink mb-1">Member details</h2>
      <p className="text-sm text-secondary mb-4">{memberLabel}</p>

      <form onSubmit={handleSubmit} className="space-y-3">
        <EmployerMemberFieldInputs fields={fields} values={values} onChange={setValue} />

        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

        <div className="flex gap-2 pt-2">
          <button type="submit" disabled={saving} className="rounded-md bg-moss text-paper py-2 px-4 font-medium hover:opacity-90 disabled:opacity-60">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={onClose} disabled={saving} className="rounded-md border border-hairline px-4 py-2 text-sm text-ink hover:bg-paper disabled:opacity-60">
            Cancel
          </button>
        </div>
      </form>
    </AccessibleDialog>
  )
}
