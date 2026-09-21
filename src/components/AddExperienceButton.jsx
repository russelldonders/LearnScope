import { useState } from 'react'
import { EXPERIENCE_TYPES } from '../lib/experienceTypes'
import { useLanguage } from '../context/LanguageContext'

export default function AddExperienceButton({
  types,
  onSelect,
  label,
  leadingOptions = [],
}) {
  const { t } = useLanguage()
  const resolvedLabel = label ?? t('modals.addExperienceButton.defaultLabel')
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
        {resolvedLabel}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 w-56 bg-card border border-hairline rounded-md shadow-lg z-50 overflow-hidden">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  if (option.isLeading) option.onSelect()
                  else onSelect(option.value)
                  setOpen(false)
                }}
                className={`w-full text-left px-4 py-2.5 text-sm text-ink hover:bg-paper transition-colors ${
                  option.isLeading && experienceOptions.length > 0 ? 'border-b border-hairline' : ''
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
