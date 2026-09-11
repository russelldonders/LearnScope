import { useEffect, useMemo, useRef, useState } from 'react'
import { createPageResource, removePageMediaAsset, updatePageResource, uploadPageMediaAsset } from '../lib/courseContent'
import {
  CALLOUT_VARIANTS,
  EMPTY_PAGE_DOCUMENT,
  MEDIA_SIZES,
  TEXT_ALIGNMENTS,
  normalisePageDocument,
  pageDocumentWordCount,
  sanitiseRichText,
} from '../lib/pageBuilder'
import PageContent, { PageMedia } from './PageContent'
import AccessibleDialog from './AccessibleDialog'

const BLOCK_LABELS = {
  heading: 'Heading',
  text: 'Text',
  image: 'Image',
  video: 'Video',
  callout: 'Callout',
  quote: 'Quote',
  columns: 'Two columns',
  divider: 'Divider',
}

const BLOCK_PLACEHOLDERS = {
  heading: 'Write a heading…',
  text: 'Start typing…',
  callout: 'Add an important note…',
  quote: 'Add a quotation…',
}

const ALIGN_LABELS = { left: 'Left', center: 'Center', right: 'Right' }

function newBlock(type) {
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
// component rather than four near-identical ones.
function OptionPicker({ label, options, value, onChange, formatOption = (option) => option }) {
  return (
    <div className="page-block-options" role="group" aria-label={label}>
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
  )
}

function MediaEditor({ block, onChange, onSizeChange, onUpload, uploading }) {
  const inputRef = useRef(null)
  return (
    <div className="page-media-editor">
      {block.url ? <PageMedia block={block} /> : (
        <div className="page-media-placeholder">
          <strong>{block.type === 'image' ? 'Add an image' : 'Add a video'}</strong>
          <span>Upload a file, paste a YouTube/Vimeo link, or use any web address below.</span>
        </div>
      )}
      <div className="page-media-upload">
        <input ref={inputRef} className="sr-only" type="file" accept={block.type === 'image' ? 'image/*' : 'video/*'}
          onChange={(event) => { const file = event.target.files?.[0]; if (file) onUpload(file); event.target.value = '' }} />
        <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}>
          {uploading ? 'Uploading…' : `Upload ${block.type}`}
        </button>
        <span>Up to 50 MB</span>
      </div>
      <div className="page-media-separator"><span>or use a URL</span></div>
      <div className="page-media-fields">
        <label>
          <span>{block.type === 'image' ? 'Image URL' : 'Video URL'}</span>
          <input type="url" value={block.url} onChange={(event) => onChange({ url: event.target.value })} placeholder="https://…" />
        </label>
        <label>
          <span>{block.type === 'image' ? 'Alternative text' : 'Accessible title'}</span>
          <input value={block.alt} onChange={(event) => onChange({ alt: event.target.value })} placeholder={block.type === 'image' ? 'Describe the image' : 'Describe the video'} />
        </label>
        <label className="sm:col-span-2">
          <span>Caption (optional)</span>
          <input value={block.caption} onChange={(event) => onChange({ caption: event.target.value })} placeholder="Add context for learners" />
        </label>
      </div>
      {block.url && (
        <OptionPicker
          label={`${block.type === 'image' ? 'Image' : 'Video'} size`}
          options={MEDIA_SIZES}
          value={block.size}
          onChange={onSizeChange}
          formatOption={(size) => size[0].toUpperCase() + size.slice(1)}
        />
      )}
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

function InsertMenu({ onInsert, label = 'Add content' }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="page-insert-menu">
      <button type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open} className="page-insert-trigger">
        <span aria-hidden="true">+</span><span>{label}</span>
      </button>
      {open && (
        <div className="page-insert-options">
          {Object.entries(BLOCK_LABELS).map(([type, blockLabel]) => (
            <button key={type} type="button" onClick={() => { onInsert(type); setOpen(false) }}>{blockLabel}</button>
          ))}
        </div>
      )}
    </div>
  )
}

function sideOf(element, clientY) {
  const rect = element.getBoundingClientRect()
  return clientY - rect.top < rect.height / 2 ? 'above' : 'below'
}

export default function PageBuilderModal({ organisationId, userId, resource, initialTitle, onClose, onSaved }) {
  const [title, setTitle] = useState(resource?.title || initialTitle?.trim() || 'Untitled page')
  const [pageDocument, setPageDocument] = useState(() => normalisePageDocument(resource?.page_content || EMPTY_PAGE_DOCUMENT))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [draggedId, setDraggedId] = useState(null)
  const [dropTarget, setDropTarget] = useState(null) // { id, side: 'above' | 'below' }
  const [activeBlockId, setActiveBlockId] = useState(null)
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

  async function closeEditor() {
    const isDirty = JSON.stringify({ title, pageDocument }) !== initialSnapshotRef.current
    if (isDirty && !window.confirm("Discard unsaved changes to this page?")) return
    if (!savedRef.current && sessionUploadsRef.current.size) {
      await Promise.allSettled([...sessionUploadsRef.current].map(removePageMediaAsset))
      sessionUploadsRef.current.clear()
    }
    onClose()
  }

  // Plain per-keystroke update -- no history entry (see the note above the
  // past/future state). Used by Editable's live typing and by MediaEditor's
  // URL/alt/caption text fields, which fire on every keystroke the same way.
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
        if (side === 'below') index += 1
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
      const saved = resource
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

  function handleAddLink(event) {
    event.preventDefault()
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) {
      window.alert('Select some text first, then add a link.')
      return
    }
    const url = window.prompt('Link URL (https://…)')
    if (!url) return
    if (!/^https?:\/\//i.test(url.trim())) {
      window.alert('Please enter a full URL starting with http:// or https://')
      return
    }
    window.document.execCommand?.('createLink', false, url.trim())
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
          <span className="text-xs text-secondary" aria-live="polite">{saving ? 'Saving…' : 'Editing live'}</span>
          <button type="button" onClick={save} disabled={saving || !isDirty} title="Save (Ctrl+S)"
            className="rounded-md bg-moss px-4 py-2 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-60">
            {saving ? 'Saving…' : 'Save page'}
          </button>
        </header>

        {error && <p className="bg-red-700 px-4 py-2 text-sm text-white" role="alert">{error}</p>}

        {!previewing && (
        <div className="page-format-bar" aria-label="Text formatting">
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
              <PageContent document={pageDocument} />
            </div>
          </main>
        ) : (
        <main className="min-h-0 flex-1 overflow-y-auto px-3 py-6 sm:px-8 sm:py-10" onClick={() => setActiveBlockId(null)}>
          <div className="page-live-canvas mx-auto min-h-full max-w-4xl bg-card px-5 py-10 sm:px-14 sm:py-14">
            <article className="page-content mx-auto w-full max-w-[70ch]">
              {pageDocument.blocks.length > 0 && (
                <InsertMenu label="Insert at top" onInsert={(type) => insertBlock(type, 0)} />
              )}
              {pageDocument.blocks.map((block, index) => {
                const isActive = activeBlockId === block.id
                const isMedia = block.type === 'image' || block.type === 'video'
                return (
                  <div key={block.id} className="page-inline-block-wrap"
                    onDragOver={(event) => {
                      if (!draggedId || draggedId === block.id) return
                      event.preventDefault()
                      setDropTarget({ id: block.id, side: sideOf(event.currentTarget, event.clientY) })
                    }}
                    onDragLeave={() => setDropTarget((current) => (current?.id === block.id ? null : current))}
                    onDrop={(event) => { event.preventDefault(); handleDrop(block.id, dropTarget?.side ?? 'above') }}
                  >
                    {dropTarget?.id === block.id && <div className={`page-drop-indicator page-drop-indicator--${dropTarget.side}`} aria-hidden="true" />}
                    <section draggable onClick={(event) => { event.stopPropagation(); setActiveBlockId(block.id) }}
                      onDragStart={() => setDraggedId(block.id)} onDragEnd={() => { setDraggedId(null); setDropTarget(null) }}
                      className={`page-inline-block ${isActive ? 'is-active' : ''}`}>
                      <div className="page-block-controls" aria-label={`${BLOCK_LABELS[block.type]} controls`}>
                        <span className="page-drag-handle" title="Drag to reorder">Drag</span>
                        <button type="button" onClick={() => moveBlock(block.id, -1)} disabled={index === 0} aria-label="Move block up">Up</button>
                        <button type="button" onClick={() => moveBlock(block.id, 1)} disabled={index === pageDocument.blocks.length - 1} aria-label="Move block down">Down</button>
                        {!isMedia && <button type="button" onClick={() => duplicateBlock(block)} aria-label="Duplicate block">Duplicate</button>}
                        <button type="button" onClick={() => void removeBlock(block)} className="text-red-700">Remove</button>
                      </div>

                      {isActive && block.type === 'heading' && (
                        <OptionPicker label="Heading level" options={[1, 2, 3]} value={block.level}
                          onChange={(level) => updateBlockWithHistory(block.id, { level })}
                          formatOption={(level) => `H${level}`} />
                      )}
                      {isActive && block.type === 'callout' && (
                        <OptionPicker label="Callout style" options={CALLOUT_VARIANTS} value={block.variant}
                          onChange={(variant) => updateBlockWithHistory(block.id, { variant })}
                          formatOption={(variant) => variant[0].toUpperCase() + variant.slice(1)} />
                      )}
                      {isActive && ['heading', 'text', 'callout', 'quote'].includes(block.type) && (
                        <OptionPicker label="Text alignment" options={TEXT_ALIGNMENTS} value={block.align}
                          onChange={(align) => updateBlockWithHistory(block.id, { align })}
                          formatOption={(align) => ALIGN_LABELS[align]} />
                      )}

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
                        <div className="page-columns">
                          <Editable value={block.content} onChange={(content) => updateBlock(block.id, { content })} onFocus={() => setActiveBlockId(block.id)}
                            label="First column" placeholder="First column…"
                            autoFocus={block.id === newlyInsertedId} onAutoFocused={() => setNewlyInsertedId(null)} />
                          <Editable value={block.secondaryContent} onChange={(secondaryContent) => updateBlock(block.id, { secondaryContent })} onFocus={() => setActiveBlockId(block.id)}
                            label="Second column" placeholder="Second column…" />
                        </div>
                      )}
                      {isMedia && (
                        <MediaEditor block={block} onChange={(changes) => updateBlock(block.id, changes)}
                          onSizeChange={(size) => updateBlockWithHistory(block.id, { size })}
                          onUpload={(file) => uploadMedia(block, file)} uploading={uploadingBlockId === block.id} />
                      )}
                    </section>
                    {isActive && <InsertMenu label="Insert below" onInsert={(type) => insertBlock(type, index + 1)} />}
                  </div>
                )
              })}
              {pageDocument.blocks.length === 0 && <div className="py-16 text-center"><p className="mb-4 text-secondary">This page is empty.</p><InsertMenu onInsert={insertBlock} /></div>}
              {pageDocument.blocks.length > 0 && <InsertMenu onInsert={insertBlock} />}
            </article>
          </div>
        </main>
        )}
    </AccessibleDialog>
  )
}
