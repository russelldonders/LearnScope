import { useId, useMemo, useState } from 'react'
import AccessibleDialog from './AccessibleDialog'

export default function PlanInviteDialog({
  planTitle,
  connections,
  invitations,
  busy,
  error,
  onClose,
  onInvite,
  t,
}) {
  const titleId = useId()
  const descriptionId = useId()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState([])
  const existingByRecipient = useMemo(
    () => new Map(invitations.filter((invite) => ['pending', 'accepted'].includes(invite.status)).map((invite) => [invite.recipient_id, invite.status])),
    [invitations],
  )
  const visibleConnections = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return connections
    return connections.filter((connection) => `${connection.name} ${connection.email ?? ''}`.toLowerCase().includes(needle))
  }, [connections, query])

  function toggle(connectionId) {
    setSelected((current) => current.includes(connectionId)
      ? current.filter((id) => id !== connectionId)
      : [...current, connectionId])
  }

  return (
    <AccessibleDialog
      labelledBy={titleId}
      describedBy={descriptionId}
      onClose={busy ? undefined : onClose}
      closeOnBackdrop={!busy}
      panelClassName="w-full max-w-lg max-h-[90vh] overflow-hidden rounded-xl border border-hairline bg-card shadow-xl"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (selected.length > 0) onInvite(selected)
        }}
        className="flex max-h-[90vh] flex-col"
      >
        <div className="border-b border-hairline px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id={titleId} className="font-display text-xl text-ink">{t('plans.inviteTitle')}</h2>
              <p id={descriptionId} className="mt-1 text-sm text-secondary">
                {t('plans.inviteDescription', { title: planTitle })}
              </p>
            </div>
            <button type="button" onClick={onClose} disabled={busy} aria-label={t('plans.closeInvite')} className="-mr-1 rounded-md p-1.5 text-secondary hover:bg-paper hover:text-ink disabled:opacity-50">
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 6 12 12M18 6 6 18" /></svg>
            </button>
          </div>
          <div className="mt-3 rounded-md border border-moss/25 bg-moss/5 px-3 py-2 text-xs leading-relaxed text-secondary">
            {t('plans.invitePrivacy')}
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto px-5 py-4">
          {connections.length > 5 && (
            <label className="mb-3 block">
              <span className="sr-only">{t('plans.searchConnections')}</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('plans.searchConnections')}
                className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-moss focus:ring-1 focus:ring-moss"
              />
            </label>
          )}
          {busy && connections.length === 0 && !error ? (
            <p className="py-8 text-center text-sm text-secondary">{t('plans.loadingConnections')}</p>
          ) : connections.length === 0 ? (
            <p className="rounded-lg border border-dashed border-hairline px-4 py-8 text-center text-sm text-secondary">{t('plans.noConnectionsToInvite')}</p>
          ) : visibleConnections.length === 0 ? (
            <p className="py-6 text-center text-sm text-secondary">{t('plans.noConnectionMatches')}</p>
          ) : (
            <fieldset>
              <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-secondary">{t('plans.chooseConnections')}</legend>
              <div className="space-y-2">
                {visibleConnections.map((connection) => {
                  const existingStatus = existingByRecipient.get(connection.id)
                  const disabled = Boolean(existingStatus) || busy
                  return (
                    <label key={connection.id} className={`flex items-center gap-3 rounded-lg border px-3 py-3 ${disabled ? 'border-hairline bg-paper/60 text-secondary' : 'cursor-pointer border-hairline hover:border-moss/60'}`}>
                      <input
                        type="checkbox"
                        checked={selected.includes(connection.id)}
                        onChange={() => toggle(connection.id)}
                        disabled={disabled}
                        className="h-4 w-4 rounded border-hairline text-moss focus:ring-moss"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">{connection.name}</span>
                        {connection.email && <span className="block truncate text-xs text-secondary">{connection.email}</span>}
                      </span>
                      {existingStatus && (
                        <span className="rounded-full border border-hairline px-2 py-0.5 text-xs text-secondary">
                          {t(`plans.inviteStatus.${existingStatus}`)}
                        </span>
                      )}
                    </label>
                  )
                })}
              </div>
            </fieldset>
          )}
          {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-hairline px-5 py-4">
          <p className="text-xs text-secondary">{t('plans.selectedCount', { count: selected.length })}</p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="rounded-md border border-hairline px-3 py-2 text-sm font-medium text-ink hover:border-moss disabled:opacity-50">
              {t('plans.cancel')}
            </button>
            <button type="submit" disabled={busy || selected.length === 0} className="rounded-md bg-moss px-3 py-2 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-50">
              {busy ? t('plans.sendingInvites') : t('plans.sendInvites')}
            </button>
          </div>
        </div>
      </form>
    </AccessibleDialog>
  )
}
