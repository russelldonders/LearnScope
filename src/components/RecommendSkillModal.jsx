import { useEffect, useState } from 'react'
import AccessibleDialog from './AccessibleDialog'
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
import { getOrCreateMyDefaultManagerTeam, inviteConnectionToManagerTeam } from '../lib/managerTeams'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Sends someone an invite to add this same skill to their own profile and
// start tracking it -- same connection_invites/share_code mechanism as
// InviteRaterModal (invite-to-assess), just invite_type='recommend' instead
// of 'rate', so the two flows share one delivery system (existing
// connections, WhatsApp, email, share link) that only differs in what
// accepting it does.
export default function RecommendSkillModal({ skill, onClose }) {
  const { user } = useAuth()
  const [inviterName, setInviterName] = useState(null)
  const [connections, setConnections] = useState([])
  const [selectedConnectionIds, setSelectedConnectionIds] = useState(new Set())
  const [connectionStatus, setConnectionStatus] = useState(new Map())
  const [sendingConnections, setSendingConnections] = useState(false)
  // Also inviting to the manager team only ever applies to the "Recommend to
  // a connection" list below: invite_connection_to_manager_team(_by_email)
  // both require an existing connections row (a deliberate constraint of
  // that feature, not something to route around here), which the email/
  // share-link paths below can't guarantee -- someone typed into the email
  // field is very often *not* an existing connection yet, that's the point
  // of that path. teamId resolves lazily (get-or-create "My team") only the
  // first time this is actually used, so opening this modal and never
  // checking the box never creates a manager workspace for someone who
  // isn't one.
  const [alsoInviteToTeam, setAlsoInviteToTeam] = useState(false)
  const [teamId, setTeamId] = useState(null)
  const [teamInviteNotices, setTeamInviteNotices] = useState([])

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
    getOrCreateShareLink(skill.id, user.id, 'recommend')
      .then(setLink)
      .catch((err) => setLinkError(err.message))
  }, [user])

  async function sendInviteTo(toEmail) {
    const invite = await createInvite(skill.id, toEmail, user.id, 'recommend')
    await sendInviteEmail({ toEmail, inviterName, skillName: skill.name, shareUrl: invite.url, emailType: 'recommend' })
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
    setTeamInviteNotices([])
    setConnectionStatus((prev) => {
      const next = new Map(prev)
      for (const c of targets) next.set(c.id, 'sending')
      return next
    })

    // Resolved once, lazily, and reused for every target in this send --
    // not per-target, so checking the box for a multi-select send doesn't
    // race to create "My team" more than once.
    let resolvedTeamId = teamId
    if (alsoInviteToTeam && !resolvedTeamId) {
      try {
        resolvedTeamId = await getOrCreateMyDefaultManagerTeam()
        setTeamId(resolvedTeamId)
      } catch (err) {
        setTeamInviteNotices((prev) => [...prev, `Couldn't set up your team: ${err.message}`])
      }
    }

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
          return
        }
        // The team invite is best-effort and independent of the skill
        // recommendation above: a failure here (e.g. they're already a
        // pending/active team member) never undoes the recommendation that
        // already sent successfully.
        if (alsoInviteToTeam && resolvedTeamId) {
          try {
            await inviteConnectionToManagerTeam(resolvedTeamId, c.id)
          } catch (err) {
            setTeamInviteNotices((prev) => [...prev, `${c.name}: ${err.message}`])
          }
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
    <AccessibleDialog
      labelledBy="recommend-skill-dialog-title"
      onClose={onClose}
      panelClassName="w-full max-w-sm bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
        <h2 id="recommend-skill-dialog-title" className="font-display text-2xl text-ink mb-1">
          Recommend this skill
        </h2>
        <p className="text-sm text-secondary mb-4">
          They'll be invited to add "{skill.name}" to their own profile and start tracking it.
        </p>

        {linkError && <p className="text-sm text-red-700 mb-4">{linkError}</p>}

        <div className="space-y-5">
          {connections.length > 0 && (
            <div>
              <span className="block text-sm text-secondary mb-1">Recommend to a connection</span>
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
              <label className="flex items-start gap-2 mt-2 mb-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={alsoInviteToTeam}
                  onChange={(e) => setAlsoInviteToTeam(e.target.checked)}
                  className="mt-0.5 rounded border-hairline accent-moss"
                />
                <span>
                  Also invite them to join your team
                  <span className="block text-xs text-secondary">
                    If they accept, you'll become their manager and can share learning with them.
                  </span>
                </span>
              </label>
              {teamInviteNotices.map((notice, index) => (
                <p key={index} className="text-xs text-red-700 mt-1">
                  {notice}
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
                    ? `Recommend to ${selectedCount} selected`
                    : 'Recommend to selected'}
              </button>
            </div>
          )}

          {isMobileDevice() && (
            <a
              href={
                link
                  ? whatsappShareUrl(`I think you'd be great at "${skill.name}" -- want to start tracking it on LearnScope? ${link.url}`)
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
            <label className="block text-sm text-secondary" htmlFor="recommendEmail">
              Recommend by email
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
              id="recommendEmail"
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
    </AccessibleDialog>
  )
}
