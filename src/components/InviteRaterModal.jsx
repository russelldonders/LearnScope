import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import {
  createInvite,
  getOrCreateShareLink,
  listConnections,
  sendInviteEmail,
  isDuplicatePendingInviteError,
  duplicatePendingInviteMessage,
  whatsappShareUrl,
} from '../lib/connections'
import { isMobileDevice } from '../lib/device'
import WhatsAppIcon from './WhatsAppIcon'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function InviteRaterModal({ skill, onClose }) {
  const { user } = useAuth()
  const [inviterName, setInviterName] = useState(null)
  const [connections, setConnections] = useState([])
  const [selectedConnectionIds, setSelectedConnectionIds] = useState(new Set())
  const [connectionStatus, setConnectionStatus] = useState(new Map())
  const [sendingConnections, setSendingConnections] = useState(false)

  const [emails, setEmails] = useState([])
  const [emailInput, setEmailInput] = useState('')
  const [emailInputError, setEmailInputError] = useState(null)
  const [emailStatus, setEmailStatus] = useState(new Map())
  const [sendingEmails, setSendingEmails] = useState(false)

  const [link, setLink] = useState(null)
  const [linkError, setLinkError] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single()
      .then(({ data }) => setInviterName(data?.full_name || user.email))
    listConnections(user.id).then((list) => setConnections(list.filter((c) => c.email)))
    getOrCreateShareLink(skill.id, user.id)
      .then(setLink)
      .catch((err) => setLinkError(err.message))
  }, [user])

  async function sendInviteTo(toEmail) {
    const invite = await createInvite(skill.id, toEmail, user.id)
    await sendInviteEmail({ toEmail, inviterName, skillName: skill.name, shareUrl: invite.url })
  }

  function toggleConnection(id) {
    setSelectedConnectionIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleInviteConnections() {
    const targets = connections.filter((c) => selectedConnectionIds.has(c.id) && connectionStatus.get(c.id) !== 'sent')
    if (targets.length === 0) return
    setSendingConnections(true)
    setConnectionStatus((prev) => {
      const next = new Map(prev)
      for (const c of targets) next.set(c.id, 'sending')
      return next
    })
    await Promise.all(
      targets.map(async (c) => {
        try {
          await sendInviteTo(c.email)
          setConnectionStatus((prev) => new Map(prev).set(c.id, 'sent'))
        } catch (err) {
          setConnectionStatus((prev) =>
            new Map(prev).set(
              c.id,
              isDuplicatePendingInviteError(err) ? duplicatePendingInviteMessage(c.email) : err.message
            )
          )
        }
      })
    )
    setSendingConnections(false)
  }

  function commitEmailInput() {
    const value = emailInput.trim()
    if (!value) return
    setEmailInputError(null)
    if (!EMAIL_RE.test(value)) {
      setEmailInputError('That doesn\'t look like a valid email address.')
      return
    }
    if (emails.includes(value)) {
      setEmailInput('')
      return
    }
    setEmails((prev) => [...prev, value])
    setEmailInput('')
  }

  function handleEmailInputKeyDown(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      commitEmailInput()
    }
  }

  function removeEmail(value) {
    setEmails((prev) => prev.filter((e) => e !== value))
    setEmailStatus((prev) => {
      if (!prev.has(value)) return prev
      const next = new Map(prev)
      next.delete(value)
      return next
    })
  }

  async function handleSendEmails(e) {
    e.preventDefault()
    commitEmailInput()
    const targets = emails.filter((addr) => emailStatus.get(addr) !== 'sent')
    if (targets.length === 0) return
    setSendingEmails(true)
    setEmailStatus((prev) => {
      const next = new Map(prev)
      for (const addr of targets) next.set(addr, 'sending')
      return next
    })
    await Promise.all(
      targets.map(async (addr) => {
        try {
          await sendInviteTo(addr)
          setEmailStatus((prev) => new Map(prev).set(addr, 'sent'))
        } catch (err) {
          setEmailStatus((prev) =>
            new Map(prev).set(addr, isDuplicatePendingInviteError(err) ? duplicatePendingInviteMessage(addr) : err.message)
          )
        }
      })
    )
    setSendingEmails(false)
  }

  function handleCopy() {
    navigator.clipboard.writeText(link.url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const selectedCount = [...selectedConnectionIds].filter((id) => connectionStatus.get(id) !== 'sent').length

  return (
    <div className="fixed inset-0 bg-ink/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        className="w-full max-w-sm bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-2xl text-ink mb-1">Invite someone to rate this</h2>
        <p className="text-sm text-secondary mb-4">
          They'll be asked to rate "{skill.name}" once they log in or sign up.
        </p>

        {linkError && <p className="text-sm text-red-700 mb-4">{linkError}</p>}

        <div className="space-y-5">
          {connections.length > 0 && (
            <div>
              <span className="block text-sm text-secondary mb-1">Invite existing connections</span>
              <div className="flex flex-wrap gap-2 mb-2">
                {connections.map((c) => {
                  const status = connectionStatus.get(c.id)
                  const selected = selectedConnectionIds.has(c.id)
                  const isError = status && status !== 'sending' && status !== 'sent'
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleConnection(c.id)}
                      disabled={status === 'sending' || status === 'sent'}
                      className={`font-mono text-xs rounded-full px-3 py-1 border transition-colors disabled:opacity-60 ${
                        status === 'sent'
                          ? 'bg-moss text-paper border-moss'
                          : isError
                            ? 'border-red-700 text-red-700'
                            : selected
                              ? 'bg-moss text-paper border-moss'
                              : 'border-hairline text-secondary hover:text-ink'
                      }`}
                    >
                      {status === 'sending'
                        ? `${c.name}…`
                        : status === 'sent'
                          ? `${c.name} ✓`
                          : c.name}
                    </button>
                  )
                })}
              </div>
              {[...connectionStatus.entries()]
                .filter(([, status]) => status && status !== 'sending' && status !== 'sent')
                .map(([id, message]) => (
                  <p key={id} className="text-xs text-red-700 mt-1">
                    {message}
                  </p>
                ))}
              <button
                type="button"
                onClick={handleInviteConnections}
                disabled={selectedCount === 0 || sendingConnections}
                className="w-full rounded-md border border-hairline text-ink py-2 font-medium hover:bg-paper disabled:opacity-60"
              >
                {sendingConnections
                  ? 'Sending…'
                  : selectedCount > 0
                    ? `Invite ${selectedCount} selected`
                    : 'Invite selected'}
              </button>
            </div>
          )}

          {isMobileDevice() && (
            <a
              href={
                link
                  ? whatsappShareUrl(`Can you rate my skill "${skill.name}" on LearnScope? ${link.url}`)
                  : undefined
              }
              target="_blank"
              rel="noopener noreferrer"
              aria-disabled={!link}
              className={`flex items-center justify-center gap-2 w-full rounded-md border border-hairline text-ink py-2 font-medium hover:bg-paper ${
                !link ? 'pointer-events-none opacity-60' : ''
              }`}
            >
              <WhatsAppIcon />
              Share via WhatsApp
            </a>
          )}

          <form onSubmit={handleSendEmails} className="space-y-2">
            <label className="block text-sm text-secondary" htmlFor="inviteEmail">
              Invite by email
            </label>
            {emails.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {emails.map((addr) => {
                  const status = emailStatus.get(addr)
                  const isError = status && status !== 'sending' && status !== 'sent'
                  return (
                    <span
                      key={addr}
                      className={`flex items-center gap-1.5 font-mono text-xs rounded-full pl-3 pr-1.5 py-1 border ${
                        status === 'sent'
                          ? 'bg-moss text-paper border-moss'
                          : isError
                            ? 'border-red-700 text-red-700'
                            : 'border-hairline text-ink'
                      }`}
                    >
                      {status === 'sending' ? `${addr}…` : status === 'sent' ? `${addr} ✓` : addr}
                      {status !== 'sending' && status !== 'sent' && (
                        <button
                          type="button"
                          onClick={() => removeEmail(addr)}
                          aria-label={`Remove ${addr}`}
                          className="hover:opacity-70"
                        >
                          ×
                        </button>
                      )}
                    </span>
                  )
                })}
              </div>
            )}
            <input
              id="inviteEmail"
              type="text"
              placeholder="someone@example.com"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              onKeyDown={handleEmailInputKeyDown}
              onBlur={commitEmailInput}
              className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
            />
            <p className="text-xs text-secondary">Press Enter or comma to add more than one.</p>
            {emailInputError && <p className="text-sm text-red-700">{emailInputError}</p>}
            <button
              type="submit"
              disabled={sendingEmails || (emails.length === 0 && !emailInput.trim())}
              className="w-full rounded-md border border-hairline text-ink py-2 font-medium hover:bg-paper disabled:opacity-60"
            >
              {sendingEmails ? 'Sending…' : emails.length > 1 ? `Send to ${emails.length}` : 'Send by email'}
            </button>
          </form>

          <div>
            <span className="block text-sm text-secondary mb-1">Or copy the share link</span>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={link ? link.url : 'Generating link…'}
                onFocus={(e) => e.target.select()}
                className="flex-1 min-w-0 rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-xs font-mono focus:outline-none"
              />
              <button
                type="button"
                onClick={handleCopy}
                disabled={!link}
                className="shrink-0 rounded-md border border-hairline text-ink py-2 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-md bg-moss text-paper py-2 font-medium hover:opacity-90 mt-5"
        >
          Close
        </button>
      </div>
    </div>
  )
}
