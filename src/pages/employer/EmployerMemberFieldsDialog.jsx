import { useEffect, useState } from 'react'
import AccessibleDialog from '../../components/AccessibleDialog'
import FieldDefinitionsManager from '../../components/FieldDefinitionsManager'
import {
  createFieldDefinition,
  deleteFieldDefinition,
  listFieldDefinitionsForEmployer,
  reorderFieldDefinitions,
  updateFieldDefinition,
} from '../../lib/admin/employers'

function EmployerMemberFieldsSettings({ employer, userId }) {
  const [fields, setFields] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    load()
    // load is intentionally local to this mounted settings view.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [employer.id])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      setFields(await listFieldDefinitionsForEmployer(employer.id))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const baseFields = fields.filter((field) => field.employer_id === null)
  const ownFields = fields.filter((field) => field.employer_id !== null)

  async function handleCreate(payload) {
    await createFieldDefinition({
      ...payload,
      employerId: employer.id,
      createdBy: userId,
      sortOrder: ownFields.length > 0 ? Math.max(...ownFields.map((field) => field.sort_order)) + 10 : 1000,
    })
    await load()
  }

  async function handleUpdate(id, payload) {
    await updateFieldDefinition(id, payload)
    await load()
  }

  async function handleDelete(id) {
    await deleteFieldDefinition(id)
    await load()
  }

  async function handleReorder(updates) {
    await reorderFieldDefinitions(updates)
    await load()
  }

  return (
    <>
      <p id="member-fields-settings-description" className="mb-5 max-w-2xl text-sm text-secondary">
        These fields appear when editing a user from the Users tab. LearnScope fields apply to every employer;
        add your own for details specific to {employer.name}.
      </p>

      {error && <p role="alert" className="mb-4 text-sm text-red-700">Couldn’t load member fields: {error}</p>}

      {loading ? (
        <p role="status" className="text-sm text-secondary">Loading member fields…</p>
      ) : (
        <div className="space-y-7">
          <section aria-labelledby="base-member-fields-title">
            <h3 id="base-member-fields-title" className="mb-2 text-sm font-medium text-ink">LearnScope fields</h3>
            {baseFields.length === 0 ? (
              <p className="text-sm text-secondary">No LearnScope fields are configured.</p>
            ) : (
              <div className="divide-y divide-hairline border-y border-hairline">
                {baseFields.map((field) => (
                  <div key={field.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="break-words text-sm text-ink">
                        {field.label}{field.required && <span className="ml-1.5 text-xs text-secondary">(required)</span>}
                      </p>
                      <p className="mt-0.5 text-xs text-secondary">{field.field_type}</p>
                    </div>
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-secondary">Set by LearnScope</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section aria-labelledby="custom-member-fields-title">
            <h3 id="custom-member-fields-title" className="mb-2 text-sm font-medium text-ink">Custom fields</h3>
            <FieldDefinitionsManager
              fields={ownFields}
              scopeLabel="field"
              onCreate={handleCreate}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
              onReorder={handleReorder}
            />
          </section>
        </div>
      )}
    </>
  )
}

// Member fields settings, opened from the workspace's Settings menu
// (EmployerSettingsMenu) -- the details kept on each member record.
export default function EmployerMemberFieldsDialog({ employer, userId, onClose }) {
  return (
    <AccessibleDialog
      labelledBy="member-fields-settings-title"
      describedBy="member-fields-settings-description"
      onClose={onClose}
      panelClassName="w-full max-w-2xl rounded-xl border border-hairline bg-card p-6 shadow-xl max-h-[90vh] overflow-y-auto overscroll-contain"
    >
      <h2 id="member-fields-settings-title" className="font-display text-lg text-ink">Member fields</h2>
      <EmployerMemberFieldsSettings employer={employer} userId={userId} />
      <div className="mt-6 flex justify-end border-t border-hairline pt-4">
        <button type="button" onClick={onClose} className="rounded-md border border-hairline px-4 py-2 text-sm font-medium text-ink hover:bg-paper">
          Close
        </button>
      </div>
    </AccessibleDialog>
  )
}
