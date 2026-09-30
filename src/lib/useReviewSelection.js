import { useState } from 'react'

// Per-row include/exclude plus inline edits for an import review list (CV
// import, Strava activities): every row starts selected, and edits are kept
// by index alongside the selection. Different from useRowSelection, which
// starts empty and tracks ids for table bulk actions.
export function useReviewSelection(items) {
  const [selected, setSelected] = useState(() => new Set(items.map((_, i) => i)))
  const [values, setValues] = useState(items)

  function toggle(i) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  function updateField(i, field, value) {
    setValues((prev) => prev.map((item, idx) => (idx === i ? { ...item, [field]: value } : item)))
  }

  return { selected, values, toggle, updateField }
}
