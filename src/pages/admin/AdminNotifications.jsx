import { useEffect, useState } from 'react'
import AdminLayout from './AdminLayout'
import { useAuth } from '../../context/AuthContext'
import { listNotificationTemplates, renderNotificationPreview, updateNotificationTemplate } from '../../lib/admin/notificationTemplates'
import MutationFeedback from '../../components/MutationFeedback'

// Emails Supabase Auth sends directly (invite/signup/password reset/etc.) --
// listed here for visibility ("every email the system sends"), but their
// wording lives in Supabase's own Auth email template settings, not in the
// notification_templates table this page otherwise edits. Wiring those up
// for in-app editing would mean either committing supabase/config.toml
// changes (local-only until redeployed) or a new Supabase Management API
// integration -- a bigger step than this pass, so they're read-only here.
const AUTH_EMAILS = [
  {
    label: 'Invite user',
    trigger: 'A platform admin, org admin, or employer admin invites someone by email who has no account yet.',
  },
  {
    label: 'Confirm signup',
    trigger: 'Someone signs up for a new account directly (not via an invite).',
  },
  {
    label: 'Magic link',
    trigger: 'Someone requests a passwordless sign-in link.',
  },
  {
    label: 'Reset password',
    trigger: 'Someone requests a password reset.',
  },
  {
    label: 'Change email address',
    trigger: "Someone changes their account's email address.",
  },
  {
    label: 'Reauthentication code',
    trigger: 'Someone is asked to confirm their identity before a sensitive change.',
  },
]

function TemplateCard({ template, onSaved }) {
  const { user } = useAuth()
  const [expanded, setExpanded] = useState(false)
  const [subject, setSubject] = useState(template.subject_template)
  const [body, setBody] = useState(template.body_template)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  const dirty = subject !== template.subject_template || body !== template.body_template
  const preview = renderNotificationPreview({ subjectTemplate: subject, bodyTemplate: body }, template.placeholders)

  function handleToggle() {
    setExpanded((current) => !current)
    setError(null)
    setSaved(false)
  }

  function handleReset() {
    setSubject(template.subject_template)
    setBody(template.body_template)
    setError(null)
  }

  async function handleSave() {
    if (!subject.trim() || !body.trim()) {
      setError('Subject and body can\'t be empty.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const updated = await updateNotificationTemplate(template.id, { subjectTemplate: subject, bodyTemplate: body }, user.id)
      onSaved(updated)
      setSaved(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-card border border-hairline rounded-lg">
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span>
          <span className="block text-sm font-medium text-ink">{template.label}</span>
          {template.description && <span className="block text-xs text-secondary mt-0.5">{template.description}</span>}
        </span>
        <span className="shrink-0 text-xs font-medium text-moss">{expanded ? 'Close' : 'Edit'}</span>
      </button>

      {expanded && (
        <div className="border-t border-hairline p-4 space-y-3">
          {template.placeholders?.length > 0 && (
            <p className="text-xs text-secondary">
              Placeholders you can use: {template.placeholders.map((p) => `{{${p}}}`).join(', ')}
            </p>
          )}

          <div>
            <label className="block text-xs text-secondary mb-1" htmlFor={`subject-${template.id}`}>Subject</label>
            <input
              id={`subject-${template.id}`}
              value={subject}
              onChange={(e) => { setSubject(e.target.value); setSaved(false) }}
              className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            />
          </div>

          <div>
            <label className="block text-xs text-secondary mb-1" htmlFor={`body-${template.id}`}>Body (HTML)</label>
            <textarea
              id={`body-${template.id}`}
              rows={8}
              value={body}
              onChange={(e) => { setBody(e.target.value); setSaved(false) }}
              className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink font-mono focus:outline-none focus:ring-2 focus:ring-moss"
            />
          </div>

          <MutationFeedback status="error" message={error} size="xs" />
          {saved && !dirty && <p className="text-xs text-moss">Saved.</p>}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !dirty}
              className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => setShowPreview((current) => !current)}
              className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper"
            >
              {showPreview ? 'Hide preview' : 'Preview'}
            </button>
            {dirty && (
              <button
                type="button"
                onClick={handleReset}
                disabled={saving}
                className="text-sm text-secondary hover:text-ink"
              >
                Revert changes
              </button>
            )}
          </div>

          {showPreview && (
            <div className="border border-hairline rounded-md overflow-hidden">
              <div className="bg-paper px-3 py-2 border-b border-hairline">
                <p className="text-[11px] uppercase tracking-wide text-secondary">Preview -- sample data, not a real send</p>
                <p className="text-sm font-medium text-ink mt-0.5">{preview.subject}</p>
              </div>
              <div className="p-4 bg-white" dangerouslySetInnerHTML={{ __html: preview.html }} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function AdminNotifications() {
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      setTemplates(await listNotificationTemplates())
    } catch (err) {
      setError(`Couldn't load notification templates: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  function handleSaved(updated) {
    setTemplates((current) => current.map((t) => (t.id === updated.id ? updated : t)))
  }

  return (
    <AdminLayout>
      <div className="space-y-8">
        <div>
          <h2 className="font-display text-lg text-ink mb-1">Notification emails</h2>
          <p className="text-sm text-secondary mb-4 max-w-2xl">
            Every custom email LearnScope sends, and what it says. Editing a template changes the wording of future
            emails of that type -- it doesn't resend anything already sent.
          </p>

          <MutationFeedback status="error" message={error} className="mb-3" />

          {loading ? (
            <p className="text-secondary">Loading…</p>
          ) : templates.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-hairline rounded-lg">
              <p className="text-secondary">No notification templates found.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {templates.map((template) => (
                <TemplateCard key={template.id} template={template} onSaved={handleSaved} />
              ))}
            </div>
          )}
        </div>

        <div>
          <h2 className="font-display text-lg text-ink mb-1">Account emails</h2>
          <p className="text-sm text-secondary mb-4 max-w-2xl">
            These are sent directly by Supabase Auth, not by the code above -- their wording is managed in Supabase's
            own Auth email template settings, not here.
          </p>
          <div className="bg-card border border-hairline rounded-lg divide-y divide-hairline">
            {AUTH_EMAILS.map((email) => (
              <div key={email.label} className="px-4 py-3">
                <p className="text-sm font-medium text-ink">{email.label}</p>
                <p className="text-xs text-secondary mt-0.5">{email.trigger}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AdminLayout>
  )
}
