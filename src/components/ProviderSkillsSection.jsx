import { useEffect, useState } from 'react'
import {
  listOrganisationLibrarySkills,
  createProviderLibrarySkill,
  listOfferedSkillIds,
  addOfferedSkill,
  removeOfferedSkill,
} from '../lib/admin/providerSkills'
import { isDuplicateLibrarySkillError, duplicateLibrarySkillMessage } from '../lib/skillLibrary'

const EMPTY_FORM = { name: '', category: '', description: '' }

// The provider console's "Skills" tab: browse the shared library plus this
// org's own provider-specific skills, create new organisation-only skills,
// and choose which ones make up the org's "offered to customers" roster
// (organisation_offered_skills, 0076) -- decoupled from any one course, so
// it can be curated before or independently of building out training.
export default function ProviderSkillsSection({ organisationId, userId }) {
  const [skills, setSkills] = useState([])
  const [offeredIds, setOfferedIds] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [creating, setCreating] = useState(false)
  const [togglingId, setTogglingId] = useState(null)

  useEffect(() => {
    load()
  }, [organisationId])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [skillRows, offeredRows] = await Promise.all([
        listOrganisationLibrarySkills(organisationId),
        listOfferedSkillIds(organisationId),
      ])
      setSkills(skillRows)
      setOfferedIds(new Set(offeredRows))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate(e) {
    e.preventDefault()
    if (!form.name.trim()) return
    setCreating(true)
    setError(null)
    try {
      await createProviderLibrarySkill(userId, organisationId, form)
      setForm(EMPTY_FORM)
      setShowForm(false)
      await load()
    } catch (err) {
      setError(isDuplicateLibrarySkillError(err) ? duplicateLibrarySkillMessage(err, form.name) : err.message)
    } finally {
      setCreating(false)
    }
  }

  async function handleToggleOffered(skill) {
    setTogglingId(skill.id)
    setError(null)
    try {
      if (offeredIds.has(skill.id)) {
        await removeOfferedSkill(organisationId, skill.id)
      } else {
        await addOfferedSkill(organisationId, skill.id, userId)
      }
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setTogglingId(null)
    }
  }

  const q = query.trim().toLowerCase()
  const filtered = q ? skills.filter((s) => s.name.toLowerCase().includes(q)) : skills

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div>
          <h3 className="font-display text-lg text-ink">Skills</h3>
          <p className="text-sm text-secondary mt-0.5">
            Browse the shared skill library, create skills specific to your organisation, and choose which ones you
            offer to your customers.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 shrink-0"
        >
          {showForm ? 'Cancel' : '+ Create skill'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-card border border-hairline rounded-lg p-4 space-y-3 mb-4">
          <p className="text-xs text-secondary">
            Only your organisation can see and offer a skill created here — it won't appear in the public library.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-secondary mb-1" htmlFor="providerSkillName">
                Name
              </label>
              <input
                id="providerSkillName"
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              />
            </div>
            <div>
              <label className="block text-sm text-secondary mb-1" htmlFor="providerSkillCategory">
                Category
              </label>
              <input
                id="providerSkillCategory"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm text-secondary mb-1" htmlFor="providerSkillDescription">
                Description
              </label>
              <textarea
                id="providerSkillDescription"
                rows={2}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={creating}
            className="rounded-md bg-moss text-paper py-2 px-4 font-medium hover:opacity-90 disabled:opacity-60"
          >
            {creating ? 'Creating…' : 'Create'}
          </button>
        </form>
      )}

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search skills…"
        className="w-full rounded-md border border-hairline bg-card px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
      />

      {error && <p className="text-sm text-red-700 mt-3">{error}</p>}

      {loading ? (
        <p className="text-secondary mt-3">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-hairline rounded-lg mt-3">
          <p className="text-secondary">No skills match.</p>
        </div>
      ) : (
        <ul className="divide-y divide-hairline border border-hairline rounded-md mt-3">
          {filtered.map((skill) => {
            const offered = offeredIds.has(skill.id)
            return (
              <li key={skill.id} className="p-3 flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="text-ink font-medium">
                    {skill.name}
                    {skill.organisation_id === organisationId && (
                      <span className="ml-1.5 font-mono text-[10px] uppercase tracking-wide text-secondary border border-hairline rounded-full px-1.5 py-0.5">
                        Your organisation
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-secondary mt-0.5">
                    {skill.category || 'No category'}
                    {skill.description ? ` — ${skill.description}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={togglingId === skill.id}
                  onClick={() => handleToggleOffered(skill)}
                  className={`rounded-md border py-1 px-3 text-xs font-medium shrink-0 disabled:opacity-50 ${
                    offered
                      ? 'border-moss text-moss hover:bg-moss/5'
                      : 'border-hairline text-ink hover:bg-paper'
                  }`}
                >
                  {offered ? 'Offered ✓' : 'Offer to customers'}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
