import { useState } from 'react'
import AccessibleDialog from './AccessibleDialog'
import { requestedDataSummary, requestedPersonalSkills } from '../lib/employerDataAccess'

export default function EmployerDataAccessConsentDialog({ request, skills, onConfirm, onClose }) {
  const requested = request.requested_data || ['skills']
  const available = requestedPersonalSkills(request, skills)
  const [categories, setCategories] = useState([])
  const [selected, setSelected] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  function toggle(setter, value) { setter((prev) => prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]) }
  async function confirm() {
    setBusy(true)
    setError(null)
    try { await onConfirm(categories.includes('skills') ? selected : [], categories) } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  return <AccessibleDialog labelledBy="consent-title" onClose={busy ? undefined : onClose} closeOnBackdrop={!busy} panelClassName="w-full max-w-xl bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto">
    <h2 id="consent-title" className="font-display text-xl text-ink mb-2">Review data access</h2>
    <p className="text-sm text-ink mb-2">{request.employers?.name || 'Your employer'} requested: {requestedDataSummary(request)}.</p>
    {request.request_comment && <blockquote className="text-sm text-secondary whitespace-pre-wrap mb-4">{request.request_comment}</blockquote>}
    <p className="text-sm text-secondary mb-4">Choose what to share. You can revoke this access in Privacy settings.</p>
    <fieldset disabled={busy} className="space-y-3">
      <legend className="text-sm font-medium mb-2">Data you agree to share</legend>
      {requested.map((category) => <label key={category} className="flex items-start gap-2 text-sm"><input type="checkbox" className="accent-moss mt-1" checked={categories.includes(category)} onChange={() => toggle(setCategories, category)} /><span>{category === 'skills' ? 'Selected skills and their assessments' : category === 'training' ? 'Training records, including notes, now and until you revoke access' : 'Experience records, including descriptions, now and until you revoke access'}</span></label>)}
      {categories.includes('skills') && <div>
        <input aria-label="Search your requested skills" placeholder="Search skills…" value={query} onChange={(e) => setQuery(e.target.value)} className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm" />
        <div className="flex gap-3 my-2"><button type="button" onClick={() => setSelected(available.map((s) => s.id))} className="text-sm text-moss hover:underline">Select all existing skills</button><button type="button" onClick={() => setSelected([])} className="text-sm text-secondary hover:underline">Clear</button></div>
        <div className="max-h-48 overflow-y-auto">{available.filter((s) => s.name.toLowerCase().includes(query.toLowerCase())).map((skill) => <label key={skill.id} className="flex items-center gap-2 py-2 text-sm"><input type="checkbox" className="accent-moss" checked={selected.includes(skill.id)} onChange={() => toggle(setSelected, skill.id)} />{skill.name}</label>)}</div>
        {!available.length && <p className="text-sm text-secondary">You have no matching skills to share.</p>}
        <p className="text-xs text-secondary mt-2">{selected.length} selected. Future skills are not shared automatically.</p>
      </div>}
    </fieldset>
    {error && <p role="alert" className="text-sm text-red-700 mt-3">{error}</p>}
    <div className="flex justify-end gap-2 mt-5"><button type="button" onClick={onClose} disabled={busy} className="rounded-md border border-hairline px-3 py-2 text-sm">Cancel</button><button type="button" onClick={confirm} disabled={busy || !categories.length || (categories.includes('skills') && !selected.length)} className="rounded-md bg-moss text-paper px-3 py-2 text-sm disabled:opacity-50">{busy ? 'Sharing…' : 'Approve selected data'}</button></div>
  </AccessibleDialog>
}
