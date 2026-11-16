import { useEffect, useId, useMemo, useState } from 'react'
import AccessibleDialog from './AccessibleDialog'
import WhatsAppIcon from './WhatsAppIcon'
import { whatsappShareUrl } from '../lib/connections'
import { getPlanShareLink, inviteEmailsToPlan, replacePlanShareLink } from '../lib/learnerPlans'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Inviting people to follow their own copy of a plan, the ways a skill can
// be shared: connections, email, or a link (copied, or sent via WhatsApp).
// Whoever accepts by email or link needn't be a connection.
export default function PlanInviteDialog({
  planId,
  planTitle,
  connections,
  invitations,
  busy,
  error,
  onClose,
  onInvite,
  onInvited,
  t,
}) {
  const titleId = useId()
  const descriptionId = useId()
  const emailInputId = useId()
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

  // Email
  const [emailText, setEmailText] = useState('')
  const [emailError, setEmailError] = useState(null)
  const [emailResults, setEmailResults] = useState([])
  const [sendingEmails, setSendingEmails] = useState(false)

  async function sendEmails(event) {
    event.preventDefault()
    const addresses = [...new Set(emailText.split(/[\s,;]+/).map((value) => value.trim()).filter(Boolean))]
    if (addresses.length === 0) return
    const invalid = addresses.filter((value) => !EMAIL_RE.test(value))
    if (invalid.length) {
      setEmailError(t('plans.invalidEmails', { emails: invalid.join(', ') }))
      return
    }
    setEmailError(null)
    setSendingEmails(true)
    try {
      const results = await inviteEmailsToPlan(planId, planTitle, addresses)
      setEmailResults(results)
      setEmailText(results.filter((result) => !result.ok).map((result) => result.email).join(', '))
      onInvited?.()
    } catch (err) {
      setEmailError(err.message)
    } finally {
      setSendingEmails(false)
    }
  }

  // Share link
  const [link, setLink] = useState(null)
  const [linkError, setLinkError] = useState(null)
  const [copied, setCopied] = useState(false)
  const [confirmingNewLink, setConfirmingNewLink] = useState(false)
  const [replacingLink, setReplacingLink] = useState(false)

  useEffect(() => {
    let active = true
    getPlanShareLink(planId)
      .then((url) => { if (active) setLink(url) })
      .catch((err) => { if (active) setLinkError(err.message) })
    return () => { active = false }
  }, [planId])

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setLinkError(t('plans.copyFailed'))
    }
  }

  async function newLink() {
    setLinkError(null)
    setReplacingLink(true)
    try {
      setLink(await replacePlanShareLink(planId))
      setConfirmingNewLink(false)
    } catch (err) {
      setLinkError(err.message)
    } finally {
      setReplacingLink(false)
    }
  }

  const sectionHeading = 'mb-2 text-xs font-medium uppercase tracking-wide text-secondary'

  return (
    <AccessibleDialog
      labelledBy={titleId}
      describedBy={descriptionId}
      onClose={busy ? undefined : onClose}
      closeOnBackdrop={!busy}
      panelClassName="w-full max-w-lg max-h-[90vh] overflow-hidden rounded-xl border border-hairline bg-card shadow-xl"
    >
      <div className="flex max-h-[90vh] flex-col">
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

        <div className="min-h-0 space-y-5 overflow-y-auto px-5 py-4">
          <form
            aria-label={t('plans.inviteConnectionsHeading')}
            onSubmit={(event) => {
              event.preventDefault()
              if (selected.length > 0) onInvite(selected)
            }}
          >
            <h3 className={sectionHeading}>{t('plans.inviteConnectionsHeading')}</h3>
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
              <p className="py-4 text-center text-sm text-secondary">{t('plans.loadingConnections')}</p>
            ) : connections.length === 0 ? (
              <p className="rounded-lg border border-dashed border-hairline px-4 py-4 text-center text-sm text-secondary">{t('plans.noConnectionsToInvite')}</p>
            ) : visibleConnections.length === 0 ? (
              <p className="py-4 text-center text-sm text-secondary">{t('plans.noConnectionMatches')}</p>
            ) : (
              <fieldset>
                <legend className="sr-only">{t('plans.chooseConnections')}</legend>
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
            {connections.length > 0 && (
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-xs text-secondary">{t('plans.selectedCount', { count: selected.length })}</p>
                <button type="submit" disabled={busy || selected.length === 0} className="rounded-md bg-moss px-3 py-2 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-50">
                  {busy ? t('plans.sendingInvites') : t('plans.sendInvites')}
                </button>
              </div>
            )}
          </form>

          <form onSubmit={sendEmails} className="border-t border-hairline pt-4">
            <label htmlFor={emailInputId} className={`block ${sectionHeading}`}>{t('plans.inviteByEmailHeading')}</label>
            <input
              id={emailInputId}
              type="text"
              inputMode="email"
              autoComplete="off"
              value={emailText}
              onChange={(event) => setEmailText(event.target.value)}
              placeholder="someone@example.com, another@example.com"
              className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-moss focus:ring-1 focus:ring-moss"
            />
            <p className="mt-1 text-xs text-secondary">{t('plans.inviteByEmailHint')}</p>
            {emailError && <p role="alert" className="mt-2 text-sm text-red-700">{emailError}</p>}
            {emailResults.length > 0 && (
              <ul role="status" className="mt-2 space-y-1 text-xs">
                {emailResults.map((result) => (
                  <li key={result.email} className={result.ok ? 'text-moss' : 'text-red-700'}>
                    {result.ok ? t('plans.emailSentTo', { email: result.email }) : t('plans.emailFailedTo', { email: result.email, error: result.error })}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex justify-end">
              <button type="submit" disabled={sendingEmails || !emailText.trim()} className="rounded-md border border-hairline px-3 py-2 text-sm font-medium text-ink hover:border-moss disabled:opacity-50">
                {sendingEmails ? t('plans.sendingInvites') : t('plans.sendEmailInvites')}
              </button>
            </div>
          </form>

          <section aria-label={t('plans.shareLinkHeading')} className="border-t border-hairline pt-4">
            <h3 className={sectionHeading}>{t('plans.shareLinkHeading')}</h3>
            <p className="mb-2 text-xs text-secondary">{t('plans.shareLinkHint')}</p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                aria-label={t('plans.shareLinkHeading')}
                value={link ?? t('plans.generatingLink')}
                onFocus={(event) => event.target.select()}
                className="min-w-0 flex-1 rounded-md border border-hairline bg-paper px-3 py-2 font-mono text-xs text-ink focus:outline-none"
              />
              <button type="button" onClick={copyLink} disabled={!link} className="shrink-0 rounded-md border border-hairline px-3 py-2 text-sm font-medium text-ink hover:border-moss disabled:opacity-50">
                {copied ? t('plans.copied') : t('plans.copyLink')}
              </button>
            </div>
            <a
              href={link ? whatsappShareUrl(t('plans.whatsappMessage', { title: planTitle, url: link })) : undefined}
              target="_blank"
              rel="noopener noreferrer"
              aria-disabled={!link}
              className={`mt-2 flex w-full items-center justify-center gap-2 rounded-md border border-hairline py-2 text-sm font-medium text-ink hover:border-moss ${!link ? 'pointer-events-none opacity-50' : ''}`}
            >
              <WhatsAppIcon />
              {t('plans.shareViaWhatsApp')}
            </a>
            {linkError && <p role="alert" className="mt-2 text-sm text-red-700">{linkError}</p>}
            <div className="mt-3 text-xs">
              {confirmingNewLink ? (
                <div role="group" aria-label={t('plans.newLink')} className="rounded-md border border-hairline bg-paper p-3">
                  <p className="text-ink">{t('plans.newLinkConfirm')}</p>
                  <div className="mt-2 flex gap-3">
                    <button type="button" onClick={newLink} disabled={replacingLink} className="font-medium text-red-700 hover:underline disabled:opacity-50">
                      {t('plans.newLinkConfirmButton')}
                    </button>
                    <button type="button" onClick={() => setConfirmingNewLink(false)} disabled={replacingLink} className="text-secondary hover:text-ink">
                      {t('plans.cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirmingNewLink(true)} disabled={!link} className="font-medium text-moss hover:underline disabled:opacity-50">
                  {t('plans.newLink')}
                </button>
              )}
            </div>
          </section>
        </div>

        <div className="flex justify-end border-t border-hairline px-5 py-4">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-md border border-hairline px-3 py-2 text-sm font-medium text-ink hover:border-moss disabled:opacity-50">
            {t('plans.done')}
          </button>
        </div>
      </div>
    </AccessibleDialog>
  )
}
