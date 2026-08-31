import { useEffect, useRef, useState } from 'react'
import { createPageResource, updatePageResource } from '../lib/courseContent'
import { EMPTY_PAGE_DOCUMENT, normalisePageDocument, sanitiseRichText } from '../lib/pageBuilder'
import { PageMedia } from './PageContent'

const BLOCK_LABELS = { heading: 'Heading', text: 'Text', image: 'Image', video: 'Video', callout: 'Callout', columns: 'Two columns', divider: 'Divider' }

function newBlock(type) {
  if (type === 'divider') return { id: crypto.randomUUID(), type }
  if (type === 'columns') return { id: crypto.randomUUID(), type, content: 'First column', secondaryContent: 'Second column' }
  if (type === 'image' || type === 'video') return { id: crypto.randomUUID(), type, url: '', alt: '', caption: '' }
  return {
    id: crypto.randomUUID(), type, ...(type === 'heading' ? { level: 2 } : {}),
    content: type === 'callout' ? 'Add an important note…' : type === 'heading' ? 'New section' : 'Write something…',
  }
}

function MediaEditor({ block, onChange }) {
  return (
    <div className="page-media-editor">
      {block.url ? <PageMedia block={block} /> : (
        <div className="page-media-placeholder">
          <strong>{block.type === 'image' ? 'Add an image' : 'Add a video'}</strong>
          <span>{block.type === 'image' ? 'Paste a direct image URL below.' : 'Paste a YouTube, Vimeo, or direct video URL below.'}</span>
        </div>
      )}
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
    </div>
  )
}

function Editable({ value, onChange, label, className = '', onFocus }) {
  const ref = useRef(null)
  useEffect(() => { if (ref.current && ref.current.innerHTML !== value) ref.current.innerHTML = value }, [value])
  return (
    <div ref={ref} contentEditable role="textbox" aria-label={label} suppressContentEditableWarning
      data-placeholder="Start typing…" onFocus={onFocus}
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

export default function PageBuilderModal({ organisationId, userId, resource, initialTitle, onClose, onSaved }) {
  const [title, setTitle] = useState(resource?.title || initialTitle?.trim() || 'Untitled page')
  const [pageDocument, setPageDocument] = useState(() => normalisePageDocument(resource?.page_content || EMPTY_PAGE_DOCUMENT))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [draggedId, setDraggedId] = useState(null)
  const [activeBlockId, setActiveBlockId] = useState(null)

  useEffect(() => {
    function handleKeyDown(event) { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  function updateBlock(id, changes) {
    setPageDocument((current) => ({ ...current, blocks: current.blocks.map((block) => block.id === id ? { ...block, ...changes } : block) }))
  }

  function insertBlock(type, index = pageDocument.blocks.length) {
    setPageDocument((current) => {
      const blocks = [...current.blocks]
      blocks.splice(index, 0, newBlock(type))
      return { ...current, blocks }
    })
  }

  function moveBlock(id, direction) {
    setPageDocument((current) => {
      const blocks = [...current.blocks]
      const from = blocks.findIndex((block) => block.id === id)
      const to = Math.max(0, Math.min(blocks.length - 1, from + direction))
      if (from === to) return current
      const [block] = blocks.splice(from, 1)
      blocks.splice(to, 0, block)
      return { ...current, blocks }
    })
  }

  function dropBefore(targetId) {
    if (!draggedId || draggedId === targetId) return
    setPageDocument((current) => {
      const blocks = current.blocks.filter((block) => block.id !== draggedId)
      const block = current.blocks.find((item) => item.id === draggedId)
      blocks.splice(blocks.findIndex((item) => item.id === targetId), 0, block)
      return { ...current, blocks }
    })
    setDraggedId(null)
  }

  async function save() {
    if (!title.trim()) { setError('Give this page a title before saving.'); return }
    setSaving(true); setError(null)
    try {
      const cleanDocument = normalisePageDocument(pageDocument)
      const saved = resource
        ? await updatePageResource(resource.id, title, cleanDocument)
        : await createPageResource(organisationId, userId, title, cleanDocument)
      onSaved(saved); onClose()
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 p-0 sm:p-3" role="dialog" aria-modal="true" aria-label="Page editor">
      <div className="page-builder-shell mx-auto flex h-full max-w-[1500px] flex-col overflow-hidden bg-paper sm:rounded-xl">
        <header className="flex flex-wrap items-center gap-3 border-b border-hairline bg-card px-4 py-3 sm:px-5">
          <button type="button" onClick={onClose} className="text-sm font-medium text-secondary hover:text-ink">Close</button>
          <span className="h-5 w-px bg-hairline" aria-hidden="true" />
          <input value={title} onChange={(event) => setTitle(event.target.value)} aria-label="Resource title"
            className="min-w-[180px] flex-1 bg-transparent font-display text-lg text-ink outline-none" />
          <span className="text-xs text-secondary" aria-live="polite">{saving ? 'Saving…' : 'Editing live'}</span>
          <button type="button" onClick={save} disabled={saving} className="rounded-md bg-moss px-4 py-2 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-60">Save page</button>
        </header>

        {error && <p className="bg-red-700 px-4 py-2 text-sm text-white" role="alert">{error}</p>}

        <div className="page-format-bar" aria-label="Text formatting">
          <span className="hidden text-xs text-secondary sm:inline">Select text, then format</span>
          {[
            ['bold', 'Bold'], ['italic', 'Italic'], ['underline', 'Underline'],
          ].map(([command, label]) => (
            <button key={command} type="button" onMouseDown={(event) => { event.preventDefault(); window.document.execCommand?.(command) }}
              className={command === 'bold' ? 'font-bold' : command === 'italic' ? 'italic' : 'underline'} aria-label={label}>{label}</button>
          ))}
        </div>

        <main className="min-h-0 flex-1 overflow-y-auto px-3 py-6 sm:px-8 sm:py-10" onClick={() => setActiveBlockId(null)}>
          <div className="page-live-canvas mx-auto min-h-full max-w-4xl bg-card px-5 py-10 sm:px-14 sm:py-14">
            <article className="page-content mx-auto w-full max-w-[70ch]">
              {pageDocument.blocks.map((block, index) => {
                const isActive = activeBlockId === block.id
                return (
                  <div key={block.id} className="page-inline-block-wrap">
                    <section draggable onClick={(event) => { event.stopPropagation(); setActiveBlockId(block.id) }}
                      onDragStart={() => setDraggedId(block.id)} onDragOver={(event) => event.preventDefault()}
                      onDrop={() => dropBefore(block.id)} className={`page-inline-block ${isActive ? 'is-active' : ''}`}>
                      <div className="page-block-controls" aria-label={`${BLOCK_LABELS[block.type]} controls`}>
                        <span className="page-drag-handle" title="Drag to reorder">Drag</span>
                        <button type="button" onClick={() => moveBlock(block.id, -1)} disabled={index === 0} aria-label="Move block up">Up</button>
                        <button type="button" onClick={() => moveBlock(block.id, 1)} disabled={index === pageDocument.blocks.length - 1} aria-label="Move block down">Down</button>
                        <button type="button" onClick={() => setPageDocument((current) => ({ ...current, blocks: current.blocks.filter((item) => item.id !== block.id) }))} className="text-red-700">Remove</button>
                      </div>

                      {block.type === 'divider' && <hr className="page-divider" />}
                      {block.type === 'heading' && <Editable value={block.content} onChange={(content) => updateBlock(block.id, { content })} onFocus={() => setActiveBlockId(block.id)} label="Heading text" className={block.level === 1 ? 'page-heading' : 'page-subheading'} />}
                      {block.type === 'text' && <Editable value={block.content} onChange={(content) => updateBlock(block.id, { content })} onFocus={() => setActiveBlockId(block.id)} label="Body text" className="page-paragraph" />}
                      {block.type === 'callout' && <Editable value={block.content} onChange={(content) => updateBlock(block.id, { content })} onFocus={() => setActiveBlockId(block.id)} label="Callout text" className="page-callout" />}
                      {block.type === 'columns' && (
                        <div className="page-columns">
                          <Editable value={block.content} onChange={(content) => updateBlock(block.id, { content })} onFocus={() => setActiveBlockId(block.id)} label="First column" />
                          <Editable value={block.secondaryContent} onChange={(secondaryContent) => updateBlock(block.id, { secondaryContent })} onFocus={() => setActiveBlockId(block.id)} label="Second column" />
                        </div>
                      )}
                      {(block.type === 'image' || block.type === 'video') && (
                        <MediaEditor block={block} onChange={(changes) => updateBlock(block.id, changes)} />
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
      </div>
    </div>
  )
}
