import { useEffect, useRef, useState } from 'react'
import { createPageResource, updatePageResource } from '../lib/courseContent'
import { EMPTY_PAGE_DOCUMENT, normalisePageDocument, sanitiseRichText } from '../lib/pageBuilder'
import PageContent from './PageContent'

const BLOCK_LABELS = {
  heading: 'Heading',
  text: 'Text',
  callout: 'Callout',
  columns: 'Two columns',
  divider: 'Divider',
}

function newBlock(type) {
  if (type === 'divider') return { id: crypto.randomUUID(), type }
  if (type === 'columns') {
    return { id: crypto.randomUUID(), type, content: 'First column', secondaryContent: 'Second column' }
  }
  return {
    id: crypto.randomUUID(),
    type,
    ...(type === 'heading' ? { level: 2 } : {}),
    content: type === 'callout' ? 'Add an important note…' : type === 'heading' ? 'New section' : 'Write something…',
  }
}

function Editable({ value, onChange, label, className = '' }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) ref.current.innerHTML = value
  }, [value])
  return (
    <div
      ref={ref}
      contentEditable
      role="textbox"
      aria-label={label}
      suppressContentEditableWarning
      data-placeholder="Start typing…"
      onBlur={(event) => onChange(sanitiseRichText(event.currentTarget.innerHTML))}
      className={`page-editable ${className}`}
    />
  )
}

export default function PageBuilderModal({ organisationId, userId, resource, initialTitle, onClose, onSaved }) {
  const [title, setTitle] = useState(resource?.title || initialTitle?.trim() || 'Untitled page')
  const [document, setDocument] = useState(() => normalisePageDocument(resource?.page_content || EMPTY_PAGE_DOCUMENT))
  const [preview, setPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [draggedId, setDraggedId] = useState(null)

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  function updateBlock(id, changes) {
    setDocument((current) => ({
      ...current,
      blocks: current.blocks.map((block) => (block.id === id ? { ...block, ...changes } : block)),
    }))
  }

  function moveBlock(id, direction) {
    setDocument((current) => {
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
    setDocument((current) => {
      const blocks = current.blocks.filter((block) => block.id !== draggedId)
      const block = current.blocks.find((item) => item.id === draggedId)
      blocks.splice(blocks.findIndex((item) => item.id === targetId), 0, block)
      return { ...current, blocks }
    })
    setDraggedId(null)
  }

  async function save() {
    if (!title.trim()) {
      setError('Give this page a title before saving.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const cleanDocument = normalisePageDocument(document)
      const saved = resource
        ? await updatePageResource(resource.id, title, cleanDocument)
        : await createPageResource(organisationId, userId, title, cleanDocument)
      onSaved(saved)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 p-2 sm:p-5" role="dialog" aria-modal="true" aria-label="Page builder">
      <div className="page-builder-shell mx-auto flex h-full max-w-[1500px] flex-col overflow-hidden bg-paper">
        <header className="flex flex-wrap items-center gap-3 border-b border-hairline bg-card px-4 py-3 sm:px-5">
          <button type="button" onClick={onClose} className="text-sm font-medium text-secondary hover:text-ink">Close</button>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            aria-label="Page title"
            className="min-w-[180px] flex-1 bg-transparent font-display text-xl text-ink outline-none"
          />
          <span className="text-xs text-secondary" aria-live="polite">{saving ? 'Saving…' : 'Draft'}</span>
          <div className="flex rounded-md border border-hairline p-0.5">
            <button type="button" onClick={() => setPreview(false)} className={`rounded px-3 py-1.5 text-xs font-medium ${!preview ? 'bg-ink text-paper' : 'text-secondary'}`}>Edit</button>
            <button type="button" onClick={() => setPreview(true)} className={`rounded px-3 py-1.5 text-xs font-medium ${preview ? 'bg-ink text-paper' : 'text-secondary'}`}>Preview</button>
          </div>
          <button type="button" onClick={save} disabled={saving} className="rounded-md bg-moss px-4 py-2 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-60">Save page</button>
        </header>

        {error && <p className="bg-red-700 px-4 py-2 text-sm text-white" role="alert">{error}</p>}

        <div className="grid min-h-0 flex-1 lg:grid-cols-[220px_1fr]">
          {!preview && (
            <aside className="border-b border-hairline bg-card p-4 lg:border-b-0 lg:border-r">
              <h2 className="font-display text-lg text-ink">Add content</h2>
              <p className="mb-3 mt-1 text-xs leading-relaxed text-secondary">Choose a block, then drag it into position or use the move controls.</p>
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
                {Object.entries(BLOCK_LABELS).map(([blockType, label]) => (
                  <button
                    key={blockType}
                    type="button"
                    onClick={() => setDocument((current) => ({ ...current, blocks: [...current.blocks, newBlock(blockType)] }))}
                    className="rounded-md border border-hairline bg-paper px-3 py-2 text-left text-sm font-medium text-ink hover:border-moss"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </aside>
          )}

          <main className="min-h-0 overflow-y-auto px-3 py-5 sm:px-8 sm:py-8">
            {preview ? (
              <div className="mx-auto min-h-full max-w-4xl bg-card px-5 py-10 sm:px-12 sm:py-14"><PageContent document={document} /></div>
            ) : (
              <div className="mx-auto max-w-4xl">
                <div className="mb-5 flex items-end justify-between gap-4">
                  <div><h2 className="font-display text-2xl text-ink">Build your page</h2><p className="text-sm text-secondary">Click into any block to write and format.</p></div>
                  <div className="flex gap-1 rounded-md border border-hairline bg-card p-1" aria-label="Text formatting">
                    {['bold', 'italic', 'underline'].map((command) => (
                      <button key={command} type="button" onMouseDown={(event) => { event.preventDefault(); window.document.execCommand?.(command) }} className="min-w-8 rounded px-2 py-1 text-sm font-semibold capitalize text-ink hover:bg-paper" aria-label={command}>{command[0].toUpperCase()}</button>
                    ))}
                  </div>
                </div>
                <div className="space-y-3">
                  {document.blocks.map((block, index) => (
                    <section
                      key={block.id}
                      draggable
                      onDragStart={() => setDraggedId(block.id)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => dropBefore(block.id)}
                      className="page-builder-block group grid grid-cols-[68px_1fr] overflow-hidden bg-card"
                    >
                      <div className="flex flex-col items-center gap-1 border-r border-hairline px-2 py-3">
                        <span className="text-[10px] font-medium uppercase tracking-wide text-secondary">{index + 1}</span>
                        <span className="cursor-grab text-[10px] text-secondary" aria-hidden="true">Drag</span>
                        <div className="mt-auto flex gap-1">
                          <button type="button" onClick={() => moveBlock(block.id, -1)} disabled={index === 0} aria-label={`Move ${BLOCK_LABELS[block.type]} up`} className="text-xs text-secondary disabled:opacity-30">Up</button>
                          <button type="button" onClick={() => moveBlock(block.id, 1)} disabled={index === document.blocks.length - 1} aria-label={`Move ${BLOCK_LABELS[block.type]} down`} className="text-xs text-secondary disabled:opacity-30">Down</button>
                        </div>
                      </div>
                      <div className="min-w-0 p-4 sm:p-5">
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <span className="text-[10px] font-medium uppercase tracking-wide text-secondary">{BLOCK_LABELS[block.type]}</span>
                          <button type="button" onClick={() => setDocument((current) => ({ ...current, blocks: current.blocks.filter((item) => item.id !== block.id) }))} className="text-xs text-red-700 hover:underline">Remove</button>
                        </div>
                        {block.type === 'divider' && <hr className="my-5 border-hairline" />}
                        {block.type === 'heading' && <Editable value={block.content} onChange={(content) => updateBlock(block.id, { content })} label="Heading text" className="font-display text-3xl" />}
                        {block.type === 'text' && <Editable value={block.content} onChange={(content) => updateBlock(block.id, { content })} label="Body text" className="leading-relaxed" />}
                        {block.type === 'callout' && <Editable value={block.content} onChange={(content) => updateBlock(block.id, { content })} label="Callout text" className="rounded-md bg-moss/10 p-4 leading-relaxed" />}
                        {block.type === 'columns' && <div className="grid gap-4 sm:grid-cols-2"><Editable value={block.content} onChange={(content) => updateBlock(block.id, { content })} label="First column" className="leading-relaxed" /><Editable value={block.secondaryContent} onChange={(secondaryContent) => updateBlock(block.id, { secondaryContent })} label="Second column" className="leading-relaxed" /></div>}
                      </div>
                    </section>
                  ))}
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  )
}
