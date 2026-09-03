import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  listOrganisationResources,
  uploadVideoResource,
  uploadScreenRecordingResource,
  uploadFileResource,
  uploadScormResource,
  uploadXapiResource,
  addExternalVideoResource,
  addWebResource,
  deleteResource,
  createResourceDraftVersion,
  listResourceVersions,
  publishResourceVersion,
  contentFileUrl,
} from '../lib/courseContent'
import ScormPlayer from './ScormPlayer'
import XapiPlayer from './XapiPlayer'
import ConfirmDialog from './ConfirmDialog'
import EditedVideoPlayer from './EditedVideoPlayer'
import VideoEditorModal from './VideoEditorModal'
import ScreenRecorderModal from './ScreenRecorderModal'
import PageBuilderModal from './PageBuilderModal'
import PageContent from './PageContent'
import { useRowSelection, useSortedPage } from '../lib/useSortedPage'
import { BulkActionBar, SelectionTh, SortableTh, TablePagination } from './TableControls'
import { RESOURCE_TYPE_LABELS } from '../lib/statusLabels'

const STATUS_LABELS = { draft: 'Draft', inactive: 'Previous version', published: 'Published' }

const RESOURCE_SORT_ACCESSORS = {
  code: (r) => r.resource_code?.toLowerCase() ?? '',
  title: (r) => r.title?.toLowerCase() ?? '',
  type: (r) => RESOURCE_TYPE_LABELS[r.type] ?? r.type ?? '',
  version: (r) => r.version_number ?? 1,
  status: (r) => STATUS_LABELS[r.status] ?? r.status ?? '',
  live: (r) => (r.is_current_published ? 1 : r.publishedVersionNumber ? 1 : 0),
}

// An organisation's whole content library -- upload once here, then attach
// (link) into however many courses need it from that course's own edit
// view (see courseContent.js's course_content_links functions). This is
// the "Manage resources" tab in the provider console.
export default function ResourceLibrarySection({ organisationId, userId, readOnly = false }) {
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
  const [pendingBulkDelete, setPendingBulkDelete] = useState(null)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  // Ids currently targeted by an in-flight bulk delete -- a row's own
  // single-row actions (Edit, Create new version, Remove) get disabled for
  // exactly these rows while true, on top of their usual own-action guards.
  // Edit in particular can insert a new higher-version row for the same
  // resource (createResourceDraftVersion) concurrently with a delete that
  // only removes the exact original row by id -- without this, that new
  // draft would silently resurface after the bulk delete "succeeds".
  const [bulkDeletingIds, setBulkDeletingIds] = useState(() => new Set())
  const [editingResourceId, setEditingResourceId] = useState(null)
  const [fileName, setFileName] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const [videoUrl, setVideoUrl] = useState('')
  const [editingResource, setEditingResource] = useState(null)
  const [showScreenRecorder, setShowScreenRecorder] = useState(false)
  const [historyForId, setHistoryForId] = useState(null)
  const [versionHistory, setVersionHistory] = useState([])
  const [editingPage, setEditingPage] = useState(null)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const fileInputRef = useRef(null)

  const filteredResources = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return resources.filter(
      (resource) =>
        (typeFilter === 'all' || resource.type === typeFilter) &&
        (!needle || [resource.title, resource.file_name].filter(Boolean).some((value) => value.toLowerCase().includes(needle)))
    )
  }, [resources, query, typeFilter])

  const { sortKey, sortDir, toggleSort, page, setPage, pageSize, setPageSize, pageItems, totalItems } =
    useSortedPage(filteredResources, RESOURCE_SORT_ACCESSORS)
  const selection = useRowSelection(filteredResources.map((r) => r.id))
  const resourcePageIds = pageItems.map((r) => r.id)
  const resourcesSelectedOnPage = resourcePageIds.filter((id) => selection.selected.has(id)).length

  useEffect(() => {
    load()
    // load is also reused after mutations; organisationId is the boundary.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
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
    if (type === 'external_video' || type === 'web_url') {
      if (!videoUrl.trim()) {
        setError(type === 'web_url' ? 'Enter a web address first.' : 'Paste a YouTube or Vimeo link first.')
        return
      }
      setUploading(true)
      setError(null)
      try {
        if (type === 'web_url') await addWebResource(organisationId, userId, videoUrl, title)
        else await addExternalVideoResource(organisationId, userId, videoUrl, title)
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
      setError(type === 'screen_recording' ? 'Record your screen first.' : 'Choose a file first.')
      return
    }
    setUploading(true)
    setError(null)
    try {
      if (type === 'video') await uploadVideoResource(organisationId, userId, file, title)
      else if (type === 'screen_recording') await uploadScreenRecordingResource(organisationId, userId, file, title)
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

  async function handleBulkDelete() {
    const targets = pendingBulkDelete
    setBulkDeleting(true)
    setBulkDeletingIds(new Set(targets.map((resource) => resource.id)))
    setError(null)
    try {
      const results = await Promise.allSettled(targets.map((resource) => deleteResource(resource)))
      const failures = results
        .map((result, index) => ({ result, resource: targets[index] }))
        .filter(({ result }) => result.status === 'rejected')
      const succeededIds = targets
        .filter((_, index) => results[index].status === 'fulfilled')
        .map((resource) => resource.id)
      setPendingBulkDelete(null)
      // Full success clears the whole selection; a partial failure keeps
      // the still-undeleted resources selected so they're easy to retry.
      if (failures.length > 0) selection.clearIds(succeededIds)
      else selection.clear()
      await load()
      if (failures.length > 0) {
        setError(
          `${failures.length} of ${targets.length} resources couldn't be removed: ` +
            failures
              .map(({ resource, result }) => `"${resource.title}" (${result.reason?.message ?? 'unknown error'})`)
              .join('; ')
        )
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBulkDeleting(false)
      setBulkDeletingIds(new Set())
    }
  }

  async function handleCreateVersion(resource) {
    setError(null)
    try {
      await createResourceDraftVersion(resource.id)
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  // Unified "Edit" for the types with an in-place editor (video/screen
  // recording, page) -- a published version can't be edited directly, so
  // instead of making a provider first hit a separate "Create new version"
  // button and then find and click a second "Edit" on the row that
  // appears, this does both in one step: create the draft version, reload
  // so the row reflects it, then open the editor on that fresh row. A
  // resource already in draft just opens straight away.
  async function handleEdit(resource) {
    // Guards against a fast double-click firing createResourceDraftVersion
    // twice for the same resource -- mirrors the actioningId-style guards
    // used everywhere else in these tables for an in-flight single-row
    // action.
    if (editingResourceId === resource.id) return
    setEditingResourceId(resource.id)
    setError(null)
    try {
      let target = resource
      if (resource.status !== 'draft') {
        const newId = await createResourceDraftVersion(resource.id)
        const refreshed = await listOrganisationResources(organisationId)
        setResources(refreshed)
        target = refreshed.find((r) => r.id === newId) ?? resource
      }
      if (resource.type === 'page') setEditingPage(target)
      else setEditingResource(target)
    } catch (err) {
      setError(err.message)
    } finally {
      setEditingResourceId(null)
    }
  }

  async function handlePublishVersion(resource) {
    setError(null)
    try {
      await publishResourceVersion(resource.id)
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleToggleHistory(resource) {
    if (historyForId === resource.id) {
      setHistoryForId(null)
      setVersionHistory([])
      return
    }
    setError(null)
    try {
      setVersionHistory(await listResourceVersions(resource.id))
      setHistoryForId(resource.id)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="font-display text-lg text-ink">Resources</h3>
        {!readOnly && (
          <button
            type="button"
            onClick={() => setShowUploadForm((v) => !v)}
            className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 shrink-0"
          >
            {showUploadForm ? 'Cancel' : '+ Add resource'}
          </button>
        )}
      </div>
      <p className="text-sm text-secondary mb-4">
        Add media, links, learning packages, or build polished content pages here, then attach them to any training course from that
        course's own edit view.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_220px] gap-2 mb-4" role="search">
        <label className="sr-only" htmlFor="providerResourceSearch">Search resources</label>
        <input id="providerResourceSearch" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search resources…" className="w-full rounded-md border border-hairline bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss" />
        <label className="sr-only" htmlFor="providerResourceType">Filter resources by type</label>
        <select id="providerResourceType" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-full rounded-md border border-hairline bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss">
          <option value="all">All resource types</option>
          {Object.entries(RESOURCE_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>

      {!readOnly && showUploadForm && (
        <div className="bg-card border border-hairline rounded-lg p-4 flex flex-wrap items-end gap-2 mb-4">
        <div>
          <label className="block text-xs text-secondary mb-1" htmlFor="resourceType">
            Type
          </label>
          <select
            id="resourceType"
            value={type}
            onChange={(e) => {
              setType(e.target.value)
              if (fileInputRef.current) fileInputRef.current.value = ''
              setFileName('')
              setVideoUrl('')
            }}
            className="rounded-md border border-hairline bg-paper px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
          >
            <option value="video">Video</option>
            <option value="screen_recording">Screen recording</option>
            <option value="file">File</option>
            <option value="scorm">SCORM package (.zip)</option>
            <option value="xapi">xAPI package (.zip)</option>
            <option value="external_video">External video (YouTube/Vimeo)</option>
            <option value="web_url">Web link</option>
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
            Opens the visual page builder. Add and reorder content after continuing.
          </div>
        ) : type === 'external_video' || type === 'web_url' ? (
          <div className="flex-1 min-w-[220px]">
            <label className="block text-xs text-secondary mb-1" htmlFor="resourceVideoUrl">
              {type === 'web_url' ? 'Web address' : 'YouTube or Vimeo link'}
            </label>
            <input
              id="resourceVideoUrl"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              placeholder={type === 'web_url' ? 'https://example.com/resource' : 'https://www.youtube.com/watch?v=...'}
              className="w-full rounded-md border border-hairline bg-paper px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            />
          </div>
        ) : type === 'screen_recording' ? (
          <div className="flex-1 min-w-[220px]">
            <span className="block text-xs text-secondary mb-1">Recording</span>
            <button
              type="button"
              onClick={() => setShowScreenRecorder(true)}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-moss text-moss px-3 py-2 text-sm font-medium hover:bg-moss/5"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <rect x="3" y="4" width="18" height="13" rx="2" />
                <path d="M8 21h8M12 17v4" />
              </svg>
              {fileName ? 'Record again' : 'Record screen'}
            </button>
            {fileName && <p className="text-xs text-secondary mt-1 truncate">Ready: {fileName}</p>}
            <input ref={fileInputRef} type="file" accept="video/*" className="sr-only" tabIndex={-1} />
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
        <div className="bg-card border border-hairline rounded-lg">
          {!readOnly && (
            <div className="p-3 pb-0">
              <BulkActionBar
                count={selection.selected.size}
                onClear={selection.clear}
                busy={bulkDeleting}
                actions={[
                  {
                    label: `Remove selected (${selection.selected.size})`,
                    variant: 'danger',
                    onClick: () => setPendingBulkDelete(resources.filter((r) => selection.selected.has(r.id))),
                  },
                ]}
              />
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-secondary">
                  {!readOnly && (
                    <SelectionTh
                      idPrefix="provider-resources"
                      checked={selection.isAllSelected(resourcePageIds)}
                      indeterminate={resourcesSelectedOnPage > 0 && resourcesSelectedOnPage < resourcePageIds.length}
                      onChange={() => selection.toggleAll(resourcePageIds)}
                    />
                  )}
                  <SortableTh label="ID" columnKey="code" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="whitespace-nowrap" />
                  <SortableTh label="Resource" columnKey="title" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Type" columnKey="type" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="whitespace-nowrap" />
                  <SortableTh label="Version" columnKey="version" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="whitespace-nowrap" />
                  <SortableTh label="Status" columnKey="status" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="whitespace-nowrap" />
                  <SortableTh label="Live for learners" columnKey="live" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="whitespace-nowrap" />
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((resource) => (
                  <ResourceRow
                    key={resource.id}
                    resource={resource}
                    userId={userId}
                    selected={selection.selected.has(resource.id)}
                    onToggleSelected={() => selection.toggle(resource.id)}
                    previewing={previewingId === resource.id}
                    onTogglePreview={() => setPreviewingId((id) => (id === resource.id ? null : resource.id))}
                    historyOpen={historyForId === resource.id}
                    versionHistory={versionHistory}
                    onToggleHistory={() => handleToggleHistory(resource)}
                    onEdit={() => handleEdit(resource)}
                    editing={editingResourceId === resource.id}
                    disabledByBulk={bulkDeletingIds.has(resource.id)}
                    onCreateVersion={() => handleCreateVersion(resource)}
                    onPublishVersion={() => handlePublishVersion(resource)}
                    onRemove={() => setPendingDelete(resource)}
                    readOnly={readOnly}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <TablePagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} totalItems={totalItems} idPrefix="provider-resources" />
        </div>
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

      {pendingBulkDelete && (
        <ConfirmDialog
          message={`Remove ${pendingBulkDelete.length} resources? This removes each one from every course it's attached to, not just this list.`}
          confirmLabel="Remove"
          confirming={bulkDeleting}
          onConfirm={handleBulkDelete}
          onCancel={() => setPendingBulkDelete(null)}
        />
      )}

      {editingResource && (
        <VideoEditorModal
          resource={editingResource}
          onClose={() => setEditingResource(null)}
          onSaved={(saved) => setResources((prev) => prev.map((r) => (r.id === saved.id ? saved : r)))}
        />
      )}

      {showScreenRecorder && (
        <ScreenRecorderModal
          onClose={() => setShowScreenRecorder(false)}
          onRecorded={(file) => {
            setSelectedFile(file)
            if (!title.trim()) setTitle('Screen recording')
          }}
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

// Preview and version history are two independent expansions (a row can
// show either, both, or neither), so each gets its own full-width row
// beneath the resource's own -- rather than cramming heterogeneous
// content (video/SCORM/xAPI/iframe/PageContent, or a version list) into a
// single expansion the way a simpler row-detail table might.
// Video/screen-recording/page are the types with an in-place editor
// (VideoEditorModal/PageBuilderModal); a single "Edit" button covers both
// "open the existing draft" and "start a new draft from the published
// version" (handleEdit above decides which). The other types (file, SCORM,
// xAPI, external video, web link) have no in-place editor, so those keep
// the plain "Create new version" action instead.
const EDITABLE_TYPES = new Set(['video', 'screen_recording', 'page'])

function ResourceRow({
  resource,
  userId,
  selected,
  onToggleSelected,
  previewing,
  onTogglePreview,
  historyOpen,
  versionHistory,
  onToggleHistory,
  onEdit,
  editing,
  disabledByBulk,
  onCreateVersion,
  onPublishVersion,
  onRemove,
  readOnly,
}) {
  const editable = EDITABLE_TYPES.has(resource.type)
  const columnCount = readOnly ? 7 : 8
  return (
    <Fragment>
      <tr className="border-b border-hairline last:border-0">
        {!readOnly && (
          <td className="px-4 py-3">
            <label className="sr-only" htmlFor={`select-resource-${resource.id}`}>Select {resource.title}</label>
            <input
              id={`select-resource-${resource.id}`}
              type="checkbox"
              checked={selected}
              onChange={onToggleSelected}
              className="rounded border-hairline accent-moss"
            />
          </td>
        )}
        <td className="px-4 py-3 font-mono text-xs text-secondary whitespace-nowrap">{resource.resource_code}</td>
        <td className="px-4 py-3 text-ink font-medium truncate max-w-[220px]">{resource.title}</td>
        <td className="px-4 py-3 text-secondary whitespace-nowrap">{RESOURCE_TYPE_LABELS[resource.type]}</td>
        <td className="px-4 py-3 whitespace-nowrap">
          <span className="font-mono text-[10px] uppercase tracking-wide text-secondary">{resource.version_number ?? 1}</span>
        </td>
        <td className="px-4 py-3 whitespace-nowrap">
          <span className="font-mono text-[10px] uppercase tracking-wide text-secondary">{STATUS_LABELS[resource.status] ?? resource.status}</span>
        </td>
        <td className="px-4 py-3 text-secondary whitespace-nowrap">
          {resource.is_current_published
            ? 'Yes'
            : resource.publishedVersionNumber
              ? `Yes (v${resource.publishedVersionNumber})`
              : '—'}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-x-4 justify-end whitespace-nowrap">
            {resource.type === 'file' ? (
              // download, not target="_blank" -- an unrestricted-type
              // upload served same-origin must never open as a
              // navigation (see ScormPlayer.jsx's sandbox comment for
              // the full reasoning).
              <a href={contentFileUrl(resource)} download={resource.file_name || true} className="text-xs text-moss font-medium whitespace-nowrap">
                Download
              </a>
            ) : resource.type === 'web_url' ? (
              <a href={resource.external_url} target="_blank" rel="noopener noreferrer" className="text-xs text-moss font-medium hover:underline underline-offset-2 whitespace-nowrap">
                Open link
              </a>
            ) : (
              <button type="button" onClick={onTogglePreview} className="text-xs text-moss font-medium whitespace-nowrap">
                {previewing ? 'Hide preview' : 'Preview'}
              </button>
            )}
            {!readOnly && editable && (
              <button
                type="button"
                onClick={onEdit}
                disabled={editing || disabledByBulk}
                title={disabledByBulk ? 'This resource is being removed' : undefined}
                className="text-xs text-moss font-medium whitespace-nowrap disabled:cursor-wait disabled:opacity-60"
              >
                {editing ? 'Opening…' : 'Edit'}
              </button>
            )}
            {!readOnly && !editable && resource.status === 'published' && resource.is_current_published && (
              <button
                type="button"
                onClick={onCreateVersion}
                disabled={disabledByBulk}
                title={disabledByBulk ? 'This resource is being removed' : undefined}
                className="text-xs text-moss font-medium hover:underline whitespace-nowrap disabled:cursor-wait disabled:opacity-60"
              >
                Create new version
              </button>
            )}
            {!readOnly && resource.status === 'draft' && (
              <button type="button" onClick={onPublishVersion} className="text-xs text-moss font-medium hover:underline whitespace-nowrap">
                Publish version
              </button>
            )}
            <button type="button" onClick={onToggleHistory} className="text-xs text-moss font-medium hover:underline whitespace-nowrap">
              {historyOpen ? 'Hide versions' : 'Version history'}
            </button>
            {!readOnly && (
              <button
                type="button"
                onClick={onRemove}
                disabled={disabledByBulk}
                title={disabledByBulk ? 'This resource is already being removed' : undefined}
                className="text-xs text-red-700 hover:underline whitespace-nowrap disabled:cursor-wait disabled:opacity-60"
              >
                Remove
              </button>
            )}
          </div>
        </td>
      </tr>
      {previewing && (
        <tr className="border-b border-hairline last:border-0">
          <td colSpan={columnCount} className="px-4 pb-3">
            {(resource.type === 'video' || resource.type === 'screen_recording') && (
              <EditedVideoPlayer resource={resource} className="w-full rounded-md bg-black" />
            )}
            {resource.type === 'scorm' && <ScormPlayer contentItem={resource} userId={userId} />}
            {resource.type === 'xapi' && <XapiPlayer contentItem={resource} userId={userId} />}
            {resource.type === 'external_video' && (
              <iframe
                src={resource.external_url}
                title={resource.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="w-full aspect-video rounded-md"
              />
            )}
            {resource.type === 'page' && (
              <div className="rounded-md border border-hairline bg-paper px-5 py-8 sm:px-8">
                <PageContent document={resource.page_content} compact />
              </div>
            )}
          </td>
        </tr>
      )}
      {historyOpen && (
        <tr className="border-b border-hairline last:border-0">
          <td colSpan={columnCount} className="px-4 pb-3">
            <p className="mb-2 text-xs font-medium text-ink">Version history</p>
            <ul className="space-y-1.5">
              {versionHistory.map((version) => (
                <li key={version.id} className="flex items-center justify-between gap-3 text-xs text-secondary">
                  <span>v{version.version_number}</span>
                  <span>{STATUS_LABELS[version.status] ?? version.status}</span>
                  <time dateTime={version.published_at || version.created_at}>{new Date(version.published_at || version.created_at).toLocaleDateString()}</time>
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </Fragment>
  )
}
