import { useEffect, useState } from 'react'
import { DragHandle } from '../../components/DragHandle'
import { sideOf } from '../../lib/dragReorder'
import { createCourseSection } from '../../lib/courseContent'
import { useIsDesktop } from '../../lib/device'
import { RESOURCE_TYPE_LABELS } from '../../lib/statusLabels'
import Chevron from '../../components/Chevron'
import { AddSectionModal, InlineSectionEditor } from './CourseSectionEditors'
import { AddResourceModal } from './AddResourceModal'
import { ItemPreviewBody, ItemPreviewPane } from './CourseItemPreview'
import { useCourseOutline } from './useCourseOutline'

// A thin insertion-point indicator instead of a box around the whole
// target row, so a reorder-in-progress shows exactly whether the dragged
// item will land above or below the row it's hovering.
function DropLine({ side }) {
  if (!side) return null
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-x-1 h-0.5 rounded-full bg-moss ${side === 'before' ? '-top-px' : '-bottom-px'}`}
    />
  )
}

export function CourseSections({ courseId, organisationId, userId, canEdit }) {
  const {
    sections,
    items,
    orgResources,
    loading,
    error,
    setError,
    load,
    openSectionIds,
    openSection,
    toggleSection,
    draggedSectionId,
    setDraggedSectionId,
    sectionDropTarget,
    setSectionDropTarget,
    draggedOutlineItem,
    setDraggedOutlineItem,
    outlineItemDropTarget,
    setOutlineItemDropTarget,
    reordering,
    registerSectionNode,
    registerOutlineItemNode,
    findOutlineDropTarget,
    itemsBySection,
    linkedResourceIds,
    ungroupedItems,
    commitSectionOrder,
    commitOutlineItemOrder,
    handleSectionKeyDown,
    handleOutlineItemKeyDown,
  } = useCourseOutline(courseId, organisationId)
  const [newSectionTitle, setNewSectionTitle] = useState('')
  const [creatingSection, setCreatingSection] = useState(false)
  const [addingSection, setAddingSection] = useState(false)
  const [editingSection, setEditingSection] = useState(null)
  const [addingResourceToSection, setAddingResourceToSection] = useState(null)
  const [previewingItem, setPreviewingItem] = useState(null)
  const isDesktop = useIsDesktop()
  function toggleItemPreview(item) {
    setPreviewingItem((current) => {
      if (current?.linkId === item.linkId) return null
      openSection(item.sectionId ?? 'ungrouped')
      return item
    })
  }

  useEffect(() => {
    if (!previewingItem) return
    document.getElementById(`outline-item-${previewingItem.linkId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [previewingItem])

  async function handleAddSection(e) {
    e.preventDefault()
    if (!newSectionTitle.trim()) return
    setCreatingSection(true)
    setError(null)
    try {
      await createCourseSection(courseId, newSectionTitle)
      setNewSectionTitle('')
      setAddingSection(false)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setCreatingSection(false)
    }
  }

  if (loading) return <p className="text-secondary">Loading content…</p>

  const availableResources = orgResources.filter((r) => !linkedResourceIds.has(r.id))
  const isFocused = !isDesktop && previewingItem !== null
  const focusedSectionId = previewingItem ? (previewingItem.sectionId ?? 'ungrouped') : null

  return (
    <div className="space-y-4">
      <h3 className="font-display text-lg text-ink">Sections</h3>

      {error && <p className="text-sm text-red-700">{error}</p>}

      <div className="grid md:grid-cols-[280px_minmax(0,1fr)] gap-6 items-start">
      <nav aria-label="Course content outline" className="md:sticky md:top-6">
        {!isFocused && (
        <div className="flex items-center justify-between gap-2 px-2.5 mb-2">
          <p className="font-mono text-[10px] uppercase tracking-wide text-secondary">Course outline</p>
          {canEdit && (
            <button
              type="button"
              onClick={() => setAddingSection(true)}
              className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-moss hover:opacity-80"
            >
              + Add section
            </button>
          )}
        </div>
        )}

        {sections.length === 0 && ungroupedItems.length === 0 ? (
            <div className="text-center py-8 px-3 border border-dashed border-hairline rounded-lg">
              <p className="text-xs text-secondary">
                {canEdit ? 'No sections yet — use "+ Add section" above to start structuring this course.' : 'No content added yet.'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {sections.map((section) => {
                const sectionItems = itemsBySection.get(section.id) ?? []
                if (isFocused && section.id !== focusedSectionId) return null
                return (
                  <div
                    key={section.id}
                    ref={registerSectionNode(section.id)}
                    data-outline-section-id={section.id}
                    onDragOver={(event) => {
                      if (!canEdit || (!draggedSectionId && !draggedOutlineItem) || draggedSectionId === section.id) return
                      event.preventDefault()
                      setSectionDropTarget({
                        id: section.id,
                        side: draggedSectionId ? sideOf(event.currentTarget, event.clientY) : null,
                      })
                      // Dragging an item over a collapsed section: open it so
                      // its items are visible/droppable at a specific
                      // position, not just appendable to the end.
                      if (draggedOutlineItem) openSection(section.id)
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      if (draggedOutlineItem) commitOutlineItemOrder(draggedOutlineItem.linkId, section.id)
                      else if (draggedSectionId) commitSectionOrder(draggedSectionId, section.id, sideOf(event.currentTarget, event.clientY))
                    }}
                    className={`relative rounded-md transition-[background-color,box-shadow,opacity] ${
                      sectionDropTarget?.id === section.id && !sectionDropTarget.side ? 'bg-moss/10 ring-2 ring-moss ring-inset' : ''
                    } ${draggedSectionId === section.id ? 'opacity-40' : ''}`}
                  >
                    {sectionDropTarget?.id === section.id && <DropLine side={sectionDropTarget.side} />}
                    {!isFocused && (
                    <div className="flex items-center gap-1">
                      {canEdit && (
                        <DragHandle
                          label={`Reorder ${section.title}`}
                          dragLabel={section.title}
                          disabled={reordering}
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = 'move'
                            event.dataTransfer.setData('text/plain', section.id)
                            setDraggedSectionId(section.id)
                          }}
                          onDragEnd={() => {
                            setDraggedSectionId(null)
                            setSectionDropTarget(null)
                          }}
                          onKeyDown={(event) => handleSectionKeyDown(event, section.id)}
                          onPointerDragStart={() => {
                            setDraggedSectionId(section.id)
                            setDraggedOutlineItem(null)
                          }}
                          onPointerDragMove={(event) => {
                            const hit = findOutlineDropTarget(event.clientX, event.clientY)
                            if (hit?.type === 'section' && hit.id !== section.id) {
                              setSectionDropTarget({ id: hit.id, side: hit.side })
                            }
                          }}
                          onPointerDragEnd={(event) => {
                            // Recompute fresh rather than trusting the
                            // sectionDropTarget state written by the last
                            // touchmove: a fast flick can fire touchend before
                            // React has re-rendered from that state update, so
                            // reading state here could read one step behind.
                            // findOutlineDropTarget is a plain synchronous
                            // getBoundingClientRect lookup, not React state, so
                            // it's always exactly current.
                            const hit = findOutlineDropTarget(event.clientX, event.clientY)
                            if (hit?.type === 'section' && hit.id !== section.id) {
                              commitSectionOrder(section.id, hit.id, hit.side ?? 'before')
                            } else {
                              setDraggedSectionId(null)
                              setSectionDropTarget(null)
                            }
                          }}
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => toggleSection(section.id)}
                        aria-expanded={openSectionIds.has(section.id)}
                        aria-label={`${openSectionIds.has(section.id) ? 'Collapse' : 'Expand'} ${section.title}`}
                        className="inline-flex h-11 w-11 md:h-7 md:w-7 shrink-0 items-center justify-center rounded-md text-secondary hover:bg-paper hover:text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                      >
                        <Chevron open={openSectionIds.has(section.id)} />
                      </button>
                      <button
                        type="button"
                        onClick={() => (canEdit ? setEditingSection(section) : toggleSection(section.id))}
                        aria-expanded={editingSection?.id === section.id}
                        className="min-w-0 flex-1 flex items-center gap-2 rounded-md border border-transparent px-2.5 py-2 text-left text-sm text-secondary transition-colors hover:bg-card hover:text-ink"
                      >
                        <span className="min-w-0 flex-1 truncate font-medium">{section.title}</span>
                        <span className="font-mono text-[10px] tabular-nums text-secondary shrink-0">{sectionItems.length}</span>
                      </button>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => setAddingResourceToSection(section)}
                          aria-label={`Add content to ${section.title}`}
                          title="Add content"
                          className="inline-flex h-11 w-11 md:h-7 md:w-7 shrink-0 items-center justify-center rounded-md text-secondary hover:bg-paper hover:text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                        >
                          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
                            <path d="M8 3v10M3 8h10" strokeLinecap="round" />
                          </svg>
                        </button>
                      )}
                    </div>
                    )}
                    {editingSection?.id === section.id && (
                      <InlineSectionEditor
                        section={section}
                        onChanged={load}
                        onClose={() => setEditingSection(null)}
                      />
                    )}
                    {editingSection?.id !== section.id && section.instructions && (
                      <p className="ml-9 max-w-2xl px-2.5 pb-2 text-xs leading-relaxed text-secondary whitespace-pre-wrap">
                        {section.instructions}
                      </p>
                    )}
                    {openSectionIds.has(section.id) && sectionItems.length > 0 && (
                      <ul className={`space-y-0.5 ${isFocused ? '' : 'mt-1 ml-7'}`} aria-label={`${section.title} resources`}>
                        {sectionItems
                          .filter((item) => !isFocused || item.linkId === previewingItem.linkId)
                          .map((item) => (
                          <li
                            key={item.linkId}
                            id={`outline-item-${item.linkId}`}
                            ref={registerOutlineItemNode(item.linkId)}
                            data-outline-item-id={item.linkId}
                            onDragOver={(event) => {
                              if (!canEdit || !draggedOutlineItem || draggedOutlineItem.linkId === item.linkId) return
                              event.preventDefault()
                              event.stopPropagation()
                              setOutlineItemDropTarget({ id: item.linkId, side: sideOf(event.currentTarget, event.clientY) })
                              setSectionDropTarget(null)
                            }}
                            onDrop={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              if (draggedOutlineItem) {
                                commitOutlineItemOrder(draggedOutlineItem.linkId, section.id, item.linkId, sideOf(event.currentTarget, event.clientY))
                              }
                            }}
                            className={`relative rounded py-0.5 pr-1 transition-[background-color,opacity] ${
                              draggedOutlineItem?.linkId === item.linkId ? 'opacity-40' : ''
                            }`}
                          >
                            {outlineItemDropTarget?.id === item.linkId && <DropLine side={outlineItemDropTarget.side} />}
                            <div className="flex min-w-0 items-center gap-1">
                              {canEdit && (
                                <DragHandle
                                  label={`Move ${item.title}`}
                                  dragLabel={item.title}
                                  disabled={reordering}
                                  onDragStart={(event) => {
                                    event.stopPropagation()
                                    event.dataTransfer.effectAllowed = 'move'
                                    event.dataTransfer.setData('text/plain', item.linkId)
                                    setDraggedOutlineItem(item)
                                    setDraggedSectionId(null)
                                  }}
                                  onDragEnd={() => {
                                    setDraggedOutlineItem(null)
                                    setOutlineItemDropTarget(null)
                                    setSectionDropTarget(null)
                                  }}
                                  onKeyDown={(event) => handleOutlineItemKeyDown(event, item)}
                                  onPointerDragStart={() => {
                                    setDraggedOutlineItem(item)
                                    setDraggedSectionId(null)
                                  }}
                                  onPointerDragMove={(event) => {
                                    const hit = findOutlineDropTarget(event.clientX, event.clientY)
                                    if (hit?.type === 'item' && hit.id !== item.linkId) {
                                      setOutlineItemDropTarget({ id: hit.id, side: hit.side })
                                      setSectionDropTarget(null)
                                    } else if (hit?.type === 'section') {
                                      setOutlineItemDropTarget(null)
                                      setSectionDropTarget({ id: hit.id, side: null })
                                      // Hovering a collapsed section while dragging: open
                                      // it so its items are visible/droppable at a
                                      // specific position, not just appendable to the end.
                                      openSection(hit.id)
                                    }
                                  }}
                                  onPointerDragEnd={(event) => {
                                    // Recompute fresh instead of trusting
                                    // outlineItemDropTarget/sectionDropTarget state: a
                                    // fast flick can fire touchend before React has
                                    // re-rendered from the last touchmove's setState,
                                    // so reading state here could read one step
                                    // behind. findOutlineDropTarget is a plain
                                    // synchronous rect lookup, always exactly current.
                                    const hit = findOutlineDropTarget(event.clientX, event.clientY)
                                    if (hit?.type === 'item' && hit.id !== item.linkId) {
                                      const targetItem = items.find((candidate) => candidate.linkId === hit.id)
                                      if (targetItem) {
                                        commitOutlineItemOrder(item.linkId, targetItem.sectionId, hit.id, hit.side)
                                      } else {
                                        setDraggedOutlineItem(null)
                                        setOutlineItemDropTarget(null)
                                        setSectionDropTarget(null)
                                      }
                                    } else if (hit?.type === 'section') {
                                      commitOutlineItemOrder(item.linkId, hit.id === 'ungrouped' ? null : hit.id)
                                    } else {
                                      setDraggedOutlineItem(null)
                                      setOutlineItemDropTarget(null)
                                      setSectionDropTarget(null)
                                    }
                                  }}
                                />
                              )}
                              <button
                                type="button"
                                onClick={() => toggleItemPreview(item)}
                                aria-expanded={!isDesktop && previewingItem?.linkId === item.linkId}
                                className="min-w-0 flex-1 flex items-center gap-1 text-left text-xs text-secondary hover:text-ink hover:underline"
                              >
                                <span className="min-w-0 flex-1 truncate">{item.title}</span>
                                <Chevron open={previewingItem?.linkId === item.linkId} className="md:hidden" />
                              </button>
                            </div>
                            {!isDesktop && previewingItem?.linkId === item.linkId && (
                              <div className="mt-1 mb-1 bg-card border border-hairline rounded-lg p-4">
                                <span className="font-mono text-[10px] uppercase tracking-wide text-secondary mb-1 block">
                                  {RESOURCE_TYPE_LABELS[item.type]}
                                </span>
                                <ItemPreviewBody
                                  item={item}
                                  userId={userId}
                                  organisationId={organisationId}
                                  canEdit={canEdit}
                                  onChanged={() => {
                                    load()
                                    setPreviewingItem(null)
                                  }}
                                />
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )
              })}
              {(canEdit || ungroupedItems.length > 0) && (!isFocused || focusedSectionId === 'ungrouped') && (
                <div
                  ref={registerSectionNode('ungrouped')}
                  data-outline-section-id="ungrouped"
                  onDragOver={(event) => {
                    if (!canEdit || !draggedOutlineItem) return
                    event.preventDefault()
                    setSectionDropTarget({ id: 'ungrouped', side: null })
                    openSection('ungrouped')
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    if (draggedOutlineItem) commitOutlineItemOrder(draggedOutlineItem.linkId, null)
                  }}
                  className={`relative rounded-md transition-[background-color,box-shadow] ${
                    sectionDropTarget?.id === 'ungrouped' && !sectionDropTarget.side ? 'bg-moss/10 ring-2 ring-moss ring-inset' : ''
                  }`}
                >
                  {!isFocused && (
                  <div className="flex items-center">
                    <button
                      type="button"
                      onClick={() => toggleSection('ungrouped')}
                      aria-expanded={openSectionIds.has('ungrouped')}
                      className="min-w-0 flex-1 flex items-center gap-2 px-2.5 py-2 text-left text-sm text-secondary hover:text-ink"
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">Ungrouped content</span>
                      <span className="font-mono text-[10px] tabular-nums text-secondary shrink-0">{ungroupedItems.length}</span>
                      <Chevron open={openSectionIds.has('ungrouped')} />
                    </button>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => setAddingResourceToSection({ id: null, title: 'Ungrouped content' })}
                        aria-label="Add content to Ungrouped content"
                        title="Add content"
                        className="inline-flex h-11 w-11 md:h-7 md:w-7 shrink-0 items-center justify-center rounded-md text-secondary hover:bg-paper hover:text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                      >
                        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
                          <path d="M8 3v10M3 8h10" strokeLinecap="round" />
                        </svg>
                      </button>
                    )}
                  </div>
                  )}
                  {openSectionIds.has('ungrouped') && (
                  <ul className={`space-y-0.5 ${isFocused ? '' : 'mt-1 ml-7'}`} aria-label="Ungrouped resources">
                    {ungroupedItems
                      .filter((item) => !isFocused || item.linkId === previewingItem.linkId)
                      .map((item) => (
                      <li
                        key={item.linkId}
                        id={`outline-item-${item.linkId}`}
                        ref={registerOutlineItemNode(item.linkId)}
                        data-outline-item-id={item.linkId}
                        onDragOver={(event) => {
                          if (!canEdit || !draggedOutlineItem || draggedOutlineItem.linkId === item.linkId) return
                          event.preventDefault()
                          event.stopPropagation()
                          setOutlineItemDropTarget({ id: item.linkId, side: sideOf(event.currentTarget, event.clientY) })
                          setSectionDropTarget(null)
                        }}
                        onDrop={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          if (draggedOutlineItem) {
                            commitOutlineItemOrder(draggedOutlineItem.linkId, null, item.linkId, sideOf(event.currentTarget, event.clientY))
                          }
                        }}
                        className={`relative rounded py-0.5 pr-1 transition-[background-color,opacity] ${
                          draggedOutlineItem?.linkId === item.linkId ? 'opacity-40' : ''
                        }`}
                      >
                        {outlineItemDropTarget?.id === item.linkId && <DropLine side={outlineItemDropTarget.side} />}
                        <div className="flex min-w-0 items-center gap-1">
                          {canEdit && (
                            <DragHandle
                              label={`Move ${item.title}`}
                              dragLabel={item.title}
                              disabled={reordering}
                              onDragStart={(event) => {
                                event.stopPropagation()
                                event.dataTransfer.effectAllowed = 'move'
                                event.dataTransfer.setData('text/plain', item.linkId)
                                setDraggedOutlineItem(item)
                                setDraggedSectionId(null)
                              }}
                              onDragEnd={() => {
                                setDraggedOutlineItem(null)
                                setOutlineItemDropTarget(null)
                                setSectionDropTarget(null)
                              }}
                              onKeyDown={(event) => handleOutlineItemKeyDown(event, item)}
                              onPointerDragStart={() => {
                                setDraggedOutlineItem(item)
                                setDraggedSectionId(null)
                              }}
                              onPointerDragMove={(event) => {
                                const hit = findOutlineDropTarget(event.clientX, event.clientY)
                                if (hit?.type === 'item' && hit.id !== item.linkId) {
                                  setOutlineItemDropTarget({ id: hit.id, side: hit.side })
                                  setSectionDropTarget(null)
                                } else if (hit?.type === 'section') {
                                  setOutlineItemDropTarget(null)
                                  setSectionDropTarget({ id: hit.id, side: null })
                                  openSection(hit.id)
                                }
                              }}
                              onPointerDragEnd={(event) => {
                                // See the grouped items' onPointerDragEnd above --
                                // recomputed fresh rather than trusted from state.
                                const hit = findOutlineDropTarget(event.clientX, event.clientY)
                                if (hit?.type === 'item' && hit.id !== item.linkId) {
                                  const targetItem = items.find((candidate) => candidate.linkId === hit.id)
                                  if (targetItem) {
                                    commitOutlineItemOrder(item.linkId, targetItem.sectionId, hit.id, hit.side)
                                  } else {
                                    setDraggedOutlineItem(null)
                                    setOutlineItemDropTarget(null)
                                    setSectionDropTarget(null)
                                  }
                                } else if (hit?.type === 'section') {
                                  commitOutlineItemOrder(item.linkId, hit.id === 'ungrouped' ? null : hit.id)
                                } else {
                                  setDraggedOutlineItem(null)
                                  setOutlineItemDropTarget(null)
                                  setSectionDropTarget(null)
                                }
                              }}
                            />
                          )}
                          <button
                            type="button"
                            onClick={() => toggleItemPreview(item)}
                            aria-expanded={!isDesktop && previewingItem?.linkId === item.linkId}
                            className="min-w-0 flex-1 flex items-center gap-1 text-left text-xs text-secondary hover:text-ink hover:underline"
                          >
                            <span className="min-w-0 flex-1 truncate">{item.title}</span>
                            <Chevron open={previewingItem?.linkId === item.linkId} className="md:hidden" />
                          </button>
                        </div>
                        {!isDesktop && previewingItem?.linkId === item.linkId && (
                          <div className="mt-1 mb-1 bg-card border border-hairline rounded-lg p-4">
                            <span className="font-mono text-[10px] uppercase tracking-wide text-secondary mb-1 block">
                              {RESOURCE_TYPE_LABELS[item.type]}
                            </span>
                            <ItemPreviewBody
                              item={item}
                              userId={userId}
                              organisationId={organisationId}
                              canEdit={canEdit}
                              onChanged={() => {
                                load()
                                setPreviewingItem(null)
                              }}
                            />
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                  )}
                </div>
              )}
            </div>
          )}
        </nav>

        {isDesktop && (
          <ItemPreviewPane
            item={previewingItem}
            userId={userId}
            organisationId={organisationId}
            canEdit={canEdit}
            onChanged={() => {
              load()
              setPreviewingItem(null)
            }}
          />
        )}
      </div>

      {addingSection && (
        <AddSectionModal
          value={newSectionTitle}
          onChange={setNewSectionTitle}
          busy={creatingSection}
          onSubmit={handleAddSection}
          onClose={() => {
            setAddingSection(false)
            setNewSectionTitle('')
          }}
        />
      )}

      {addingResourceToSection && (
        <AddResourceModal
          section={addingResourceToSection}
          courseId={courseId}
          organisationId={organisationId}
          userId={userId}
          availableResources={availableResources}
          onChanged={load}
          onClose={() => setAddingResourceToSection(null)}
        />
      )}
    </div>
  )
}
