import { supabase } from '../../lib/supabaseClient'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import AppHeader from '../../components/AppHeader'
import { useAuth } from '../../context/AuthContext'
import { listLmsConnections, saveLmsConnection, listSkillLtiObjects, saveSkillLtiObject } from '../../lib/lti/configuration'
import { LEVELS, LEVEL_LABELS } from '../../lib/levels'

const inputClass = 'mt-1 w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss'
const buttonClass = 'rounded-md border border-hairline px-3 py-2 text-sm text-ink hover:bg-paper disabled:opacity-50'
const primaryClass = 'rounded-md bg-moss text-paper px-3 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50'
const emptyConnection = { name: '', issuer: '', client_id: '', deployment_ids: '', authorization_url: '', jwks_url: '', token_url: '', status: 'draft' }

function Field({ label, children }) { return <label className="block text-sm text-secondary">{label}{children}</label> }
function Feedback({ error, message }) { return <>{error && <p role="alert" className="text-sm text-red-700 mb-3">{error}</p>}{message && <p role="status" className="text-sm text-moss mb-3">{message}</p>}</> }
function DraftNotice() { return <p className="text-sm text-secondary mb-5">Connections require deployment activation before they accept launches. Archived connections and objects cannot launch.</p> }

export default function LmsConnectionsPage() {
  const { organisationId } = useParams()
  const { organisationMemberships } = useAuth()
  const allowed = organisationMemberships?.some((m) => m.organisation_id === organisationId && m.role === 'admin')
  return <div className="min-h-screen bg-paper"><AppHeader hideNavLinks /><main id="main-content" tabIndex={-1} className="max-w-5xl mx-auto px-4 py-8">
    <Link to={`/provider?org=${organisationId}`} className="inline-block text-sm text-moss hover:underline mb-5">Back to provider</Link>
    {allowed ? <LmsConnectionsPanel key={organisationId} organisationId={organisationId} /> : <p role="alert" className="text-sm text-secondary">Only an administrator of this provider can configure LMS connections.</p>}
  </main></div>
}

export function LmsConnectionsPanel({ organisationId }) {
  const [setup, setSetup] = useState(null)
  async function showSetup(row) {
    setError(null)
    try {
      const { data }=await supabase.auth.getSession()
      const response=await fetch('/api/lti/setup',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+data.session.access_token},body:JSON.stringify({connectionId:row.id})})
      const result=await response.json()
      if(!response.ok) throw new Error(result.error)
      setSetup({...result,id:row.id,name:row.name})
    } catch(err) { setError(err.message) }
  }
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [editor, setEditor] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    listLmsConnections(organisationId).then((data) => { if (live) setRows(data) }).catch((err) => { if (live) setError(err.message) }).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [organisationId])
  function edit(row) { setError(null); setMessage(null); setEditor(row ? { ...row, deployment_ids: row.deployment_ids.join('\n') } : { ...emptyConnection }) }
  function change(key, value) { setEditor((prev) => ({ ...prev, [key]: value })) }
  async function save(e) {
    e.preventDefault(); setBusy(true); setError(null)
    try {
      const saved = await saveLmsConnection(organisationId, editor.id || null, editor)
      setRows((prev) => prev.some((r) => r.id === saved.id) ? prev.map((r) => r.id === saved.id ? saved : r) : [...prev, saved])
      setEditor(null); setMessage('LMS connection saved.')
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  return <section aria-labelledby="lms-connections-heading">
    <div className="flex flex-wrap justify-between items-center gap-3 mb-3"><h1 id="lms-connections-heading" className="font-display text-2xl text-ink">LMS connections</h1>{!editor && <button className={primaryClass} onClick={() => edit(null)}>Add LMS connection</button>}</div>
    <p className="text-sm text-secondary mb-3">Register any LMS supporting LTI 1.3 and Assignment and Grade Services. Use the registration values supplied by its administrator.</p>
    <DraftNotice /><Feedback error={error} message={message} />
    {setup && <div className="border border-hairline rounded-lg p-4 mb-5 space-y-3"><h2 className="font-display text-lg">Register {setup.name}</h2><p className="text-sm">{setup.enabled ? 'Activated for this deployment.' : 'Awaiting deployment activation.'}</p><dl className="text-sm space-y-2">{[['login','Login initiation URL'],['launch','Redirect / launch URL'],['jwks','Public keyset URL'],['deepLink','Deep Linking URL']].map(([key,label])=><div key={key}><dt className="text-secondary">{label}</dt><dd className="break-all select-all">{setup[key]}</dd></div>)}</dl><details><summary className="cursor-pointer text-sm">Deployment activation value</summary><p className="text-xs text-secondary mt-2">Your deployment administrator adds this entry to LTI_ENABLED_CONNECTIONS after checking the LMS registration.</p><pre className="text-xs whitespace-pre-wrap break-all mt-2">{JSON.stringify({[setup.id]:setup.fingerprint},null,2)}</pre></details><button className={buttonClass} onClick={()=>setSetup(null)}>Close registration details</button></div>}
    {editor ? <form onSubmit={save} className="max-w-3xl space-y-4"><h2 className="font-display text-lg">{editor.id ? 'Edit LMS connection' : 'New LMS connection'}</h2>
      <fieldset disabled={busy} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Connection name"><input required maxLength={200} value={editor.name} onChange={(e) => change('name', e.target.value)} className={inputClass} /></Field>
        <Field label="Client ID"><input required maxLength={500} value={editor.client_id} onChange={(e) => change('client_id', e.target.value)} className={inputClass} /></Field>
        {[['issuer', 'Issuer URL'], ['authorization_url', 'Authentication URL'], ['jwks_url', 'Public keyset URL (JWKS)'], ['token_url', 'Access token URL']].map(([key, label]) => <Field key={key} label={label}><input type="url" required maxLength={2048} placeholder="https://" value={editor[key]} onChange={(e) => change(key, e.target.value)} className={inputClass} /></Field>)}
        <div className="sm:col-span-2"><Field label="Deployment IDs (one per line)"><textarea rows={3} required value={editor.deployment_ids} onChange={(e) => change('deployment_ids', e.target.value)} className={inputClass} /></Field></div>
        {editor.id && <Field label="Status"><select value={editor.status} onChange={(e) => change('status', e.target.value)} className={inputClass}><option value="draft">Draft</option><option value="archived">Archived</option></select></Field>}
      </fieldset>
      <p className="text-xs text-secondary">No client secret or private key is needed here. Archiving a connection stops launches and grade delivery.</p>
      <div className="flex justify-end gap-2"><button type="button" disabled={busy} className={buttonClass} onClick={() => { setEditor(null); setError(null) }}>Cancel</button><button disabled={busy} className={primaryClass}>{busy ? 'Saving…' : 'Save connection'}</button></div>
    </form> : loading ? <p role="status" className="text-sm text-secondary">Loading connections…</p> : !rows.length ? <p className="border border-dashed border-hairline rounded-lg py-10 text-center text-secondary">No LMS connections yet.</p> : <ul className="divide-y divide-hairline border border-hairline rounded-lg">
      {rows.map((row) => <li key={row.id} className="p-4 flex flex-wrap items-center gap-3"><div className="flex-1 min-w-0"><p className="font-medium text-sm break-words">{row.name}</p><p className="text-xs text-secondary break-all mt-1">{row.issuer}</p><p className="text-xs text-secondary mt-1"><span className="font-mono">{row.code}</span> · {row.status === 'archived' ? 'Archived' : 'Draft'} · {row.deployment_ids.length} deployment(s)</p></div><button className={buttonClass} onClick={() => showSetup(row)}>Registration details</button><button className={buttonClass} onClick={() => edit(row)} aria-label={`Edit ${row.name}`}>Edit</button></li>)}
    </ul>}
  </section>
}

export function SkillLtiObjectsPanel({ organisationId, skillId, skillName, canManage }) {
  const [rows, setRows] = useState([])
  const [connections, setConnections] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [message, setMessage] = useState(null)
  const [editor, setEditor] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    Promise.all([listSkillLtiObjects(organisationId, skillId), listLmsConnections(organisationId)]).then(([objects, platforms]) => { if (live) { setRows(objects); setConnections(platforms) } }).catch((err) => { if (live) { setError(err.message); setLoadFailed(true) } }).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [organisationId, skillId])
  function edit(row) { setError(null); setMessage(null); setEditor(row ? { ...row, target_level: row.target_level ?? '', connectionIds: row.lti_object_connections.map((l) => l.connection_id) } : { title: skillName, description: '', target_level: '', grade_passback: true, status: 'draft', connectionIds: [] }) }
  function change(key, value) { setEditor((prev) => ({ ...prev, [key]: value })) }
  async function save(e) {
    e.preventDefault(); setBusy(true); setError(null)
    try {
      const { connectionIds, ...form } = editor
      const saved = await saveSkillLtiObject(organisationId, skillId, editor.id || null, { ...form, target_level: editor.target_level === '' ? null : Number(editor.target_level) }, connectionIds)
      const row = { ...saved, lti_object_connections: connectionIds.map((connection_id) => ({ connection_id })) }
      setRows((prev) => prev.some((r) => r.id === row.id) ? prev.map((r) => r.id === row.id ? row : r) : [...prev, row])
      setEditor(null); setMessage('LTI object saved as ' + (row.status === 'archived' ? 'archived.' : 'a draft.'))
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  return <section id="lti-panel" role="tabpanel" aria-labelledby="lti-tab">
    <div className="flex flex-wrap items-center justify-between gap-3 mb-3"><h2 className="font-display text-lg">LTI objects</h2>{canManage && !editor && <button disabled={loading || loadFailed} className={primaryClass} onClick={() => edit(null)}>Create LTI object</button>}</div>
    <DraftNotice /><Feedback error={error} message={message} />
    {editor ? <form onSubmit={save} className="max-w-3xl space-y-4">
      <fieldset disabled={busy} className="space-y-4">
        <Field label="Object title"><input required maxLength={200} value={editor.title} onChange={(e) => change('title', e.target.value)} className={inputClass} /></Field>
        <Field label="Description"><textarea rows={3} maxLength={2000} value={editor.description} onChange={(e) => change('description', e.target.value)} className={inputClass} /></Field>
        <Field label="Target proficiency"><select value={editor.target_level} onChange={(e) => change('target_level', e.target.value)} className={inputClass}><option value="">No target</option>{LEVELS.map((level) => <option key={level} value={level}>{level} — {LEVEL_LABELS[level]}</option>)}</select></Field>
        <label className="flex gap-2 items-center text-sm"><input type="checkbox" className="accent-moss" checked={editor.grade_passback} onChange={(e) => change('grade_passback', e.target.checked)} />Send proficiency grades to the LMS</label>
        <p className="text-xs text-secondary">Current proficiency is reported as 1–5 out of 5. The target does not change the scale. Unassessed skills do not send a grade.</p>
        <fieldset><legend className="text-sm font-medium mb-2">LMS connections</legend>{connections.map((connection) => <label key={connection.id} className="flex items-center gap-2 py-2 text-sm"><input type="checkbox" className="accent-moss" disabled={connection.status === 'archived' && !editor.connectionIds.includes(connection.id)} checked={editor.connectionIds.includes(connection.id)} onChange={(e) => change('connectionIds', e.target.checked ? [...editor.connectionIds, connection.id] : editor.connectionIds.filter((id) => id !== connection.id))} />{connection.name}{connection.status === 'archived' ? ' (archived — remove to save)' : ''}</label>)}{!connections.length && <p className="text-sm text-secondary">No LMS connections yet. You can save this draft and connect it later.</p>}</fieldset>
        {editor.id && <Field label="Status"><select className={inputClass} value={editor.status} onChange={(e) => change('status', e.target.value)}><option value="draft">Draft</option><option value="archived">Archived</option></select></Field>}
      </fieldset>
      <div className="flex justify-end gap-2"><button type="button" disabled={busy} className={buttonClass} onClick={() => { setEditor(null); setError(null) }}>Cancel</button><button disabled={busy} className={primaryClass}>{busy ? 'Saving…' : 'Save object'}</button></div>
    </form> : loading ? <p role="status" className="text-sm text-secondary">Loading LTI objects…</p> : !rows.length ? <p className="border border-dashed border-hairline rounded-lg py-10 text-center text-secondary">No LTI objects for this skill yet.</p> : <ul className="divide-y divide-hairline border border-hairline rounded-lg">{rows.map((row) => <li key={row.id} className="p-4 flex flex-wrap items-center gap-3"><div className="flex-1 min-w-0"><p className="text-sm font-medium break-words">{row.title}</p><p className="text-xs text-secondary mt-1"><span className="font-mono">{row.code}</span> · {row.status === 'archived' ? 'Archived' : 'Draft'} · {row.target_level ? `Target ${row.target_level}` : 'No target'} · {row.grade_passback ? 'Proficiency grades on' : 'Grades off'}</p><p className="text-xs text-secondary mt-1">{row.lti_object_connections.length ? row.lti_object_connections.map((l) => connections.find((c) => c.id === l.connection_id)?.name || 'Unavailable connection').join(', ') : 'No LMS connected'}</p></div>{canManage && <button className={buttonClass} onClick={() => edit(row)} aria-label={`Edit ${row.title}`}>Edit</button>}</li>)}</ul>}
    {canManage && !busy && <Link to={`/provider/organisations/${organisationId}/lms-connections`} className="inline-block mt-5 text-sm text-moss hover:underline">Manage LMS connections</Link>}
  </section>
}
