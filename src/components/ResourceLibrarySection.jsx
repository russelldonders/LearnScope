import { useEffect, useRef, useState } from 'react'
import {
  listOrganisationResources,
  uploadVideoResource,
  uploadFileResource,
  uploadScormResource,
  deleteResource,
  contentFileUrl,
} from '../lib/courseContent'
import ScormPlayer from './ScormPlayer'
import ConfirmDialog from './ConfirmDialog'

const TYPE_LABELS = { video: 'Video', file: 'File', scorm: 'SCORM package' }

// An organisation's whole content library -- upload once here, then attach
// (link) into however many courses need it from that course's own edit
// view (see courseContent.js's course_content_links functions). This is
// the "Manage resources" tab in the provider console.
export default function ResourceLibrarySection({ organisationId, userId }) {
  const [resources, setResources] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [previewingId, setPreviewingId] = useState(null)
  const [type, setType] = useState('video')
  const [title, setTitle] = useState('')
  const [uploading, setUploading] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [fileName, setFileName] = useState('')
  const [dragActive, setDragActive] = useState(false)
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
      else await uploadScormResource(organisationId, userId, file, title)
      setTitle('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      setFileName('')
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

  return (
    <div>
      <div className="mb-4">
        <h3 className="font-display text-lg text-ink mb-1">Resources</h3>
        <p className="text-sm text-secondary">
          Upload video, files, and SCORM packages here, then attach them to any of your training courses from that
          course's own edit view.
        </p>
      </div>

      {loading ? (
        <p className="text-secondary">Loading…</p>
      ) : resources.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-hairline rounded-lg mb-4">
          <p className="text-secondary">No resources uploaded yet.</p>
        </div>
      ) : (
        <ul className="divide-y divide-hairline border border-hairline rounded-md mb-4">
          {resources.map((resource) => (
            <li key={resource.id} className="p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-ink truncate">{resource.title}</p>
                  <p className="font-mono text-[10px] text-secondary">{TYPE_LABELS[resource.type]}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
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

      {error && <p className="text-sm text-red-700 mb-3">{error}</p>}

      <div className="bg-card border border-hairline rounded-lg p-4 flex flex-wrap items-end gap-2">
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
            accept={type === 'scorm' ? '.zip' : type === 'video' ? 'video/*' : undefined}
            onChange={(e) => setFileName(e.target.files?.[0]?.name || '')}
            className="sr-only"
          />
        </div>
        <button
          type="button"
          onClick={handleUpload}
          disabled={uploading}
          className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
        >
          {uploading ? 'Uploading…' : 'Add'}
        </button>
      </div>

      {pendingDelete && (
        <ConfirmDialog
          message={`Remove "${pendingDelete.title}"? This removes it from every course it's attached to, not just this list.`}
          confirmLabel="Remove"
          confirming={deleting}
          onConfirm={handleDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}
