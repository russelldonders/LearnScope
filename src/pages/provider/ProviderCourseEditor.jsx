import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import AppHeader from '../../components/AppHeader'
import ScormPlayer from '../../components/ScormPlayer'
import XapiPlayer from '../../components/XapiPlayer'
import EditedVideoPlayer from '../../components/EditedVideoPlayer'
import ConfirmDialog from '../../components/ConfirmDialog'
import AccessibleDialog from '../../components/AccessibleDialog'
import CourseThumbnail from '../../components/CourseThumbnail'
import ScreenRecorderModal from '../../components/ScreenRecorderModal'
import {
  getCatalogueCourse,
  updateProviderCourse,
  setCatalogueCourseStatus,
  uploadCourseImage,
  removeCourseImage,
} from '../../lib/admin/catalogue'
import {
  listCourseSections,
  createCourseSection,
  renameCourseSection,
  deleteCourseSection,
  reorderCourseSections,
  listCourseResources,
  listOrganisationResources,
  linkResourceToCourse,
  unlinkResourceFromCourse,
  reorderContentLinks,
  uploadVideoResource,
  uploadScreenRecordingResource,
  uploadFileResource,
  uploadScormResource,
  uploadXapiResource,
  addWebResource,
  contentFileUrl,
} from '../../lib/courseContent'
import { optimizeCourseImage, COURSE_IMAGE_MAX_INPUT_BYTES } from '../../lib/optimizeImage'

const TYPE_LABELS = {
  video: 'Video',
  screen_recording: 'Screen recording',
  file: 'File',
  scorm: 'SCORM package',
  xapi: 'xAPI package',
  external_video: 'External video',
  web_url: 'Web link',
}
const STATUS_LABELS = {
  draft: 'Draft',
  pending_approval: 'Pending approval',
  approved: 'Approved',
  rejected: 'Rejected',
  inactive: 'Inactive',
}
const MAX_IMAGE_BYTES = COURSE_IMAGE_MAX_INPUT_BYTES

// `side` picks the insertion point relative to a target: 'before' the
// target's midpoint or 'after' it. Reordering always removes the dragged
// item first, so an insertion index computed against the *original* list
// has to shift left by one once the removal point is above it.
export function reorderById(list, draggedId, targetId, idKey, side = 'before') {
  if (!targetId || targetId === draggedId) return list
  const fromIndex = list.findIndex((item) => item[idKey] === draggedId)
  const targetIndex = list.findIndex((item) => item[idKey] === targetId)
  if (fromIndex < 0 || targetIndex < 0) return list
  let toIndex = side === 'after' ? targetIndex + 1 : targetIndex
  if (fromIndex < toIndex) toIndex -= 1
  if (fromIndex === toIndex) return list
  const reordered = [...list]
  const [dragged] = reordered.splice(fromIndex, 1)
  reordered.splice(toIndex, 0, dragged)
  return reordered
}

function sideOf(element, clientY) {
  const rect = element.getBoundingClientRect()
  return clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

// Touch dragging previously resolved its drop target with
// document.elementFromPoint, which on iOS Safari was unreliable for the
// densely-packed outline rows specifically (it kept resolving back to
// something that didn't match any tracked row, so the drop-target state
// never updated and nothing committed on release). Comparing the touch
// point against each candidate row's own getBoundingClientRect from a ref
// registry sidesteps elementFromPoint's hit-testing entirely -- the same
// approach real drag-and-drop libraries use. Falls back to the row whose
// vertical center is nearest the touch point if it isn't exactly inside
// any row's box (e.g. a fast drag between rows, or the gap between them).
function findDropTarget(refsMap, clientX, clientY) {
  let nearest = null
  let nearestDistance = Infinity
  for (const [id, node] of refsMap) {
    if (!node || !node.isConnected) continue
    const rect = node.getBoundingClientRect()
    if (clientX < rect.left || clientX > rect.right) continue
    if (clientY >= rect.top && clientY <= rect.bottom) {
      return { id, side: clientY < rect.top + rect.height / 2 ? 'before' : 'after' }
    }
    const center = rect.top + rect.height / 2
    const distance = Math.abs(clientY - center)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearest = { id, side: clientY < center ? 'before' : 'after' }
    }
  }
  return nearest
}

// Clicking an item in the course outline selects its section (so it renders
// in SectionCard/UngroupedContent) and needs to then jump the reader's eye
// to that specific item in what can be a long content list. `token` (not
// just itemId) makes the effect below re-fire even when the same item is
// clicked twice in a row. The same node registry doubles as the drop-target
// registry for reordering (see findDropTarget above).
function useItemFocusHighlight(focusRequest) {
  const [highlightedItemId, setHighlightedItemId] = useState(null)
  const itemRefs = useRef(new Map())

  useEffect(() => {
    if (!focusRequest) return
    const node = itemRefs.current.get(focusRequest.itemId)
    if (!node) return
    node.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlightedItemId(focusRequest.itemId)
    const timeout = setTimeout(() => setHighlightedItemId(null), 1600)
    return () => clearTimeout(timeout)
  }, [focusRequest])

  function registerItemRef(itemId) {
    return (node) => {
      if (node) itemRefs.current.set(itemId, node)
      else itemRefs.current.delete(itemId)
    }
  }

  return { highlightedItemId, registerItemRef, itemRefs }
}

// A thin insertion-point indicator instead of a box around the whole
// target row, so a reorder-in-progress shows exactly whether the dragged
// item will land above or below the row it's hovering.
function DropLine({ side }) {
  if (!side) return null
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-x-1 h-0.5 rounded-full bg-moss ${side === 'before' ? '-top-px' : '-bottom-px'}`}
    />
  )
}

// Touch dragging is wired through raw touchstart/touchmove/touchend
// listeners rather than the Pointer Events API. Pointer Events looked
// right in every browser we could test (including Chromium under touch
// emulation) but iOS Safari's setPointerCapture/hasPointerCapture is a
// known-unreliable combo for nested touch targets -- it can silently
// no-op, so handlePointerMove/finishPointerDrag's hasPointerCapture guard
// never passes and the drag never "picks up". Touch events plus a
// manually attached non-passive listener (JSX touch handlers are passive
// by default in React and can't preventDefault) is the standard
// workaround. Mouse still goes through native HTML5 draggable/onDragStart
// below, untouched.
export function DragHandle({
  label,
  dragLabel,
  disabled,
  onDragStart,
  onDragEnd,
  onKeyDown,
  onPointerDragStart,
  onPointerDragMove,
  onPointerDragEnd,
}) {
  const buttonRef = useRef(null)
  const draggingRef = useRef(false)
  // Touch dragging had no visual feedback at all -- the only cue was the
  // drop target lighting up once you were already over it, so a drag in
  // progress was easy to miss. This floating label follows the finger the
  // same way a native HTML5 drag image would for mouse (which gets one for
  // free from the browser); touch never did, since we drive it ourselves.
  const [ghost, setGhost] = useState(null)
  // The outline nav holds its dragged-item/drop-target state on the parent
  // CourseSections component itself, so every touchmove-driven setState
  // re-renders its whole section/item tree (unlike the smaller, self-
  // contained SectionCard in the main pane) and hands this component fresh
  // onPointerDrag* closures on every one of those renders. Keeping those in
  // a ref -- instead of the effect's dependency array -- means the touch
  // listeners are attached once and read the latest callback rather than
  // being torn down and re-attached mid-gesture, which on iOS Safari was
  // dropping the in-flight touch and making outline items never pick up.
  const callbacksRef = useRef({})
  callbacksRef.current = { onPointerDragStart, onPointerDragMove, onPointerDragEnd, onDragEnd }

  useEffect(() => {
    const button = buttonRef.current
    if (!button || disabled) return

    function handleTouchStart(event) {
      draggingRef.current = true
      const touch = event.touches[0]
      if (touch) setGhost({ x: touch.clientX, y: touch.clientY })
      callbacksRef.current.onPointerDragStart?.(event)
    }

    function handleTouchMove(event) {
      if (!draggingRef.current) return
      event.preventDefault()
      const touch = event.touches[0]
      if (!touch) return
      if (touch.clientY < 72) window.scrollBy({ top: -16, behavior: 'auto' })
      else if (touch.clientY > window.innerHeight - 72) window.scrollBy({ top: 16, behavior: 'auto' })
      setGhost({ x: touch.clientX, y: touch.clientY })
      callbacksRef.current.onPointerDragMove?.({ clientX: touch.clientX, clientY: touch.clientY })
    }

    function handleTouchEnd(event) {
      if (!draggingRef.current) return
      draggingRef.current = false
      setGhost(null)
      const touch = event.changedTouches[0]
      callbacksRef.current.onPointerDragEnd?.(touch ? { clientX: touch.clientX, clientY: touch.clientY } : { clientX: -1, clientY: -1 })
    }

    function handleTouchCancel() {
      if (!draggingRef.current) return
      draggingRef.current = false
      setGhost(null)
      callbacksRef.current.onDragEnd?.()
    }

    button.addEventListener('touchstart', handleTouchStart, { passive: true })
    button.addEventListener('touchmove', handleTouchMove, { passive: false })
    button.addEventListener('touchend', handleTouchEnd, { passive: true })
    button.addEventListener('touchcancel', handleTouchCancel, { passive: true })
    return () => {
      button.removeEventListener('touchstart', handleTouchStart)
      button.removeEventListener('touchmove', handleTouchMove)
      button.removeEventListener('touchend', handleTouchEnd)
      button.removeEventListener('touchcancel', handleTouchCancel)
    }
  }, [disabled])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        draggable={!disabled}
        disabled={disabled}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onKeyDown={onKeyDown}
        aria-label={`${label}. Drag to reorder, or use the arrow keys.`}
        title="Drag to reorder"
        className="inline-flex h-11 w-11 md:h-7 md:w-7 shrink-0 touch-none cursor-grab items-center justify-center rounded-md text-secondary hover:bg-paper hover:text-ink focus:outline-none focus:ring-2 focus:ring-moss active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
      >
        <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="3.5" r="1" /><circle cx="11" cy="3.5" r="1" />
          <circle cx="5" cy="8" r="1" /><circle cx="11" cy="8" r="1" />
          <circle cx="5" cy="12.5" r="1" /><circle cx="11" cy="12.5" r="1" />
        </svg>
      </button>
      {ghost &&
        dragLabel &&
        createPortal(
          // Portalled to <body> rather than rendered inline: this used to sit
          // in the DOM as a descendant of the dragged row itself, so when it
          // visually overlapped a *different* row under the finger, some drop-
          // target lookups could resolve back to the dragged row's own
          // ancestors instead of whatever was actually underneath. Detaching
          // it removes that possibility entirely.
          <div
            aria-hidden="true"
            className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-[calc(100%+14px)] whitespace-nowrap rounded-md bg-ink text-paper text-xs font-medium px-2.5 py-1.5 shadow-lg"
            style={{ left: ghost.x, top: ghost.y }}
          >
            {dragLabel}
          </div>,
          document.body
        )}
    </>
  )
}

// Info (name/type/duration/synopsis/image, save/submit/unpublish) and
// Content (sections/resources) used to sit stacked on one long page --
// split into tabs since the two are edited at different times (details
// first, content once the basics are settled) and content on its own can
// already run long for a course with several sections. Mirrors the
// Overview/Skills/Activities/Details tab pattern in CourseModal.jsx.
const TABS = [
  { id: 'info', label: 'Info' },
  { id: 'content', label: 'Content' },
]

// A course's own full-page editor -- structuring content into named,
// ordered sections (0078) needs more room than the summary card in
// ProviderConsole ever had, so editing moved off that inline expand-in-
// place form onto its own route, the same way AdminUserDetail/
// AdminSkillDetail moved their consoles' inline expansions onto dedicated
// pages. Mirrors the learner-facing CourseLearn's grouped-by-section
// structure, just for building it rather than taking it.
export default function ProviderCourseEditor() {
  const { courseId } = useParams()
  const { user, organisationMemberships } = useAuth()
  const [course, setCourse] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('content')

  useEffect(() => {
    load()
  }, [courseId])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const data = await getCatalogueCourse(courseId)
      if (!data) {
        setNotFound(true)
      } else {
        setCourse(data)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const myRole = (organisationMemberships ?? []).find((m) => m.organisation_id === course?.organisation_id)?.role
  const canEdit = Boolean(myRole) && (course?.status === 'draft' || course?.status === 'rejected')

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader hideNavLinks />
      <main id="main-content" tabIndex={-1} className="max-w-4xl mx-auto px-4 py-8">
        <Link to="/provider" className="text-sm text-secondary hover:text-ink mb-4 inline-block">
          ← Back to provider console
        </Link>

        {loading && <p className="text-secondary">Loading…</p>}
        {notFound && <p className="text-secondary">Course not found.</p>}
        {error && <p className="text-sm text-red-700">{error}</p>}

        {course && (
          <div className="space-y-6">
            <div className="flex items-center gap-1 border-b border-hairline">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
                    tab === t.id
                      ? 'border-moss text-ink'
                      : 'border-transparent text-secondary hover:text-ink'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tab === 'info' && <CourseHeader course={course} canEdit={canEdit} onSaved={load} />}
            {tab === 'content' && (
              <CourseSections courseId={course.id} organisationId={course.organisation_id} userId={user.id} canEdit={canEdit} />
            )}
          </div>
        )}
      </main>
    </div>
  )
}

function CourseHeader({ course, canEdit, onSaved }) {
  const [form, setForm] = useState({
    name: course.name,
    provider: course.provider ?? '',
    courseType: course.course_type ?? '',
    duration: course.duration ?? '',
    synopsis: course.synopsis ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [unpublishing, setUnpublishing] = useState(false)
  const [confirmingUnpublish, setConfirmingUnpublish] = useState(false)
  const [error, setError] = useState(null)

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await updateProviderCourse(course.id, form)
      await onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleSubmitForApproval() {
    setSubmitting(true)
    setError(null)
    try {
      await updateProviderCourse(course.id, form)
      await setCatalogueCourseStatus(course.id, 'pending_approval')
      await onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleUnpublish() {
    setUnpublishing(true)
    setError(null)
    try {
      await setCatalogueCourseStatus(course.id, 'draft')
      setConfirmingUnpublish(false)
      await onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setUnpublishing(false)
    }
  }

  return (
    <div className="bg-card border border-hairline rounded-lg p-6">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <h1 className="font-display text-xl text-ink">{course.name}</h1>
        <span className="font-mono text-[10px] uppercase tracking-wide text-secondary shrink-0">
          {STATUS_LABELS[course.status] ?? course.status}
        </span>
      </div>

      {course.status === 'rejected' && course.rejection_reason && (
        <p className="text-sm text-red-700 mb-4">Rejected: {course.rejection_reason}</p>
      )}

      <CourseImageUpload course={course} canEdit={canEdit} onUpdated={onSaved} />

      {error && <p className="text-sm text-red-700 mb-4">{error}</p>}

      {course.status === 'approved' && (
        <div className="mb-4">
          {course.synopsis && <p className="text-sm text-secondary mb-3">{course.synopsis}</p>}
          <button
            type="button"
            onClick={() => setConfirmingUnpublish(true)}
            className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper"
          >
            Unpublish to edit
          </button>
        </div>
      )}

      {confirmingUnpublish && (
        <ConfirmDialog
          message="This removes the course from the public training catalogue until you resubmit it for approval. Learners already partway through it keep their access and progress in the meantime."
          confirmLabel="Unpublish"
          confirming={unpublishing}
          onConfirm={handleUnpublish}
          onCancel={() => setConfirmingUnpublish(false)}
        />
      )}

      {!canEdit ? (
        course.status !== 'approved' && course.synopsis && <p className="text-sm text-secondary">{course.synopsis}</p>
      ) : (
        <form onSubmit={handleSave} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-secondary mb-1" htmlFor="courseName">
                Name
              </label>
              <input
                id="courseName"
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              />
            </div>
            <div>
              <label className="block text-sm text-secondary mb-1" htmlFor="courseType">
                Course type
              </label>
              <input
                id="courseType"
                value={form.courseType}
                onChange={(e) => setForm((f) => ({ ...f, courseType: e.target.value }))}
                placeholder="Online, In-person, Workshop…"
                className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              />
            </div>
            <div>
              <label className="block text-sm text-secondary mb-1" htmlFor="courseDuration">
                Duration
              </label>
              <input
                id="courseDuration"
                value={form.duration}
                onChange={(e) => setForm((f) => ({ ...f, duration: e.target.value }))}
                className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm text-secondary mb-1" htmlFor="courseSynopsis">
                Synopsis
              </label>
              <textarea
                id="courseSynopsis"
                rows={3}
                value={form.synopsis}
                onChange={(e) => setForm((f) => ({ ...f, synopsis: e.target.value }))}
                className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="submit"
              disabled={saving || submitting}
              className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button
              type="button"
              onClick={handleSubmitForApproval}
              disabled={saving || submitting}
              className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
            >
              {submitting ? 'Submitting…' : 'Submit for approval'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

// Overtakes CourseThumbnail's generated placeholder once set. Shown (and,
// while canEdit, editable) regardless of which tab-form state the rest of
// the card is in -- unlike the name/type/duration/synopsis fields, it isn't
// part of the plain-object form state above since it uploads and persists
// immediately on selection, same UX as OrganisationSettingsModal's logo
// upload (a separate storage operation, not a row-field edit that waits for
// Save).
function CourseImageUpload({ course, canEdit, onUpdated }) {
  const fileInputRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Choose a JPEG, PNG, or WebP image.')
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError('That image is too large (max 10MB).')
      return
    }
    setError(null)
    setUploading(true)
    try {
      const optimizedImage = await optimizeCourseImage(file)
      await uploadCourseImage(course.id, optimizedImage)
      await onUpdated()
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  async function handleRemove() {
    setUploading(true)
    setError(null)
    try {
      await removeCourseImage(course.id)
      await onUpdated()
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="mb-4">
      <span className="block text-sm text-secondary mb-1">Course image</span>
      <div className="flex items-center gap-4">
        <CourseThumbnail
          name={course.name}
          provider={course.provider}
          imageUrl={course.image_url}
          className="w-32 h-20 rounded-md overflow-hidden border border-hairline shrink-0"
        />
        {canEdit && (
          <div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
              >
                {uploading ? 'Uploading…' : course.image_url ? 'Change image' : 'Upload image'}
              </button>
              {course.image_url && (
                <button
                  type="button"
                  onClick={handleRemove}
                  disabled={uploading}
                  className="text-sm text-secondary hover:text-red-700 disabled:opacity-60"
                >
                  Remove
                </button>
              )}
            </div>
            {error && <p className="text-xs text-red-700 mt-1">{error}</p>}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>
    </div>
  )
}

function CourseSections({ courseId, organisationId, userId, canEdit }) {
  const [sections, setSections] = useState([])
  const [items, setItems] = useState([])
  const [orgResources, setOrgResources] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [newSectionTitle, setNewSectionTitle] = useState('')
  const [creatingSection, setCreatingSection] = useState(false)
  const [addingSection, setAddingSection] = useState(false)
  const [selectedSectionId, setSelectedSectionId] = useState(null)
  const [focusRequest, setFocusRequest] = useState(null)
  const [draggedSectionId, setDraggedSectionId] = useState(null)
  const [sectionDropTarget, setSectionDropTarget] = useState(null)
  const [draggedOutlineItem, setDraggedOutlineItem] = useState(null)
  const [outlineItemDropTarget, setOutlineItemDropTarget] = useState(null)
  // One shared lock prevents overlapping section/resource order writes.
  const [reordering, setReordering] = useState(false)
  // Registries of rendered row nodes, used to resolve a touch drag's drop
  // target by comparing the touch point against each row's own
  // getBoundingClientRect (see findDropTarget) instead of
  // document.elementFromPoint, which was unreliable here.
  const sectionNodeRefs = useRef(new Map())
  const outlineItemNodeRefs = useRef(new Map())
  function registerSectionNode(id) {
    return (node) => {
      if (node) sectionNodeRefs.current.set(id, node)
      else sectionNodeRefs.current.delete(id)
    }
  }
  function registerOutlineItemNode(id) {
    return (node) => {
      if (node) outlineItemNodeRefs.current.set(id, node)
      else outlineItemNodeRefs.current.delete(id)
    }
  }
  // Items are the finer-grained target -- prefer a hit on a specific item
  // row over the coarser section row it sits inside.
  function findOutlineDropTarget(clientX, clientY) {
    const item = findDropTarget(outlineItemNodeRefs.current, clientX, clientY)
    if (item) return { type: 'item', ...item }
    const section = findDropTarget(sectionNodeRefs.current, clientX, clientY)
    if (section) return { type: 'section', ...section }
    return null
  }

  useEffect(() => {
    load()
  }, [courseId])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [sectionRows, itemRows, resourceRows] = await Promise.all([
        listCourseSections(courseId),
        listCourseResources(courseId),
        listOrganisationResources(organisationId),
      ])
      setSections(sectionRows)
      setItems(itemRows)
      setOrgResources(resourceRows)
      setSelectedSectionId((current) => {
        if (sectionRows.some((section) => section.id === current)) return current
        if (current === 'ungrouped' && itemRows.some((item) => item.sectionId === null)) return current
        return sectionRows[0]?.id ?? (itemRows.some((item) => item.sectionId === null) ? 'ungrouped' : null)
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const itemsBySection = useMemo(() => {
    const map = new Map()
    for (const item of items) {
      const list = map.get(item.sectionId) ?? []
      list.push(item)
      map.set(item.sectionId, list)
    }
    for (const list of map.values()) list.sort((a, b) => a.position - b.position)
    return map
  }, [items])

  const linkedResourceIds = useMemo(() => new Set(items.map((i) => i.id)), [items])
  // Content whose section was deleted (course_content_links.section_id "on
  // delete set null", 0078) stays attached to the course but ungrouped --
  // still shown here (reorderable, detachable) so a provider doesn't lose
  // the ability to manage it just because its section is gone, matching
  // what CourseLearn's own "Other" bucket already shows a learner.
  const ungroupedItems = itemsBySection.get(null) ?? []

  async function handleAddSection(e) {
    e.preventDefault()
    if (!newSectionTitle.trim()) return
    setCreatingSection(true)
    setError(null)
    try {
      const section = await createCourseSection(courseId, newSectionTitle)
      setNewSectionTitle('')
      setAddingSection(false)
      setSelectedSectionId(section.id)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setCreatingSection(false)
    }
  }

  function handleFocusItem(item) {
    setSelectedSectionId(item.sectionId ?? 'ungrouped')
    setFocusRequest({ itemId: item.linkId, token: Date.now() })
  }

  async function commitSectionOrder(draggedId, targetId, side = 'before') {
    const reordered = reorderById(sections, draggedId, targetId, 'id', side)
    if (reordered === sections) return
    const previous = sections
    setSections(reordered.map((section, position) => ({ ...section, position })))
    setReordering(true)
    setError(null)
    try {
      await reorderCourseSections(reordered)
      await load()
    } catch (err) {
      setSections(previous)
      setError(`Couldn't reorder sections. ${err.message}`)
    } finally {
      setReordering(false)
      setDraggedSectionId(null)
      setSectionDropTarget(null)
    }
  }

  function handleSectionKeyDown(event, sectionId) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    const index = sections.findIndex((section) => section.id === sectionId)
    const target = sections[index + (event.key === 'ArrowUp' ? -1 : 1)]
    if (target) commitSectionOrder(sectionId, target.id)
  }

  async function commitOutlineItemOrder(draggedId, targetSectionId, targetLinkId = null, side = 'before') {
    const dragged = items.find((item) => item.linkId === draggedId)
    if (!dragged) return
    const sourceSectionId = dragged.sectionId
    const sourceItems = (itemsBySection.get(sourceSectionId) ?? []).filter((item) => item.linkId !== draggedId)
    const destinationItems = itemsBySection.get(targetSectionId) ?? []

    let orderedDestination
    if (sourceSectionId === targetSectionId && targetLinkId) {
      orderedDestination = reorderById(destinationItems, draggedId, targetLinkId, 'linkId', side)
    } else {
      const withoutDragged = destinationItems.filter((item) => item.linkId !== draggedId)
      let targetIndex = targetLinkId
        ? withoutDragged.findIndex((item) => item.linkId === targetLinkId)
        : withoutDragged.length
      if (targetIndex < 0) targetIndex = withoutDragged.length
      else if (side === 'after') targetIndex += 1
      orderedDestination = [...withoutDragged]
      orderedDestination.splice(targetIndex, 0, dragged)
    }

    if (orderedDestination === destinationItems) return

    const normalizedDestination = orderedDestination.map((item, position) => ({ ...item, sectionId: targetSectionId, position }))
    const normalizedSource = sourceSectionId === targetSectionId
      ? []
      : sourceItems.map((item, position) => ({ ...item, position }))
    const previous = items
    const affectedIds = new Set([...normalizedSource, ...normalizedDestination].map((item) => item.linkId))
    setItems([
      ...items.filter((item) => !affectedIds.has(item.linkId)),
      ...normalizedSource,
      ...normalizedDestination,
    ])
    setSelectedSectionId(targetSectionId ?? 'ungrouped')
    setReordering(true)
    setError(null)
    try {
      await reorderContentLinks(normalizedDestination, targetSectionId)
      if (sourceSectionId !== targetSectionId) await reorderContentLinks(normalizedSource, sourceSectionId)
      await load()
    } catch (err) {
      setItems(previous)
      await load()
      setError(`Couldn't move the resource. ${err.message}`)
    } finally {
      setReordering(false)
      setDraggedOutlineItem(null)
      setOutlineItemDropTarget(null)
      setSectionDropTarget(null)
    }
  }

  function handleOutlineItemKeyDown(event, item) {
    const sectionItems = itemsBySection.get(item.sectionId) ?? []
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      const index = sectionItems.findIndex((candidate) => candidate.linkId === item.linkId)
      const target = sectionItems[index + (event.key === 'ArrowUp' ? -1 : 1)]
      if (target) commitOutlineItemOrder(item.linkId, item.sectionId, target.linkId)
      return
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const sectionIndex = sections.findIndex((section) => section.id === item.sectionId)
    const targetSection = sections[sectionIndex + (event.key === 'ArrowLeft' ? -1 : 1)]
    if (targetSection) commitOutlineItemOrder(item.linkId, targetSection.id)
  }

  if (loading) return <p className="text-secondary">Loading content…</p>

  const selectedSection = sections.find((section) => section.id === selectedSectionId)

  return (
    <div className="space-y-4">
      <h3 className="font-display text-lg text-ink">Sections</h3>

      {error && <p className="text-sm text-red-700">{error}</p>}

      <div className="grid md:grid-cols-[280px_minmax(0,1fr)] gap-6 items-start">
        <nav aria-label="Course content outline" className="md:sticky md:top-6">
          <div className="flex items-center justify-between gap-2 px-2.5 mb-2">
            <p className="font-mono text-[10px] uppercase tracking-wide text-secondary">Course outline</p>
            {canEdit && (
              <button
                type="button"
                onClick={() => setAddingSection(true)}
                className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-moss hover:opacity-80"
              >
                + Add section
              </button>
            )}
          </div>

          {sections.length === 0 && ungroupedItems.length === 0 ? (
            <div className="text-center py-8 px-3 border border-dashed border-hairline rounded-lg">
              <p className="text-xs text-secondary">
                {canEdit ? 'No sections yet — use "+ Add section" above to start structuring this course.' : 'No content added yet.'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {sections.map((section) => {
                const sectionItems = itemsBySection.get(section.id) ?? []
                const isSelected = selectedSectionId === section.id
                return (
                  <div
                    key={section.id}
                    ref={registerSectionNode(section.id)}
                    data-outline-section-id={section.id}
                    onDragOver={(event) => {
                      if (!canEdit || (!draggedSectionId && !draggedOutlineItem) || draggedSectionId === section.id) return
                      event.preventDefault()
                      setSectionDropTarget({
                        id: section.id,
                        side: draggedSectionId ? sideOf(event.currentTarget, event.clientY) : null,
                      })
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      if (draggedOutlineItem) commitOutlineItemOrder(draggedOutlineItem.linkId, section.id)
                      else if (draggedSectionId) commitSectionOrder(draggedSectionId, section.id, sideOf(event.currentTarget, event.clientY))
                    }}
                    className={`relative rounded-md transition-[background-color,box-shadow,opacity] ${
                      sectionDropTarget?.id === section.id && !sectionDropTarget.side ? 'bg-moss/10 ring-2 ring-moss ring-inset' : ''
                    } ${draggedSectionId === section.id ? 'opacity-40' : ''}`}
                  >
                    {sectionDropTarget?.id === section.id && <DropLine side={sectionDropTarget.side} />}
                    <div className="flex items-center gap-1">
                      {canEdit && (
                        <DragHandle
                          label={`Reorder ${section.title}`}
                          dragLabel={section.title}
                          disabled={reordering}
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = 'move'
                            event.dataTransfer.setData('text/plain', section.id)
                            setDraggedSectionId(section.id)
                          }}
                          onDragEnd={() => {
                            setDraggedSectionId(null)
                            setSectionDropTarget(null)
                          }}
                          onKeyDown={(event) => handleSectionKeyDown(event, section.id)}
                          onPointerDragStart={() => {
                            setDraggedSectionId(section.id)
                            setDraggedOutlineItem(null)
                          }}
                          onPointerDragMove={(event) => {
                            const hit = findOutlineDropTarget(event.clientX, event.clientY)
                            if (hit?.type === 'section' && hit.id !== section.id) {
                              setSectionDropTarget({ id: hit.id, side: hit.side })
                            }
                          }}
                          onPointerDragEnd={() => {
                            // Trust the drop-target state the drag already
                            // highlighted (from findOutlineDropTarget, resolved via
                            // each row's own getBoundingClientRect) rather than
                            // re-deriving it a second time at touch-end.
                            if (sectionDropTarget && sectionDropTarget.id !== section.id) {
                              commitSectionOrder(section.id, sectionDropTarget.id, sectionDropTarget.side ?? 'before')
                            } else {
                              setDraggedSectionId(null)
                              setSectionDropTarget(null)
                            }
                          }}
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => setSelectedSectionId(section.id)}
                        aria-current={isSelected ? 'true' : undefined}
                        className={`min-w-0 flex-1 flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
                          isSelected
                            ? 'bg-card border border-moss text-ink'
                            : 'border border-transparent text-secondary hover:bg-card hover:text-ink'
                        }`}
                      >
                        <span className={`w-2 h-2 rounded-full shrink-0 ${isSelected ? 'bg-moss' : 'border border-hairline'}`} aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate font-medium">{section.title}</span>
                        <span className="font-mono text-[10px] tabular-nums text-secondary shrink-0">{sectionItems.length}</span>
                      </button>
                    </div>
                    {sectionItems.length > 0 && (
                      <ul className="mt-1 ml-7 space-y-0.5" aria-label={`${section.title} resources`}>
                        {sectionItems.map((item) => (
                          <li
                            key={item.linkId}
                            ref={registerOutlineItemNode(item.linkId)}
                            data-outline-item-id={item.linkId}
                            onDragOver={(event) => {
                              if (!canEdit || !draggedOutlineItem || draggedOutlineItem.linkId === item.linkId) return
                              event.preventDefault()
                              event.stopPropagation()
                              setOutlineItemDropTarget({ id: item.linkId, side: sideOf(event.currentTarget, event.clientY) })
                              setSectionDropTarget(null)
                            }}
                            onDrop={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              if (draggedOutlineItem) {
                                commitOutlineItemOrder(draggedOutlineItem.linkId, section.id, item.linkId, sideOf(event.currentTarget, event.clientY))
                              }
                            }}
                            className={`relative flex min-w-0 items-center gap-1 rounded py-0.5 pr-1 transition-[background-color,opacity] ${
                              draggedOutlineItem?.linkId === item.linkId ? 'opacity-40' : ''
                            }`}
                          >
                            {outlineItemDropTarget?.id === item.linkId && <DropLine side={outlineItemDropTarget.side} />}
                            {canEdit && (
                              <DragHandle
                                label={`Move ${item.title}`}
                                dragLabel={item.title}
                                disabled={reordering}
                                onDragStart={(event) => {
                                  event.stopPropagation()
                                  event.dataTransfer.effectAllowed = 'move'
                                  event.dataTransfer.setData('text/plain', item.linkId)
                                  setDraggedOutlineItem(item)
                                  setDraggedSectionId(null)
                                }}
                                onDragEnd={() => {
                                  setDraggedOutlineItem(null)
                                  setOutlineItemDropTarget(null)
                                  setSectionDropTarget(null)
                                }}
                                onKeyDown={(event) => handleOutlineItemKeyDown(event, item)}
                                onPointerDragStart={() => {
                                  setDraggedOutlineItem(item)
                                  setDraggedSectionId(null)
                                }}
                                onPointerDragMove={(event) => {
                                  const hit = findOutlineDropTarget(event.clientX, event.clientY)
                                  if (hit?.type === 'item' && hit.id !== item.linkId) {
                                    setOutlineItemDropTarget({ id: hit.id, side: hit.side })
                                    setSectionDropTarget(null)
                                  } else if (hit?.type === 'section') {
                                    setOutlineItemDropTarget(null)
                                    setSectionDropTarget({ id: hit.id, side: null })
                                  }
                                }}
                                onPointerDragEnd={() => {
                                  // Trust the drop-target state the drag already
                                  // highlighted, rather than a second
                                  // findDropTarget call at touch-end.
                                  if (outlineItemDropTarget && outlineItemDropTarget.id !== item.linkId) {
                                    const targetItem = items.find((candidate) => candidate.linkId === outlineItemDropTarget.id)
                                    if (targetItem) {
                                      commitOutlineItemOrder(item.linkId, targetItem.sectionId, outlineItemDropTarget.id, outlineItemDropTarget.side)
                                    } else {
                                      setDraggedOutlineItem(null)
                                      setOutlineItemDropTarget(null)
                                      setSectionDropTarget(null)
                                    }
                                  } else if (sectionDropTarget) {
                                    commitOutlineItemOrder(item.linkId, sectionDropTarget.id === 'ungrouped' ? null : sectionDropTarget.id)
                                  } else {
                                    setDraggedOutlineItem(null)
                                    setOutlineItemDropTarget(null)
                                    setSectionDropTarget(null)
                                  }
                                }}
                              />
                            )}
                            <button
                              type="button"
                              onClick={() => handleFocusItem(item)}
                              className="min-w-0 flex-1 truncate text-left text-xs text-secondary hover:text-ink hover:underline"
                            >
                              {item.title}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )
              })}
              {ungroupedItems.length > 0 && (
                <div
                  ref={registerSectionNode('ungrouped')}
                  data-outline-section-id="ungrouped"
                  onDragOver={(event) => {
                    if (!canEdit || !draggedOutlineItem) return
                    event.preventDefault()
                    setSectionDropTarget({ id: 'ungrouped', side: null })
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    if (draggedOutlineItem) commitOutlineItemOrder(draggedOutlineItem.linkId, null)
                  }}
                  className={`relative rounded-md transition-[background-color,box-shadow] ${
                    sectionDropTarget?.id === 'ungrouped' && !sectionDropTarget.side ? 'bg-moss/10 ring-2 ring-moss ring-inset' : ''
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedSectionId('ungrouped')}
                    aria-current={selectedSectionId === 'ungrouped' ? 'true' : undefined}
                    className={`w-full flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
                      selectedSectionId === 'ungrouped'
                        ? 'bg-card border border-moss text-ink'
                        : 'border border-transparent text-secondary hover:bg-card hover:text-ink'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full border border-hairline shrink-0" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate font-medium">Ungrouped content</span>
                    <span className="font-mono text-[10px] tabular-nums text-secondary shrink-0">{ungroupedItems.length}</span>
                  </button>
                  <ul className="mt-1 ml-7 space-y-0.5" aria-label="Ungrouped resources">
                    {ungroupedItems.map((item) => (
                      <li
                        key={item.linkId}
                        ref={registerOutlineItemNode(item.linkId)}
                        data-outline-item-id={item.linkId}
                        onDragOver={(event) => {
                          if (!canEdit || !draggedOutlineItem || draggedOutlineItem.linkId === item.linkId) return
                          event.preventDefault()
                          event.stopPropagation()
                          setOutlineItemDropTarget({ id: item.linkId, side: sideOf(event.currentTarget, event.clientY) })
                          setSectionDropTarget(null)
                        }}
                        onDrop={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          if (draggedOutlineItem) {
                            commitOutlineItemOrder(draggedOutlineItem.linkId, null, item.linkId, sideOf(event.currentTarget, event.clientY))
                          }
                        }}
                        className={`relative flex min-w-0 items-center gap-1 rounded py-0.5 pr-1 transition-[background-color,opacity] ${
                          draggedOutlineItem?.linkId === item.linkId ? 'opacity-40' : ''
                        }`}
                      >
                        {outlineItemDropTarget?.id === item.linkId && <DropLine side={outlineItemDropTarget.side} />}
                        {canEdit && (
                          <DragHandle
                            label={`Move ${item.title}`}
                            dragLabel={item.title}
                            disabled={reordering}
                            onDragStart={(event) => {
                              event.stopPropagation()
                              event.dataTransfer.effectAllowed = 'move'
                              event.dataTransfer.setData('text/plain', item.linkId)
                              setDraggedOutlineItem(item)
                              setDraggedSectionId(null)
                            }}
                            onDragEnd={() => {
                              setDraggedOutlineItem(null)
                              setOutlineItemDropTarget(null)
                              setSectionDropTarget(null)
                            }}
                            onKeyDown={(event) => handleOutlineItemKeyDown(event, item)}
                            onPointerDragStart={() => {
                              setDraggedOutlineItem(item)
                              setDraggedSectionId(null)
                            }}
                            onPointerDragMove={(event) => {
                              const hit = findOutlineDropTarget(event.clientX, event.clientY)
                              if (hit?.type === 'item' && hit.id !== item.linkId) {
                                setOutlineItemDropTarget({ id: hit.id, side: hit.side })
                                setSectionDropTarget(null)
                              } else if (hit?.type === 'section') {
                                setOutlineItemDropTarget(null)
                                setSectionDropTarget({ id: hit.id, side: null })
                              }
                            }}
                            onPointerDragEnd={() => {
                              if (outlineItemDropTarget && outlineItemDropTarget.id !== item.linkId) {
                                const targetItem = items.find((candidate) => candidate.linkId === outlineItemDropTarget.id)
                                if (targetItem) {
                                  commitOutlineItemOrder(item.linkId, targetItem.sectionId, outlineItemDropTarget.id, outlineItemDropTarget.side)
                                } else {
                                  setDraggedOutlineItem(null)
                                  setOutlineItemDropTarget(null)
                                  setSectionDropTarget(null)
                                }
                              } else if (sectionDropTarget) {
                                commitOutlineItemOrder(item.linkId, sectionDropTarget.id === 'ungrouped' ? null : sectionDropTarget.id)
                              } else {
                                setDraggedOutlineItem(null)
                                setOutlineItemDropTarget(null)
                                setSectionDropTarget(null)
                              }
                            }}
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => handleFocusItem(item)}
                          className="min-w-0 flex-1 truncate text-left text-xs text-secondary hover:text-ink hover:underline"
                        >
                          {item.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </nav>

        <div className="min-w-0">
          {selectedSection && (
            <SectionCard
              key={selectedSection.id}
              section={selectedSection}
              items={itemsBySection.get(selectedSection.id) ?? []}
              availableResources={orgResources.filter((r) => !linkedResourceIds.has(r.id))}
              courseId={courseId}
              organisationId={organisationId}
              userId={userId}
              canEdit={canEdit}
              onChanged={load}
              reordering={reordering}
              setReordering={setReordering}
              focusRequest={focusRequest}
            />
          )}
          {selectedSectionId === 'ungrouped' && ungroupedItems.length > 0 && (
            <UngroupedContent
              items={ungroupedItems}
              userId={userId}
              canEdit={canEdit}
              onChanged={load}
              reordering={reordering}
              setReordering={setReordering}
              focusRequest={focusRequest}
            />
          )}
        </div>
      </div>

      {addingSection && (
        <AddSectionModal
          value={newSectionTitle}
          onChange={setNewSectionTitle}
          busy={creatingSection}
          onSubmit={handleAddSection}
          onClose={() => {
            setAddingSection(false)
            setNewSectionTitle('')
          }}
        />
      )}
    </div>
  )
}

function AddSectionModal({ value, onChange, busy, onSubmit, onClose }) {
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

// Content left over from a deleted section (0078: course_content_links.
// section_id "on delete set null") -- reorderable and detachable like any
// section's items, but can't accept new attachments/uploads directly since
// it isn't a real section; a provider who wants to keep this content
// organized should create a section and re-attach it there instead.
function UngroupedContent({ items, userId, canEdit, onChanged, reordering, setReordering, focusRequest }) {
  const [previewingId, setPreviewingId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [draggedItemId, setDraggedItemId] = useState(null)
  const [itemDropTarget, setItemDropTarget] = useState(null)
  const { highlightedItemId, registerItemRef, itemRefs } = useItemFocusHighlight(focusRequest)

  async function handleDetach(item) {
    setBusy(true)
    setError(null)
    try {
      await unlinkResourceFromCourse(item.linkId)
      await onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function commitItemOrder(draggedId, targetId, side = 'before') {
    const reordered = reorderById(items, draggedId, targetId, 'linkId', side)
    if (reordered === items) return
    setReordering(true)
    setError(null)
    try {
      await reorderContentLinks(reordered)
      await onChanged()
    } catch (err) {
      setError(`Couldn't reorder content. ${err.message}`)
    } finally {
      setReordering(false)
      setDraggedItemId(null)
      setItemDropTarget(null)
    }
  }

  function handleItemKeyDown(event, itemId) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    const index = items.findIndex((item) => item.linkId === itemId)
    const target = items[index + (event.key === 'ArrowUp' ? -1 : 1)]
    if (target) commitItemOrder(itemId, target.linkId)
  }

  return (
    <div className="bg-card border border-dashed border-hairline rounded-lg p-6">
      <h4 className="font-display text-base text-ink mb-1">Ungrouped content</h4>
      <p className="text-xs text-secondary mb-3">
        This content's section was deleted. It's still part of the course — add a section and re-attach it to
        organize it again.
      </p>

      {error && <p className="text-xs text-red-700 mb-2">{error}</p>}

      <ul className="divide-y divide-hairline border border-hairline rounded-md">
        {items.map((item) => (
          <li
            key={item.linkId}
            ref={registerItemRef(item.linkId)}
            data-content-item-id={item.linkId}
            onDragOver={(event) => {
              if (!canEdit || !draggedItemId || draggedItemId === item.linkId) return
              event.preventDefault()
              setItemDropTarget({ id: item.linkId, side: sideOf(event.currentTarget, event.clientY) })
            }}
            onDrop={(event) => {
              event.preventDefault()
              if (draggedItemId) commitItemOrder(draggedItemId, item.linkId, sideOf(event.currentTarget, event.clientY))
            }}
            className={`relative p-2 text-sm transition-[background-color,box-shadow,opacity] ${
              highlightedItemId === item.linkId ? 'bg-moss/10 ring-2 ring-moss ring-inset' : ''
            } ${draggedItemId === item.linkId ? 'opacity-40' : ''}`}
          >
            {itemDropTarget?.id === item.linkId && <DropLine side={itemDropTarget.side} />}
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1">
                {canEdit && (
                  <DragHandle
                    label={`Reorder ${item.title}`}
                    dragLabel={item.title}
                    disabled={busy || reordering}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move'
                      event.dataTransfer.setData('text/plain', item.linkId)
                      setDraggedItemId(item.linkId)
                    }}
                    onDragEnd={() => {
                      setDraggedItemId(null)
                      setItemDropTarget(null)
                    }}
                    onKeyDown={(event) => handleItemKeyDown(event, item.linkId)}
                    onPointerDragStart={() => setDraggedItemId(item.linkId)}
                    onPointerDragMove={(event) => {
                      const hit = findDropTarget(itemRefs.current, event.clientX, event.clientY)
                      if (hit && hit.id !== item.linkId) setItemDropTarget(hit)
                    }}
                    onPointerDragEnd={() => {
                      if (itemDropTarget && itemDropTarget.id !== item.linkId) {
                        commitItemOrder(item.linkId, itemDropTarget.id, itemDropTarget.side)
                      } else {
                        setDraggedItemId(null)
                        setItemDropTarget(null)
                      }
                    }}
                  />
                )}
                <div className="min-w-0">
                <p className="text-ink truncate">{item.title}</p>
                <p className="font-mono text-[10px] text-secondary">{TYPE_LABELS[item.type]}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {item.type === 'file' ? (
                  <a href={contentFileUrl(item)} download={item.file_name || true} className="text-xs text-moss font-medium">
                    Download
                  </a>
                ) : item.type === 'web_url' ? (
                  <a href={item.external_url} target="_blank" rel="noopener noreferrer" className="text-xs text-moss font-medium">
                    Open link
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPreviewingId((id) => (id === item.id ? null : item.id))}
                    className="text-xs text-moss font-medium"
                  >
                    {previewingId === item.id ? 'Hide preview' : 'Preview'}
                  </button>
                )}
                {canEdit && (
                    <button
                      type="button"
                      onClick={() => handleDetach(item)}
                      disabled={busy}
                      className="text-xs text-red-700 hover:underline disabled:opacity-60"
                    >
                      Detach
                    </button>
                )}
              </div>
            </div>
            {previewingId === item.id && (item.type === 'video' || item.type === 'screen_recording') && (
              <EditedVideoPlayer resource={item} className="w-full mt-2 rounded-md bg-black" />
            )}
            {previewingId === item.id && item.type === 'scorm' && (
              <div className="mt-2">
                <ScormPlayer contentItem={item} userId={userId} />
              </div>
            )}
            {previewingId === item.id && item.type === 'xapi' && (
              <div className="mt-2">
                <XapiPlayer contentItem={item} userId={userId} />
              </div>
            )}
            {previewingId === item.id && item.type === 'external_video' && (
              <iframe
                src={item.external_url}
                title={item.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="w-full aspect-video mt-2 rounded-md"
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function SectionCard({
  section,
  items,
  availableResources,
  courseId,
  organisationId,
  userId,
  canEdit,
  onChanged,
  reordering,
  setReordering,
  focusRequest,
}) {
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(section.title)
  const [previewingId, setPreviewingId] = useState(null)
  const [selectedResourceId, setSelectedResourceId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [uploadType, setUploadType] = useState('video')
  const [uploadTitle, setUploadTitle] = useState('')
  const [uploading, setUploading] = useState(false)
  const [showScreenRecorder, setShowScreenRecorder] = useState(false)
  const [recordedFileName, setRecordedFileName] = useState('')
  const [webUrl, setWebUrl] = useState('')
  const [draggedItemId, setDraggedItemId] = useState(null)
  const [itemDropTarget, setItemDropTarget] = useState(null)
  const { highlightedItemId, registerItemRef, itemRefs } = useItemFocusHighlight(focusRequest)
  const fileInputRef = useRef(null)

  function setRecordedFile(file) {
    if (!fileInputRef.current) return
    const transfer = new DataTransfer()
    transfer.items.add(file)
    fileInputRef.current.files = transfer.files
    setRecordedFileName(file.name)
    if (!uploadTitle.trim()) setUploadTitle('Screen recording')
  }

  async function handleRenameSave() {
    if (!titleDraft.trim() || titleDraft === section.title) {
      setEditingTitle(false)
      setTitleDraft(section.title)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await renameCourseSection(section.id, titleDraft)
      setEditingTitle(false)
      await onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteSection() {
    setBusy(true)
    setError(null)
    try {
      await deleteCourseSection(section.id)
      setConfirmingDelete(false)
      await onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleAttach() {
    if (!selectedResourceId) return
    setBusy(true)
    setError(null)
    try {
      await linkResourceToCourse(courseId, selectedResourceId, section.id)
      setSelectedResourceId('')
      await onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleDetach(item) {
    setBusy(true)
    setError(null)
    try {
      await unlinkResourceFromCourse(item.linkId)
      await onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function commitItemOrder(draggedId, targetId, side = 'before') {
    const reordered = reorderById(items, draggedId, targetId, 'linkId', side)
    if (reordered === items) return
    setReordering(true)
    setError(null)
    try {
      await reorderContentLinks(reordered)
      await onChanged()
    } catch (err) {
      setError(`Couldn't reorder content. ${err.message}`)
    } finally {
      setReordering(false)
      setDraggedItemId(null)
      setItemDropTarget(null)
    }
  }

  function handleItemKeyDown(event, itemId) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    const index = items.findIndex((item) => item.linkId === itemId)
    const target = items[index + (event.key === 'ArrowUp' ? -1 : 1)]
    if (target) commitItemOrder(itemId, target.linkId)
  }

  async function handleUpload() {
    if (uploadType === 'web_url') {
      if (!webUrl.trim()) {
        setError('Enter a web address first.')
        return
      }
      setUploading(true)
      setError(null)
      try {
        const resource = await addWebResource(organisationId, userId, webUrl, uploadTitle)
        await linkResourceToCourse(courseId, resource.id, section.id)
        setUploadTitle('')
        setWebUrl('')
        setShowUpload(false)
        await onChanged()
      } catch (err) {
        setError(err.message)
      } finally {
        setUploading(false)
      }
      return
    }

    const file = fileInputRef.current?.files[0]
    if (!file) {
      setError(uploadType === 'screen_recording' ? 'Record your screen first.' : 'Choose a file first.')
      return
    }
    setUploading(true)
    setError(null)
    try {
      const resource =
        uploadType === 'video'
          ? await uploadVideoResource(organisationId, userId, file, uploadTitle)
          : uploadType === 'screen_recording'
            ? await uploadScreenRecordingResource(organisationId, userId, file, uploadTitle)
          : uploadType === 'file'
            ? await uploadFileResource(organisationId, userId, file, uploadTitle)
            : uploadType === 'scorm'
              ? await uploadScormResource(organisationId, userId, file, uploadTitle)
              : await uploadXapiResource(organisationId, userId, file, uploadTitle)
      await linkResourceToCourse(courseId, resource.id, section.id)
      setUploadTitle('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      setRecordedFileName('')
      setShowUpload(false)
      await onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="bg-card border border-hairline rounded-lg p-6">
      <div className="flex items-center justify-between gap-2 mb-3">
        {editingTitle ? (
          <div className="flex items-center gap-2 flex-1">
            <input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleRenameSave()}
              className="flex-1 rounded-md border border-hairline bg-paper px-2 py-1 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            />
            <button type="button" onClick={handleRenameSave} disabled={busy} className="text-xs text-moss font-medium">
              Save
            </button>
          </div>
        ) : (
          <h4 className="font-display text-base text-ink">{section.title}</h4>
        )}

        {canEdit && !editingTitle && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setEditingTitle(true)}
              className="rounded-md border border-hairline text-ink py-1 px-2 text-xs font-medium hover:bg-paper"
            >
              Rename
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="rounded-md border border-hairline text-red-700 py-1 px-2 text-xs font-medium hover:bg-paper"
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-secondary">No content in this section yet.</p>
      ) : (
        <ul className="divide-y divide-hairline border border-hairline rounded-md mb-3">
          {items.map((item) => (
            <li
              key={item.linkId}
              ref={registerItemRef(item.linkId)}
              data-content-item-id={item.linkId}
              onDragOver={(event) => {
                if (!canEdit || !draggedItemId || draggedItemId === item.linkId) return
                event.preventDefault()
                setItemDropTarget({ id: item.linkId, side: sideOf(event.currentTarget, event.clientY) })
              }}
              onDrop={(event) => {
                event.preventDefault()
                if (draggedItemId) commitItemOrder(draggedItemId, item.linkId, sideOf(event.currentTarget, event.clientY))
              }}
              className={`relative p-2 text-sm transition-[background-color,box-shadow,opacity] ${
                highlightedItemId === item.linkId ? 'bg-moss/10 ring-2 ring-moss ring-inset' : ''
              } ${draggedItemId === item.linkId ? 'opacity-40' : ''}`}
            >
              {itemDropTarget?.id === item.linkId && <DropLine side={itemDropTarget.side} />}
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1">
                  {canEdit && (
                    <DragHandle
                      label={`Reorder ${item.title}`}
                      dragLabel={item.title}
                      disabled={busy || reordering}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData('text/plain', item.linkId)
                        setDraggedItemId(item.linkId)
                      }}
                      onDragEnd={() => {
                        setDraggedItemId(null)
                        setItemDropTarget(null)
                      }}
                      onKeyDown={(event) => handleItemKeyDown(event, item.linkId)}
                      onPointerDragStart={() => setDraggedItemId(item.linkId)}
                      onPointerDragMove={(event) => {
                        const hit = findDropTarget(itemRefs.current, event.clientX, event.clientY)
                        if (hit && hit.id !== item.linkId) setItemDropTarget(hit)
                      }}
                      onPointerDragEnd={() => {
                        if (itemDropTarget && itemDropTarget.id !== item.linkId) {
                          commitItemOrder(item.linkId, itemDropTarget.id, itemDropTarget.side)
                        } else {
                          setDraggedItemId(null)
                          setItemDropTarget(null)
                        }
                      }}
                    />
                  )}
                  <div className="min-w-0">
                    <p className="text-ink truncate">{item.title}</p>
                    <p className="font-mono text-[10px] text-secondary">{TYPE_LABELS[item.type]}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {item.type === 'file' ? (
                    <a href={contentFileUrl(item)} download={item.file_name || true} className="text-xs text-moss font-medium">
                      Download
                    </a>
                  ) : item.type === 'web_url' ? (
                    <a href={item.external_url} target="_blank" rel="noopener noreferrer" className="text-xs text-moss font-medium">
                      Open link
                    </a>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPreviewingId((id) => (id === item.id ? null : item.id))}
                      className="text-xs text-moss font-medium"
                    >
                      {previewingId === item.id ? 'Hide preview' : 'Preview'}
                    </button>
                  )}
                  {canEdit && (
                      <button
                        type="button"
                        onClick={() => handleDetach(item)}
                        disabled={busy}
                        className="text-xs text-red-700 hover:underline disabled:opacity-60"
                      >
                        Detach
                      </button>
                  )}
                </div>
              </div>
              {previewingId === item.id && (item.type === 'video' || item.type === 'screen_recording') && (
                <EditedVideoPlayer resource={item} className="w-full mt-2 rounded-md bg-black" />
              )}
              {previewingId === item.id && item.type === 'scorm' && (
                <div className="mt-2">
                  <ScormPlayer contentItem={item} userId={userId} />
                </div>
              )}
              {previewingId === item.id && item.type === 'xapi' && (
                <div className="mt-2">
                  <XapiPlayer contentItem={item} userId={userId} />
                </div>
              )}
              {previewingId === item.id && item.type === 'external_video' && (
                <iframe
                  src={item.external_url}
                  title={item.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  className="w-full aspect-video mt-2 rounded-md"
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-xs text-red-700 mb-2">{error}</p>}

      {canEdit && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs text-secondary mb-1" htmlFor={`attachResource-${section.id}`}>
                Add existing resource
              </label>
              <select
                id={`attachResource-${section.id}`}
                value={selectedResourceId}
                onChange={(e) => setSelectedResourceId(e.target.value)}
                disabled={availableResources.length === 0}
                className="w-full rounded-md border border-hairline bg-paper px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss disabled:opacity-60"
              >
                <option value="">
                  {availableResources.length === 0 ? 'Nothing left to add' : 'Choose a resource…'}
                </option>
                {availableResources.map((resource) => (
                  <option key={resource.id} value={resource.id}>
                    {resource.title} ({TYPE_LABELS[resource.type]})
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={handleAttach}
              disabled={busy || !selectedResourceId}
              className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => setShowUpload((v) => !v)}
              className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper"
            >
              {showUpload ? 'Cancel' : '+ Add new content'}
            </button>
          </div>

          {showUpload && (
            <div className="bg-paper border border-hairline rounded-md p-3 flex flex-wrap items-end gap-2">
              <div>
                <label className="block text-xs text-secondary mb-1" htmlFor={`uploadType-${section.id}`}>
                  Type
                </label>
                <select
                  id={`uploadType-${section.id}`}
                  value={uploadType}
                  onChange={(e) => {
                    setUploadType(e.target.value)
                    if (fileInputRef.current) fileInputRef.current.value = ''
                    setRecordedFileName('')
                    setWebUrl('')
                  }}
                  className="rounded-md border border-hairline bg-card px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                >
                  <option value="video">Video</option>
                  <option value="screen_recording">Screen recording</option>
                  <option value="file">File</option>
                  <option value="scorm">SCORM package (.zip)</option>
                  <option value="xapi">xAPI package (.zip)</option>
                  <option value="web_url">Web link</option>
                </select>
              </div>
              <div className="flex-1 min-w-[140px]">
                <label className="block text-xs text-secondary mb-1" htmlFor={`uploadTitle-${section.id}`}>
                  Title (optional)
                </label>
                <input
                  id={`uploadTitle-${section.id}`}
                  value={uploadTitle}
                  onChange={(e) => setUploadTitle(e.target.value)}
                  className="w-full rounded-md border border-hairline bg-card px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                />
              </div>
              {uploadType === 'web_url' ? (
                <div className="flex-1 min-w-[220px]">
                  <label className="block text-xs text-secondary mb-1" htmlFor={`webUrl-${section.id}`}>Web address</label>
                  <input
                    id={`webUrl-${section.id}`}
                    type="url"
                    value={webUrl}
                    onChange={(e) => setWebUrl(e.target.value)}
                    placeholder="https://example.com/resource"
                    className="w-full rounded-md border border-hairline bg-card px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                  />
                </div>
              ) : uploadType === 'screen_recording' ? (
                <div className="min-w-[180px]">
                  <span className="block text-xs text-secondary mb-1">Recording</span>
                  <button
                    type="button"
                    onClick={() => setShowScreenRecorder(true)}
                    className="inline-flex items-center gap-2 rounded-md border border-moss text-moss px-3 py-1.5 text-sm font-medium hover:bg-moss/5"
                  >
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <rect x="3" y="4" width="18" height="13" rx="2" />
                      <path d="M8 21h8M12 17v4" />
                    </svg>
                    {recordedFileName ? 'Record again' : 'Record screen'}
                  </button>
                  {recordedFileName && <p className="text-xs text-secondary mt-1 max-w-[220px] truncate">Ready: {recordedFileName}</p>}
                  <input ref={fileInputRef} type="file" accept="video/*" className="sr-only" tabIndex={-1} />
                </div>
              ) : (
                <div>
                  <input
                  ref={fileInputRef}
                  type="file"
                  accept={
                    uploadType === 'scorm' || uploadType === 'xapi'
                      ? '.zip'
                      : uploadType === 'video'
                        ? 'video/*'
                        : undefined
                  }
                  className="text-xs text-secondary"
                  />
                </div>
              )}
              <button
                type="button"
                onClick={handleUpload}
                disabled={uploading}
                className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
              >
                {uploading
                  ? 'Adding…'
                  : uploadType === 'screen_recording'
                    ? 'Add recording'
                    : uploadType === 'web_url'
                      ? 'Add link'
                      : 'Upload & add'}
              </button>
            </div>
          )}

          {showScreenRecorder && (
            <ScreenRecorderModal onClose={() => setShowScreenRecorder(false)} onRecorded={setRecordedFile} />
          )}
        </div>
      )}

      {confirmingDelete && (
        <ConfirmDialog
          message={`Delete the "${section.title}" section? Its content stays attached to the course, just ungrouped.`}
          confirmLabel="Delete section"
          confirming={busy}
          onConfirm={handleDeleteSection}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  )
}
