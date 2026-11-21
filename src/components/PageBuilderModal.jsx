import { useEffect, useMemo, useRef, useState } from 'react'
import { contentFileUrl, createPageResource, listOrganisationResources, removePageMediaAsset, updatePageResource, uploadPageMediaAsset } from '../lib/courseContent'
import {
  CALLOUT_VARIANTS,
  EMPTY_PAGE_DOCUMENT,
  GOAL_PANEL_SHOW,
  INTERACTIVE_BLOCKS,
  MEDIA_SIZES,
  PANEL_BLOCKS,
  PANEL_LIMITS,
  TEXT_ALIGNMENTS,
  newInteractiveBlock,
  newPanelBlock,
  normalisePageDocument,
  pageDocumentWordCount,
  pageHasScoredTest,
  sanitiseRichText,
} from '../lib/pageBuilder'
import PageContent, { PageMedia } from './PageContent'
import { SampleGoalsPanel, SampleSkillsPanel } from './WorkspacePanels'
import PageInteractiveEditor from './PageInteractiveEditor'
import AccessibleDialog from './AccessibleDialog'
import ConfirmDialog from './ConfirmDialog'
import { DragHandle } from './DragHandle'
import { sideOf, findDropTarget } from '../lib/dragReorder'

const BLOCK_LABELS = {
  heading: 'Heading',
  text: 'Text',
  image: 'Image',
  video: 'Video',
  callout: 'Callout',
  quote: 'Quote',
  columns: 'Two columns',
  divider: 'Divider',
  ...Object.fromEntries(Object.entries(INTERACTIVE_BLOCKS).map(([type, spec]) => [type, spec.label])),
  ...Object.fromEntries(Object.entries(PANEL_BLOCKS).map(([type, spec]) => [type, `${spec.label} panel`])),
}

const SAMPLE_PANELS = { goals_panel: SampleGoalsPanel, skills_panel: SampleSkillsPanel }

const BLOCK_PLACEHOLDERS = {
  heading: 'Write a heading…',
  text: 'Start typing…',
  callout: 'Add an important note…',
  quote: 'Add a quotation…',
}

const ALIGN_LABELS = { left: 'Left', center: 'Center', right: 'Right' }

function newBlock(type) {
  if (INTERACTIVE_BLOCKS[type]) return newInteractiveBlock(type)
  if (PANEL_BLOCKS[type]) return newPanelBlock(type)
  if (type === 'divider') return { id: crypto.randomUUID(), type }
  if (type === 'columns') return { id: crypto.randomUUID(), type, content: 'First column', secondaryContent: 'Second column', align: 'left' }
  if (type === 'image' || type === 'video') return { id: crypto.randomUUID(), type, url: '', alt: '', caption: '', size: 'full' }
  if (type === 'callout') return { id: crypto.randomUUID(), type, content: 'Add an important note…', align: 'left', variant: 'info' }
  if (type === 'quote') return { id: crypto.randomUUID(), type, content: 'Add a quotation…', align: 'left' }
  return {
    id: crypto.randomUUID(), type, ...(type === 'heading' ? { level: 1 } : {}), align: 'left',
    content: type === 'heading' ? 'New section' : 'Write something…',
  }
}

// Reusable pill-button group for a block's own settings (heading level,
// alignment, callout style, media size) -- kept as one small generic
// component rather than four near-identical ones. Always shown inside
// BlockSettingsMenu's popover now, so the group label is rendered visibly
// (not just as an aria-label) -- with several of these stacked in one
// popover, an icon-only reader would have no way to tell them apart.
function OptionPicker({ label, options, value, onChange, formatOption = (option) => option }) {
  return (
    <div role="group" aria-label={label}>
      <p className="text-[10px] uppercase tracking-wide text-secondary mb-1">{label}</p>
      <div className="page-block-options">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={value === option ? 'is-selected' : ''}
            aria-pressed={value === option}
          >
            {formatOption(option)}
          </button>
        ))}
      </div>
    </div>
  )
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

// Tucks a block's own settings (heading level, alignment, callout style,
// and every media property/action) behind a gear button. Media blocks show
// only their rendered image/video and caption on the canvas once a source
// exists, keeping the editing surface faithful to the learner-facing page.
// Same outside-click/Escape-to-close popover pattern as TableControls.jsx's
// ColumnCustomizer.
export function BlockSettingsMenu({ block, onChange, onChangeWithHistory, onUpload, uploading, libraryResources, onPickFromLibrary }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function handleOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) setOpen(false)
    }
    function handleEscape(event) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  const isMedia = block.type === 'image' || block.type === 'video'
  const isAlignable = ['heading', 'text', 'callout', 'quote'].includes(block.type)
  const hasSettings = block.type === 'heading' || block.type === 'callout' || isAlignable || (isMedia && block.url)
  if (!hasSettings) return null

  return (
    <div className="relative" ref={containerRef}>
      <button type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open} aria-label={`${BLOCK_LABELS[block.type]} settings`} title="Settings">
        <SettingsIcon />
      </button>
      {open && (
        <div className={`page-block-settings-popover ${isMedia ? 'page-block-settings-popover--media' : ''}`}>
          {block.type === 'heading' && (
            <OptionPicker label="Heading level" options={[1, 2, 3]} value={block.level}
              onChange={(level) => onChangeWithHistory({ level })} formatOption={(level) => `H${level}`} />
          )}
          {block.type === 'callout' && (
            <OptionPicker label="Callout style" options={CALLOUT_VARIANTS} value={block.variant}
              onChange={(variant) => onChangeWithHistory({ variant })}
              formatOption={(variant) => variant[0].toUpperCase() + variant.slice(1)} />
          )}
          {isAlignable && (
            <OptionPicker label="Text alignment" options={TEXT_ALIGNMENTS} value={block.align}
              onChange={(align) => onChangeWithHistory({ align })} formatOption={(align) => ALIGN_LABELS[align]} />
          )}
          {isMedia && block.url && (
            <>
              <OptionPicker label={`${block.type === 'image' ? 'Image' : 'Video'} size`} options={MEDIA_SIZES} value={block.size}
                onChange={(size) => onChangeWithHistory({ size })} formatOption={(size) => size[0].toUpperCase() + size.slice(1)} />
              <MediaSettingsFields block={block} onChange={onChange} />
              <MediaSourceControls
                block={block}
                onChange={onChange}
                onUpload={onUpload}
                uploading={uploading}
                libraryResources={libraryResources}
                onPickFromLibrary={onPickFromLibrary}
                compact
              />
            </>
          )}
        </div>
      )}
    </div>
  )
}

function isManagedMedia(block) {
  return Boolean(block.storagePath || block.url?.startsWith('/course-content/'))
}

function MediaSettingsFields({ block, onChange }) {
  return (
    <div className="page-media-settings-fields">
      <label>
        <span>{block.type === 'image' ? 'Alternative text' : 'Accessible title'}</span>
        <input
          value={block.alt}
          onChange={(event) => onChange({ alt: event.target.value })}
          placeholder={block.type === 'image' ? 'Describe the image' : 'Describe the video'}
        />
      </label>
      <label>
        <span>Caption (optional)</span>
        <input
          value={block.caption}
          onChange={(event) => onChange({ caption: event.target.value })}
          placeholder="Add context for learners"
        />
      </label>
    </div>
  )
}

// Video/screen-recording resources already in the org's library -- images
// have no equivalent library concept (content_resources' own type list is
// video/screen_recording/file/scorm/xapi/external_video/web_url, nothing
// image-shaped), so "Choose from library" only ever appears for a video
// block. Picking one points the block straight at that resource's own
// storage path (see normaliseMediaUrl in lib/pageBuilder.js) rather than
// copying the file -- it's never added to this editor's own session-
// upload tracking, so removing or replacing this block later never
// deletes a file the library resource itself still needs.
function LibraryVideoPicker({ resources, onPick, compact = false }) {
  const [selectedId, setSelectedId] = useState('')
  if (resources.length === 0) return null
  return (
    <>
      <div className={compact ? 'page-media-settings-separator' : 'page-media-separator'}><span>or choose from your library</span></div>
      <div className={compact ? 'page-media-settings-source' : 'page-media-upload'}>
        <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
          <option value="">Choose a video or screen recording…</option>
          {resources.map((resource) => (
            <option key={resource.id} value={resource.id}>{resource.title}</option>
          ))}
        </select>
        <button
          type="button"
          disabled={!selectedId}
          onClick={() => {
            const resource = resources.find((item) => item.id === selectedId)
            if (resource) onPick(resource)
            setSelectedId('')
          }}
        >
          Use this
        </button>
      </div>
    </>
  )
}

function MediaSourceControls({ block, onChange, onUpload, uploading, libraryResources, onPickFromLibrary, compact = false }) {
  const inputRef = useRef(null)
  const managed = isManagedMedia(block)
  return (
    <div>
      {compact && (
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wide text-secondary">Source</p>
          {managed && <p className="mb-2 text-xs text-secondary">Uploaded file · path managed by LearnScope</p>}
        </div>
      )}
      <div className={compact ? 'page-media-settings-source' : 'page-media-upload'}>
        <input ref={inputRef} className="sr-only" type="file" accept={block.type === 'image' ? 'image/*' : 'video/*'}
          onChange={(event) => { const file = event.target.files?.[0]; if (file) onUpload(file); event.target.value = '' }} />
        <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}>
          {uploading ? 'Uploading…' : `${block.url ? 'Replace' : 'Upload'} ${block.type}`}
        </button>
        {!compact && <span>Up to 50 MB</span>}
      </div>
      {block.type === 'video' && libraryResources?.length > 0 && (
        <LibraryVideoPicker resources={libraryResources} onPick={onPickFromLibrary} compact={compact} />
      )}
      {!managed && (
        <>
          {!compact && <div className="page-media-separator"><span>or use a URL</span></div>}
        <label>
          {compact && (
            <span className="mb-1 mt-2 block text-[10px] uppercase tracking-wide text-secondary">
              {block.type === 'image' ? 'Image URL' : 'Video URL'}
            </span>
          )}
          <input
            type="url"
            aria-label={block.type === 'image' ? 'Image URL' : 'Video URL'}
            value={block.url}
            onChange={(event) => onChange({ url: event.target.value, storagePath: '' })}
            placeholder="https://…"
            className={compact ? 'w-full rounded-md border border-hairline bg-paper px-2 py-1.5 text-xs text-ink' : 'mt-2 w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink'}
          />
        </label>
        </>
      )}
    </div>
  )
}

export function MediaEditor({ block, onChange, onUpload, uploading, libraryResources, onPickFromLibrary }) {
  if (block.url) return <PageMedia block={block} />
  return (
    <div className="page-media-editor">
      <div className="page-media-placeholder">
        <strong>{block.type === 'image' ? 'Add an image' : 'Add a video'}</strong>
        <span>Upload a file, paste a YouTube/Vimeo link, or use any web address below.</span>
      </div>
      <MediaSourceControls
        block={block}
        onChange={onChange}
        onUpload={onUpload}
        uploading={uploading}
        libraryResources={libraryResources}
        onPickFromLibrary={onPickFromLibrary}
      />
    </div>
  )
}

// autoFocus/onAutoFocused only ever apply on this element's very first mount
// (a freshly inserted or duplicated block gets a brand-new id, so React
// mounts a genuinely new node) -- every pre-existing block mounts once when
// the editor first opens without autoFocus set, so opening the page never
// steals focus from the title field.
function Editable({ value, onChange, label, className = '', onFocus, placeholder = 'Start typing…', autoFocus = false, onAutoFocused }) {
  const ref = useRef(null)
  useEffect(() => { if (ref.current && ref.current.innerHTML !== value) ref.current.innerHTML = value }, [value])
  useEffect(() => {
    if (!autoFocus || !ref.current) return
    ref.current.focus()
    // Caret at the end of the block's default placeholder text (e.g. "Write
    // something…") rather than the start, so typing immediately replaces it
    // forward the way someone reading it would expect.
    const range = window.document.createRange()
    range.selectNodeContents(ref.current)
    range.collapse(false)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    onAutoFocused?.()
    // Deliberately mount-only -- see the comment above the component.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div ref={ref} contentEditable role="textbox" aria-label={label} suppressContentEditableWarning
      data-placeholder={placeholder} onFocus={onFocus}
      onInput={(event) => onChange(sanitiseRichText(event.currentTarget.innerHTML))}
      onBlur={(event) => onChange(sanitiseRichText(event.currentTarget.innerHTML))}
      className={`page-inline-editable ${className}`} />
  )
}

// `panelBlocks` adds the LearnScope panels, offered only on an
// organisation's learner-workspace pages.
function InsertMenu({ onInsert, label = 'Add content', panelBlocks = false }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="page-insert-menu">
      <button type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open} className="page-insert-trigger">
        <span aria-hidden="true">+</span><span>{label}</span>
      </button>
      {open && (
        <div className="page-insert-options">
          {Object.entries(BLOCK_LABELS).filter(([type]) => !INTERACTIVE_BLOCKS[type] && !PANEL_BLOCKS[type]).map(([type, blockLabel]) => (
            <button key={type} type="button" onClick={() => { onInsert(type); setOpen(false) }}>{blockLabel}</button>
          ))}
          <span className="page-insert-options__group">Interactive and visual</span>
          {Object.entries(INTERACTIVE_BLOCKS).map(([type, spec]) => (
            <button key={type} type="button" onClick={() => { onInsert(type); setOpen(false) }}>{spec.label}</button>
          ))}
          {panelBlocks && (
            <>
              <span className="page-insert-options__group">From LearnScope</span>
              {Object.entries(PANEL_BLOCKS).map(([type, spec]) => (
                <button key={type} type="button" title={spec.description} onClick={() => { onInsert(type); setOpen(false) }}>{BLOCK_LABELS[type]}</button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// A LearnScope panel's settings, above an example of how it looks. Each
// member sees their own records for this organisation in its place.
function PanelBlockEditor({ block, onChange, onChangeWithHistory }) {
  const Sample = SAMPLE_PANELS[block.type]
  const fieldClass = 'w-full rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss'
  return (
    <div className="space-y-3">
      <p className="text-xs text-secondary">{PANEL_BLOCKS[block.type].description} Each member sees only their own, and only what belongs to this organisation.</p>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
        <label className="block text-xs text-secondary">
          Panel heading
          <input value={block.title} onChange={(event) => onChange({ title: event.target.value })} maxLength={120}
            placeholder={block.type === 'goals_panel' ? 'Your goals' : 'Your latest skills'} className={`mt-1 ${fieldClass}`} />
        </label>
        <label className="block text-xs text-secondary">
          How many to show
          <input type="number" min={PANEL_LIMITS.min} max={PANEL_LIMITS.max} value={block.limit}
            onChange={(event) => onChangeWithHistory({ limit: Math.max(PANEL_LIMITS.min, Math.min(PANEL_LIMITS.max, Number(event.target.value) || PANEL_LIMITS.min)) })}
            className={`mt-1 ${fieldClass}`} />
        </label>
      </div>
      {block.type === 'goals_panel' && (
        <label className="block text-xs text-secondary">
          Which goals
          <select value={block.show} onChange={(event) => onChangeWithHistory({ show: event.target.value })} className={`mt-1 ${fieldClass}`}>
            {GOAL_PANEL_SHOW.map((value) => (
              <option key={value} value={value}>{value === 'all' ? 'Open and completed goals' : 'Open goals only'}</option>
            ))}
          </select>
        </label>
      )}
      {Sample && <Sample block={block} />}
    </div>
  )
}

// `saveResource(title, pageDocument)` optionally replaces the default
// persistence (update the given resource in place / create a new page) --
// the course editor uses it to save an edit to a published page as a new
// page version linked into that course instead (see CourseSections).
export default function PageBuilderModal({ organisationId, userId, resource, initialTitle, onClose, onSaved, saveResource = null, panelBlocks = false }) {
  const [title, setTitle] = useState(resource?.title || initialTitle?.trim() || 'Untitled page')
  const [pageDocument, setPageDocument] = useState(() => normalisePageDocument(resource?.page_content || EMPTY_PAGE_DOCUMENT))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  // The text range a link is being added to, kept while the link dialog has
  // focus (focusing its input clears the page's own selection).
  const [linkRange, setLinkRange] = useState(null)
  const [linkUrl, setLinkUrl] = useState('')
  // New tab unless the author picks the same window; the text to show when
  // the link is added at the cursor rather than to selected text; and the
  // link being changed, when the cursor or selection is inside one.
  const [linkNewTab, setLinkNewTab] = useState(true)
  const [linkText, setLinkText] = useState('')
  const [linkExisting, setLinkExisting] = useState(false)
  const [linkError, setLinkError] = useState(null)
  const [draggedId, setDraggedId] = useState(null)
  const [dropTarget, setDropTarget] = useState(null) // { id, side: 'before' | 'after' }
  // Registry of each block wrapper's own DOM node, keyed by block id -- lets
  // touch dragging resolve its drop target by comparing the finger's
  // position against each block's own getBoundingClientRect (see
  // findDropTarget in lib/dragReorder.js) instead of relying on native HTML5
  // drag events, which touch browsers never fire.
  const blockNodeRefsRef = useRef(new Map())
  function registerBlockNode(id) {
    return (node) => {
      if (node) blockNodeRefsRef.current.set(id, node)
      else blockNodeRefsRef.current.delete(id)
    }
  }
  const [activeBlockId, setActiveBlockId] = useState(null)
  // The formatting bar only shows while a rich-text area (heading, text,
  // callout, quote, column) has focus -- or the bar itself does, for
  // keyboard users who tab into it.
  const [textFocused, setTextFocused] = useState(false)
  const [formatBarFocused, setFormatBarFocused] = useState(false)
  // For MediaEditor's "Choose from library" -- loaded once, best-effort
  // (a failure here shouldn't block the editor from opening, since upload
  // and URL entry still work without it).
  const [libraryVideoResources, setLibraryVideoResources] = useState([])
  useEffect(() => {
    listOrganisationResources(organisationId)
      .then((resources) => setLibraryVideoResources(resources.filter((item) => item.type === 'video' || item.type === 'screen_recording')))
      .catch(() => {})
  }, [organisationId])
  const [uploadingBlockId, setUploadingBlockId] = useState(null)
  const [newlyInsertedId, setNewlyInsertedId] = useState(null)
  const [previewing, setPreviewing] = useState(false)
  const sessionUploadsRef = useRef(new Set())
  const savedRef = useRef(false)

  // Undo/redo history -- deliberately tracks structural edits (insert,
  // remove, move, drag-reorder, duplicate) and discrete per-block settings
  // (heading level, alignment, callout style, media size), not every
  // keystroke of running text. A typo is trivially retyped; accidentally
  // deleting or reordering a whole block is the "oh no, undo!" moment this
  // is actually for, and per-keystroke history would make the stack useless
  // (one entry per character) for that.
  const [past, setPast] = useState([])
  const [future, setFuture] = useState([])
  const pageDocumentRef = useRef(pageDocument)
  useEffect(() => { pageDocumentRef.current = pageDocument }, [pageDocument])

  // Snapshot at open, compared against on Close so an accidental backdrop-
  // less dismissal (Escape, the Close button) can't silently drop real work
  // -- closeOnBackdrop is already false on this dialog for the same reason.
  const initialSnapshotRef = useRef(JSON.stringify({ title, pageDocument }))

  function commitDocument(updater) {
    setPast((current) => [...current.slice(-49), pageDocumentRef.current])
    setFuture([])
    setPageDocument(updater)
  }

  function undo() {
    setPast((currentPast) => {
      if (currentPast.length === 0) return currentPast
      const previous = currentPast[currentPast.length - 1]
      setFuture((currentFuture) => [pageDocumentRef.current, ...currentFuture].slice(0, 50))
      setPageDocument(previous)
      return currentPast.slice(0, -1)
    })
  }

  function redo() {
    setFuture((currentFuture) => {
      if (currentFuture.length === 0) return currentFuture
      const next = currentFuture[0]
      setPast((currentPast) => [...currentPast, pageDocumentRef.current].slice(-50))
      setPageDocument(next)
      return currentFuture.slice(1)
    })
  }

  async function closeEditor({ discard = false } = {}) {
    const isDirty = JSON.stringify({ title, pageDocument }) !== initialSnapshotRef.current
    if (isDirty && !discard) {
      setConfirmingDiscard(true)
      return
    }
    setConfirmingDiscard(false)
    if (!savedRef.current && sessionUploadsRef.current.size) {
      await Promise.allSettled([...sessionUploadsRef.current].map(removePageMediaAsset))
      sessionUploadsRef.current.clear()
    }
    onClose()
  }

  // Plain per-keystroke update -- no history entry (see the note above the
  // past/future state). Used by Editable's live typing and by the media
  // settings panel's URL/alternative-text/caption fields, which fire on
  // every keystroke the same way.
  function updateBlock(id, changes) {
    setPageDocument((current) => ({ ...current, blocks: current.blocks.map((block) => block.id === id ? { ...block, ...changes } : block) }))
  }

  // One click, one undo step -- used by the discrete settings pickers
  // (heading level, alignment, callout style, media size) instead of
  // updateBlock above.
  function updateBlockWithHistory(id, changes) {
    commitDocument((current) => ({ ...current, blocks: current.blocks.map((block) => block.id === id ? { ...block, ...changes } : block) }))
  }

  function insertBlock(type, index = pageDocument.blocks.length) {
    const block = newBlock(type)
    commitDocument((current) => {
      const blocks = [...current.blocks]
      blocks.splice(index, 0, block)
      return { ...current, blocks }
    })
    setActiveBlockId(block.id)
    setNewlyInsertedId(block.id)
  }

  function duplicateBlock(block) {
    // A fresh blank block of the same type, not a literal copy -- sharing a
    // storagePath/url with the original would mean deleting either copy
    // later (removeBlock) deletes the file out from under the other one.
    // Media blocks don't get a Duplicate button in the controls below for
    // exactly this reason; this only ever runs for text-bearing types.
    const clone = { ...block, id: crypto.randomUUID() }
    commitDocument((current) => {
      const blocks = [...current.blocks]
      const index = blocks.findIndex((item) => item.id === block.id)
      blocks.splice(index + 1, 0, clone)
      return { ...current, blocks }
    })
    setActiveBlockId(clone.id)
    setNewlyInsertedId(clone.id)
  }

  function moveBlock(id, direction) {
    commitDocument((current) => {
      const blocks = [...current.blocks]
      const from = blocks.findIndex((block) => block.id === id)
      const to = Math.max(0, Math.min(blocks.length - 1, from + direction))
      if (from === to) return current
      const [block] = blocks.splice(from, 1)
      blocks.splice(to, 0, block)
      return { ...current, blocks }
    })
  }

  async function uploadMedia(block, file) {
    setUploadingBlockId(block.id); setError(null)
    try {
      if (block.storagePath && sessionUploadsRef.current.has(block.storagePath)) {
        await removePageMediaAsset(block.storagePath)
        sessionUploadsRef.current.delete(block.storagePath)
      }
      const asset = await uploadPageMediaAsset(organisationId, file, block.type)
      sessionUploadsRef.current.add(asset.storagePath)
      updateBlock(block.id, { ...asset, alt: block.alt || file.name.replace(/\.[^.]+$/, '') })
    } catch (err) { setError(err.message) } finally { setUploadingBlockId(null) }
  }

  async function removeBlock(block) {
    if (block.storagePath && sessionUploadsRef.current.has(block.storagePath)) {
      try { await removePageMediaAsset(block.storagePath) } catch (err) { setError(err.message); return }
      sessionUploadsRef.current.delete(block.storagePath)
    }
    commitDocument((current) => ({ ...current, blocks: current.blocks.filter((item) => item.id !== block.id) }))
  }

  function handleDrop(targetId, side) {
    if (draggedId && draggedId !== targetId) {
      commitDocument((current) => {
        const blocks = current.blocks.filter((block) => block.id !== draggedId)
        const block = current.blocks.find((item) => item.id === draggedId)
        let index = blocks.findIndex((item) => item.id === targetId)
        if (side === 'after') index += 1
        blocks.splice(index, 0, block)
        return { ...current, blocks }
      })
    }
    setDraggedId(null)
    setDropTarget(null)
  }

  async function save() {
    if (!title.trim()) { setError('Give this page a title before saving.'); return }
    setSaving(true); setError(null)
    try {
      const cleanDocument = normalisePageDocument(pageDocument)
      const saved = saveResource
        ? await saveResource(title, cleanDocument)
        : resource
          ? await updatePageResource(resource.id, title, cleanDocument)
          : await createPageResource(organisationId, userId, title, cleanDocument)
      savedRef.current = true
      onSaved(saved); onClose()
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }

  // Refs so the single global keydown listener below never closes over a
  // stale title/pageDocument/past/future from whichever render first
  // attached it -- attaching once on mount avoids fighting the browser over
  // add/removeEventListener on every keystroke instead.
  const latestRef = useRef()
  latestRef.current = { save, undo, redo, canUndo: past.length > 0, canRedo: future.length > 0 }

  useEffect(() => {
    function handleKeyDown(event) {
      const meta = event.ctrlKey || event.metaKey
      if (!meta) return
      const key = event.key.toLowerCase()
      if (key === 's') {
        event.preventDefault()
        void latestRef.current.save()
      } else if (key === 'z' && !event.shiftKey) {
        if (!latestRef.current.canUndo) return
        event.preventDefault()
        latestRef.current.undo()
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        if (!latestRef.current.canRedo) return
        event.preventDefault()
        latestRef.current.redo()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const isDirty = JSON.stringify({ title, pageDocument }) !== initialSnapshotRef.current
  const wordCount = useMemo(() => pageDocumentWordCount(pageDocument), [pageDocument])
  const readingMinutes = Math.max(1, Math.round(wordCount / 200))

  function editableOf(node) {
    return (node?.nodeType === 1 ? node : node?.parentElement)?.closest('[contenteditable="true"]') ?? null
  }

  function linkAt(node, editable) {
    const anchor = (node?.nodeType === 1 ? node : node?.parentElement)?.closest('a')
    return anchor && editable?.contains(anchor) ? anchor : null
  }

  function handleAddLink(event) {
    event.preventDefault()
    const selection = window.getSelection()
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null
    const editable = range ? editableOf(range.startContainer) : null
    if (!range || !editable) {
      setError('Click into some text first (or select the words to link), then add a link.')
      return
    }
    const existing = linkAt(range.startContainer, editable)
    setError(null)
    setLinkError(null)
    setLinkUrl(existing?.getAttribute('href') ?? '')
    setLinkNewTab(existing ? existing.getAttribute('target') !== '_self' : true)
    setLinkText('')
    setLinkExisting(Boolean(existing))
    setLinkRange(range.cloneRange())
  }

  function applyLink(event) {
    event.preventDefault()
    const url = linkUrl.trim()
    if (!/^https?:\/\//i.test(url)) {
      setLinkError('Enter a full web address starting with http:// or https://')
      return
    }
    const target = linkNewTab ? '_blank' : '_self'
    // Put the remembered selection back, in its own editable block, before
    // turning it into a link.
    const editable = editableOf(linkRange.startContainer)
    if (!editable) { setLinkRange(null); return }
    const existing = linkAt(linkRange.startContainer, editable)
    if (linkRange.collapsed && !existing && !linkText.trim()) {
      setLinkError('Enter the text to show for the link.')
      return
    }
    editable.focus()
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(linkRange)
    if (linkRange.collapsed && existing) {
      existing.setAttribute('href', url)
      existing.setAttribute('target', target)
    } else if (linkRange.collapsed) {
      const anchor = window.document.createElement('a')
      anchor.setAttribute('href', url)
      anchor.setAttribute('target', target)
      anchor.textContent = linkText.trim()
      linkRange.insertNode(anchor)
      const after = window.document.createRange()
      after.setStartAfter(anchor)
      after.collapse(true)
      selection.removeAllRanges()
      selection.addRange(after)
    } else {
      window.document.execCommand?.('createLink', false, url)
      const linked = selection.rangeCount ? selection.getRangeAt(0) : linkRange
      for (const anchor of editable.querySelectorAll('a')) {
        if (linked.intersectsNode(anchor) || anchor.contains(linked.startContainer)) anchor.setAttribute('target', target)
      }
    }
    // Hand the finished markup (with its target) back through the block's
    // own onInput, which sanitises it into the page.
    editable.dispatchEvent(new Event('input', { bubbles: true }))
    setLinkRange(null)
  }

  return (
    <AccessibleDialog
      label="Page editor"
      onClose={() => void closeEditor()}
      closeOnBackdrop={false}
      overlayClassName="!bg-black/60 !p-0 sm:!p-3"
      panelClassName="page-builder-shell mx-auto flex h-full w-full max-w-[1500px] flex-col overflow-hidden bg-paper sm:rounded-xl"
    >
        <header className="flex flex-wrap items-center gap-3 border-b border-hairline bg-card px-4 py-3 sm:px-5">
          <button type="button" onClick={() => void closeEditor()} className="text-sm font-medium text-secondary hover:text-ink">Close</button>
          <span className="h-5 w-px bg-hairline" aria-hidden="true" />
          <input value={title} onChange={(event) => setTitle(event.target.value)} aria-label="Resource title"
            className="min-w-[180px] flex-1 bg-transparent font-display text-lg text-ink outline-none" />
          <div className="flex items-center gap-1">
            <button type="button" onClick={undo} disabled={previewing || past.length === 0} title="Undo (Ctrl+Z)" aria-label="Undo"
              className="rounded-md px-2 py-1.5 text-sm text-secondary hover:bg-paper hover:text-ink disabled:opacity-35">
              Undo
            </button>
            <button type="button" onClick={redo} disabled={previewing || future.length === 0} title="Redo (Ctrl+Shift+Z)" aria-label="Redo"
              className="rounded-md px-2 py-1.5 text-sm text-secondary hover:bg-paper hover:text-ink disabled:opacity-35">
              Redo
            </button>
          </div>
          <button type="button" onClick={() => setPreviewing((current) => !current)} aria-pressed={previewing}
            className={`rounded-md px-3 py-1.5 text-sm font-medium border ${previewing ? 'border-moss bg-moss/10 text-ink' : 'border-hairline text-secondary hover:text-ink hover:bg-paper'}`}>
            {previewing ? '← Back to editing' : 'Preview'}
          </button>
          <span className="hidden text-xs text-secondary sm:inline" aria-hidden="true">
            {wordCount} word{wordCount === 1 ? '' : 's'} · ~{readingMinutes} min read
          </span>
          {pageHasScoredTest(pageDocument) && <div className="flex flex-wrap items-center gap-2" aria-label="Test settings">
            <label className="flex items-center gap-1 text-xs text-secondary">Pass mark <input type="number" min="0" max="100" value={pageDocument.test?.passMark ?? 70} onChange={(event) => setPageDocument((current) => ({ ...current, test: { ...current.test, passMark: Number(event.target.value) } }))} className="w-16 rounded-md border border-hairline bg-paper px-2 py-1 text-ink" />%</label>
            <label className="flex items-center gap-1 text-xs text-secondary">Show questions
              <select value={pageDocument.test?.displayMode ?? 'all'} onChange={(event) => setPageDocument((current) => ({ ...current, test: { ...current.test, displayMode: event.target.value } }))} className="rounded-md border border-hairline bg-paper px-2 py-1 text-ink">
                <option value="all">All together</option>
                <option value="one_at_a_time">One at a time</option>
              </select>
            </label>
          </div>}
          <span className="text-xs text-secondary" aria-live="polite">{saving ? 'Saving…' : 'Editing live'}</span>
          <button type="button" onClick={save} disabled={saving || !isDirty} title="Save (Ctrl+S)"
            className="rounded-md bg-moss px-4 py-2 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-60">
            {saving ? 'Saving…' : 'Save page'}
          </button>
        </header>

        {error && <p className="bg-red-700 px-4 py-2 text-sm text-white" role="alert">{error}</p>}

        <div className="relative flex min-h-0 flex-1 flex-col">
        {!previewing && (textFocused || formatBarFocused) && (
        <div
          className="page-format-bar page-format-bar--floating"
          role="toolbar"
          aria-label="Text formatting"
          onFocus={() => setFormatBarFocused(true)}
          onBlur={(event) => {
            if (event.currentTarget.contains(event.relatedTarget)) return
            setFormatBarFocused(false)
            // Back into the text keeps the bar; anywhere else closes it.
            if (!event.relatedTarget?.closest?.('.page-inline-editable')) setTextFocused(false)
          }}
        >
          <span className="hidden text-xs text-secondary sm:inline">Select text, then format</span>
          {[
            ['bold', 'Bold', 'font-bold'],
            ['italic', 'Italic', 'italic'],
            ['underline', 'Underline', 'underline'],
            ['strikeThrough', 'Strike', 'line-through'],
          ].map(([command, label, className]) => (
            <button key={command} type="button" onMouseDown={(event) => { event.preventDefault(); window.document.execCommand?.(command) }}
              className={className} aria-label={label} title={label}>{label}</button>
          ))}
          <span className="mx-1 h-4 w-px bg-hairline" aria-hidden="true" />
          <button type="button" onMouseDown={(event) => { event.preventDefault(); window.document.execCommand?.('insertUnorderedList') }} aria-label="Bulleted list" title="Bulleted list">Bullets</button>
          <button type="button" onMouseDown={(event) => { event.preventDefault(); window.document.execCommand?.('insertOrderedList') }} aria-label="Numbered list" title="Numbered list">Numbers</button>
          <span className="mx-1 h-4 w-px bg-hairline" aria-hidden="true" />
          <button type="button" onMouseDown={handleAddLink} aria-label="Add link" title="Add link">Link</button>
          <button type="button" onMouseDown={(event) => { event.preventDefault(); window.document.execCommand?.('unlink') }} aria-label="Remove link" title="Remove link">Unlink</button>
          <span className="mx-1 h-4 w-px bg-hairline" aria-hidden="true" />
          <button type="button" onMouseDown={(event) => { event.preventDefault(); window.document.execCommand?.('removeFormat') }} aria-label="Clear formatting" title="Clear formatting">Clear</button>
        </div>
        )}

        {previewing ? (
          <main className="min-h-0 flex-1 overflow-y-auto px-3 py-6 sm:px-8 sm:py-10">
            <div className="page-live-canvas mx-auto min-h-full max-w-4xl bg-card px-5 py-10 sm:px-14 sm:py-14">
              <PageContent document={pageDocument} panels={panelBlocks ? SAMPLE_PANELS : null} />
            </div>
          </main>
        ) : (
        <main
          className="page-editor-scroll min-h-0 flex-1 overflow-y-auto px-3 py-6 sm:px-8 sm:py-10"
          onClick={() => setActiveBlockId(null)}
          onFocus={(event) => setTextFocused(Boolean(event.target.closest?.('.page-inline-editable')))}
          onBlur={(event) => { if (!event.relatedTarget?.closest?.('.page-inline-editable, .page-format-bar')) setTextFocused(false) }}
        >
          <div className="page-live-canvas mx-auto min-h-full max-w-4xl bg-card px-5 py-10 sm:px-14 sm:py-14">
            <article className="page-content mx-auto w-full max-w-[70ch]">
              {pageDocument.blocks.length > 0 && (
                <InsertMenu label="Insert at top" panelBlocks={panelBlocks} onInsert={(type) => insertBlock(type, 0)} />
              )}
              {pageDocument.blocks.map((block, index) => {
                const isActive = activeBlockId === block.id
                const isMedia = block.type === 'image' || block.type === 'video'
                return (
                  <div key={block.id} className="page-inline-block-wrap" ref={registerBlockNode(block.id)}
                    onDragOver={(event) => {
                      if (!draggedId || draggedId === block.id) return
                      event.preventDefault()
                      setDropTarget({ id: block.id, side: sideOf(event.currentTarget, event.clientY) })
                    }}
                    onDragLeave={() => setDropTarget((current) => (current?.id === block.id ? null : current))}
                    onDrop={(event) => { event.preventDefault(); handleDrop(block.id, dropTarget?.side ?? 'before') }}
                  >
                    {dropTarget?.id === block.id && <div className={`page-drop-indicator page-drop-indicator--${dropTarget.side}`} aria-hidden="true" />}
                    <section onClick={(event) => { event.stopPropagation(); setActiveBlockId(block.id) }}
                      className={`page-inline-block ${isActive ? 'is-active' : ''}`}>
                      <div className="page-block-controls" aria-label={`${BLOCK_LABELS[block.type]} controls`}>
                        <DragHandle
                          label={`Move ${BLOCK_LABELS[block.type]}`}
                          dragLabel={BLOCK_LABELS[block.type]}
                          onDragStart={() => setDraggedId(block.id)}
                          onDragEnd={() => { setDraggedId(null); setDropTarget(null) }}
                          onPointerDragStart={() => setDraggedId(block.id)}
                          onPointerDragMove={(event) => {
                            const hit = findDropTarget(blockNodeRefsRef.current, event.clientX, event.clientY)
                            if (hit && hit.id !== block.id) setDropTarget(hit)
                          }}
                          onPointerDragEnd={(event) => {
                            const hit = findDropTarget(blockNodeRefsRef.current, event.clientX, event.clientY)
                            if (hit && hit.id !== block.id) handleDrop(hit.id, hit.side)
                            else { setDraggedId(null); setDropTarget(null) }
                          }}
                        />
                        <button type="button" onClick={() => moveBlock(block.id, -1)} disabled={index === 0} aria-label="Move block up">Up</button>
                        <button type="button" onClick={() => moveBlock(block.id, 1)} disabled={index === pageDocument.blocks.length - 1} aria-label="Move block down">Down</button>
                        {!isMedia && <button type="button" onClick={() => duplicateBlock(block)} aria-label="Duplicate block">Duplicate</button>}
                        <BlockSettingsMenu
                          block={block}
                          onChange={(changes) => updateBlock(block.id, changes)}
                          onChangeWithHistory={(changes) => updateBlockWithHistory(block.id, changes)}
                          onUpload={(file) => uploadMedia(block, file)}
                          uploading={uploadingBlockId === block.id}
                          libraryResources={libraryVideoResources}
                          onPickFromLibrary={(resource) => updateBlockWithHistory(block.id, {
                            url: contentFileUrl(resource),
                            storagePath: resource.storage_path,
                            alt: block.alt || resource.title,
                          })}
                        />
                        <button type="button" onClick={() => void removeBlock(block)} className="text-red-700">Remove</button>
                      </div>

                      {block.type === 'divider' && <hr className="page-divider" />}
                      {block.type === 'heading' && (
                        <Editable value={block.content} onChange={(content) => updateBlock(block.id, { content })} onFocus={() => setActiveBlockId(block.id)}
                          label="Heading text" placeholder={BLOCK_PLACEHOLDERS.heading}
                          className={`${block.level === 1 ? 'page-heading' : block.level === 2 ? 'page-subheading' : 'page-subheading page-subheading--sm'} page-align-${block.align}`}
                          autoFocus={block.id === newlyInsertedId} onAutoFocused={() => setNewlyInsertedId(null)} />
                      )}
                      {block.type === 'text' && (
                        <Editable value={block.content} onChange={(content) => updateBlock(block.id, { content })} onFocus={() => setActiveBlockId(block.id)}
                          label="Body text" placeholder={BLOCK_PLACEHOLDERS.text} className={`page-paragraph page-align-${block.align}`}
                          autoFocus={block.id === newlyInsertedId} onAutoFocused={() => setNewlyInsertedId(null)} />
                      )}
                      {block.type === 'callout' && (
                        <Editable value={block.content} onChange={(content) => updateBlock(block.id, { content })} onFocus={() => setActiveBlockId(block.id)}
                          label="Callout text" placeholder={BLOCK_PLACEHOLDERS.callout} className={`page-callout page-callout--${block.variant} page-align-${block.align}`}
                          autoFocus={block.id === newlyInsertedId} onAutoFocused={() => setNewlyInsertedId(null)} />
                      )}
                      {block.type === 'quote' && (
                        <Editable value={block.content} onChange={(content) => updateBlock(block.id, { content })} onFocus={() => setActiveBlockId(block.id)}
                          label="Quote text" placeholder={BLOCK_PLACEHOLDERS.quote} className={`page-quote page-align-${block.align}`}
                          autoFocus={block.id === newlyInsertedId} onAutoFocused={() => setNewlyInsertedId(null)} />
                      )}
                      {block.type === 'columns' && (
                        <div className="page-columns page-columns--editing">
                          <Editable value={block.content} onChange={(content) => updateBlock(block.id, { content })} onFocus={() => setActiveBlockId(block.id)}
                            label="First column" placeholder="First column…"
                            autoFocus={block.id === newlyInsertedId} onAutoFocused={() => setNewlyInsertedId(null)} />
                          <Editable value={block.secondaryContent} onChange={(secondaryContent) => updateBlock(block.id, { secondaryContent })} onFocus={() => setActiveBlockId(block.id)}
                            label="Second column" placeholder="Second column…" />
                        </div>
                      )}
                      {INTERACTIVE_BLOCKS[block.type] && (
                        <PageInteractiveEditor
                          block={block}
                          onChange={(changes) => updateBlock(block.id, changes)}
                          onChangeWithHistory={(changes) => updateBlockWithHistory(block.id, changes)}
                        />
                      )}
                      {PANEL_BLOCKS[block.type] && (
                        <PanelBlockEditor
                          block={block}
                          onChange={(changes) => updateBlock(block.id, changes)}
                          onChangeWithHistory={(changes) => updateBlockWithHistory(block.id, changes)}
                        />
                      )}
                      {isMedia && (
                        <MediaEditor block={block} onChange={(changes) => updateBlock(block.id, changes)}
                          onUpload={(file) => uploadMedia(block, file)} uploading={uploadingBlockId === block.id}
                          libraryResources={libraryVideoResources}
                          onPickFromLibrary={(resource) => updateBlockWithHistory(block.id, {
                            url: contentFileUrl(resource),
                            storagePath: resource.storage_path,
                            alt: block.alt || resource.title,
                          })}
                        />
                      )}
                    </section>
                    {isActive && <InsertMenu label="Insert below" panelBlocks={panelBlocks} onInsert={(type) => insertBlock(type, index + 1)} />}
                  </div>
                )
              })}
              {pageDocument.blocks.length === 0 && <div className="py-16 text-center"><p className="mb-4 text-secondary">This page is empty.</p><InsertMenu panelBlocks={panelBlocks} onInsert={insertBlock} /></div>}
              {pageDocument.blocks.length > 0 && <InsertMenu panelBlocks={panelBlocks} onInsert={insertBlock} />}
            </article>
          </div>
        </main>
        )}

      </div>

      {confirmingDiscard && (
        <ConfirmDialog
          message="Discard unsaved changes to this page?"
          confirmLabel="Discard changes"
          onConfirm={() => void closeEditor({ discard: true })}
          onCancel={() => setConfirmingDiscard(false)}
        />
      )}

      {linkRange && (
        <AccessibleDialog
          labelledBy="page-link-dialog-title"
          onClose={() => setLinkRange(null)}
          overlayClassName="z-[60]"
          panelClassName="w-full max-w-sm bg-card border border-hairline rounded-lg p-6"
        >
          <form onSubmit={applyLink} className="space-y-3">
            <h2 id="page-link-dialog-title" className="font-display text-lg text-ink">{linkExisting ? 'Edit link' : 'Add a link'}</h2>
            <div>
              <label htmlFor="page-link-url" className="block text-sm text-secondary mb-1">Web address</label>
              <input
                id="page-link-url"
                type="url"
                autoFocus
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://…"
                className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              />
            </div>
            {linkRange.collapsed && !linkExisting && (
              <div>
                <label htmlFor="page-link-text" className="block text-sm text-secondary mb-1">Text to show</label>
                <input
                  id="page-link-text"
                  value={linkText}
                  onChange={(e) => setLinkText(e.target.value)}
                  maxLength={200}
                  className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                />
              </div>
            )}
            <fieldset>
              <legend className="text-sm text-secondary mb-1">Open the link in</legend>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="radio" name="page-link-target" checked={linkNewTab} onChange={() => setLinkNewTab(true)} />
                A new tab
              </label>
              <label className="mt-1 flex items-center gap-2 text-sm text-ink">
                <input type="radio" name="page-link-target" checked={!linkNewTab} onChange={() => setLinkNewTab(false)} />
                The same window
              </label>
            </fieldset>
            {linkError && <p role="alert" className="text-xs text-red-700">{linkError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setLinkRange(null)} className="rounded-md border border-hairline text-ink py-2 px-4 text-sm font-medium hover:bg-paper">
                Cancel
              </button>
              <button type="submit" className="rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90">
                {linkExisting ? 'Update link' : 'Add link'}
              </button>
            </div>
          </form>
        </AccessibleDialog>
      )}
    </AccessibleDialog>
  )
}
