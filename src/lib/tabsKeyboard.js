// Standard WAI-ARIA APG "automatic activation" keyboard behavior, shared by
// every tab-like switcher in the admin/provider/employer consoles (org/
// employer switchers, section switchers, catalogue detail tabs). These
// render as real `Link`s carrying ?org=/?section=/?tab= query params, not
// plain buttons -- this only layers standard tablist keyboard semantics on
// top of that click-to-navigate behaviour via `onChange`, it doesn't change
// what "active" means or how navigation actually happens (`onChange` is
// free to call `setSearchParams` instead of `setState`).
//
// Left/Right (Up/Down for a vertical layout) moves focus AND activates the
// newly-focused tab together; Home/End jump to the first/last tab. `refs`
// is a ref to a { [key]: HTMLElement } map so the newly active tab actually
// receives DOM focus -- a roving tabIndex alone only affects where Tab-key
// navigation lands, not where focus moves after an arrow key. Works the
// same whether the underlying element is a <button> or a <Link>/<a> -- refs
// just need to resolve to the rendered DOM node either way.
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
