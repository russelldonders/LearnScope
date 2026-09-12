import { useEffect, useState } from 'react'
import { listOrganisations } from '../lib/admin/organisations'
import { listSharingConnections, listSharingEmployers, listSharingCatalogues, sendSharingRequest, decideSharing, removeSharing, emptySharing, validSharing } from '../lib/providerSharing'
import ConfirmDialog from './ConfirmDialog'

const button = 'rounded-md border border-hairline px-3 py-2 text-sm text-ink hover:bg-paper disabled:opacity-50'

function Selection({ catalogues, value, onChange }) {
  const update = (id, patch) => onChange?.({ ...value, catalogues: value.catalogues.map(c => c.id === id ? { ...c, ...patch } : c) })
  return <fieldset className="space-y-4" disabled={!onChange}>
    <legend className="font-medium text-ink mb-2">Catalogues and courses</legend>
    <label className="flex gap-2 items-start text-sm py-2">
      <input type="checkbox" checked={value.all} onChange={e => onChange?.({ all: e.target.checked, catalogues: [] })} />
      <span>All catalogues and courses<span className="block text-secondary">Includes future catalogues, courses and updates.</span></span>
    </label>
    {!value.all && catalogues.map(cat => {
      const selected = value.catalogues.find(c => c.id === cat.id)
      const courses = (cat.course_catalogue_publications ?? []).filter(p => p.published_at && p.course_catalogue?.status === 'approved' && p.course_catalogue.is_current_published).map(p => p.course_catalogue)
      return <div key={cat.id} className="border-t border-hairline pt-3">
        <label className="flex items-start gap-2 text-sm py-2">
          <input type="checkbox" checked={!!selected} onChange={e => onChange({ ...value, catalogues: e.target.checked ? [...value.catalogues, { id: cat.id, all: true, courses: [] }] : value.catalogues.filter(c => c.id !== cat.id) })} />
          <span className="font-medium break-words">{cat.name}</span>
        </label>
        {selected && <div className="pl-6 space-y-2">
          <label className="flex gap-2 items-start text-sm py-2"><input type="checkbox" checked={selected.all} onChange={e => update(cat.id, { all: e.target.checked, courses: [] })} /><span>All courses, including future additions and updates</span></label>
          {!selected.all && <>
            <p className="text-xs text-secondary">Only the selected published course versions will be enabled.</p>
            {courses.length === 0 && <p className="text-sm text-secondary">No published courses in this catalogue.</p>}
            {courses.map(course => <label key={course.id} className="flex gap-2 items-start text-sm py-2"><input type="checkbox" checked={selected.courses.includes(course.id)} onChange={e => update(cat.id, { courses: e.target.checked ? [...selected.courses, course.id] : selected.courses.filter(id => id !== course.id) })} /><span className="break-words">{course.name}</span></label>)}
          </>}
        </div>}
      </div>
    })}
    {!value.all && catalogues.length === 0 && <p className="text-sm text-secondary">This provider has no catalogues yet. Choose all to include future catalogues.</p>}
  </fieldset>
}

function Agreement({ row, side, name, busy, onDecision, onRemove }) {
  const [catalogues, setCatalogues] = useState(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const incoming = row.status === 'pending' && row.initiated_by !== side
  async function review() {
    setOpen(!open)
    if (!catalogues) {
      try { setCatalogues(await listSharingCatalogues(row.provider_organisation_id)); setError('') }
      catch (err) { setError(err.message) }
    }
  }
  return <li className="border-b border-hairline py-4 last:border-0">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0"><h3 className="font-medium text-ink break-words">{name}</h3><p className="text-sm text-secondary">{row.status === 'accepted' ? 'Confirmed sharing' : row.status === 'declined' ? 'Declined' : incoming ? 'Awaiting your approval' : `Awaiting ${side === 'employer' ? 'provider' : 'employer'} approval`}</p></div>
      <div className="flex flex-wrap gap-2"><button className={button} onClick={review} aria-expanded={open}>{open ? 'Hide selection' : 'Review selection'}</button><button className={button} disabled={busy} onClick={() => onRemove(row)}>{row.status === 'accepted' ? 'End sharing' : 'Remove request'}</button></div>
    </div>
    {open && <div className="mt-4 space-y-4">
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {catalogues ? <Selection catalogues={catalogues} value={row.sharing} /> : !error && <p role="status">Loading selection…</p>}
      {catalogues && !row.sharing.all && row.sharing.catalogues.some(s => !catalogues.some(c => c.id === s.id)) && <p className="text-sm text-secondary">A selected catalogue is no longer available. Removed content will not be shared.</p>}
      {incoming && catalogues && <div className="flex gap-2"><button className={button} disabled={busy} onClick={() => onDecision(row.id, true)}>Approve sharing</button><button className={button} disabled={busy} onClick={() => onDecision(row.id, false)}>Decline</button></div>}
    </div>}
  </li>
}

export default function ProviderSharingPanel({ side = 'employer', employer, organisation, userId }) {
  const id = side === 'employer' ? employer.id : organisation.id
  const [rows, setRows] = useState([])
  const [directory, setDirectory] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [target, setTarget] = useState(null)
  const [catalogues, setCatalogues] = useState(null)
  const [sharing, setSharing] = useState(emptySharing)
  const [busy, setBusy] = useState(false)
  const [removeTarget, setRemoveTarget] = useState(null)
  async function load() {
    const [links, orgs] = await Promise.all([listSharingConnections(side, id), side === 'employer' ? listOrganisations() : listSharingEmployers(id)])
    setRows(links); setDirectory(orgs)
  }
  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([listSharingConnections(side, id), side === 'employer' ? listOrganisations() : listSharingEmployers(id)])
      .then(([links, orgs]) => { if (active) { setRows(links); setDirectory(orgs) } })
      .catch(err => { if (active) setError(err.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [side, id])
  useEffect(() => {
    let active = true
    if (!target) return
    setCatalogues(null)
    listSharingCatalogues(side === 'provider' ? id : target.id).then(data => { if (active) setCatalogues(data) }).catch(err => { if (active) setError(err.message) })
    return () => { active = false }
  }, [target, side, id])
  const otherId = row => side === 'employer' ? row.provider_organisation_id : row.employer_id
  const name = row => directory.find(d => d.id === otherId(row))?.name || 'Organisation unavailable'
  const incoming = rows.filter(r => r.status === 'pending' && r.initiated_by !== side)
  const remaining = rows.filter(r => !incoming.includes(r))
  const matches = directory.filter(d => (side === 'employer' ? d.id !== employer.provider_organisation_id : d.provider_organisation_id !== id) && !rows.some(r => otherId(r) === d.id) && d.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 20)
  async function mutate(action, message) {
    setBusy(true); setError(''); setNotice('')
    try { await action(); await load(); setNotice(message) } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  function decision(rowId, accept) { return mutate(() => decideSharing(rowId, accept), accept ? 'Sharing approved.' : 'Request declined.') }
  return <section aria-label={side === 'employer' ? 'Linked providers' : 'Employer sharing'} className="space-y-6">
    <div><h2 className="font-display text-lg text-ink">{side === 'employer' ? 'Linked providers' : 'Employer sharing'}</h2><p className="text-sm text-secondary mt-1 max-w-2xl">Agree which catalogues and courses the employer can use. The receiving organisation must approve the selection before sharing begins.</p></div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}{notice && <p role="status" className="text-sm text-moss">{notice}</p>}
    {side === 'employer' && <div className="border border-hairline rounded-lg p-4"><h3 className="font-medium text-ink">{employer.name}</h3><p className="text-sm text-secondary">Main provider · Permanent connection</p><p className="text-sm text-secondary mt-2">All courses published in your main provider’s catalogues are enabled. This connection cannot be removed.</p></div>}
    {loading ? <p role="status">Loading connections…</p> : <>
      <div><h3 className="font-medium text-ink">{side === 'employer' ? 'Provider invitations' : 'Employer requests'} ({incoming.length})</h3>{incoming.length === 0 ? <p className="text-sm text-secondary mt-2">No invitations awaiting your approval.</p> : <ul>{incoming.map(row => <Agreement key={row.id} {...{row,side,busy}} name={name(row)} onDecision={decision} onRemove={setRemoveTarget} />)}</ul>}</div>
      <div className="border-t border-hairline pt-5"><h3 className="font-medium text-ink mb-3">{side === 'employer' ? 'Request a provider connection' : 'Invite an employer'}</h3>
        {!target ? <><label className="block text-sm text-secondary mb-2" htmlFor={`sharing-search-${side}`}>Search {side === 'employer' ? 'providers' : 'employers'} by name</label><input id={`sharing-search-${side}`} className="w-full max-w-md rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink" value={query} onChange={e => setQuery(e.target.value)} />{query.trim() && <ul className="mt-2 divide-y divide-hairline">{matches.map(d => <li key={d.id} className="flex flex-wrap justify-between gap-3 py-2"><span className="text-sm break-words">{d.name}</span><button className={button} onClick={() => { setTarget(d); setSharing(emptySharing()); setError('') }}>Select catalogues</button></li>)}{matches.length === 0 && <li className="text-sm text-secondary py-2">No matching organisations available.</li>}</ul>}</> : <div className="space-y-4"><h4 className="font-medium text-ink">{target.name}</h4>{catalogues ? <Selection value={sharing} onChange={setSharing} catalogues={catalogues} /> : <p role="status">Loading catalogues…</p>}<div className="flex gap-2"><button className={button} disabled={busy || !catalogues || !validSharing(sharing)} onClick={() => mutate(async () => { await sendSharingRequest({ employerId: side === 'employer' ? id : target.id, providerId: side === 'provider' ? id : target.id, userId, side, sharing }); setTarget(null); setQuery('') }, 'Sent. Sharing will begin after approval.')}>{busy ? 'Sending…' : side === 'employer' ? 'Send request' : 'Send invitation'}</button><button className={button} disabled={busy} onClick={() => setTarget(null)}>Cancel</button></div></div>}
      </div>
      <div className="border-t border-hairline pt-5"><h3 className="font-medium text-ink">Connections and sent requests</h3>{remaining.length === 0 ? <p className="text-sm text-secondary mt-2">No additional connections or sent requests.</p> : <ul>{remaining.map(row => <Agreement key={row.id} {...{row,side,busy}} name={name(row)} onDecision={decision} onRemove={setRemoveTarget} />)}</ul>}</div>
    </>}
    {removeTarget && <ConfirmDialog confirmLabel="Remove connection" message={`Remove the connection with ${name(removeTarget)}? New course assignments through this connection will stop. Existing learner enrolments will remain.`} confirming={busy} onCancel={() => setRemoveTarget(null)} onConfirm={() => mutate(async () => { await removeSharing(removeTarget.id); setRemoveTarget(null) }, 'Connection removed.')} />}
  </section>
}
