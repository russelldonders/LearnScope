import { useEffect, useMemo, useState } from 'react'
import { listEmployerRoleProfiles } from '../../lib/employerRoleProfiles'
import {
  EMPLOYER_CATALOGUE_VISIBILITY,
  listEmployerCatalogueAccess,
  setEmployerCatalogueAccess,
} from '../../lib/employerCatalogues'

export default function EmployerCatalogueAccessPanel({ employerId }) {
  const [catalogues, setCatalogues] = useState([])
  const [roleProfiles, setRoleProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [savingId, setSavingId] = useState(null)
  const [savedId, setSavedId] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([listEmployerCatalogueAccess(employerId), listEmployerRoleProfiles(employerId)])
      .then(([access, profiles]) => {
        if (cancelled) return
        setCatalogues(access)
        setRoleProfiles((profiles ?? []).filter((profile) => profile.status === 'active'))
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [employerId])

  const roleProfileById = useMemo(
    () => new Map(roleProfiles.map((profile) => [profile.id, profile])),
    [roleProfiles]
  )

  function updateCatalogue(catalogueId, changes) {
    setCatalogues((current) => current.map((catalogue) => (
      catalogue.catalogueId === catalogueId ? { ...catalogue, ...changes } : catalogue
    )))
    setSavedId(null)
  }

  function toggleRole(catalogue, roleProfileId) {
    const selected = new Set(catalogue.roleProfileIds)
    if (selected.has(roleProfileId)) selected.delete(roleProfileId)
    else selected.add(roleProfileId)
    updateCatalogue(catalogue.catalogueId, { roleProfileIds: [...selected] })
  }

  async function save(catalogue) {
    setError(null)
    setSavingId(catalogue.catalogueId)
    try {
      await setEmployerCatalogueAccess(
        employerId,
        catalogue.catalogueId,
        catalogue.visibility,
        catalogue.visibility === 'role_profiles' ? catalogue.roleProfileIds : []
      )
      setSavedId(catalogue.catalogueId)
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingId(null)
    }
  }

  return (
    <section className="rounded-lg border border-hairline bg-card p-5" aria-labelledby="catalogue-access-heading">
      <div className="max-w-2xl">
        <p className="font-mono text-xs uppercase tracking-wide text-moss">Employer access</p>
        <h2 id="catalogue-access-heading" className="font-display text-xl text-ink mt-1">Choose who can browse each catalogue</h2>
        <p className="text-sm text-secondary mt-2">
          Public catalogues use the same content everywhere: visitors see them before login and active members also see them inside this workspace.
        </p>
      </div>

      {loading && <p className="text-sm text-secondary mt-5">Loading catalogue access…</p>}
      {error && <p role="alert" className="text-sm text-red-700 mt-4">{error}</p>}
      {!loading && catalogues.length === 0 && (
        <p className="text-sm text-secondary mt-5">No published catalogues are currently connected to this employer.</p>
      )}

      <div className="mt-5 divide-y divide-hairline border-y border-hairline">
        {catalogues.map((catalogue) => {
          const roleSelectionInvalid = catalogue.visibility === 'role_profiles' && catalogue.roleProfileIds.length === 0
          return (
            <div key={catalogue.catalogueId} className="py-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,1.2fr)_auto] lg:items-start">
              <div>
                <h3 className="font-medium text-ink">{catalogue.name}</h3>
                <p className="text-xs text-secondary mt-1">{catalogue.providerName}</p>
                {catalogue.description && <p className="text-sm text-secondary mt-2">{catalogue.description}</p>}
              </div>

              <div>
                <label htmlFor={`catalogue-visibility-${catalogue.catalogueId}`} className="sr-only">
                  Access for {catalogue.name}
                </label>
                <select
                  id={`catalogue-visibility-${catalogue.catalogueId}`}
                  value={catalogue.visibility}
                  onChange={(event) => updateCatalogue(catalogue.catalogueId, { visibility: event.target.value })}
                  className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink"
                >
                  {EMPLOYER_CATALOGUE_VISIBILITY.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <p className="text-xs text-secondary mt-1.5">
                  {EMPLOYER_CATALOGUE_VISIBILITY.find((option) => option.value === catalogue.visibility)?.description}
                </p>

                {catalogue.visibility === 'role_profiles' && (
                  <fieldset className="mt-3">
                    <legend className="text-xs font-medium text-ink">Role profiles with access</legend>
                    {roleProfiles.length === 0 ? (
                      <p className="text-xs text-secondary mt-2">Create an active role profile before using restricted access.</p>
                    ) : (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {roleProfiles.map((profile) => {
                          const checked = catalogue.roleProfileIds.includes(profile.id)
                          return (
                            <label key={profile.id} className={`cursor-pointer rounded-full border px-3 py-1.5 text-xs ${checked ? 'border-moss bg-moss/10 text-ink' : 'border-hairline text-secondary'}`}>
                              <input
                                type="checkbox"
                                className="sr-only"
                                checked={checked}
                                onChange={() => toggleRole(catalogue, profile.id)}
                              />
                              {roleProfileById.get(profile.id)?.name}
                            </label>
                          )
                        })}
                      </div>
                    )}
                    {roleSelectionInvalid && <p className="text-xs text-red-700 mt-2">Select at least one role profile.</p>}
                  </fieldset>
                )}
              </div>

              <div className="flex items-center gap-2 lg:justify-end">
                {savedId === catalogue.catalogueId && <span className="text-xs text-moss">Saved</span>}
                <button
                  type="button"
                  onClick={() => save(catalogue)}
                  disabled={savingId === catalogue.catalogueId || roleSelectionInvalid}
                  className="rounded-md bg-moss px-3 py-2 text-sm font-medium text-paper disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingId === catalogue.catalogueId ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
