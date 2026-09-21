import AccessibleDialog from './AccessibleDialog'
import { useLanguage } from '../context/LanguageContext'

// A small in-app stand-in for window.confirm() -- same "are you sure, with
// no other way through" shape, but styled like the rest of the app instead
// of an OS-level dialog. z-[60] so it always sits above a parent *Modal.jsx
// (z-50) when a destructive action is confirmed from inside one.
export default function ConfirmDialog({ message, confirmLabel = null, onConfirm, onCancel, confirming = false }) {
  const { t } = useLanguage()
  const resolvedConfirmLabel = confirmLabel ?? t('modals.confirmDialog.delete')
  return (
    <AccessibleDialog
      label={t('modals.confirmDialog.dialogLabel')}
      describedBy="confirm-dialog-message"
      onClose={confirming ? undefined : onCancel}
      closeOnBackdrop={!confirming}
      overlayClassName="z-[60]"
      panelClassName="w-full max-w-sm bg-card border border-hairline rounded-lg p-6"
    >
        <p id="confirm-dialog-message" className="text-sm text-ink mb-5">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={confirming}
            className="rounded-md border border-hairline text-ink py-2 px-4 text-sm font-medium hover:bg-paper disabled:opacity-60"
          >
            {t('modals.confirmDialog.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirming}
            className="rounded-md border border-hairline text-red-700 py-2 px-4 text-sm font-medium hover:bg-paper disabled:opacity-60"
          >
            {confirming ? t('modals.confirmDialog.working') : resolvedConfirmLabel}
          </button>
        </div>
    </AccessibleDialog>
  )
}
