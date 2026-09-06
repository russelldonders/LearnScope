import { useEffect, useState } from 'react'
import AccessibleDialog from '../../components/AccessibleDialog'
import { listLibrarySkills } from '../../lib/skillLibrary'

export default function RequestDataAccessDialog({ count, onSubmit, onClose }) {
  const [categories, setCategories] = useState(['skills'])
  const [mode, setMode] = useState('all')
  const [skills, setSkills] = useState([])
  const [selected, setSelected] = useState([])
  const [query, setQuery] = useState('')
  const [comment, setComment] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    listLibrarySkills().then((rows) => { if (live) setSkills(rows) }).catch((err) => { if (live) setLoadError(err.message) }).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [])
  const specific = categories.includes('skills') && mode === 'specific'
  function toggle(setter, value) { setter((prev) => prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]) }
  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onSubmit({ categories, skillIds: specific ? selected : [], comment: comment.trim() })
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  return <AccessibleDialog labelledBy="request-access-title" onClose={busy ? undefined : onClose} closeOnBackdrop={!busy} panelClassName="w-full max-w-xl bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto">
    <h2 id="request-access-title" className="font-display text-xl text-ink mb-2">Request data access</h2>
    <p className="text-sm text-secondary mb-5">Ask {count} selected user{count === 1 ? '' : 's'} to share data. Each user reviews and approves their own request.</p>
    <form onSubmit={submit} className="space-y-5">
      <fieldset disabled={busy} className="space-y-2">
        <legend className="text-sm font-medium text-ink mb-2">What would you like to access?</legend>
        {['skills', 'training', 'experience'].map((category) => <label key={category} className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" className="accent-moss" checked={categories.includes(category)} onChange={() => toggle(setCategories, category)} />{category[0].toUpperCase() + category.slice(1)}</label>)}
      </fieldset>
      {categories.includes('skills') && <fieldset disabled={busy} className="space-y-3">
        <legend className="text-sm font-medium text-ink mb-2">Which skills?</legend>
        <div className="flex flex-wrap gap-4">{[['all', 'All skills'], ['specific', 'Specific skills']].map(([value, label]) => <label key={value} className="flex items-center gap-2 text-sm"><input type="radio" name="requested-skills" className="accent-moss" checked={mode === value} onChange={() => setMode(value)} />{label}</label>)}</div>
        <p className="text-xs text-secondary">Users choose which existing skills to share. Future skills are not shared automatically.</p>
        {specific && <div>
          <input aria-label="Search skill catalogue" placeholder="Search skill catalogue…" value={query} onChange={(e) => setQuery(e.target.value)} className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm" />
          {loading ? <p role="status" className="text-sm text-secondary mt-2">Loading skills…</p> : loadError ? <p role="alert" className="text-sm text-red-700 mt-2">{loadError}</p> : <div className="max-h-48 overflow-y-auto mt-2">
            {skills.filter((s) => s.name.toLowerCase().includes(query.trim().toLowerCase())).map((s) => <label key={s.id} className="flex items-center gap-2 py-2 text-sm"><input type="checkbox" className="accent-moss" checked={selected.includes(s.id)} onChange={() => toggle(setSelected, s.id)} />{s.name}</label>)}
            {!skills.some((s) => s.name.toLowerCase().includes(query.trim().toLowerCase())) && <p className="text-sm text-secondary py-2">No skills found.</p>}
          </div>}
          <p className="text-xs text-secondary mt-2">{selected.length} skills selected</p>
        </div>}
      </fieldset>}
      <div><label htmlFor="access-comment" className="block text-sm font-medium text-ink mb-2">Comment for the user (optional)</label><textarea id="access-comment" maxLength={2000} rows={3} value={comment} disabled={busy} onChange={(e) => setComment(e.target.value)} className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm" /><p className="text-xs text-secondary">Explain why you need this data. The same comment goes to each selected user.</p></div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" onClick={onClose} disabled={busy} className="rounded-md border border-hairline px-3 py-2 text-sm">Cancel</button><button disabled={busy || !categories.length || (specific && (!selected.length || loading || Boolean(loadError)))} className="rounded-md bg-moss text-paper px-3 py-2 text-sm disabled:opacity-50">{busy ? 'Sending…' : 'Send request'}</button></div>
    </form>
  </AccessibleDialog>
}
