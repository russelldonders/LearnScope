import { useState } from 'react'
import { suggestTags } from '../lib/skillTags'

// tags: [{ id, name }] — id may be null for a tag not yet persisted (e.g.
// while adding a brand-new skill). onAddTag/onRemoveTag are async
// callbacks; the caller decides whether they hit the database immediately
// (editing an existing skill) or just update local state (adding a new
// one, applied once the skill itself is saved).
export default function TagsField({ tags, onAddTag, onRemoveTag, skillName, allTags, datalistId, readOnly = false }) {
  const [input, setInput] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [suggesting, setSuggesting] = useState(false)
  const [error, setError] = useState(null)

  async function handleAdd(e) {
    e?.preventDefault()
    const name = input.trim()
    if (!name) return
    if (tags.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
      setInput('')
      return
    }
    setError(null)
    try {
      await onAddTag(name)
      setInput('')
      setSuggestions((prev) => prev.filter((s) => s.toLowerCase() !== name.toLowerCase()))
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleSuggest() {
    if (!skillName?.trim()) {
      setError('Enter a skill name first.')
      return
    }
    setError(null)
    setSuggesting(true)
    try {
      const result = await suggestTags(
        skillName,
        allTags.map((t) => t.name)
      )
      setSuggestions(result.filter((s) => !tags.some((t) => t.name.toLowerCase() === s.toLowerCase())))
    } catch (err) {
      setError(err.message)
    } finally {
      setSuggesting(false)
    }
  }

  async function handleAddSuggestion(name) {
    setError(null)
    try {
      await onAddTag(name)
      setSuggestions((prev) => prev.filter((s) => s !== name))
    } catch (err) {
      setError(err.message)
    }
  }

  if (readOnly) {
    return (
      <div>
        <span className="block text-sm text-secondary mb-1">Tags</span>
        {tags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((t, i) => (
              <span
                key={t.id ?? t.name ?? i}
                className="font-mono text-[10px] uppercase tracking-wide text-secondary border border-hairline rounded-full px-2 py-0.5"
              >
                {t.name}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-secondary">No tags.</p>
        )}
      </div>
    )
  }

  return (
    <div>
      <span className="block text-sm text-secondary mb-1">Tags (optional)</span>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {tags.map((t, i) => (
            <span
              key={t.id ?? t.name}
              className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide text-secondary border border-hairline rounded-full px-2 py-0.5"
            >
              {t.name}
              <button
                type="button"
                onClick={() => onRemoveTag(t.id ?? i)}
                className="text-red-700"
                aria-label={`Remove ${t.name}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          list={datalistId}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd(e)
          }}
          placeholder="Type a tag and press Enter…"
          className="flex-1 rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
        />
        <datalist id={datalistId}>
          {allTags.map((t) => (
            <option key={t.id} value={t.name} />
          ))}
        </datalist>
        <button
          type="button"
          onClick={handleAdd}
          className="shrink-0 rounded-md border border-hairline text-ink py-2 px-3 text-sm font-medium hover:bg-paper"
        >
          Add
        </button>
      </div>

      <button
        type="button"
        onClick={handleSuggest}
        disabled={suggesting}
        className="text-xs text-moss font-medium mt-2 disabled:opacity-60"
      >
        {suggesting ? 'Suggesting…' : '✨ Suggest tags'}
      </button>

      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => handleAddSuggestion(s)}
              className="font-mono text-xs rounded-full px-3 py-1 border border-moss text-moss hover:bg-moss/10"
            >
              + {s}
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-xs text-red-700 mt-1">{error}</p>}
    </div>
  )
}
