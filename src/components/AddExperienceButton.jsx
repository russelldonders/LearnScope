import { useState } from 'react'
import { EXPERIENCE_TYPES } from '../lib/experienceTypes'

export default function AddExperienceButton({ types, onSelect, label = '+ Add Experience' }) {
  const [open, setOpen] = useState(false)
  const options = EXPERIENCE_TYPES.filter((t) => types.includes(t.value))

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
                  onSelect(t.value)
                  setOpen(false)
                }}
                className="w-full text-left px-4 py-2.5 text-sm text-ink hover:bg-paper transition-colors"
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
