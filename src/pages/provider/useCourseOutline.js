import { useEffect, useMemo, useRef, useState } from 'react'
import { findDropTarget, reorderById } from '../../lib/dragReorder'
import { listCourseSections, listCourseResources, listOrganisationResources, reorderCourseSections, reorderContentLinks } from '../../lib/courseContent'

// The course outline (see CourseSections.jsx): its sections and content,
// which sections are open, and dragging or arrow-keying rows into a new
// order. Dialog and preview state stays in the page.
export function useCourseOutline(courseId, organisationId) {
  const [sections, setSections] = useState([])
  const [items, setItems] = useState([])
  const [orgResources, setOrgResources] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
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
    if (target) commitSectionOrder(sectionId, target.id, event.key === 'ArrowUp' ? 'before' : 'after')
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
      if (target) commitOutlineItemOrder(item.linkId, item.sectionId, target.linkId, event.key === 'ArrowUp' ? 'before' : 'after')
      return
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const sectionIndex = sections.findIndex((section) => section.id === item.sectionId)
    const targetSection = sections[sectionIndex + (event.key === 'ArrowLeft' ? -1 : 1)]
    if (targetSection) commitOutlineItemOrder(item.linkId, targetSection.id)
  }

  return {
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
  }
}
