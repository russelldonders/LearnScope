import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { findOrCreatePersonalSkill } from '../lib/skillLibrary'
import { suggestActivitySkills } from '../lib/activitySkillSuggestions'
import AccessibleDialog from './AccessibleDialog'

// A lighter-weight picker than FindSkillModal's full add-a-skill wizard --
// no tracking-reason or self-assessment steps, since this only needs to
// resolve which skill(s) an activity being logged relates to. Runs an AI
// suggestion once on open using whatever activity text was already typed,
// rather than per keystroke, to keep this to a single request. Supports
// picking more than one skill in a single visit -- toggled into `chosen`
// and confirmed together, rather than closing after the first pick.
export default function SkillPickerModal({ activityTitle, activityDescription, skills, onConfirm, onClose }) {
  const { user } = useAuth()
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const [suggestionError, setSuggestionError] = useState(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState(null)
  const [chosen, setChosen] = useState(new Map())

  useEffect(() => {
    if (!activityTitle?.trim()) return
    let cancelled = false
    setLoadingSuggestions(true)
    setSuggestionError(null)
    suggestActivitySkills(
      { title: activityTitle, description: activityDescription },
      skills.map((s) => s.name)
    )
      .then((result) => {
        if (!cancelled) setSuggestions(result)
      })
      .catch((err) => {
        if (!cancelled) setSuggestionError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoadingSuggestions(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return skills
    return skills.filter((s) => s.name.toLowerCase().includes(q))
  }, [skills, query])

  const exactMatch = skills.some((s) => s.name.toLowerCase() === query.trim().toLowerCase())

  function toggleChosen(skill) {
    setChosen((current) => {
      const next = new Map(current)
      if (next.has(skill.id)) next.delete(skill.id)
      else next.set(skill.id, skill)
      return next
    })
  }

  async function chooseByName(name) {
    const existing = skills.find((s) => s.name.toLowerCase() === name.trim().toLowerCase())
    if (existing) {
      toggleChosen(existing)
      return
    }
    setCreating(true)
    setError(null)
    try {
      const { skill } = await findOrCreatePersonalSkill(user.id, name)
      setChosen((current) => new Map(current).set(skill.id, skill))
      setQuery('')
    } catch (err) {
      setError(err.message)
    } finally {
      setCreating(false)
    }
  }

  function handleConfirm() {
    onConfirm([...chosen.values()])
  }

  return (
    <AccessibleDialog
      labelledBy="skill-picker-dialog-title"
      onClose={creating ? undefined : onClose}
      closeOnBackdrop={!creating}
      panelClassName="w-full max-w-md bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
      <h2 id="skill-picker-dialog-title" className="font-display text-2xl text-ink mb-1">
        Choose skills
      </h2>
      <p className="text-sm text-secondary mb-4">
        Pick as many of your skills as apply, or create a new one.
      </p>

      {loadingSuggestions && <p className="text-sm text-secondary mb-3">Finding likely skills…</p>}
      {suggestionError && (
        <p role="alert" className="text-sm text-red-700 mb-3">
          {suggestionError}
        </p>
      )}
      {!loadingSuggestions && suggestions.length > 0 && (
        <div className="mb-4">
          <h3 className="font-mono text-[10px] uppercase tracking-wide text-secondary mb-2">Suggested</h3>
          <div className="divide-y divide-hairline">
            {suggestions.map((s) => {
              const existing = skills.find((sk) => sk.name.toLowerCase() === s.name.toLowerCase())
              const isChosen = existing ? chosen.has(existing.id) : false
              return (
                <label key={s.name} className="flex items-start gap-3 py-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isChosen}
                    disabled={creating}
                    onChange={() => chooseByName(s.name)}
                    className="mt-1 size-4 accent-moss"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-ink">{s.name}</span>
                    <span className="block text-xs text-secondary mt-0.5">{s.reason}</span>
                  </span>
                </label>
              )
            })}
          </div>
        </div>
      )}

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search your skills…"
        className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
      />

      <div className="max-h-48 overflow-y-auto mt-3 mb-3 divide-y divide-hairline">
        {filtered.length === 0 && <p className="text-sm text-secondary py-2">No matches.</p>}
        {filtered.map((s) => (
          <label key={s.id} className="flex items-center gap-3 py-2 cursor-pointer">
            <input
              type="checkbox"
              checked={chosen.has(s.id)}
              disabled={creating}
              onChange={() => toggleChosen(s)}
              className="size-4 accent-moss shrink-0"
            />
            <span className="text-sm text-ink truncate min-w-0">{s.name}</span>
          </label>
        ))}
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-700 mb-3">
          {error}
        </p>
      )}

      {query.trim() && !exactMatch && (
        <button
          type="button"
          disabled={creating}
          onClick={() => chooseByName(query)}
          className="w-full mb-3 rounded-md border border-hairline text-ink py-2 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
        >
          {creating ? 'Creating…' : `+ Create "${query.trim()}"`}
        </button>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={chosen.size === 0 || creating}
          onClick={handleConfirm}
          className="flex-1 rounded-md bg-moss text-paper py-2 font-medium hover:opacity-90 disabled:opacity-60"
        >
          {`Add ${chosen.size || ''} skill${chosen.size === 1 ? '' : 's'}`}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={creating}
          className="rounded-md border border-hairline text-ink py-2 px-4 hover:bg-paper disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </AccessibleDialog>
  )
}
