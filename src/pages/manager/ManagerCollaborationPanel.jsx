import { useRef, useState } from 'react'
import MutationFeedback from '../../components/MutationFeedback'
import AccessibleDialog from '../../components/AccessibleDialog'
import { formatRelativeDate, formatAbsoluteDate } from '../../lib/dates'

// Team-collaboration records are a new domain concept (decision: manager
// mode adds these alongside connections, it isn't a lightweight employer) --
// a shared note/goal a manager logs against one or more team members. This
// panel only renders whatever `records` it's given and forwards a new one
// via `onCreateRecord`; persistence and the record shape's server-side
// validation belong to the data layer, not here.
export default function ManagerCollaborationPanel({
  records = [],
  teamOptions = [],
  loading = false,
  error = null,
  onCreateRecord,
}) {
  const [formOpen, setFormOpen] = useState(false)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-secondary">
          Notes, goals and other collaboration records you've logged with your team.
        </p>
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          disabled={teamOptions.length === 0}
          title={teamOptions.length === 0 ? 'Add a team member first' : undefined}
          className="shrink-0 rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-50"
        >
          New record
        </button>
      </div>

      <MutationFeedback status="error" message={error} />

      {loading ? (
        <p className="text-secondary text-sm">Loading…</p>
      ) : records.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
          <p className="text-secondary text-sm">
            No collaboration records yet. Log a note or goal against a team member to get started.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {records.map((record) => (
            <div key={record.id} className="bg-card border border-hairline rounded-lg px-4 py-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-sm font-medium text-ink">{record.title}</p>
                {record.createdAt && (
                  <p className="font-mono text-xs text-secondary" title={formatAbsoluteDate(record.createdAt)}>
                    {formatRelativeDate(record.createdAt)}
                  </p>
                )}
              </div>
              {record.memberNames?.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {record.memberNames.map((name) => (
                    <span
                      key={name}
                      className="font-mono text-[11px] uppercase tracking-wide text-secondary border border-hairline rounded-full px-2 py-0.5"
                    >
                      {name}
                    </span>
                  ))}
                </div>
              )}
              {record.note && <p className="text-sm text-ink mt-2 whitespace-pre-wrap">{record.note}</p>}
            </div>
          ))}
        </div>
      )}

      {formOpen && (
        <NewRecordDialog
          teamOptions={teamOptions}
          onClose={() => setFormOpen(false)}
          onCreateRecord={onCreateRecord}
        />
      )}
    </div>
  )
}

function NewRecordDialog({ teamOptions, onClose, onCreateRecord }) {
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [memberIds, setMemberIds] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const initialFocusRef = useRef(null)

  function toggleMember(id) {
    setMemberIds((current) => (current.includes(id) ? current.filter((m) => m !== id) : [...current, id]))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!onCreateRecord) {
      onClose()
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    try {
      await onCreateRecord({ title: title.trim(), note: note.trim(), memberIds })
      onClose()
    } catch (error) {
      setSubmitError(error.message || 'Could not save the record. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AccessibleDialog
      label="New collaboration record"
      onClose={submitting ? undefined : onClose}
      closeOnBackdrop={!submitting}
      panelClassName="w-full max-w-md bg-card border border-hairline rounded-lg p-6"
    >
      <form onSubmit={handleSubmit}>
        <h2 className="font-display text-lg text-ink mb-4">New collaboration record</h2>

        <label htmlFor="manager-record-title" className="block text-sm font-medium text-ink mb-1">
          Title
        </label>
        <input
          ref={initialFocusRef}
          id="manager-record-title"
          type="text"
          required
          maxLength={160}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          data-dialog-initial-focus
          className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss mb-4"
        />

        <label htmlFor="manager-record-note" className="block text-sm font-medium text-ink mb-1">
          Note
        </label>
        <textarea
          id="manager-record-note"
          rows={4}
          required
          maxLength={5000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss mb-4"
        />

        <MutationFeedback status="error" message={submitError} className="mb-4" />

        <fieldset className="mb-5">
          <legend className="block text-sm font-medium text-ink mb-1.5">Team members</legend>
          <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto">
            {teamOptions.map((member) => (
              <label key={member.id} className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={memberIds.includes(member.id)}
                  onChange={() => toggleMember(member.id)}
                  className="rounded border-hairline accent-moss"
                />
                {member.name}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md border border-hairline text-ink py-2 px-4 text-sm font-medium hover:bg-paper disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !title.trim() || !note.trim() || memberIds.length === 0}
            className="rounded-md border border-hairline text-ink py-2 px-4 text-sm font-medium hover:bg-paper disabled:opacity-60"
          >
            {submitting ? 'Saving…' : 'Save record'}
          </button>
        </div>
      </form>
    </AccessibleDialog>
  )
}
