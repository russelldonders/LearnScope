import { useEffect, useMemo, useRef, useState } from 'react'
import ScormPlayer from '../../components/ScormPlayer'
import XapiPlayer from '../../components/XapiPlayer'
import Cmi5Player from '../../components/Cmi5Player'
import LtiPlayer from '../../components/LtiPlayer'
import EditedVideoPlayer from '../../components/EditedVideoPlayer'
import ConfirmDialog from '../../components/ConfirmDialog'
import AccessibleDialog from '../../components/AccessibleDialog'
import ScreenRecorderModal from '../../components/ScreenRecorderModal'
import PageBuilderModal from '../../components/PageBuilderModal'
import PageContent from '../../components/PageContent'
import { DragHandle } from '../../components/DragHandle'
import { sideOf, findDropTarget } from '../../lib/dragReorder'
import { listCourseSections, createCourseSection, updateCourseSection, deleteCourseSection, reorderCourseSections, listCourseResources, listOrganisationResources, linkResourceToCourse, unlinkResourceFromCourse, reorderContentLinks, uploadVideoResource, uploadScreenRecordingResource, uploadFileResource, uploadScormResource, uploadXapiResource, uploadCmi5Resource, addWebResource, addExternalVideoResource, contentFileUrl, listLtiTools, createLtiResource } from '../../lib/courseContent'
import { useIsDesktop } from '../../lib/device'
import { RESOURCE_TYPE_LABELS } from '../../lib/statusLabels'
import Chevron from '../../components/Chevron'

// `side` picks the insertion point relative to a target: 'before' the
// target's midpoint or 'after' it. Reordering always removes the dragged
// item first, so an insertion index computed against the *original* list
// has to shift left by one once the removal point is above it.
export function reorderById(list, draggedId, targetId, idKey, side = 'before') {
  if (!targetId || targetId === draggedId) return list
  const fromIndex = list.findIndex((item) => item[idKey] === draggedId)
  const targetIndex = list.findIndex((item) => item[idKey] === targetId)
  if (fromIndex < 0 || targetIndex < 0) return list
  let toIndex = side === 'after' ? targetIndex + 1 : targetIndex
  if (fromIndex < toIndex) toIndex -= 1
  if (fromIndex === toIndex) return list
  const reordered = [...list]
  const [dragged] = reordered.splice(fromIndex, 1)
  reordered.splice(toIndex, 0, dragged)
  return reordered
}

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
  const [sections, setSections] = useState([])
  const [items, setItems] = useState([])
  const [orgResources, setOrgResources] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
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
  // All sections start open so the full course structure is visible as soon
  // as the editor loads. Each section can still be collapsed independently. Below
  // md, an open item goes further into "focus mode": everything else in
  // the outline hides so only that item's row and its preview are visible.
  const [openSectionIds, setOpenSectionIds] = useState(() => new Set())
  function openSection(id) {
    setOpenSectionIds((current) => new Set(current).add(id))
  }
  function toggleSection(id) {
    setOpenSectionIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const [draggedSectionId, setDraggedSectionId] = useState(null)
  const [sectionDropTarget, setSectionDropTarget] = useState(null)
  const [draggedOutlineItem, setDraggedOutlineItem] = useState(null)
  const [outlineItemDropTarget, setOutlineItemDropTarget] = useState(null)
  // One shared lock prevents overlapping section/resource order writes.
  const [reordering, setReordering] = useState(false)
  // Registries of rendered row nodes, used to resolve a touch drag's drop
  // target by comparing the touch point against each row's own
  // getBoundingClientRect (see findDropTarget) instead of
  // document.elementFromPoint, which was unreliable here.
  const sectionNodeRefs = useRef(new Map())
  const outlineItemNodeRefs = useRef(new Map())
  function registerSectionNode(id) {
    return (node) => {
      if (node) sectionNodeRefs.current.set(id, node)
      else sectionNodeRefs.current.delete(id)
    }
  }
  function registerOutlineItemNode(id) {
    return (node) => {
      if (node) outlineItemNodeRefs.current.set(id, node)
      else outlineItemNodeRefs.current.delete(id)
    }
  }
  // Items are the finer-grained target -- prefer a hit on a specific item
  // row over the coarser section row it sits inside.
  function findOutlineDropTarget(clientX, clientY) {
    const item = findDropTarget(outlineItemNodeRefs.current, clientX, clientY)
    if (item) return { type: 'item', ...item }
    const section = findDropTarget(sectionNodeRefs.current, clientX, clientY)
    if (section) return { type: 'section', ...section }
    return null
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the listed values change; the loaders are recreated every render
  }, [courseId])

  useEffect(() => {
    if (!previewingItem) return
    document.getElementById(`outline-item-${previewingItem.linkId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [previewingItem])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [sectionRows, itemRows, resourceRows] = await Promise.all([
        listCourseSections(courseId),
        listCourseResources(courseId),
        listOrganisationResources(organisationId),
      ])
      setSections(sectionRows)
      setItems(itemRows)
      setOrgResources(resourceRows)
      setOpenSectionIds(
        new Set([
          ...sectionRows.map((section) => section.id),
          ...(itemRows.some((item) => item.sectionId == null) ? ['ungrouped'] : []),
        ])
      )
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const itemsBySection = useMemo(() => {
    const map = new Map()
    for (const item of items) {
      const list = map.get(item.sectionId) ?? []
      list.push(item)
      map.set(item.sectionId, list)
    }
    for (const list of map.values()) list.sort((a, b) => a.position - b.position)
    return map
  }, [items])

  const linkedResourceIds = useMemo(() => new Set(items.map((i) => i.id)), [items])
  // Content whose section was deleted (course_content_links.section_id "on
  // delete set null", 0078) stays attached to the course but ungrouped --
  // still shown here (reorderable, detachable) so a provider doesn't lose
  // the ability to manage it just because its section is gone, matching
  // what CourseLearn's own "Other" bucket already shows a learner.
  const ungroupedItems = itemsBySection.get(null) ?? []

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

  async function commitSectionOrder(draggedId, targetId, side = 'before') {
    const reordered = reorderById(sections, draggedId, targetId, 'id', side)
    if (reordered === sections) return
    const previous = sections
    setSections(reordered.map((section, position) => ({ ...section, position })))
    setReordering(true)
    setError(null)
    try {
      await reorderCourseSections(reordered)
      await load()
    } catch (err) {
      setSections(previous)
      setError(`Couldn't reorder sections. ${err.message}`)
    } finally {
      setReordering(false)
      setDraggedSectionId(null)
      setSectionDropTarget(null)
    }
  }

  function handleSectionKeyDown(event, sectionId) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    const index = sections.findIndex((section) => section.id === sectionId)
    const target = sections[index + (event.key === 'ArrowUp' ? -1 : 1)]
    if (target) commitSectionOrder(sectionId, target.id)
  }

  async function commitOutlineItemOrder(draggedId, targetSectionId, targetLinkId = null, side = 'before') {
    const dragged = items.find((item) => item.linkId === draggedId)
    if (!dragged) return
    const sourceSectionId = dragged.sectionId
    const sourceItems = (itemsBySection.get(sourceSectionId) ?? []).filter((item) => item.linkId !== draggedId)
    const destinationItems = itemsBySection.get(targetSectionId) ?? []

    let orderedDestination
    if (sourceSectionId === targetSectionId && targetLinkId) {
      orderedDestination = reorderById(destinationItems, draggedId, targetLinkId, 'linkId', side)
    } else {
      const withoutDragged = destinationItems.filter((item) => item.linkId !== draggedId)
      let targetIndex = targetLinkId
        ? withoutDragged.findIndex((item) => item.linkId === targetLinkId)
        : withoutDragged.length
      if (targetIndex < 0) targetIndex = withoutDragged.length
      else if (side === 'after') targetIndex += 1
      orderedDestination = [...withoutDragged]
      orderedDestination.splice(targetIndex, 0, dragged)
    }

    if (orderedDestination === destinationItems) return

    const normalizedDestination = orderedDestination.map((item, position) => ({ ...item, sectionId: targetSectionId, position }))
    const normalizedSource = sourceSectionId === targetSectionId
      ? []
      : sourceItems.map((item, position) => ({ ...item, position }))
    const previous = items
    const affectedIds = new Set([...normalizedSource, ...normalizedDestination].map((item) => item.linkId))
    setItems([
      ...items.filter((item) => !affectedIds.has(item.linkId)),
      ...normalizedSource,
      ...normalizedDestination,
    ])
    setReordering(true)
    setError(null)
    try {
      // reorderContentLinks only writes a row when its stored position/
      // section differs from the target it's given -- it needs each item's
      // *current* (pre-move) position/sectionId to compare against, not the
      // already-target-normalized versions above (which was comparing the
      // target against itself, always "unchanged", so the drop never
      // actually persisted; this is why sections reordered fine and items
      // never did -- commitSectionOrder already passes reorderCourseSections
      // the un-normalized array for the same reason).
      await reorderContentLinks(orderedDestination, targetSectionId)
      if (sourceSectionId !== targetSectionId) await reorderContentLinks(sourceItems, sourceSectionId)
      await load()
    } catch (err) {
      setItems(previous)
      await load()
      setError(`Couldn't move the resource. ${err.message}`)
    } finally {
      setReordering(false)
      setDraggedOutlineItem(null)
      setOutlineItemDropTarget(null)
      setSectionDropTarget(null)
    }
  }

  function handleOutlineItemKeyDown(event, item) {
    const sectionItems = itemsBySection.get(item.sectionId) ?? []
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      const index = sectionItems.findIndex((candidate) => candidate.linkId === item.linkId)
      const target = sectionItems[index + (event.key === 'ArrowUp' ? -1 : 1)]
      if (target) commitOutlineItemOrder(item.linkId, item.sectionId, target.linkId)
      return
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const sectionIndex = sections.findIndex((section) => section.id === item.sectionId)
    const targetSection = sections[sectionIndex + (event.key === 'ArrowLeft' ? -1 : 1)]
    if (targetSection) commitOutlineItemOrder(item.linkId, targetSection.id)
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

function AddSectionModal({ value, onChange, busy, onSubmit, onClose }) {
  return (
    <AccessibleDialog
      labelledBy="add-section-dialog-title"
      onClose={onClose}
      panelClassName="w-full max-w-sm bg-card border border-hairline rounded-lg p-6"
    >
      <h2 id="add-section-dialog-title" className="font-display text-xl text-ink mb-4">
        Add section
      </h2>
      <form onSubmit={onSubmit}>
        <label className="block text-xs text-secondary mb-1" htmlFor="newSectionTitle">
          Section title
        </label>
        <input
          id="newSectionTitle"
          data-dialog-initial-focus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. Getting started"
          className="w-full rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
        />
        <div className="flex items-center gap-2 mt-4">
          <button
            type="submit"
            disabled={busy || !value.trim()}
            className="flex-1 rounded-md bg-moss text-paper py-2 text-sm font-medium hover:opacity-90 disabled:opacity-60"
          >
            {busy ? 'Adding…' : 'Add section'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-hairline text-ink py-2 px-3 text-sm font-medium hover:bg-paper"
          >
            Cancel
          </button>
        </div>
      </form>
    </AccessibleDialog>
  )
}

function InlineSectionEditor({ section, onChanged, onClose }) {
  const [titleDraft, setTitleDraft] = useState(section.title)
  const [instructionsDraft, setInstructionsDraft] = useState(section.instructions ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  async function handleSave(e) {
    e.preventDefault()
    if (!titleDraft.trim()) return
    setBusy(true)
    setError(null)
    try {
      await updateCourseSection(section.id, { title: titleDraft, instructions: instructionsDraft })
      await onChanged()
      onClose()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  async function handleDeleteSection() {
    setBusy(true)
    setError(null)
    try {
      await deleteCourseSection(section.id)
      await onChanged()
      onClose()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <>
      <div className="ml-9 mt-1 mb-3 max-w-2xl rounded-lg border border-hairline bg-card p-4">
        {error && <p className="text-sm text-red-700 mb-3">{error}</p>}
        <form onSubmit={handleSave}>
          <label className="block text-xs text-secondary mb-1" htmlFor={`section-title-${section.id}`}>
            Section title
          </label>
          <input
            id={`section-title-${section.id}`}
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            className="w-full rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
          />
          <label className="block text-xs text-secondary mt-3 mb-1" htmlFor={`section-instructions-${section.id}`}>
            Instructions for learners
          </label>
          <textarea
            id={`section-instructions-${section.id}`}
            value={instructionsDraft}
            onChange={(e) => setInstructionsDraft(e.target.value)}
            rows={4}
            placeholder="Explain what learners should do or know before starting this section."
            className="w-full resize-y rounded-md border border-hairline bg-paper px-3 py-2 text-sm leading-relaxed text-ink placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-moss"
          />
          <div className="flex items-center gap-2 mt-4">
            <button
              type="submit"
              disabled={busy || !titleDraft.trim()}
              className="flex-1 rounded-md bg-moss text-paper py-2 text-sm font-medium hover:opacity-90 disabled:opacity-60"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-md border border-hairline text-ink py-2 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              disabled={busy}
              className="rounded-md border border-hairline text-red-700 py-2 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
            >
              Delete
            </button>
          </div>
        </form>
      </div>
      {confirmingDelete && (
        <ConfirmDialog
          message={`Delete the "${section.title}" section? Its content stays attached to the course, just ungrouped.`}
          confirmLabel="Delete section"
          confirming={busy}
          onConfirm={handleDeleteSection}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </>
  )
}

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
function AddResourceModal({ section, courseId, organisationId, userId, availableResources, onChanged, onClose }) {
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

// Preview/download + detach, shown inline on the right the same way
// CourseLearn.jsx shows a learner the content they've selected from its own
// left-hand nav -- a popup here would be a different experience for the
// provider curating content than for the learner consuming it.
// Player/download/detach -- shared by the md+ side pane (ItemPreviewPane,
// which wraps this with a card + type label + title) and the below-md
// inline accordion in the outline (which already shows the title as the
// row it's expanding under, so it renders this directly without repeating
// it).
function ItemPreviewBody({ item, userId, canEdit, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function handleDetach() {
    setBusy(true)
    setError(null)
    try {
      await unlinkResourceFromCourse(item.linkId)
      onChanged()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <>
      {error && <p className="text-sm text-red-700 mb-3">{error}</p>}

      {(item.type === 'video' || item.type === 'screen_recording') && (
        <EditedVideoPlayer key={item.id} resource={item} className="w-full rounded-md bg-black" />
      )}

      {item.type === 'file' && (
        <a
          href={contentFileUrl(item)}
          download={item.file_name || true}
          className="flex items-center gap-3 rounded-md border border-hairline bg-paper px-3 py-2.5"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-secondary shrink-0">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <span className="text-sm text-ink flex-1 truncate">{item.file_name}</span>
          <span className="font-mono text-[10px] uppercase tracking-wide text-moss shrink-0">Download</span>
        </a>
      )}

      {item.type === 'scorm' && <ScormPlayer key={item.id} contentItem={item} userId={userId} />}

      {item.type === 'xapi' && <XapiPlayer key={item.id} contentItem={item} userId={userId} />}

      {item.type === 'cmi5' && <Cmi5Player key={item.id} contentItem={item} userId={userId} />}

      {item.type === 'lti' && <LtiPlayer key={item.id} contentItem={item} userId={userId} />}

      {item.type === 'external_video' && (
        <iframe
          key={item.id}
          src={item.external_url}
          title={item.title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="w-full aspect-video rounded-md"
        />
      )}

      {item.type === 'web_url' && (
        <a
          href={item.external_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between gap-3 rounded-md border border-hairline bg-paper px-4 py-3 text-sm text-ink hover:border-moss"
        >
          <span className="min-w-0 truncate">{item.external_url}</span>
          <span className="font-medium text-moss shrink-0">Open link ↗</span>
        </a>
      )}

      {item.type === 'page' && <PageContent document={item.page_content} compact />}

      {canEdit && (
        <div className="flex items-center gap-2 mt-4 pt-4 border-t border-hairline">
          <button
            type="button"
            onClick={handleDetach}
            disabled={busy}
            className="rounded-md border border-hairline text-red-700 py-2 px-4 text-sm font-medium hover:bg-paper disabled:opacity-60"
          >
            {busy ? 'Removing…' : 'Detach from course'}
          </button>
        </div>
      )}
    </>
  )
}

// md+ only -- see the outline's own inline accordion (rendered per-item,
// gated by useIsDesktop) for the below-md equivalent.
function ItemPreviewPane({ item, userId, canEdit, onChanged }) {
  if (!item) {
    return (
      <div className="bg-card border border-hairline rounded-lg p-6">
        <p className="text-sm text-secondary">Select an item from the outline to preview it here.</p>
      </div>
    )
  }

  return (
    <div className="bg-card border border-hairline rounded-lg p-6">
      <span className="font-mono text-[10px] uppercase tracking-wide text-secondary mb-1 block">
        {RESOURCE_TYPE_LABELS[item.type]}
      </span>
      <h3 className="font-display text-xl text-ink mb-4">{item.title}</h3>
      <ItemPreviewBody item={item} userId={userId} canEdit={canEdit} onChanged={onChanged} />
    </div>
  )
}
