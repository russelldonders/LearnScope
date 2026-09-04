import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import MutationFeedback from '../../components/MutationFeedback'
import { LEVEL_LABELS, LEVELS } from '../../lib/levels'
import { listAllLibrarySkills } from '../../lib/admin/skills'
import {
  addSkillCompositeComponent,
  createSkillCompositeDraft,
  getSkillCompositeDefinitions,
  publishSkillComposite,
  removeSkillCompositeComponent,
  updateSkillCompositeComponent,
} from '../../lib/admin/skillComposites'

export default function SkillCompositionSection({ parentSkill, userId, componentHref = null }) {
  const [definitions, setDefinitions] = useState({ draft: null, published: null })
  const [librarySkills, setLibrarySkills] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [actioningId, setActioningId] = useState(null)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [selectedSkillId, setSelectedSkillId] = useState('')
  const [required, setRequired] = useState(true)
  const [targetLevel, setTargetLevel] = useState(1)

  useEffect(() => {
    load()
    // parentSkill.id is the stable identity for this entire editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentSkill.id])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [definitionData, skills] = await Promise.all([
        getSkillCompositeDefinitions(parentSkill.id),
        listAllLibrarySkills(),
      ])
      setDefinitions(definitionData)
      setLibrarySkills(skills)
    } catch (err) {
      setError(`Couldn't load component skills: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  const editableDefinition = definitions.draft
  const displayedDefinition = editableDefinition ?? definitions.published
  const existingIds = useMemo(
    () => new Set((editableDefinition?.components ?? []).map((component) => component.component_skill_id)),
    [editableDefinition]
  )
  const candidates = useMemo(
    () =>
      librarySkills.filter((skill) => {
        if (skill.id === parentSkill.id || skill.is_private || skill.status !== 'active') return false
        if (existingIds.has(skill.id)) return false
        if (parentSkill.organisation_id === null) return skill.organisation_id === null
        return skill.organisation_id === null || skill.organisation_id === parentSkill.organisation_id
      }),
    [librarySkills, parentSkill.id, parentSkill.organisation_id, existingIds]
  )

  async function run(action, successMessage = null) {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await action()
      await load()
      if (successMessage) setMessage(successMessage)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleCreateDraft() {
    await run(
      () => createSkillCompositeDraft(parentSkill.id),
      definitions.published ? 'Draft version created from the published component set.' : 'Component set created.'
    )
  }

  async function handleAdd(event) {
    event.preventDefault()
    if (!editableDefinition || !selectedSkillId) return
    await run(
      () =>
        addSkillCompositeComponent(editableDefinition.id, selectedSkillId, userId, {
          required,
          targetLevel,
          sortOrder: editableDefinition.components.length,
        }),
      'Component skill added.'
    )
    setSelectedSkillId('')
    setRequired(true)
    setTargetLevel(1)
  }

  async function handleUpdate(component, fields) {
    setActioningId(component.id)
    setError(null)
    setMessage(null)
    try {
      await updateSkillCompositeComponent(component.id, fields)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setActioningId(null)
    }
  }

  async function handleRemove(component) {
    setActioningId(component.id)
    setError(null)
    setMessage(null)
    try {
      await removeSkillCompositeComponent(component.id)
      await load()
      setMessage('Component skill removed.')
    } catch (err) {
      setError(err.message)
    } finally {
      setActioningId(null)
    }
  }

  async function handlePublish() {
    await run(
      () => publishSkillComposite(editableDefinition.id),
      `Version ${editableDefinition.version} published.`
    )
  }

  return (
    <section aria-labelledby="skill-components-heading" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="skill-components-heading" className="font-display text-lg text-ink">Component skills</h3>
          <p className="mt-1 max-w-2xl text-sm text-secondary">
            Build this broader skill from reusable skills in the library. Components describe coverage; they do
            not automatically replace a learner's confirmed {parentSkill.name} level.
          </p>
        </div>
        {!loading && !editableDefinition && (
          <button
            type="button"
            onClick={handleCreateDraft}
            disabled={busy}
            className="rounded-md bg-moss px-3 py-1.5 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-60"
          >
            {definitions.published ? 'Edit components' : 'Define components'}
          </button>
        )}
      </div>

      <MutationFeedback status="success" message={message} size="xs" />
      <MutationFeedback status="error" message={error} size="xs" />

      {loading ? (
        <p role="status" className="text-sm text-secondary">Loading component skills…</p>
      ) : !displayedDefinition ? (
        <div className="rounded-lg border border-dashed border-hairline py-10 text-center">
          <p className="text-sm text-secondary">This skill has no component set yet.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-hairline bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-4 py-3">
            <div>
              <p className="text-sm font-medium text-ink">
                Version {displayedDefinition.version}
                {editableDefinition ? ' draft' : ' published'}
              </p>
              {editableDefinition && definitions.published && (
                <p className="text-xs text-secondary">The published version stays live until this draft is published.</p>
              )}
            </div>
            {editableDefinition && (
              <button
                type="button"
                onClick={handlePublish}
                disabled={busy || editableDefinition.components.length === 0}
                className="rounded-md bg-moss px-3 py-1.5 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-60"
              >
                {busy ? 'Saving…' : 'Publish component set'}
              </button>
            )}
          </div>

          {displayedDefinition.components.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-secondary">Add the first component skill below.</p>
          ) : (
            <ul className="divide-y divide-hairline">
              {displayedDefinition.components.map((component) => (
                <li key={component.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-[180px] flex-1">
                    {componentHref ? (
                      <Link
                        to={componentHref(component.skill_library)}
                        className="text-sm font-medium text-ink hover:text-moss hover:underline"
                      >
                        {component.skill_library.name}
                      </Link>
                    ) : (
                      <p className="text-sm font-medium text-ink">{component.skill_library.name}</p>
                    )}
                    <p className="mt-0.5 text-xs text-secondary">{component.skill_library.skill_code}</p>
                  </div>
                  {editableDefinition ? (
                    <>
                      <label className="flex items-center gap-2 text-xs text-secondary">
                        <input
                          type="checkbox"
                          checked={component.is_required}
                          disabled={actioningId === component.id}
                          onChange={(event) => handleUpdate(component, { required: event.target.checked })}
                          className="rounded border-hairline accent-moss"
                        />
                        Required
                      </label>
                      <label className="flex items-center gap-2 text-xs text-secondary">
                        Target
                        <select
                          value={component.target_level}
                          disabled={actioningId === component.id}
                          onChange={(event) => handleUpdate(component, { targetLevel: Number(event.target.value) })}
                          className="rounded-md border border-hairline bg-paper px-2 py-1 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                        >
                          {LEVELS.map((level) => <option key={level} value={level}>{level}. {LEVEL_LABELS[level]}</option>)}
                        </select>
                      </label>
                      <button
                        type="button"
                        onClick={() => handleRemove(component)}
                        disabled={actioningId === component.id}
                        className="text-xs font-medium text-red-700 hover:underline disabled:opacity-60"
                      >
                        Remove
                      </button>
                    </>
                  ) : (
                    <div className="flex items-center gap-3 text-xs text-secondary">
                      <span>{component.is_required ? 'Required' : 'Optional'}</span>
                      <span>Target {component.target_level}. {LEVEL_LABELS[component.target_level]}</span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {editableDefinition && (
            <form onSubmit={handleAdd} className="grid gap-3 border-t border-hairline bg-paper p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-end">
              <div>
                <label htmlFor="component-skill" className="mb-1 block text-xs text-secondary">Add component skill</label>
                <select
                  id="component-skill"
                  required
                  value={selectedSkillId}
                  onChange={(event) => setSelectedSkillId(event.target.value)}
                  className="w-full rounded-md border border-hairline bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                >
                  <option value="">Choose a library skill…</option>
                  {candidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>{candidate.name} ({candidate.skill_code})</option>
                  ))}
                </select>
              </div>
              <label className="flex h-10 items-center gap-2 text-xs text-secondary">
                <input
                  type="checkbox"
                  checked={required}
                  onChange={(event) => setRequired(event.target.checked)}
                  className="rounded border-hairline accent-moss"
                />
                Required
              </label>
              <div>
                <label htmlFor="component-target-level" className="mb-1 block text-xs text-secondary">Target level</label>
                <select
                  id="component-target-level"
                  value={targetLevel}
                  onChange={(event) => setTargetLevel(Number(event.target.value))}
                  className="rounded-md border border-hairline bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                >
                  {LEVELS.map((level) => <option key={level} value={level}>{level}. {LEVEL_LABELS[level]}</option>)}
                </select>
              </div>
              <button
                type="submit"
                disabled={busy || !selectedSkillId}
                className="rounded-md border border-hairline bg-card px-3 py-2 text-sm font-medium text-ink hover:bg-paper disabled:opacity-60"
              >
                Add component
              </button>
            </form>
          )}
        </div>
      )}
    </section>
  )
}
