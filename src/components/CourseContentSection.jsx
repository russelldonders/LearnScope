import { useEffect, useRef, useState } from 'react'
import {
  listCourseContentItems,
  uploadVideoContent,
  uploadFileContent,
  uploadScormContent,
  deleteContentItem,
  contentFileUrl,
} from '../lib/courseContent'
import ScormPlayer from './ScormPlayer'

const TYPE_LABELS = { video: 'Video', file: 'File', scorm: 'SCORM package' }

// Reused by the provider console (authoring, editable) and, later, anywhere
// content just needs to be listed read-only (moderation review, a learner
// view) via readOnly.
export default function CourseContentSection({ courseId, userId, readOnly = false }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [previewingId, setPreviewingId] = useState(null)
  const [type, setType] = useState('video')
  const [title, setTitle] = useState('')
  const [uploading, setUploading] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const fileInputRef = useRef(null)

  useEffect(() => {
    load()
  }, [courseId])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      setItems(await listCourseContentItems(courseId))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // A plain click handler, not a form submit -- this section is always
  // rendered inside CourseCard's own outer <form> (name/synopsis/etc.), and
  // nested <form> elements are invalid HTML.
  async function handleUpload() {
    const file = fileInputRef.current?.files[0]
    if (!file) {
      setError('Choose a file first.')
      return
    }
    setUploading(true)
    setError(null)
    try {
      if (type === 'video') await uploadVideoContent(courseId, userId, file, title)
      else if (type === 'file') await uploadFileContent(courseId, userId, file, title)
      else await uploadScormContent(courseId, userId, file, title)
      setTitle('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(item) {
    setDeletingId(item.id)
    setError(null)
    try {
      await deleteContentItem(item)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-3">
      <h4 className="font-mono text-[10px] uppercase tracking-wide text-secondary">Content</h4>

      {loading ? (
        <p className="text-xs text-secondary">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-secondary">No content added yet.</p>
      ) : (
        <ul className="divide-y divide-hairline border border-hairline rounded-md">
          {items.map((item) => (
            <li key={item.id} className="p-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-ink truncate">{item.title}</p>
                  <p className="font-mono text-[10px] text-secondary">{TYPE_LABELS[item.type]}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {item.type === 'file' ? (
                    // download (not target="_blank") -- this file was
                    // uploaded with no type restriction and served
                    // same-origin; opening it as a navigation instead of a
                    // forced download would let an .html upload render and
                    // execute with full access to this app's own origin.
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
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => handleDelete(item)}
                      disabled={deletingId === item.id}
                      className="text-xs text-red-700 hover:underline disabled:opacity-60"
                    >
                      {deletingId === item.id ? 'Removing…' : 'Remove'}
                    </button>
                  )}
                </div>
              </div>
              {previewingId === item.id && item.type === 'video' && (
                <video src={contentFileUrl(item)} controls className="w-full mt-2 rounded-md bg-ink" />
              )}
              {previewingId === item.id && item.type === 'scorm' && (
                <div className="mt-2">
                  <ScormPlayer contentItem={item} userId={userId} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-xs text-red-700">{error}</p>}

      {!readOnly && (
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-xs text-secondary mb-1" htmlFor={`contentType-${courseId}`}>
              Type
            </label>
            <select
              id={`contentType-${courseId}`}
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
            <label className="block text-xs text-secondary mb-1" htmlFor={`contentTitle-${courseId}`}>
              Title (optional)
            </label>
            <input
              id={`contentTitle-${courseId}`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-md border border-hairline bg-paper px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            />
          </div>
          <div>
            <label className="block text-xs text-secondary mb-1" htmlFor={`contentFile-${courseId}`}>
              File
            </label>
            <input
              id={`contentFile-${courseId}`}
              ref={fileInputRef}
              type="file"
              accept={type === 'scorm' ? '.zip' : type === 'video' ? 'video/*' : undefined}
              className="text-sm text-ink"
            />
          </div>
          <button
            type="button"
            onClick={handleUpload}
            disabled={uploading}
            className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
          >
            {uploading ? 'Uploading…' : 'Add'}
          </button>
        </div>
      )}
    </div>
  )
}
