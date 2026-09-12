import { useEffect, useState } from 'react'
import { listOrganisations } from '../lib/admin/organisations'
import {
  decideSharing,
  emptySharing,
  listSharingCatalogues,
  listSharingConnections,
  listSharingEmployers,
  removeSharing,
  sendSharingRequest,
  updateSharingSelection,
  validSharing,
} from '../lib/providerSharing'
import ConfirmDialog from './ConfirmDialog'

const button = 'rounded-md border border-hairline px-3 py-2 text-sm text-ink hover:bg-paper disabled:opacity-50'
const primaryButton = 'rounded-md bg-moss px-3 py-2 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-50'

function sameSelection(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function Selection({ catalogues, value, onChange }) {
  const update = (id, patch) => onChange?.({
    ...value,
    catalogues: value.catalogues.map((catalogue) => catalogue.id === id ? { ...catalogue, ...patch } : catalogue),
  })

  return (
    <fieldset className="space-y-4" disabled={!onChange}>
      <legend className="font-medium text-ink mb-2">Catalogues and courses</legend>
      <label className="flex gap-2 items-start text-sm py-2">
        <input type="checkbox" checked={value.all} onChange={(event) => onChange?.({ all: event.target.checked, catalogues: [] })} />
        <span>All catalogues and courses<span className="block text-secondary">Includes future catalogues, courses and updates.</span></span>
      </label>
      {!value.all && catalogues.map((catalogue) => {
        const selected = value.catalogues.find((item) => item.id === catalogue.id)
        const courses = (catalogue.course_catalogue_publications ?? [])
          .filter((publication) => publication.published_at && publication.course_catalogue?.status === 'approved' && publication.course_catalogue.is_current_published)
          .map((publication) => publication.course_catalogue)
        return (
          <div key={catalogue.id} className="border-t border-hairline pt-3">
            <label className="flex items-start gap-2 text-sm py-2">
              <input type="checkbox" checked={!!selected} onChange={(event) => onChange({
                ...value,
                catalogues: event.target.checked
                  ? [...value.catalogues, { id: catalogue.id, all: true, courses: [] }]
                  : value.catalogues.filter((item) => item.id !== catalogue.id),
              })} />
              <span className="font-medium break-words">{catalogue.name}</span>
            </label>
            {selected && (
              <div className="pl-6 space-y-2">
                <label className="flex gap-2 items-start text-sm py-2">
                  <input type="checkbox" checked={selected.all} onChange={(event) => update(catalogue.id, { all: event.target.checked, courses: [] })} />
                  <span>All courses, including future additions and updates</span>
                </label>
                {!selected.all && (
                  <>
                    <p className="text-xs text-secondary">Only the selected published course versions will be enabled.</p>
                    {courses.length === 0 && <p className="text-sm text-secondary">No published courses in this catalogue.</p>}
                    {courses.map((course) => (
                      <label key={course.id} className="flex gap-2 items-start text-sm py-2">
                        <input type="checkbox" checked={selected.courses.includes(course.id)} onChange={(event) => update(catalogue.id, {
                          courses: event.target.checked
                            ? [...selected.courses, course.id]
                            : selected.courses.filter((id) => id !== course.id),
                        })} />
                        <span className="break-words">{course.name}</span>
                      </label>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        )
      })}
      {!value.all && catalogues.length === 0 && <p className="text-sm text-secondary">This provider has no catalogues yet. Choose all to include future catalogues.</p>}
    </fieldset>
  )
}

function Agreement({ row, side, name, busy, pending = false, onDecision, onRemove, onUpdate }) {
  const selection = row.pending_sharing ?? row.sharing
  const initiator = row.pending_sharing ? row.pending_initiated_by : row.initiated_by
  const hasPendingApproval = pending || !!row.pending_sharing
  const incoming = hasPendingApproval && initiator !== side
  const [catalogues, setCatalogues] = useState(null)
  const [draft, setDraft] = useState(selection)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const changed = !sameSelection(draft, selection)

  useEffect(() => setDraft(selection), [selection])

  async function review() {
    const nextOpen = !open
    setOpen(nextOpen)
    if (nextOpen && !catalogues) {
      try {
        setCatalogues(await listSharingCatalogues(row.provider_organisation_id))
        setError('')
      } catch (err) {
        setError(err.message)
      }
    }
  }

  const status = hasPendingApproval
    ? incoming
      ? row.pending_sharing ? 'Approval needed for an updated selection' : 'Awaiting your approval'
      : row.pending_sharing ? 'Selection update sent for approval' : `Awaiting ${side === 'employer' ? 'provider' : 'employer'} approval`
    : row.pending_sharing ? 'Linked · selection update pending' : 'Linked'

  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-medium text-ink break-words">{name}</h3>
          <p className="text-sm text-secondary">{status}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} onClick={review} aria-expanded={open}>
            {open ? 'Hide selection' : row.pending_sharing ? 'Review update' : pending ? 'Review selection' : 'Update selection'}
          </button>
          <button type="button" className={button} disabled={busy} onClick={() => onRemove(row)}>
            {pending && row.status === 'pending' ? 'Remove request' : 'End sharing'}
          </button>
        </div>
      </div>
      {open && (
        <div className="mt-4 space-y-4 border-t border-hairline pt-4">
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          {catalogues ? <Selection catalogues={catalogues} value={draft} onChange={setDraft} /> : !error && <p role="status">Loading selection…</p>}
          {catalogues && !selection.all && selection.catalogues.some((item) => !catalogues.some((catalogue) => catalogue.id === item.id)) && (
            <p className="text-sm text-secondary">A selected catalogue is no longer available. Removed content will not be shared.</p>
          )}
          {catalogues && !hasPendingApproval && <p className="text-sm text-secondary">Your current selection stays active until the other organisation approves these changes.</p>}
          {catalogues && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className={hasPendingApproval ? button : primaryButton} disabled={busy || !changed || !validSharing(draft)} onClick={() => onUpdate(row, draft)}>
                {hasPendingApproval ? 'Save selection' : 'Send changes for approval'}
              </button>
              {incoming && (
                <>
                  <button type="button" className={primaryButton} disabled={busy || changed} onClick={() => onDecision(row, true)}>
                    Approve {row.pending_sharing ? 'update' : 'sharing'}
                  </button>
                  <button type="button" className={button} disabled={busy || changed} onClick={() => onDecision(row, false)}>Decline</button>
                </>
              )}
            </div>
          )}
          {incoming && changed && <p className="text-xs text-secondary">Save your selection before approving or declining.</p>}
        </div>
      )}
    </li>
  )
}

export default function ProviderSharingPanel({ side = 'employer', employer, organisation, userId }) {
  const id = side === 'employer' ? employer.id : organisation.id
  const [rows, setRows] = useState([])
  const [directory, setDirectory] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [requestOpen, setRequestOpen] = useState(false)
  const [target, setTarget] = useState(null)
  const [catalogues, setCatalogues] = useState(null)
  const [sharing, setSharing] = useState(emptySharing)
  const [busy, setBusy] = useState(false)
  const [removeTarget, setRemoveTarget] = useState(null)

  async function load() {
    const [links, organisations] = await Promise.all([
      listSharingConnections(side, id),
      side === 'employer' ? listOrganisations() : listSharingEmployers(id),
    ])
    setRows(links)
    setDirectory(organisations)
  }

  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([listSharingConnections(side, id), side === 'employer' ? listOrganisations() : listSharingEmployers(id)])
      .then(([links, organisations]) => {
        if (active) {
          setRows(links)
          setDirectory(organisations)
        }
      })
      .catch((err) => { if (active) setError(err.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [side, id])

  useEffect(() => {
    let active = true
    if (!target) return undefined
    setCatalogues(null)
    listSharingCatalogues(side === 'provider' ? id : target.id)
      .then((data) => { if (active) setCatalogues(data) })
      .catch((err) => { if (active) setError(err.message) })
    return () => { active = false }
  }, [target, side, id])

  const otherId = (row) => side === 'employer' ? row.provider_organisation_id : row.employer_id
  const name = (row) => directory.find((item) => item.id === otherId(row))?.name || 'Organisation unavailable'
  const accepted = rows.filter((row) => row.status === 'accepted')
  const pendingRows = rows.filter((row) => row.status === 'pending')
  const pendingInitiator = (row) => row.pending_sharing ? row.pending_initiated_by : row.initiated_by
  const incoming = pendingRows.filter((row) => pendingInitiator(row) !== side)
  const sent = pendingRows.filter((row) => pendingInitiator(row) === side)
  const mainProvider = side === 'employer' ? directory.find((item) => item.id === employer.provider_organisation_id) : null
  const matches = directory
    .filter((item) => (
      side === 'employer' ? item.id !== employer.provider_organisation_id : item.provider_organisation_id !== id
    ) && !rows.some((row) => otherId(row) === item.id && row.status !== 'declined') && item.name.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 20)

  async function mutate(action, message) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
      await load()
      setNotice(message)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  function decision(row, accept) {
    return mutate(
      () => decideSharing(row, accept),
      row.pending_sharing
        ? accept ? 'Selection update approved.' : 'Selection update declined. The current selection is unchanged.'
        : accept ? 'Sharing approved.' : 'Request declined.',
    )
  }

  function updateSelection(row, nextSharing) {
    return mutate(
      () => updateSharingSelection(row, nextSharing, side),
      row.status === 'accepted' ? 'Changes sent for approval. The current selection remains active.' : 'Selection updated.',
    )
  }

  function closeRequest() {
    setRequestOpen(false)
    setTarget(null)
    setQuery('')
    setSharing(emptySharing())
  }

  const sectionTitle = side === 'employer' ? 'Linked providers' : 'Linked employers'
  const inviteTitle = side === 'employer' ? 'Provider invitations' : 'Employer requests'

  return (
    <section aria-label={side === 'employer' ? 'Linked providers' : 'Employer sharing'} className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-lg text-ink">{sectionTitle}</h2>
          <p className="text-sm text-secondary mt-1 max-w-2xl">Choose which catalogues and courses each organisation can use. New links and later changes require approval.</p>
        </div>
        <button type="button" className={primaryButton} onClick={() => requestOpen ? closeRequest() : setRequestOpen(true)}>
          {requestOpen ? 'Cancel' : side === 'employer' ? 'Link a provider' : 'Link an employer'}
        </button>
      </div>

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="text-sm text-moss">{notice}</p>}

      {requestOpen && (
        <div className="border-y border-hairline py-5">
          {!target ? (
            <>
              <label className="block text-sm text-secondary mb-2" htmlFor={`sharing-search-${side}`}>Search {side === 'employer' ? 'providers' : 'employers'} by name</label>
              <input id={`sharing-search-${side}`} className="w-full max-w-md rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink" value={query} onChange={(event) => setQuery(event.target.value)} />
              {query.trim() && (
                <ul className="mt-2 max-w-md divide-y divide-hairline">
                  {matches.map((item) => (
                    <li key={item.id} className="flex flex-wrap justify-between gap-3 py-2">
                      <span className="text-sm break-words">{item.name}</span>
                      <button type="button" className={button} onClick={() => {
                        setTarget(item)
                        setSharing(emptySharing())
                        setError('')
                      }}>Select catalogues</button>
                    </li>
                  ))}
                  {matches.length === 0 && <li className="text-sm text-secondary py-2">No matching organisations available.</li>}
                </ul>
              )}
            </>
          ) : (
            <div className="space-y-4">
              <h3 className="font-medium text-ink">{target.name}</h3>
              {catalogues ? <Selection value={sharing} onChange={setSharing} catalogues={catalogues} /> : <p role="status">Loading catalogues…</p>}
              <div className="flex gap-2">
                <button type="button" className={primaryButton} disabled={busy || !catalogues || !validSharing(sharing)} onClick={() => mutate(async () => {
                  await sendSharingRequest({
                    employerId: side === 'employer' ? id : target.id,
                    providerId: side === 'provider' ? id : target.id,
                    userId,
                    side,
                    sharing,
                    ...(rows.find((row) => otherId(row) === target.id && row.status === 'declined')?.id
                      ? { requestId: rows.find((row) => otherId(row) === target.id && row.status === 'declined').id }
                      : {}),
                  })
                  closeRequest()
                }, 'Sent. Sharing will begin after approval.')}>{busy ? 'Sending…' : 'Send for approval'}</button>
                <button type="button" className={button} disabled={busy} onClick={() => setTarget(null)}>Back</button>
              </div>
            </div>
          )}
        </div>
      )}

      {loading ? <p role="status">Loading connections…</p> : (
        <>
          <div>
            <h3 className="font-medium text-ink mb-3">{sectionTitle}</h3>
            <ul className="divide-y divide-hairline border-y border-hairline">
              {side === 'employer' && (
                <li className="py-4 first:pt-0">
                  <h4 className="font-medium text-ink">{mainProvider?.name || employer.name}</h4>
                  <p className="text-sm text-secondary">Main provider · All published courses · Permanent</p>
                </li>
              )}
              {accepted.map((row) => <Agreement key={row.id} row={row} side={side} busy={busy} name={name(row)} onDecision={decision} onRemove={setRemoveTarget} onUpdate={updateSelection} />)}
              {side === 'provider' && accepted.length === 0 && <li className="py-4 text-sm text-secondary">No linked employers yet.</li>}
            </ul>
          </div>

          {incoming.length > 0 && (
            <div>
              <h3 className="font-medium text-ink mb-3">{inviteTitle}</h3>
              <ul className="divide-y divide-hairline border-y border-hairline">
                {incoming.map((row) => <Agreement key={row.id} row={row} side={side} busy={busy} pending name={name(row)} onDecision={decision} onRemove={setRemoveTarget} onUpdate={updateSelection} />)}
              </ul>
            </div>
          )}

          {sent.length > 0 && (
            <div>
              <h3 className="font-medium text-ink mb-3">Sent requests</h3>
              <ul className="divide-y divide-hairline border-y border-hairline">
                {sent.map((row) => <Agreement key={row.id} row={row} side={side} busy={busy} pending name={name(row)} onDecision={decision} onRemove={setRemoveTarget} onUpdate={updateSelection} />)}
              </ul>
            </div>
          )}
        </>
      )}

      {removeTarget && (
        <ConfirmDialog
          confirmLabel={removeTarget.status === 'pending' ? 'Remove request' : 'Remove connection'}
          message={`Remove the connection with ${name(removeTarget)}? New course assignments through this connection will stop. Existing learner enrolments will remain.`}
          confirming={busy}
          onCancel={() => setRemoveTarget(null)}
          onConfirm={() => mutate(async () => {
            await removeSharing(removeTarget.id)
            setRemoveTarget(null)
          }, 'Connection removed.')}
        />
      )}
    </section>
  )
}
