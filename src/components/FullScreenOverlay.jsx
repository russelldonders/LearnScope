import { useId } from 'react'
import AccessibleDialog from './AccessibleDialog'

// Something opened over almost the whole screen -- a course or a SCORM/xAPI
// package -- with its title and a Close button along the top. Escape closes
// it too; a click outside doesn't, so a stray click can't lose the learner's
// place.
export default function FullScreenOverlay({ title, subtitle = null, closeLabel, onClose, children }) {
  const headingId = useId()
  return (
    <AccessibleDialog
      labelledBy={headingId}
      onClose={onClose}
      closeOnBackdrop={false}
      overlayClassName="p-2! sm:p-4!"
      panelClassName="flex h-full w-full flex-col overflow-hidden rounded-md bg-paper shadow-xl focus:outline-none"
    >
      <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-2">
        <div className="min-w-0">
          <h2 id={headingId} className="truncate font-display text-lg text-ink">{title}</h2>
          {subtitle && <p className="text-xs text-secondary">{subtitle}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md border border-hairline px-3 py-1.5 text-sm text-ink hover:border-moss"
        >
          {closeLabel}
        </button>
      </div>
      <div className="relative min-h-0 flex-1 overflow-y-auto bg-card">{children}</div>
    </AccessibleDialog>
  )
}
