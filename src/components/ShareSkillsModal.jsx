import { useMemo, useState } from 'react'
import AccessibleDialog from './AccessibleDialog'

// Purpose-built skill picker for the employer data-access sharing flow
// (Actions.jsx's Accept, ProfilePrivacy.jsx's Share/Edit shared skills) --
// matches SkillPickerModal's general interaction pattern (search-filterable
// checklist, multi-select, confirm/cancel) and ProfilePrivacy's own
// SearchableSkillsModal styling, but with no AI-suggestion logic -- not
// relevant to choosing which existing skills to share with an employer.
export default function ShareSkillsModal({
  skills,
  initiallySelectedIds = [],
  title = 'Choose skills to share',
  description = 'Pick which of your skills this employer can see. You can change this any time.',
  confirmLabel = 'Share',
  onConfirm,
  onClose,
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(() => new Set(initiallySelectedIds))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return skills
    return skills.filter((s) => s.name.toLowerCase().includes(q))
  }, [skills, query])

  function toggle(skillId) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(skillId)) next.delete(skillId)
      else next.add(skillId)
      return next
    })
  }

  function selectAll() {
    setSelected(new Set(skills.map((s) => s.id)))
  }

  function selectNone() {
    setSelected(new Set())
  }

  async function handleConfirm() {
    setError(null)
    setSaving(true)
    try {
      await onConfirm([...selected])
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <AccessibleDialog
      labelledBy="share-skills-dialog-title"
      onClose={saving ? undefined : onClose}
      closeOnBackdrop={!saving}
      panelClassName="w-full max-w-md bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
      <h2 id="share-skills-dialog-title" className="font-display text-2xl text-ink mb-1">
        {title}
      </h2>
      <p className="text-sm text-secondary mb-4">{description}</p>

      {skills.length === 0 ? (
        <p className="text-sm text-secondary py-2">You haven't added any skills yet.</p>
      ) : (
        <>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your skills…"
            className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
          />

          <div className="flex items-center gap-3 mt-3 mb-1">
            <button
              type="button"
              onClick={selectAll}
              disabled={saving}
              className="text-xs font-medium text-moss hover:underline disabled:opacity-60"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={selectNone}
              disabled={saving}
              className="text-xs font-medium text-moss hover:underline disabled:opacity-60"
            >
              Select none
            </button>
            <span className="text-xs text-secondary ml-auto">{selected.size} selected</span>
          </div>

          <div className="max-h-64 overflow-y-auto mt-2 mb-3 divide-y divide-hairline">
            {filtered.length === 0 && <p className="text-sm text-secondary py-2">No matches.</p>}
            {filtered.map((s) => (
              <label key={s.id} className="flex items-center gap-3 py-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.has(s.id)}
                  disabled={saving}
                  onChange={() => toggle(s.id)}
                  className="size-4 accent-moss shrink-0"
                />
                <span className="text-sm text-ink truncate min-w-0">{s.name}</span>
              </label>
            ))}
          </div>
        </>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-700 mb-3">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={saving}
          className="flex-1 rounded-md bg-moss text-paper py-2 font-medium hover:opacity-90 disabled:opacity-60"
        >
          {saving ? 'Saving…' : `${confirmLabel} ${selected.size} skill${selected.size === 1 ? '' : 's'}`}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="rounded-md border border-hairline text-ink py-2 px-4 hover:bg-paper disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </AccessibleDialog>
  )
}
