import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import { createInvite } from '../lib/connections'

export default function InviteRaterModal({ skill, onClose }) {
  const { user } = useAuth()
  const [email, setEmail] = useState('')
  const [inviterName, setInviterName] = useState(null)
  const [sending, setSending] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single()
      .then(({ data }) => setInviterName(data?.full_name || user.email))
  }, [user])

  async function handleSendEmail(e) {
    e.preventDefault()
    if (!email.trim()) return
    setError(null)
    setSending(true)
    try {
      const invite = await createInvite(skill.id, email.trim(), user.id)
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const res = await fetch('/api/send-invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          toEmail: email.trim(),
          inviterName,
          skillName: skill.name,
          shareUrl: invite.url,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to send invite email.')
      }
      setResult({ ...invite, sentTo: email.trim() })
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  async function handleGenerateLink() {
    setError(null)
    setGenerating(true)
    try {
      const invite = await createInvite(skill.id, email.trim() || null, user.id)
      setResult(invite)
    } catch (err) {
      setError(err.message)
    } finally {
      setGenerating(false)
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(result.url)
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

        {result ? (
          <div className="space-y-3">
            {result.sentTo ? (
              <p className="text-sm text-ink">Invite sent to {result.sentTo}.</p>
            ) : (
              <p className="text-sm text-ink">Share this link with them:</p>
            )}
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={result.url}
                onFocus={(e) => e.target.select()}
                className="flex-1 min-w-0 rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-xs font-mono focus:outline-none"
              />
              <button
                type="button"
                onClick={handleCopy}
                className="shrink-0 rounded-md border border-hairline text-ink py-2 px-3 text-sm font-medium hover:bg-paper"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-md bg-moss text-paper py-2 font-medium hover:opacity-90"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSendEmail} className="space-y-4">
            <div>
              <label className="block text-sm text-secondary mb-1" htmlFor="inviteEmail">
                Email (optional)
              </label>
              <input
                id="inviteEmail"
                type="email"
                placeholder="someone@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
              />
            </div>

            {error && <p className="text-sm text-red-700">{error}</p>}

            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={sending || generating || !email.trim()}
                className="flex-1 rounded-md bg-moss text-paper py-2 font-medium hover:opacity-90 disabled:opacity-60"
              >
                {sending ? 'Sending…' : 'Send by email'}
              </button>
              <button
                type="button"
                onClick={handleGenerateLink}
                disabled={sending || generating}
                className="flex-1 rounded-md border border-hairline text-ink py-2 font-medium hover:bg-paper disabled:opacity-60"
              >
                {generating ? 'Generating…' : 'Just generate a link'}
              </button>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-full text-sm text-secondary hover:text-ink"
            >
              Cancel
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
