// Standard WAI-ARIA APG "automatic activation" keyboard behavior, shared by
// every button-based tab-like switcher in the admin/provider/employer
// consoles (org/employer switchers, section switchers, catalogue detail
// tabs). These are still local-state button groups, not real routes (a
// later slice converts org/section selection into URL state) -- this only
// layers standard tablist keyboard semantics on top of the existing
// click-to-switch behaviour, it doesn't change what "active" means.
//
// Left/Right (Up/Down for a vertical layout) moves focus AND activates the
// newly-focused tab together; Home/End jump to the first/last tab. `refs`
// is a ref to a { [key]: HTMLElement } map so the newly active tab actually
// receives DOM focus -- a roving tabIndex alone only affects where Tab-key
// navigation lands, not where focus moves after an arrow key.
export function handleTabListKeyDown(event, { keys, activeKey, refs, onChange, orientation = 'horizontal' }) {
  const nextKey = orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown'
  const prevKey = orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp'
  const currentIndex = Math.max(0, keys.indexOf(activeKey))

  let targetIndex = null
  if (event.key === nextKey) targetIndex = (currentIndex + 1) % keys.length
  else if (event.key === prevKey) targetIndex = (currentIndex - 1 + keys.length) % keys.length
  else if (event.key === 'Home') targetIndex = 0
  else if (event.key === 'End') targetIndex = keys.length - 1
  else return

  event.preventDefault()
  const targetKey = keys[targetIndex]
  onChange(targetKey)
  refs.current?.[targetKey]?.focus()
}
