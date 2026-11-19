import { useEffect, useState } from 'react'
import AccessibleDialog from './AccessibleDialog'
import WhatsAppIcon from './WhatsAppIcon'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import {
  createConnectInvite,
  getOrCreateConnectShareLink,
  isDuplicatePendingConnectInviteError,
  sendInviteEmail,
  whatsappShareUrl,
} from '../lib/connections'
import { isMobileDevice } from '../lib/device'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Invite someone to connect, whether or not they're on LearnScope yet: by
// email, or with a link to share however the learner likes. Either way the
// invitee decides -- nothing is connected until they accept -- and nothing
// here says whether an address already has an account. onSent receives each
// emailed invite, shaped like listSentInvites' rows, for the invites tab.
export default function InviteConnectModal({ onClose, onSent }) {
  const { t } = useLanguage()
  const { user } = useAuth()
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [emailError, setEmailError] = useState(null)
  const [sentTo, setSentTo] = useState([])
  const [link, setLink] = useState(null)
  const [linkError, setLinkError] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    getOrCreateConnectShareLink(user.id)
      .then(setLink)
      .catch((err) => setLinkError(err.message))
  }, [user.id])

  async function handleSend(event) {
    event.preventDefault()
    const address = email.trim()
    setEmailError(null)
    if (!EMAIL_RE.test(address)) {
      setEmailError(t('modals.inviteConnect.invalidEmail'))
      return
    }
    if (address.toLowerCase() === user.email?.toLowerCase()) {
      setEmailError(t('modals.inviteConnect.ownEmail'))
      return
    }
    setSending(true)
    let invite = null
    try {
      invite = await createConnectInvite(address, user.id)
      onSent?.({ ...invite, invitee_email: address, status: 'pending', created_at: new Date().toISOString() })
      await sendInviteEmail({ toEmail: address, shareUrl: invite.url, emailType: 'connect' })
      setSentTo((current) => [...current, address])
      setEmail('')
    } catch (err) {
      if (isDuplicatePendingConnectInviteError(err)) {
        setEmailError(t('modals.inviteConnect.alreadyInvited', { email: address }))
      } else if (invite) {
        // The invite exists (it's on the invites tab, where it can be resent),
        // only the email didn't go.
        setEmailError(t('modals.inviteConnect.emailFailed', { email: address }))
      } else {
        setEmailError(err.message)
      }
    } finally {
      setSending(false)
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(link.url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <AccessibleDialog
      labelledBy="invite-connect-dialog-title"
      onClose={onClose}
      panelClassName="w-full max-w-sm bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
      <h2 id="invite-connect-dialog-title" className="font-display text-2xl text-ink mb-1">
        {t('modals.inviteConnect.title')}
      </h2>
      <p className="text-sm text-secondary mb-4 text-pretty">{t('modals.inviteConnect.subtitle')}</p>

      <div className="space-y-3">
        <form onSubmit={handleSend} noValidate className="rounded-lg border border-hairline p-3 space-y-2">
          <label className="block font-mono text-[10px] uppercase tracking-wide text-secondary" htmlFor="inviteConnectEmail">
            {t('modals.inviteConnect.byEmail')}
          </label>
          <input
            id="inviteConnectEmail"
            type="email"
            autoComplete="off"
            placeholder="someone@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={emailError ? true : undefined}
            aria-describedby={emailError ? 'inviteConnectEmailError' : undefined}
            className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-moss"
          />
          {emailError && <p id="inviteConnectEmailError" role="alert" className="text-sm text-red-700">{emailError}</p>}
          {sentTo.length > 0 && (
            <ul role="status" className="space-y-1">
              {sentTo.map((address) => (
                <li key={address} className="text-sm text-moss">{t('modals.inviteConnect.sent', { email: address })}</li>
              ))}
            </ul>
          )}
          <button
            type="submit"
            disabled={sending || !email.trim()}
            className="w-full rounded-md border border-hairline text-ink py-2 font-medium hover:bg-paper disabled:opacity-60"
          >
            {sending ? t('modals.inviteConnect.sending') : t('modals.inviteConnect.send')}
          </button>
        </form>

        <div className="rounded-lg border border-hairline p-3">
          <span className="block font-mono text-[10px] uppercase tracking-wide text-secondary mb-1">
            {t('modals.inviteConnect.orShareLink')}
          </span>
          <p className="text-xs text-secondary mb-2">{t('modals.inviteConnect.linkHint')}</p>
          {linkError && <p className="text-sm text-red-700 mb-2">{linkError}</p>}
          <div className="flex items-center gap-2">
            <input
              readOnly
              aria-label={t('modals.inviteConnect.linkLabel')}
              value={link ? link.url : t('modals.inviteConnect.generatingLink')}
              onFocus={(e) => e.target.select()}
              className="flex-1 min-w-0 rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-xs font-mono focus:outline-none"
            />
            <button
              type="button"
              onClick={handleCopy}
              disabled={!link}
              className="shrink-0 rounded-md border border-hairline text-ink py-2 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
            >
              {copied ? t('modals.inviteConnect.copied') : t('modals.inviteConnect.copy')}
            </button>
          </div>
          {isMobileDevice() && (
            <a
              href={link ? whatsappShareUrl(t('modals.inviteConnect.whatsappMessage', { url: link.url })) : undefined}
              target="_blank"
              rel="noopener noreferrer"
              aria-disabled={!link}
              className={`flex items-center justify-center gap-2 w-full rounded-md border border-hairline text-ink py-2 font-medium hover:bg-paper mt-2 ${
                !link ? 'pointer-events-none opacity-60' : ''
              }`}
            >
              <WhatsAppIcon />
              {t('modals.inviteConnect.shareViaWhatsApp')}
            </a>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={onClose}
        className="w-full rounded-md bg-moss text-paper py-2 font-medium hover:opacity-90 mt-5"
      >
        {t('modals.inviteConnect.done')}
      </button>
    </AccessibleDialog>
  )
}
