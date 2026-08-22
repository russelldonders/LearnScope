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
import WhatsAppIcon from './WhatsAppIcon'

export default function InviteRaterModal({ skill, onClose }) {
  const { user } = useAuth()
  const [email, setEmail] = useState('')
  const [inviterName, setInviterName] = useState(null)
  const [connections, setConnections] = useState([])
  const [selectedConnectionId, setSelectedConnectionId] = useState(null)
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

  function handleSelectConnection(connection) {
    if (selectedConnectionId === connection.id) {
      setSelectedConnectionId(null)
      setEmail('')
    } else {
      setSelectedConnectionId(connection.id)
      setEmail(connection.email)
    }
  }

  function handleEmailChange(value) {
    setEmail(value)
    setSelectedConnectionId(null)
  }

  async function handleSendEmail(e) {
    e.preventDefault()
    if (!email.trim()) return
    setError(null)
    setSending(true)
    try {
      const invite = await createInvite(skill.id, email.trim(), user.id)
      await sendInviteEmail({
        toEmail: email.trim(),
        inviterName,
        skillName: skill.name,
        shareUrl: invite.url,
      })
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

        <div className="space-y-2 mb-4">
          <p className="text-sm text-ink">Share this link with them:</p>
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
          <a
            href={link ? whatsappShareUrl(`Can you rate my skill "${skill.name}" on LearnScope? ${link.url}`) : undefined}
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
        </div>

        <form onSubmit={handleSendEmail} className="space-y-4 pt-4 border-t border-hairline">
          <p className="text-sm text-secondary">Or send it by email:</p>

          {connections.length > 0 && (
            <div>
              <span className="block text-sm text-secondary mb-1">
                Choose an existing connection
              </span>
              <div className="flex flex-wrap gap-2">
                {connections.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => handleSelectConnection(c)}
                    className={`font-mono text-xs rounded-full px-3 py-1 border transition-colors ${
                      selectedConnectionId === c.id
                        ? 'bg-moss text-paper border-moss'
                        : 'border-hairline text-secondary hover:text-ink'
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm text-secondary mb-1" htmlFor="inviteEmail">
              Email
            </label>
            <input
              id="inviteEmail"
              type="email"
              placeholder="someone@example.com"
              value={email}
              onChange={(e) => handleEmailChange(e.target.value)}
              className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
            />
          </div>

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

        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-md bg-moss text-paper py-2 font-medium hover:opacity-90 mt-4"
        >
          Close
        </button>
      </div>
    </div>
  )
}
