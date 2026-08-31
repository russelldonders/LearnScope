import { useState } from 'react'
import { EXPERIENCE_TYPES } from '../lib/experienceTypes'

export default function AddExperienceButton({
  types,
  onSelect,
  label = '+ Add Experience',
  leadingOptions = [],
}) {
  const [open, setOpen] = useState(false)
  // Preserve the caller's ordering (e.g. Subject before Project for
  // education) rather than EXPERIENCE_TYPES' own fixed order.
  const experienceOptions = types
    .map((value) => EXPERIENCE_TYPES.find((type) => type.value === value))
    .filter(Boolean)
  const options = [
    ...leadingOptions.map((option) => ({ ...option, isLeading: true })),
    ...experienceOptions,
  ]

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-md bg-moss text-paper py-2 px-4 font-medium hover:opacity-90"
      >
        {label}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 w-56 bg-card border border-hairline rounded-md shadow-lg z-50 overflow-hidden">
            {options.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => {
                  if (t.isLeading) t.onSelect()
                  else onSelect(t.value)
                  setOpen(false)
                }}
                className={`w-full text-left px-4 py-2.5 text-sm text-ink hover:bg-paper transition-colors ${
                  t.isLeading && experienceOptions.length > 0 ? 'border-b border-hairline' : ''
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
