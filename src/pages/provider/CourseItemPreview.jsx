import { useState } from 'react'
import ScormPlayer from '../../components/ScormPlayer'
import XapiPlayer from '../../components/XapiPlayer'
import Cmi5Player from '../../components/Cmi5Player'
import LtiPlayer from '../../components/LtiPlayer'
import EditedVideoPlayer from '../../components/EditedVideoPlayer'
import PageBuilderModal from '../../components/PageBuilderModal'
import PageContent from '../../components/PageContent'
import { unlinkResourceFromCourse, contentFileUrl, saveCoursePageEdit } from '../../lib/courseContent'
import { RESOURCE_TYPE_LABELS } from '../../lib/statusLabels'

// Preview/download + detach, shown inline on the right the same way
// CourseLearn.jsx shows a learner the content they've selected from its own
// left-hand nav -- a popup here would be a different experience for the
// provider curating content than for the learner consuming it.
// Player/download/detach -- shared by the md+ side pane (ItemPreviewPane,
// which wraps this with a card + type label + title) and the below-md
// inline accordion in the outline (which already shows the title as the
// row it's expanding under, so it renders this directly without repeating
// it).
export function ItemPreviewBody({ item, userId, organisationId, canEdit, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [editingPage, setEditingPage] = useState(false)

  async function handleDetach() {
    setBusy(true)
    setError(null)
    try {
      await unlinkResourceFromCourse(item.linkId)
      onChanged()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <>
      {error && <p className="text-sm text-red-700 mb-3">{error}</p>}

      {(item.type === 'video' || item.type === 'screen_recording') && (
        <EditedVideoPlayer key={item.id} resource={item} className="w-full rounded-md bg-black" />
      )}

      {item.type === 'file' && (
        <a
          href={contentFileUrl(item)}
          download={item.file_name || true}
          className="flex items-center gap-3 rounded-md border border-hairline bg-paper px-3 py-2.5"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-secondary shrink-0">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <span className="text-sm text-ink flex-1 truncate">{item.file_name}</span>
          <span className="font-mono text-[10px] uppercase tracking-wide text-moss shrink-0">Download</span>
        </a>
      )}

      {item.type === 'scorm' && <ScormPlayer key={item.id} contentItem={item} userId={userId} />}

      {item.type === 'xapi' && <XapiPlayer key={item.id} contentItem={item} userId={userId} />}

      {item.type === 'cmi5' && <Cmi5Player key={item.id} contentItem={item} userId={userId} />}

      {item.type === 'lti' && <LtiPlayer key={item.id} contentItem={item} userId={userId} />}

      {item.type === 'external_video' && (
        <iframe
          key={item.id}
          src={item.external_url}
          title={item.title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="w-full aspect-video rounded-md"
        />
      )}

      {item.type === 'web_url' && (
        <a
          href={item.external_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between gap-3 rounded-md border border-hairline bg-paper px-4 py-3 text-sm text-ink hover:border-moss"
        >
          <span className="min-w-0 truncate">{item.external_url}</span>
          <span className="font-medium text-moss shrink-0">Open link ↗</span>
        </a>
      )}

      {item.type === 'page' && <PageContent document={item.page_content} compact />}

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-hairline">
          {item.type === 'page' && (
            <button
              type="button"
              onClick={() => setEditingPage(true)}
              disabled={busy}
              className="rounded-md border border-hairline text-ink py-2 px-4 text-sm font-medium hover:bg-paper disabled:opacity-60"
            >
              Edit page
            </button>
          )}
          <button
            type="button"
            onClick={handleDetach}
            disabled={busy}
            className="rounded-md border border-hairline text-red-700 py-2 px-4 text-sm font-medium hover:bg-paper disabled:opacity-60"
          >
            {busy ? 'Removing…' : 'Detach from course'}
          </button>
        </div>
      )}

      {/* Opens the page builder on this page -- including a generated
          course's final test, with its answer key. Saving an already
          published page creates a new version for this course only (see
          saveCoursePageEdit). */}
      {editingPage && (
        <PageBuilderModal
          organisationId={organisationId}
          userId={userId}
          resource={item}
          saveResource={(title, pageDocument) => saveCoursePageEdit(item, title, pageDocument)}
          onClose={() => setEditingPage(false)}
          onSaved={() => onChanged()}
        />
      )}
    </>
  )
}

// md+ only -- see the outline's own inline accordion (rendered per-item,
// gated by useIsDesktop) for the below-md equivalent.
export function ItemPreviewPane({ item, userId, organisationId, canEdit, onChanged }) {
  if (!item) {
    return (
      <div className="bg-card border border-hairline rounded-lg p-6">
        <p className="text-sm text-secondary">Select an item from the outline to preview it here.</p>
      </div>
    )
  }

  return (
    <div className="bg-card border border-hairline rounded-lg p-6">
      <span className="font-mono text-[10px] uppercase tracking-wide text-secondary mb-1 block">
        {RESOURCE_TYPE_LABELS[item.type]}
      </span>
      <h3 className="font-display text-xl text-ink mb-4">{item.title}</h3>
      <ItemPreviewBody item={item} userId={userId} organisationId={organisationId} canEdit={canEdit} onChanged={onChanged} />
    </div>
  )
}
