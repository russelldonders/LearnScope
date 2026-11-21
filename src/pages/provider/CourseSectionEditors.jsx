import { useState } from 'react'
import ConfirmDialog from '../../components/ConfirmDialog'
import AccessibleDialog from '../../components/AccessibleDialog'
import { updateCourseSection, deleteCourseSection } from '../../lib/courseContent'

// Adding and editing a section of the course outline (see CourseSections.jsx).

export function AddSectionModal({ value, onChange, busy, onSubmit, onClose }) {
  return (
    <AccessibleDialog
      labelledBy="add-section-dialog-title"
      onClose={onClose}
      panelClassName="w-full max-w-sm bg-card border border-hairline rounded-lg p-6"
    >
      <h2 id="add-section-dialog-title" className="font-display text-xl text-ink mb-4">
        Add section
      </h2>
      <form onSubmit={onSubmit}>
        <label className="block text-xs text-secondary mb-1" htmlFor="newSectionTitle">
          Section title
        </label>
        <input
          id="newSectionTitle"
          data-dialog-initial-focus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. Getting started"
          className="w-full rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
        />
        <div className="flex items-center gap-2 mt-4">
          <button
            type="submit"
            disabled={busy || !value.trim()}
            className="flex-1 rounded-md bg-moss text-paper py-2 text-sm font-medium hover:opacity-90 disabled:opacity-60"
          >
            {busy ? 'Adding…' : 'Add section'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-hairline text-ink py-2 px-3 text-sm font-medium hover:bg-paper"
          >
            Cancel
          </button>
        </div>
      </form>
    </AccessibleDialog>
  )
}

export function InlineSectionEditor({ section, onChanged, onClose }) {
  const [titleDraft, setTitleDraft] = useState(section.title)
  const [instructionsDraft, setInstructionsDraft] = useState(section.instructions ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  async function handleSave(e) {
    e.preventDefault()
    if (!titleDraft.trim()) return
    setBusy(true)
    setError(null)
    try {
      await updateCourseSection(section.id, { title: titleDraft, instructions: instructionsDraft })
      await onChanged()
      onClose()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  async function handleDeleteSection() {
    setBusy(true)
    setError(null)
    try {
      await deleteCourseSection(section.id)
      await onChanged()
      onClose()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <>
      <div className="ml-9 mt-1 mb-3 max-w-2xl rounded-lg border border-hairline bg-card p-4">
        {error && <p className="text-sm text-red-700 mb-3">{error}</p>}
        <form onSubmit={handleSave}>
          <label className="block text-xs text-secondary mb-1" htmlFor={`section-title-${section.id}`}>
            Section title
          </label>
          <input
            id={`section-title-${section.id}`}
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            className="w-full rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
          />
          <label className="block text-xs text-secondary mt-3 mb-1" htmlFor={`section-instructions-${section.id}`}>
            Instructions for learners
          </label>
          <textarea
            id={`section-instructions-${section.id}`}
            value={instructionsDraft}
            onChange={(e) => setInstructionsDraft(e.target.value)}
            rows={4}
            placeholder="Explain what learners should do or know before starting this section."
            className="w-full resize-y rounded-md border border-hairline bg-paper px-3 py-2 text-sm leading-relaxed text-ink placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-moss"
          />
          <div className="flex items-center gap-2 mt-4">
            <button
              type="submit"
              disabled={busy || !titleDraft.trim()}
              className="flex-1 rounded-md bg-moss text-paper py-2 text-sm font-medium hover:opacity-90 disabled:opacity-60"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-md border border-hairline text-ink py-2 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              disabled={busy}
              className="rounded-md border border-hairline text-red-700 py-2 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
            >
              Delete
            </button>
          </div>
        </form>
      </div>
      {confirmingDelete && (
        <ConfirmDialog
          message={`Delete the "${section.title}" section? Its content stays attached to the course, just ungrouped.`}
          confirmLabel="Delete section"
          confirming={busy}
          onConfirm={handleDeleteSection}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </>
  )
}
