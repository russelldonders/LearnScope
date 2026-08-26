import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import AppHeader from '../../components/AppHeader'
import ScormPlayer from '../../components/ScormPlayer'
import XapiPlayer from '../../components/XapiPlayer'
import EditedVideoPlayer from '../../components/EditedVideoPlayer'
import ConfirmDialog from '../../components/ConfirmDialog'
import { getCatalogueCourse, updateProviderCourse, setCatalogueCourseStatus } from '../../lib/admin/catalogue'
import {
  listCourseSections,
  createCourseSection,
  renameCourseSection,
  deleteCourseSection,
  moveCourseSection,
  listCourseResources,
  listOrganisationResources,
  linkResourceToCourse,
  unlinkResourceFromCourse,
  moveContentLink,
  uploadVideoResource,
  uploadFileResource,
  uploadScormResource,
  uploadXapiResource,
  contentFileUrl,
} from '../../lib/courseContent'

const TYPE_LABELS = {
  video: 'Video',
  file: 'File',
  scorm: 'SCORM package',
  xapi: 'xAPI package',
  external_video: 'External video',
}
const STATUS_LABELS = {
  draft: 'Draft',
  pending_approval: 'Pending approval',
  approved: 'Approved',
  rejected: 'Rejected',
  inactive: 'Inactive',
}

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
      <main className="max-w-4xl mx-auto px-4 py-8">
        <Link to="/provider" className="text-sm text-secondary hover:text-ink mb-4 inline-block">
          ← Back to provider console
        </Link>

        {loading && <p className="text-secondary">Loading…</p>}
        {notFound && <p className="text-secondary">Course not found.</p>}
        {error && <p className="text-sm text-red-700">{error}</p>}

        {course && (
          <div className="space-y-6">
            <CourseHeader course={course} canEdit={canEdit} onSaved={load} />
            <CourseSections courseId={course.id} organisationId={course.organisation_id} userId={user.id} canEdit={canEdit} />
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

  return (
    <div className="bg-card border border-hairline rounded-lg p-6">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <h2 className="font-display text-xl text-ink">{course.name}</h2>
        <span className="font-mono text-[10px] uppercase tracking-wide text-secondary shrink-0">
          {STATUS_LABELS[course.status] ?? course.status}
        </span>
      </div>

      {course.status === 'rejected' && course.rejection_reason && (
        <p className="text-sm text-red-700 mb-4">Rejected: {course.rejection_reason}</p>
      )}

      {!canEdit ? (
        course.synopsis && <p className="text-sm text-secondary">{course.synopsis}</p>
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

          {error && <p className="text-sm text-red-700">{error}</p>}

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

function CourseSections({ courseId, organisationId, userId, canEdit }) {
  const [sections, setSections] = useState([])
  const [items, setItems] = useState([])
  const [orgResources, setOrgResources] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [newSectionTitle, setNewSectionTitle] = useState('')
  const [creatingSection, setCreatingSection] = useState(false)
  // Shared across every section/ungrouped-content row (not just one row's
  // own local `busy`) -- moveCourseSection/moveContentLink swap two rows'
  // positions from a snapshot passed in by the caller, so two reorders
  // in flight at once (different rows, each individually enabled) could
  // race and stomp each other's write. Locking reorder globally while any
  // one move is in flight is simpler than optimistic locking at the DB
  // layer for what's a rare, low-stakes edge case.
  const [reordering, setReordering] = useState(false)

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
      await createCourseSection(courseId, newSectionTitle)
      setNewSectionTitle('')
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setCreatingSection(false)
    }
  }

  if (loading) return <p className="text-secondary">Loading content…</p>

  return (
    <div className="space-y-4">
      <h3 className="font-display text-lg text-ink">Sections</h3>

      {error && <p className="text-sm text-red-700">{error}</p>}

      {sections.length === 0 && ungroupedItems.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-hairline rounded-lg">
          <p className="text-secondary">
            {canEdit ? 'No sections yet — add one below to start structuring this course.' : 'No content added yet.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {sections.map((section, index) => (
            <SectionCard
              key={section.id}
              section={section}
              isFirst={index === 0}
              isLast={index === sections.length - 1}
              items={itemsBySection.get(section.id) ?? []}
              availableResources={orgResources.filter((r) => !linkedResourceIds.has(r.id))}
              courseId={courseId}
              organisationId={organisationId}
              userId={userId}
              canEdit={canEdit}
              allSections={sections}
              onChanged={load}
              reordering={reordering}
              setReordering={setReordering}
            />
          ))}
          {ungroupedItems.length > 0 && (
            <UngroupedContent
              items={ungroupedItems}
              userId={userId}
              canEdit={canEdit}
              onChanged={load}
              reordering={reordering}
              setReordering={setReordering}
            />
          )}
        </div>
      )}

      {canEdit && (
        <form onSubmit={handleAddSection} className="bg-card border border-hairline rounded-lg p-4 flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-secondary mb-1" htmlFor="newSectionTitle">
              Section title
            </label>
            <input
              id="newSectionTitle"
              value={newSectionTitle}
              onChange={(e) => setNewSectionTitle(e.target.value)}
              placeholder="e.g. Getting started"
              className="w-full rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            />
          </div>
          <button
            type="submit"
            disabled={creatingSection || !newSectionTitle.trim()}
            className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
          >
            {creatingSection ? 'Adding…' : '+ Add section'}
          </button>
        </form>
      )}
    </div>
  )
}

// Content left over from a deleted section (0078: course_content_links.
// section_id "on delete set null") -- reorderable and detachable like any
// section's items, but can't accept new attachments/uploads directly since
// it isn't a real section; a provider who wants to keep this content
// organized should create a section and re-attach it there instead.
function UngroupedContent({ items, userId, canEdit, onChanged, reordering, setReordering }) {
  const [previewingId, setPreviewingId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

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

  async function handleMoveItem(item, direction) {
    setReordering(true)
    setError(null)
    try {
      await moveContentLink(items, item.linkId, direction)
      await onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setReordering(false)
    }
  }

  return (
    <div className="bg-card border border-dashed border-hairline rounded-lg p-4">
      <h4 className="font-display text-base text-ink mb-1">Ungrouped content</h4>
      <p className="text-xs text-secondary mb-3">
        This content's section was deleted. It's still part of the course — add a section and re-attach it to
        organize it again.
      </p>

      {error && <p className="text-xs text-red-700 mb-2">{error}</p>}

      <ul className="divide-y divide-hairline border border-hairline rounded-md">
        {items.map((item, index) => (
          <li key={item.linkId} className="p-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-ink truncate">{item.title}</p>
                <p className="font-mono text-[10px] text-secondary">{TYPE_LABELS[item.type]}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {item.type === 'file' ? (
                  <a href={contentFileUrl(item)} download={item.file_name || true} className="text-xs text-moss font-medium">
                    Download
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
                  <>
                    <button
                      type="button"
                      disabled={index === 0 || busy || reordering}
                      onClick={() => handleMoveItem(item, 'up')}
                      title="Move up"
                      className="rounded-md border border-hairline text-ink w-6 h-6 text-xs hover:bg-paper disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={index === items.length - 1 || busy || reordering}
                      onClick={() => handleMoveItem(item, 'down')}
                      title="Move down"
                      className="rounded-md border border-hairline text-ink w-6 h-6 text-xs hover:bg-paper disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDetach(item)}
                      disabled={busy}
                      className="text-xs text-red-700 hover:underline disabled:opacity-60"
                    >
                      Detach
                    </button>
                  </>
                )}
              </div>
            </div>
            {previewingId === item.id && item.type === 'video' && (
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
  isFirst,
  isLast,
  items,
  availableResources,
  courseId,
  organisationId,
  userId,
  canEdit,
  allSections,
  onChanged,
  reordering,
  setReordering,
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
  const fileInputRef = useRef(null)

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

  async function handleMoveSection(direction) {
    setReordering(true)
    setError(null)
    try {
      await moveCourseSection(allSections, section.id, direction)
      await onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setReordering(false)
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

  async function handleMoveItem(item, direction) {
    setReordering(true)
    setError(null)
    try {
      await moveContentLink(items, item.linkId, direction)
      await onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setReordering(false)
    }
  }

  async function handleUpload() {
    const file = fileInputRef.current?.files[0]
    if (!file) {
      setError('Choose a file first.')
      return
    }
    setUploading(true)
    setError(null)
    try {
      const resource =
        uploadType === 'video'
          ? await uploadVideoResource(organisationId, userId, file, uploadTitle)
          : uploadType === 'file'
            ? await uploadFileResource(organisationId, userId, file, uploadTitle)
            : uploadType === 'scorm'
              ? await uploadScormResource(organisationId, userId, file, uploadTitle)
              : await uploadXapiResource(organisationId, userId, file, uploadTitle)
      await linkResourceToCourse(courseId, resource.id, section.id)
      setUploadTitle('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      setShowUpload(false)
      await onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="bg-card border border-hairline rounded-lg p-4">
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
              disabled={isFirst || busy || reordering}
              onClick={() => handleMoveSection('up')}
              title="Move up"
              className="rounded-md border border-hairline text-ink w-7 h-7 text-xs hover:bg-paper disabled:opacity-30"
            >
              ↑
            </button>
            <button
              type="button"
              disabled={isLast || busy || reordering}
              onClick={() => handleMoveSection('down')}
              title="Move down"
              className="rounded-md border border-hairline text-ink w-7 h-7 text-xs hover:bg-paper disabled:opacity-30"
            >
              ↓
            </button>
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
          {items.map((item, index) => (
            <li key={item.linkId} className="p-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-ink truncate">{item.title}</p>
                  <p className="font-mono text-[10px] text-secondary">{TYPE_LABELS[item.type]}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {item.type === 'file' ? (
                    <a href={contentFileUrl(item)} download={item.file_name || true} className="text-xs text-moss font-medium">
                      Download
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
                    <>
                      <button
                        type="button"
                        disabled={index === 0 || busy || reordering}
                        onClick={() => handleMoveItem(item, 'up')}
                        title="Move up"
                        className="rounded-md border border-hairline text-ink w-6 h-6 text-xs hover:bg-paper disabled:opacity-30"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        disabled={index === items.length - 1 || busy || reordering}
                        onClick={() => handleMoveItem(item, 'down')}
                        title="Move down"
                        className="rounded-md border border-hairline text-ink w-6 h-6 text-xs hover:bg-paper disabled:opacity-30"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDetach(item)}
                        disabled={busy}
                        className="text-xs text-red-700 hover:underline disabled:opacity-60"
                      >
                        Detach
                      </button>
                    </>
                  )}
                </div>
              </div>
              {previewingId === item.id && item.type === 'video' && (
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
              {showUpload ? 'Cancel upload' : '+ Upload new content'}
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
                  onChange={(e) => setUploadType(e.target.value)}
                  className="rounded-md border border-hairline bg-card px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                >
                  <option value="video">Video</option>
                  <option value="file">File</option>
                  <option value="scorm">SCORM package (.zip)</option>
                  <option value="xapi">xAPI package (.zip)</option>
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
              <button
                type="button"
                onClick={handleUpload}
                disabled={uploading}
                className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
              >
                {uploading ? 'Uploading…' : 'Upload & add'}
              </button>
            </div>
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
