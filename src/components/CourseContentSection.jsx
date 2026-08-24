import { useEffect, useState } from 'react'
import {
  listCourseResources,
  listOrganisationResources,
  linkResourceToCourse,
  unlinkResourceFromCourse,
  contentFileUrl,
} from '../lib/courseContent'
import ScormPlayer from './ScormPlayer'

const TYPE_LABELS = { video: 'Video', file: 'File', scorm: 'SCORM package' }

// Attaches resources from the organisation's library (see
// ResourceLibrarySection, the "Resources" tab) onto one specific course --
// upload happens once at the org level, this just links/unlinks existing
// resources, it never uploads anything itself.
export default function CourseContentSection({ courseId, organisationId, userId, readOnly = false }) {
  const [linked, setLinked] = useState([])
  const [available, setAvailable] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [previewingId, setPreviewingId] = useState(null)
  const [selectedResourceId, setSelectedResourceId] = useState('')
  const [attaching, setAttaching] = useState(false)
  const [detachingLinkId, setDetachingLinkId] = useState(null)

  useEffect(() => {
    load()
  }, [courseId, organisationId])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [linkedResources, orgResources] = await Promise.all([
        listCourseResources(courseId),
        listOrganisationResources(organisationId),
      ])
      setLinked(linkedResources)
      setAvailable(orgResources)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const linkedIds = new Set(linked.map((r) => r.id))
  const attachable = available.filter((r) => !linkedIds.has(r.id))

  async function handleAttach() {
    if (!selectedResourceId) return
    setAttaching(true)
    setError(null)
    try {
      await linkResourceToCourse(courseId, selectedResourceId)
      setSelectedResourceId('')
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setAttaching(false)
    }
  }

  async function handleDetach(resource) {
    setDetachingLinkId(resource.linkId)
    setError(null)
    try {
      await unlinkResourceFromCourse(resource.linkId)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setDetachingLinkId(null)
    }
  }

  return (
    <div className="space-y-3">
      <h4 className="font-mono text-[10px] uppercase tracking-wide text-secondary">Content</h4>

      {loading ? (
        <p className="text-xs text-secondary">Loading…</p>
      ) : linked.length === 0 ? (
        <p className="text-xs text-secondary">No content attached yet.</p>
      ) : (
        <ul className="divide-y divide-hairline border border-hairline rounded-md">
          {linked.map((resource) => (
            <li key={resource.linkId} className="p-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-ink truncate">{resource.title}</p>
                  <p className="font-mono text-[10px] text-secondary">{TYPE_LABELS[resource.type]}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {resource.type === 'file' ? (
                    <a
                      href={contentFileUrl(resource)}
                      download={resource.file_name || true}
                      className="text-xs text-moss font-medium"
                    >
                      Download
                    </a>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPreviewingId((id) => (id === resource.id ? null : resource.id))}
                      className="text-xs text-moss font-medium"
                    >
                      {previewingId === resource.id ? 'Hide preview' : 'Preview'}
                    </button>
                  )}
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => handleDetach(resource)}
                      disabled={detachingLinkId === resource.linkId}
                      className="text-xs text-red-700 hover:underline disabled:opacity-60"
                    >
                      {detachingLinkId === resource.linkId ? 'Removing…' : 'Detach'}
                    </button>
                  )}
                </div>
              </div>
              {previewingId === resource.id && resource.type === 'video' && (
                <video src={contentFileUrl(resource)} controls className="w-full mt-2 rounded-md bg-ink" />
              )}
              {previewingId === resource.id && resource.type === 'scorm' && (
                <div className="mt-2">
                  <ScormPlayer contentItem={resource} userId={userId} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-xs text-red-700">{error}</p>}

      {!readOnly && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-secondary mb-1" htmlFor={`attachResource-${courseId}`}>
              Attach from your resource library
            </label>
            <select
              id={`attachResource-${courseId}`}
              value={selectedResourceId}
              onChange={(e) => setSelectedResourceId(e.target.value)}
              disabled={attachable.length === 0}
              className="w-full rounded-md border border-hairline bg-paper px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss disabled:opacity-60"
            >
              <option value="">
                {attachable.length === 0 ? 'Nothing left to attach' : 'Choose a resource…'}
              </option>
              {attachable.map((resource) => (
                <option key={resource.id} value={resource.id}>
                  {resource.title} ({TYPE_LABELS[resource.type]})
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={handleAttach}
            disabled={attaching || !selectedResourceId}
            className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
          >
            {attaching ? 'Attaching…' : 'Attach'}
          </button>
        </div>
      )}
    </div>
  )
}
