import { useEffect, useMemo, useRef, useState } from 'react'
import {
  listOrganisationResources,
  uploadVideoResource,
  uploadFileResource,
  uploadScormResource,
  uploadXapiResource,
  addExternalVideoResource,
  deleteResource,
  contentFileUrl,
} from '../lib/courseContent'
import ScormPlayer from './ScormPlayer'
import XapiPlayer from './XapiPlayer'
import ConfirmDialog from './ConfirmDialog'
import EditedVideoPlayer from './EditedVideoPlayer'
import VideoEditorModal from './VideoEditorModal'
import PageBuilderModal from './PageBuilderModal'
import PageContent from './PageContent'

const TYPE_LABELS = {
  video: 'Video',
  file: 'File',
  scorm: 'SCORM package',
  xapi: 'xAPI package',
  external_video: 'External video',
  page: 'Page',
}

// An organisation's whole content library -- upload once here, then attach
// (link) into however many courses need it from that course's own edit
// view (see courseContent.js's course_content_links functions). This is
// the "Manage resources" tab in the provider console.
export default function ResourceLibrarySection({ organisationId, userId }) {
  const [resources, setResources] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [previewingId, setPreviewingId] = useState(null)
  const [showUploadForm, setShowUploadForm] = useState(false)
  const [type, setType] = useState('video')
  const [title, setTitle] = useState('')
  const [uploading, setUploading] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [fileName, setFileName] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const [videoUrl, setVideoUrl] = useState('')
  const [editingResource, setEditingResource] = useState(null)
  const [editingPage, setEditingPage] = useState(null)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const fileInputRef = useRef(null)

  useEffect(() => {
    load()
  }, [organisationId])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      setResources(await listOrganisationResources(organisationId))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleUpload() {
    if (type === 'page') {
      setShowUploadForm(false)
      setEditingPage({ isNew: true, title })
      return
    }
    if (type === 'external_video') {
      if (!videoUrl.trim()) {
        setError('Paste a YouTube or Vimeo link first.')
        return
      }
      setUploading(true)
      setError(null)
      try {
        await addExternalVideoResource(organisationId, userId, videoUrl, title)
        setTitle('')
        setVideoUrl('')
        setShowUploadForm(false)
        await load()
      } catch (err) {
        setError(err.message)
      } finally {
        setUploading(false)
      }
      return
    }

    const file = fileInputRef.current?.files[0]
    if (!file) {
      setError('Choose a file first.')
      return
    }
    setUploading(true)
    setError(null)
    try {
      if (type === 'video') await uploadVideoResource(organisationId, userId, file, title)
      else if (type === 'file') await uploadFileResource(organisationId, userId, file, title)
      else if (type === 'scorm') await uploadScormResource(organisationId, userId, file, title)
      else await uploadXapiResource(organisationId, userId, file, title)
      setTitle('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      setFileName('')
      setShowUploadForm(false)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  function setSelectedFile(file) {
    if (!file || !fileInputRef.current) return
    const transfer = new DataTransfer()
    transfer.items.add(file)
    fileInputRef.current.files = transfer.files
    setFileName(file.name)
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragActive(false)
    setSelectedFile(e.dataTransfer.files?.[0])
  }

  async function handleDelete() {
    setDeleting(true)
    setError(null)
    try {
      await deleteResource(pendingDelete)
      setPendingDelete(null)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setDeleting(false)
    }
  }

  const filteredResources = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return resources.filter(
      (resource) =>
        (typeFilter === 'all' || resource.type === typeFilter) &&
        (!needle || [resource.title, resource.file_name].filter(Boolean).some((value) => value.toLowerCase().includes(needle)))
    )
  }, [resources, query, typeFilter])

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="font-display text-lg text-ink">Resources</h3>
        <button
          type="button"
          onClick={() => setShowUploadForm((v) => !v)}
          className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 shrink-0"
        >
          {showUploadForm ? 'Cancel' : '+ Add resource'}
        </button>
      </div>
      <p className="text-sm text-secondary mb-4">
        Upload media or build polished content pages here, then attach them to any of your training courses from that
        course's own edit view.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_220px] gap-2 mb-4" role="search">
        <label className="sr-only" htmlFor="providerResourceSearch">Search resources</label>
        <input id="providerResourceSearch" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search resources…" className="w-full rounded-md border border-hairline bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss" />
        <label className="sr-only" htmlFor="providerResourceType">Filter resources by type</label>
        <select id="providerResourceType" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-full rounded-md border border-hairline bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss">
          <option value="all">All resource types</option>
          {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>

      {showUploadForm && (
        <div className="bg-card border border-hairline rounded-lg p-4 flex flex-wrap items-end gap-2 mb-4">
        <div>
          <label className="block text-xs text-secondary mb-1" htmlFor="resourceType">
            Type
          </label>
          <select
            id="resourceType"
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="rounded-md border border-hairline bg-paper px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
          >
            <option value="video">Video</option>
            <option value="file">File</option>
            <option value="scorm">SCORM package (.zip)</option>
            <option value="xapi">xAPI package (.zip)</option>
            <option value="external_video">External video (YouTube/Vimeo)</option>
            <option value="page">Content page</option>
          </select>
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="block text-xs text-secondary mb-1" htmlFor="resourceTitle">
            Title (optional)
          </label>
          <input
            id="resourceTitle"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-md border border-hairline bg-paper px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
          />
        </div>
        {type === 'page' ? (
          <div className="flex-1 min-w-[220px] rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-secondary">
            Opens the visual page builder. You can add and reorder content after continuing.
          </div>
        ) : type === 'external_video' ? (
          <div className="flex-1 min-w-[220px]">
            <label className="block text-xs text-secondary mb-1" htmlFor="resourceVideoUrl">
              YouTube or Vimeo link
            </label>
            <input
              id="resourceVideoUrl"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              className="w-full rounded-md border border-hairline bg-paper px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            />
          </div>
        ) : (
        <div className="flex-1 min-w-[220px]">
          <label className="block text-xs text-secondary mb-1" htmlFor="resourceFile">
            File
          </label>
          <div
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                fileInputRef.current?.click()
              }
            }}
            onDragOver={(e) => {
              e.preventDefault()
              setDragActive(true)
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            className={`flex items-center gap-2 rounded-md border-2 border-dashed px-3 py-2 text-sm cursor-pointer transition-colors ${
              dragActive
                ? 'border-moss bg-moss/5 text-ink'
                : 'border-hairline text-secondary hover:border-moss/60 hover:text-ink'
            }`}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="shrink-0"
            >
              <path d="M12 16V4M12 4l-4 4M12 4l4 4" />
              <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
            </svg>
            <span className="truncate">{fileName || 'Click to upload or drag and drop'}</span>
          </div>
          <input
            id="resourceFile"
            ref={fileInputRef}
            type="file"
            accept={type === 'scorm' || type === 'xapi' ? '.zip' : type === 'video' ? 'video/*' : undefined}
            onChange={(e) => setFileName(e.target.files?.[0]?.name || '')}
            className="sr-only"
          />
        </div>
        )}
        <button
          type="button"
          onClick={handleUpload}
          disabled={uploading}
          className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
        >
          {uploading ? 'Adding…' : type === 'page' ? 'Open builder' : 'Add'}
        </button>
        </div>
      )}

      {error && <p className="text-sm text-red-700 mb-3">{error}</p>}

      {loading ? (
        <p className="text-secondary">Loading…</p>
      ) : resources.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-hairline rounded-lg">
          <p className="text-secondary">No resources uploaded yet.</p>
        </div>
      ) : filteredResources.length === 0 ? (
        <div className="text-center py-10 border border-dashed border-hairline rounded-lg">
          <p className="text-secondary">No resources match these filters.</p>
        </div>
      ) : (
        <ul className="divide-y divide-hairline border border-hairline rounded-md">
          {filteredResources.map((resource) => (
            <li key={resource.id} className="p-3 text-sm">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-ink font-medium break-words">{resource.title}</p>
                  <p className="font-mono text-[10px] text-secondary">{TYPE_LABELS[resource.type]}</p>
                </div>
                <div className="flex items-center gap-x-4 gap-y-2 flex-wrap sm:justify-end shrink-0 border-t border-hairline pt-2 sm:border-0 sm:pt-0">
                  {resource.type === 'file' ? (
                    // download, not target="_blank" -- an unrestricted-type
                    // upload served same-origin must never open as a
                    // navigation (see ScormPlayer.jsx's sandbox comment for
                    // the full reasoning).
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
                  {resource.type === 'video' && (
                    <button
                      type="button"
                      onClick={() => setEditingResource(resource)}
                      className="text-xs text-moss font-medium"
                    >
                      Edit
                    </button>
                  )}
                  {resource.type === 'page' && (
                    <button
                      type="button"
                      onClick={() => setEditingPage(resource)}
                      className="text-xs text-moss font-medium"
                    >
                      Edit page
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setPendingDelete(resource)}
                    className="text-xs text-red-700 hover:underline"
                  >
                    Remove
                  </button>
                </div>
              </div>
              {previewingId === resource.id && resource.type === 'video' && (
                <EditedVideoPlayer resource={resource} className="w-full mt-2 rounded-md bg-black" />
              )}
              {previewingId === resource.id && resource.type === 'scorm' && (
                <div className="mt-2">
                  <ScormPlayer contentItem={resource} userId={userId} />
                </div>
              )}
              {previewingId === resource.id && resource.type === 'xapi' && (
                <div className="mt-2">
                  <XapiPlayer contentItem={resource} userId={userId} />
                </div>
              )}
              {previewingId === resource.id && resource.type === 'external_video' && (
                <iframe
                  src={resource.external_url}
                  title={resource.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  className="w-full aspect-video mt-2 rounded-md"
                />
              )}
              {previewingId === resource.id && resource.type === 'page' && (
                <div className="mt-3 rounded-md border border-hairline bg-paper px-5 py-8 sm:px-8">
                  <PageContent document={resource.page_content} compact />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {pendingDelete && (
        <ConfirmDialog
          message={`Remove "${pendingDelete.title}"? This removes it from every course it's attached to, not just this list.`}
          confirmLabel="Remove"
          confirming={deleting}
          onConfirm={handleDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {editingResource && (
        <VideoEditorModal
          resource={editingResource}
          onClose={() => setEditingResource(null)}
          onSaved={(saved) => setResources((prev) => prev.map((r) => (r.id === saved.id ? saved : r)))}
        />
      )}

      {editingPage && (
        <PageBuilderModal
          organisationId={organisationId}
          userId={userId}
          resource={editingPage.isNew ? null : editingPage}
          initialTitle={editingPage.isNew ? editingPage.title : undefined}
          onClose={() => setEditingPage(null)}
          onSaved={(saved) => {
            setResources((current) => {
              const exists = current.some((resource) => resource.id === saved.id)
              return exists ? current.map((resource) => (resource.id === saved.id ? saved : resource)) : [saved, ...current]
            })
          }}
        />
      )}
    </div>
  )
}
