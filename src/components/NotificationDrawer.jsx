import { Link } from 'react-router-dom'
import AccessibleDialog from './AccessibleDialog'
import { formatAbsoluteDate, formatRelativeDate } from '../lib/dates'

export default function NotificationDrawer({
  items,
  loading,
  error,
  viewAllHref = '/actions',
  onClose,
  onRetry,
}) {
  return (
    <AccessibleDialog
      labelledBy="notification-drawer-title"
      describedBy="notification-drawer-description"
      onClose={onClose}
      overlayClassName="!items-stretch !justify-end !p-0"
      panelClassName="flex h-full w-full max-w-md flex-col bg-card shadow-2xl"
    >
      <div className="flex items-start justify-between gap-4 border-b border-hairline px-5 py-5 sm:px-6">
        <div className="min-w-0">
          <h2 id="notification-drawer-title" className="font-display text-2xl text-ink text-balance">
            Notifications
          </h2>
          <p id="notification-drawer-description" className="mt-1 text-sm text-secondary">
            Across all your LearnScope workspaces
          </p>
        </div>
        <button
          type="button"
          data-dialog-initial-focus
          onClick={onClose}
          aria-label="Close notifications"
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-ink hover:bg-paper"
        >
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 sm:px-6" aria-live="polite">
        {loading && <p className="py-10 text-center text-sm text-secondary">Loading notifications…</p>}

        {!loading && error && (
          <div role="alert" className="rounded-xl bg-paper p-4 text-sm text-ink">
            <p>{error}</p>
            <button type="button" onClick={onRetry} className="mt-3 font-medium text-moss underline underline-offset-4 hover:no-underline">
              Try Again
            </button>
          </div>
        )}

        {!loading && items.length === 0 && !error && (
          <div className="py-16 text-center">
            <p className="font-medium text-ink">You’re all caught up</p>
            <p className="mt-1 text-sm text-secondary">New requests and updates will appear here.</p>
          </div>
        )}

        {!loading && items.length > 0 && (
          <ol className="divide-y divide-hairline">
            {items.map((item) => (
              <li key={item.id} className="py-4 first:pt-0">
                <article className="min-w-0">
                  <div className="flex items-start justify-between gap-4">
                    <h3 className="min-w-0 break-words font-medium text-ink">{item.title}</h3>
                    {item.occurredAt && (
                      <time
                        dateTime={item.occurredAt}
                        title={formatAbsoluteDate(item.occurredAt)}
                        className="shrink-0 text-xs tabular-nums text-secondary"
                      >
                        {formatRelativeDate(item.occurredAt)}
                      </time>
                    )}
                  </div>
                  <p className="mt-1 break-words text-sm leading-6 text-secondary">{item.detail}</p>
                  <p className="mt-2 inline-flex max-w-full rounded-full bg-paper px-2.5 py-1 text-xs font-medium text-ink">
                    <span className="truncate">{item.source}</span>
                  </p>
                </article>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="border-t border-hairline bg-card px-5 py-4 sm:px-6">
        <Link
          to={viewAllHref}
          onClick={onClose}
          className="flex min-h-11 w-full items-center justify-center rounded-lg bg-moss px-4 py-2.5 text-sm font-medium text-paper hover:opacity-90"
        >
          View All Actions
        </Link>
      </div>
    </AccessibleDialog>
  )
}
