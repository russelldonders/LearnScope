// Shared by every drag-to-reorder list in the app (ProviderCourseEditor's
// content outline, PageBuilderModal's block canvas) so touch behaviour
// stays identical everywhere rather than each screen reinventing its own
// slightly-different version.

export function sideOf(element, clientY) {
  const rect = element.getBoundingClientRect()
  return clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

// Touch dragging previously resolved its drop target with
// document.elementFromPoint, which on iOS Safari was unreliable for
// densely-packed rows specifically (it kept resolving back to something
// that didn't match any tracked row, so the drop-target state never
// updated and nothing committed on release). Comparing the touch point
// against each candidate row's own getBoundingClientRect from a ref
// registry sidesteps elementFromPoint's hit-testing entirely -- the same
// approach real drag-and-drop libraries use. Falls back to the row whose
// vertical center is nearest the touch point if it isn't exactly inside
// any row's box (e.g. a fast drag between rows, or the gap between them).
export function findDropTarget(refsMap, clientX, clientY) {
  let nearest = null
  let nearestDistance = Infinity
  for (const [id, node] of refsMap) {
    if (!node || !node.isConnected) continue
    const rect = node.getBoundingClientRect()
    if (clientX < rect.left || clientX > rect.right) continue
    if (clientY >= rect.top && clientY <= rect.bottom) {
      return { id, side: clientY < rect.top + rect.height / 2 ? 'before' : 'after' }
    }
    const center = rect.top + rect.height / 2
    const distance = Math.abs(clientY - center)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearest = { id, side: clientY < center ? 'before' : 'after' }
    }
  }
  return nearest
}

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
