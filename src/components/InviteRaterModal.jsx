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

export default function InviteRaterModal({ skill, onClose }) {
  const { user } = useAuth()
  const [email, setEmail] = useState('')
  const [inviterName, setInviterName] = useState(null)
  const [connections, setConnections] = useState([])
  const [sendingConnectionId, setSendingConnectionId] = useState(null)
  const [sentConnectionId, setSentConnectionId] = useState(null)
  const [connectionError, setConnectionError] = useState(null)
  const [link, setLink] = useState(null)
  const [linkError, setLinkError] = useState(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const [emailSentTo, setEmailSentTo] = useState(null)
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

  async function handleInviteConnection(connection) {
    setConnectionError(null)
    setSendingConnectionId(connection.id)
    try {
      await sendInviteTo(connection.email)
      setSentConnectionId(connection.id)
    } catch (err) {
      setConnectionError({
        id: connection.id,
        message: isDuplicatePendingInviteError(err)
          ? duplicatePendingInviteMessage(connection.email)
          : err.message,
      })
    } finally {
      setSendingConnectionId(null)
    }
  }

  async function handleSendEmail(e) {
    e.preventDefault()
    if (!email.trim()) return
    setError(null)
    setSending(true)
    try {
      await sendInviteTo(email.trim())
      setEmailSentTo(email.trim())
    } catch (err) {
      setError(isDuplicatePendingInviteError(err) ? duplicatePendingInviteMessage(email.trim()) : err.message)
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
    <div className="fixed inset-0 bg-ink/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        className="w-full max-w-sm bg-card border border-hairline rounded-lg p-6"
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
              <span className="block text-sm text-secondary mb-1">Invite an existing connection</span>
              <div className="flex flex-wrap gap-2">
                {connections.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => handleInviteConnection(c)}
                    disabled={sendingConnectionId === c.id || sentConnectionId === c.id}
                    className={`font-mono text-xs rounded-full px-3 py-1 border transition-colors disabled:opacity-60 ${
                      sentConnectionId === c.id
                        ? 'bg-moss text-paper border-moss'
                        : 'border-hairline text-secondary hover:text-ink'
                    }`}
                  >
                    {sendingConnectionId === c.id
                      ? 'Sending…'
                      : sentConnectionId === c.id
                        ? `Sent to ${c.name}`
                        : c.name}
                  </button>
                ))}
              </div>
              {connectionError && <p className="text-xs text-red-700 mt-1">{connectionError.message}</p>}
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

          <form onSubmit={handleSendEmail} className="space-y-2">
            <label className="block text-sm text-secondary" htmlFor="inviteEmail">
              Invite by email
            </label>
            <input
              id="inviteEmail"
              type="email"
              placeholder="someone@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
            />
            {emailSentTo && <p className="text-sm text-ink">Invite sent to {emailSentTo}.</p>}
            {error && <p className="text-sm text-red-700">{error}</p>}
            <button
              type="submit"
              disabled={sending || !email.trim()}
              className="w-full rounded-md border border-hairline text-ink py-2 font-medium hover:bg-paper disabled:opacity-60"
            >
              {sending ? 'Sending…' : 'Send by email'}
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
