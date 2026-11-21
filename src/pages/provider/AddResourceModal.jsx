import { useEffect, useRef, useState } from 'react'
import AccessibleDialog from '../../components/AccessibleDialog'
import ScreenRecorderModal from '../../components/ScreenRecorderModal'
import PageBuilderModal from '../../components/PageBuilderModal'
import { linkResourceToCourse, uploadVideoResource, uploadScreenRecordingResource, uploadFileResource, uploadScormResource, uploadXapiResource, uploadCmi5Resource, addWebResource, addExternalVideoResource, listLtiTools, createLtiResource } from '../../lib/courseContent'
import { RESOURCE_TYPE_LABELS } from '../../lib/statusLabels'

// Attach-existing / upload-new / build-a-page, moved from the now-removed
// right-hand detail panel into a popup scoped to whichever section's "+"
// button opened it. Opens on a plain choice of the three ways to add
// content -- rather than landing straight in the existing-resource picker
// -- so the initial focus goes to that choice instead of pre-selecting a
// dropdown option most people arrived here to skip past. Each choice's own
// AccessibleDialog-mounted sub-view reuses the same dialog instance (this
// component always returns exactly one <AccessibleDialog>, just with
// different children), so switching modes doesn't retrigger the
// mount-time initial-focus behaviour.
export function AddResourceModal({ section, courseId, organisationId, userId, availableResources, onChanged, onClose }) {
  const [mode, setMode] = useState(null) // null (choice) | 'existing' | 'new'
  const [selectedResourceId, setSelectedResourceId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [uploadType, setUploadType] = useState('video')
  const [uploadTitle, setUploadTitle] = useState('')
  const [uploading, setUploading] = useState(false)
  const [showScreenRecorder, setShowScreenRecorder] = useState(false)
  const [recordedFileName, setRecordedFileName] = useState('')
  const [webUrl, setWebUrl] = useState('')
  const [selectedFileName, setSelectedFileName] = useState('')
  const [dragging, setDragging] = useState(false)
  const dragCounterRef = useRef(0)
  const fileInputRef = useRef(null)
  const cameraInputRef = useRef(null)
  const [ltiTools, setLtiTools] = useState([])
  const [selectedLtiToolId, setSelectedLtiToolId] = useState('')

  useEffect(() => {
    listLtiTools(organisationId).then(setLtiTools).catch(() => {})
  }, [organisationId])

  function setRecordedFile(file) {
    if (!fileInputRef.current) return
    const transfer = new DataTransfer()
    transfer.items.add(file)
    fileInputRef.current.files = transfer.files
    setRecordedFileName(file.name)
    if (!uploadTitle.trim()) setUploadTitle('Screen recording')
  }

  // Shared by drag-drop and "Take video" -- both hand this a File that isn't
  // (and for a camera capture, can't be) the file input's own native
  // selection, so it's copied onto fileInputRef the same way setRecordedFile
  // already does, keeping handleUpload's single `fileInputRef.current.
  // files[0]` read path unchanged regardless of how the file was chosen.
  function setChosenFile(file) {
    if (!fileInputRef.current) return
    const transfer = new DataTransfer()
    transfer.items.add(file)
    fileInputRef.current.files = transfer.files
    setSelectedFileName(file.name)
  }

  function handleFileInputChange(e) {
    const file = e.target.files?.[0]
    if (file) setSelectedFileName(file.name)
  }

  function handleDragEnter(e) {
    e.preventDefault()
    dragCounterRef.current += 1
    setDragging(true)
  }

  function handleDragLeave(e) {
    e.preventDefault()
    dragCounterRef.current -= 1
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0
      setDragging(false)
    }
  }

  function handleDragOver(e) {
    e.preventDefault()
  }

  function handleFileDrop(e) {
    e.preventDefault()
    dragCounterRef.current = 0
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) setChosenFile(file)
  }

  async function handleAttach() {
    if (!selectedResourceId) return
    setBusy(true)
    setError(null)
    try {
      await linkResourceToCourse(courseId, selectedResourceId, section.id)
      await onChanged()
      onClose()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  async function handleUpload() {
    if (uploadType === 'lti') {
      if (!selectedLtiToolId) {
        setError('Choose an LTI tool first.')
        return
      }
      setUploading(true)
      setError(null)
      try {
        const resource = await createLtiResource(organisationId, userId, { title: uploadTitle, ltiToolId: selectedLtiToolId })
        await linkResourceToCourse(courseId, resource.id, section.id)
        await onChanged()
        onClose()
      } catch (err) {
        setError(err.message)
        setUploading(false)
      }
      return
    }

    if (uploadType === 'web_url' || uploadType === 'external_video') {
      if (!webUrl.trim()) {
        setError(uploadType === 'web_url' ? 'Enter a web address first.' : 'Paste a YouTube or Vimeo link first.')
        return
      }
      setUploading(true)
      setError(null)
      try {
        const resource =
          uploadType === 'web_url'
            ? await addWebResource(organisationId, userId, webUrl, uploadTitle)
            : await addExternalVideoResource(organisationId, userId, webUrl, uploadTitle)
        await linkResourceToCourse(courseId, resource.id, section.id)
        await onChanged()
        onClose()
      } catch (err) {
        setError(err.message)
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
              : uploadType === 'xapi'
                ? await uploadXapiResource(organisationId, userId, file, uploadTitle)
                : await uploadCmi5Resource(organisationId, userId, file, uploadTitle)
      await linkResourceToCourse(courseId, resource.id, section.id)
      await onChanged()
      onClose()
    } catch (err) {
      setError(err.message)
      setUploading(false)
    }
  }

  // The page builder is its own full-screen editor (mirrors
  // ResourceLibrarySection's usage) rather than a field inside this dialog
  // -- createPageResource already records the caller as created_by, same
  // as every other resource-creation path here, so whoever builds the page
  // is its owner. Its own "Close"/save flow calls onClose itself, which
  // unmounts this whole modal too since PageBuilderModal is this
  // component's entire return value while in this mode.
  if (mode === 'page') {
    return (
      <PageBuilderModal
        organisationId={organisationId}
        userId={userId}
        onClose={onClose}
        onSaved={async (saved) => {
          try {
            await linkResourceToCourse(courseId, saved.id, section.id)
          } finally {
            await onChanged()
          }
        }}
      />
    )
  }

  return (
    <AccessibleDialog
      labelledBy="add-resource-dialog-title"
      onClose={onClose}
      panelClassName="w-full max-w-lg bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
      <h2 id="add-resource-dialog-title" className="font-display text-xl text-ink mb-1">
        Add content to {section.title}
      </h2>

      {mode === null && (
        <>
          <p className="text-sm text-secondary mb-4">Choose how you'd like to add content to this section.</p>
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setMode('existing')}
              className="w-full flex items-center justify-between gap-3 rounded-md border border-hairline px-4 py-3 text-left hover:border-moss hover:bg-paper"
            >
              <span>
                <span className="block text-sm font-medium text-ink">Select existing resource</span>
                <span className="block text-xs text-secondary mt-0.5">Reuse something already in your library.</span>
              </span>
              <span aria-hidden="true" className="text-secondary">›</span>
            </button>
            <button
              type="button"
              onClick={() => setMode('new')}
              className="w-full flex items-center justify-between gap-3 rounded-md border border-hairline px-4 py-3 text-left hover:border-moss hover:bg-paper"
            >
              <span>
                <span className="block text-sm font-medium text-ink">Create new resource</span>
                <span className="block text-xs text-secondary mt-0.5">Upload a file, video, package or link.</span>
              </span>
              <span aria-hidden="true" className="text-secondary">›</span>
            </button>
            <button
              type="button"
              onClick={() => setMode('page')}
              className="w-full flex items-center justify-between gap-3 rounded-md border border-hairline px-4 py-3 text-left hover:border-moss hover:bg-paper"
            >
              <span>
                <span className="block text-sm font-medium text-ink">Create content page</span>
                <span className="block text-xs text-secondary mt-0.5">Build a page with text, images and video.</span>
              </span>
              <span aria-hidden="true" className="text-secondary">›</span>
            </button>
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <button type="button" onClick={onClose} className="rounded-md border border-hairline px-3 py-1.5 text-sm text-ink hover:bg-paper">
              Cancel
            </button>
          </div>
        </>
      )}

      {mode === 'existing' && (
        <>
          <button type="button" onClick={() => setMode(null)} className="text-xs text-secondary hover:text-ink mb-4">
            ‹ Back
          </button>
          <p className="text-sm text-secondary mb-4">Attach something already in your organisation's library.</p>

          {error && <p className="text-sm text-red-700 mb-3">{error}</p>}

          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs text-secondary mb-1" htmlFor={`attachResource-${section.id}`}>
                Resource
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
                    {resource.title} ({RESOURCE_TYPE_LABELS[resource.type]})
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={handleAttach}
              disabled={busy || !selectedResourceId}
              className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
            >
              {busy ? 'Adding…' : 'Add'}
            </button>
          </div>

          <div className="flex justify-end gap-2 mt-5">
            <button type="button" onClick={onClose} disabled={busy} className="rounded-md border border-hairline px-3 py-1.5 text-sm text-ink hover:bg-paper disabled:opacity-50">
              Cancel
            </button>
          </div>
        </>
      )}

      {mode === 'new' && (
        <>
          <button type="button" onClick={() => setMode(null)} className="text-xs text-secondary hover:text-ink mb-4">
            ‹ Back
          </button>

          {error && <p className="text-sm text-red-700 mb-3">{error}</p>}

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
                  setSelectedFileName('')
                  setWebUrl('')
                }}
                className="rounded-md border border-hairline bg-card px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              >
                <option value="video">Video</option>
                <option value="screen_recording">Screen recording</option>
                <option value="file">File</option>
                <option value="scorm">SCORM package (.zip)</option>
                <option value="xapi">xAPI package (.zip)</option>
                <option value="cmi5">cmi5 package (.zip)</option>
                <option value="external_video">External video (YouTube/Vimeo)</option>
                <option value="web_url">Web link</option>
                <option value="lti">LTI tool</option>
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
            {uploadType === 'lti' ? (
              <div className="flex-1 min-w-[200px]">
                <label className="block text-xs text-secondary mb-1" htmlFor={`ltiTool-${section.id}`}>
                  Tool
                </label>
                <select
                  id={`ltiTool-${section.id}`}
                  value={selectedLtiToolId}
                  onChange={(e) => setSelectedLtiToolId(e.target.value)}
                  disabled={ltiTools.length === 0}
                  className="w-full rounded-md border border-hairline bg-card px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss disabled:opacity-60"
                >
                  <option value="">{ltiTools.length === 0 ? 'No LTI tools set up yet' : 'Choose a tool…'}</option>
                  {ltiTools.map((tool) => (
                    <option key={tool.id} value={tool.id}>{tool.name}</option>
                  ))}
                </select>
              </div>
            ) : uploadType === 'web_url' || uploadType === 'external_video' ? (
              <div className="flex-1 min-w-[220px]">
                <label className="block text-xs text-secondary mb-1" htmlFor={`webUrl-${section.id}`}>
                  {uploadType === 'web_url' ? 'Web address' : 'Video link'}
                </label>
                <input
                  id={`webUrl-${section.id}`}
                  type="url"
                  value={webUrl}
                  onChange={(e) => setWebUrl(e.target.value)}
                  placeholder={uploadType === 'web_url' ? 'https://example.com/resource' : 'https://www.youtube.com/watch?v=…'}
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
              <div className="min-w-[220px]">
                <span className="block text-xs text-secondary mb-1">File</span>
                <div
                  onDragEnter={handleDragEnter}
                  onDragLeave={handleDragLeave}
                  onDragOver={handleDragOver}
                  onDrop={handleFileDrop}
                  className={`flex flex-col items-center justify-center gap-1.5 rounded-md border-2 border-dashed px-3 py-4 text-center transition-colors ${
                    dragging ? 'border-moss bg-moss/10' : 'border-hairline'
                  }`}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-secondary">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  <p className="text-xs text-secondary">
                    Drag and drop {uploadType === 'video' ? 'a video' : 'a file'} here, or
                  </p>
                  <div className="flex items-center gap-2 flex-wrap justify-center">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper"
                    >
                      Browse files
                    </button>
                    {uploadType === 'video' && (
                      <button
                        type="button"
                        onClick={() => cameraInputRef.current?.click()}
                        className="inline-flex items-center gap-1.5 rounded-md border border-moss text-moss px-3 py-1.5 text-sm font-medium hover:bg-moss/5"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M23 7l-7 5 7 5V7z" />
                          <rect x="1" y="5" width="15" height="14" rx="2" />
                        </svg>
                        Take video
                      </button>
                    )}
                  </div>
                  {selectedFileName && (
                    <p className="text-xs text-secondary mt-1 max-w-[260px] truncate">Selected: {selectedFileName}</p>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={
                    uploadType === 'scorm' || uploadType === 'xapi' || uploadType === 'cmi5'
                      ? '.zip'
                      : uploadType === 'video'
                        ? 'video/*'
                        : undefined
                  }
                  onChange={handleFileInputChange}
                  className="hidden"
                />
                {uploadType === 'video' && (
                  <input
                    ref={cameraInputRef}
                    type="file"
                    accept="video/*"
                    capture="environment"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) setChosenFile(file)
                    }}
                    className="hidden"
                  />
                )}
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
                  : uploadType === 'web_url' || uploadType === 'external_video'
                    ? 'Add link'
                    : uploadType === 'lti'
                      ? 'Add tool'
                      : 'Upload & add'}
            </button>
          </div>

          {showScreenRecorder && (
            <ScreenRecorderModal onClose={() => setShowScreenRecorder(false)} onRecorded={setRecordedFile} />
          )}

          <div className="flex justify-end gap-2 mt-5">
            <button type="button" onClick={onClose} disabled={uploading} className="rounded-md border border-hairline px-3 py-1.5 text-sm text-ink hover:bg-paper disabled:opacity-50">
              Cancel
            </button>
          </div>
        </>
      )}
    </AccessibleDialog>
  )
}
