import { useEffect, useState } from 'react'
import FieldDefinitionsManager from '../../components/FieldDefinitionsManager'
import MutationFeedback from '../../components/MutationFeedback'
import { useAuth } from '../../context/AuthContext'
import {
  createFieldDefinition,
  deleteFieldDefinition,
  listGlobalFieldDefinitions,
  reorderFieldDefinitions,
  updateFieldDefinition,
} from '../../lib/admin/employers'

export default function AdminMemberFieldSettings() {
  const { user } = useAuth()
  const [fieldDefinitions, setFieldDefinitions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function loadFields() {
      setLoading(true)
      setError(null)
      try {
        setFieldDefinitions(await listGlobalFieldDefinitions())
      } catch (err) {
        setError(`Couldn't load member field settings: ${err.message}`)
      } finally {
        setLoading(false)
      }
    }

    loadFields()
  }, [])

  async function refreshFields() {
    setFieldDefinitions(await listGlobalFieldDefinitions())
  }

  async function handleCreateField(payload) {
    await createFieldDefinition({
      ...payload,
      employerId: null,
      createdBy: user.id,
      sortOrder: fieldDefinitions.length > 0
        ? Math.max(...fieldDefinitions.map((field) => field.sort_order)) + 10
        : 10,
    })
    await refreshFields()
  }

  async function handleUpdateField(id, payload) {
    await updateFieldDefinition(id, payload)
    await refreshFields()
  }

  async function handleDeleteField(id) {
    await deleteFieldDefinition(id)
    await refreshFields()
  }

  async function handleReorderFields(updates) {
    await reorderFieldDefinitions(updates)
    await refreshFields()
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-lg text-ink mb-1">Member field settings</h2>
        <p className="text-sm text-secondary max-w-2xl">
          Manage the base fields included in every employer's roster. Employers can add their own
          fields alongside these from their console.
        </p>
      </div>

      <MutationFeedback status="error" message={error} />

      {loading ? (
        <p className="text-secondary">Loading…</p>
      ) : (
        <FieldDefinitionsManager
          fields={fieldDefinitions}
          scopeLabel="base field"
          onCreate={handleCreateField}
          onUpdate={handleUpdateField}
          onDelete={handleDeleteField}
          onReorder={handleReorderFields}
        />
      )}
    </div>
  )
}
