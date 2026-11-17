import { useMemo, useState } from 'react'
import MutationFeedback from '../../../components/MutationFeedback'
import { LEVELS, LEVEL_LABELS } from '../../../lib/levels'

const MAX_RESULTS = 8

function LevelSelect({ id, label, value, onChange, disabled, className = '' }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-xs text-secondary mb-1">{label}</label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded-md border border-hairline bg-paper px-2 py-1.5 text-sm text-ink"
      >
        {LEVELS.map((level) => (
          <option key={level} value={level}>{LEVEL_LABELS[level]}</option>
        ))}
      </select>
    </div>
  )
}

// One place to add a role's required skills, three ways:
//   - search the skills already in the system (the organisation's own first,
//     then the skill library) and add one at the chosen level;
//   - create a new skill from the search text when nothing matches;
//   - ask AI for suggestions from the role's name and description, shown one
//     at a time (existing skills first) to add or skip.
// Nothing is added without an explicit click. onAddSkill({ skillId, name,
// targetLevel }) resolves truthy once added -- skillId is omitted for a new
// skill, which the caller creates in the library (reusing any same-named
// entry). onRequestSuggestions(excludedNames) resolves to
// [{ name, reason, targetLevel, isExisting }].
export default function RoleProfileAddSkills({
  roleName,
  requiredSkills,
  availableSkills,
  saving = false,
  onAddSkill,
  onRequestSuggestions,
}) {
  const [query, setQuery] = useState('')
  const [level, setLevel] = useState(3)
  const [suggestions, setSuggestions] = useState([])
  const [shownNames, setShownNames] = useState([])
  const [handledNames, setHandledNames] = useState(() => new Set())
  const [suggestionLevels, setSuggestionLevels] = useState({})
  const [suggesting, setSuggesting] = useState(false)
  const [suggestionsRequested, setSuggestionsRequested] = useState(false)
  const [suggestionError, setSuggestionError] = useState(null)

  const requiredIds = useMemo(() => new Set(requiredSkills.map((s) => s.skillId)), [requiredSkills])
  const requiredNameKeys = useMemo(() => new Set(requiredSkills.map((s) => s.name.toLowerCase())), [requiredSkills])
  const trimmed = query.trim()
  const queryKey = trimmed.toLowerCase()

  const matches = useMemo(() => {
    if (!queryKey) return []
    return availableSkills
      .filter((s) => !requiredIds.has(s.id))
      .filter((s) => s.name.toLowerCase().includes(queryKey) || s.category?.toLowerCase().includes(queryKey))
      .sort((a, b) => {
        // Exact and prefix matches first, then the organisation's own skills.
        const rank = (s) => {
          const name = s.name.toLowerCase()
          return (name === queryKey ? 0 : name.startsWith(queryKey) ? 1 : 2) * 2 + (s.fromOrganisation ? 0 : 1)
        }
        return rank(a) - rank(b) || a.name.localeCompare(b.name)
      })
  }, [availableSkills, requiredIds, queryKey])

  const exactExists = availableSkills.some((s) => s.name.toLowerCase() === queryKey)
  const alreadyRequired = queryKey && requiredNameKeys.has(queryKey)
  const canCreate = Boolean(trimmed) && !exactExists && !alreadyRequired

  const remainingSuggestions = suggestions.filter((s) => {
    const key = s.name.toLowerCase()
    return !handledNames.has(key) && !requiredNameKeys.has(key)
  })
  const currentSuggestion = remainingSuggestions[0] ?? null
  const currentSuggestionLevel = currentSuggestion
    ? (suggestionLevels[currentSuggestion.name.toLowerCase()] ?? currentSuggestion.targetLevel)
    : 3

  async function addSkill(skill) {
    const added = await onAddSkill?.(skill)
    if (added) setQuery('')
  }

  async function requestSuggestions() {
    setSuggesting(true)
    setSuggestionError(null)
    try {
      const excluded = [...requiredSkills.map((s) => s.name), ...shownNames]
      const results = await onRequestSuggestions(excluded)
      setSuggestions(results)
      setShownNames((names) => [...names, ...results.map((s) => s.name)])
      setSuggestionsRequested(true)
    } catch (err) {
      setSuggestionError(err.message)
    } finally {
      setSuggesting(false)
    }
  }

  function markHandled(name) {
    setHandledNames((current) => new Set(current).add(name.toLowerCase()))
  }

  async function acceptSuggestion() {
    const suggestion = currentSuggestion
    const known = suggestion.isExisting
      ? availableSkills.find((s) => s.name.toLowerCase() === suggestion.name.toLowerCase())
      : null
    const added = await onAddSkill?.({ skillId: known?.id, name: suggestion.name, targetLevel: currentSuggestionLevel })
    if (added) markHandled(suggestion.name)
  }

  const busy = saving || suggesting
  const hasRoleName = Boolean(roleName?.trim())

  return (
    <div className="border-t border-hairline pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h4 className="text-sm font-medium text-ink">Add skills</h4>
        {!currentSuggestion && (
          <button
            type="button"
            onClick={requestSuggestions}
            disabled={busy || !hasRoleName}
            title={hasRoleName ? undefined : 'Give the role a name first'}
            className="rounded-md border border-moss/40 text-moss py-1.5 px-3 text-xs font-medium hover:bg-paper disabled:opacity-60"
          >
            {suggesting ? 'Thinking…' : suggestionsRequested ? 'Suggest more with AI' : 'Suggest skills with AI'}
          </button>
        )}
      </div>

      <MutationFeedback status="error" message={suggestionError} className="mb-3" />
      {suggestionsRequested && !currentSuggestion && !suggesting && (
        <p className="text-xs text-secondary mb-3" aria-live="polite">
          {suggestions.length === 0
            ? 'No new AI suggestions this time.'
            : "You've been through the AI suggestions — ask for more or search below."}
        </p>
      )}

      {currentSuggestion && (
        <div className="rounded-md border border-moss/40 bg-paper p-4 mb-4" aria-live="polite">
          <p className="text-xs font-medium uppercase tracking-wide text-moss mb-2">AI suggestion</p>
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="text-sm font-medium text-ink">{currentSuggestion.name}</span>
            <span className="rounded-full border border-hairline px-2 py-0.5 text-xs text-secondary">
              {currentSuggestion.isExisting ? 'In skill library' : 'New skill'}
            </span>
          </div>
          <p className="text-sm text-secondary">{currentSuggestion.reason}</p>
          {!currentSuggestion.isExisting && (
            <p className="text-xs text-secondary mt-1">Adding it will also create it in the skill library.</p>
          )}
          <div className="flex flex-wrap items-end gap-2 mt-3">
            <LevelSelect
              id="role-profile-suggestion-level"
              label="Level needed"
              value={currentSuggestionLevel}
              disabled={busy}
              onChange={(value) => setSuggestionLevels((o) => ({ ...o, [currentSuggestion.name.toLowerCase()]: value }))}
            />
            <button
              type="button"
              onClick={acceptSuggestion}
              disabled={busy}
              className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
            >
              Add to role
            </button>
            <button
              type="button"
              onClick={() => markHandled(currentSuggestion.name)}
              disabled={busy}
              className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-card disabled:opacity-60"
            >
              Skip
            </button>
          </div>
          {remainingSuggestions.length > 1 && (
            <p className="text-xs text-secondary mt-3">
              {remainingSuggestions.length - 1} more suggestion{remainingSuggestions.length - 1 === 1 ? '' : 's'} after this one.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[12rem]">
          <label htmlFor="role-profile-skill-search" className="block text-xs text-secondary mb-1">
            Find or create a skill
          </label>
          <input
            id="role-profile-skill-search"
            type="search"
            value={query}
            disabled={saving}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a skill name…"
            autoComplete="off"
            className="w-full rounded-md border border-hairline bg-paper px-2 py-1.5 text-sm text-ink"
          />
        </div>
        <LevelSelect id="role-profile-add-skill-level" label="Level needed" value={level} onChange={setLevel} disabled={saving} />
      </div>

      {trimmed && (
        <ul className="mt-2 border border-hairline rounded-md divide-y divide-hairline" aria-label="Matching skills">
          {matches.slice(0, MAX_RESULTS).map((skill) => (
            <li key={skill.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="flex-1 min-w-[8rem] text-sm text-ink">
                {skill.name}
                {skill.isComposite && (
                  <span className="ml-1 text-xs text-secondary">· Composite ({skill.componentCount})</span>
                )}
                {skill.fromOrganisation && (
                  <span className="ml-2 rounded-full border border-hairline px-2 py-0.5 text-xs text-secondary">Your organisation</span>
                )}
              </span>
              <button
                type="button"
                onClick={() => addSkill({ skillId: skill.id, name: skill.name, targetLevel: level })}
                disabled={saving}
                aria-label={`Add ${skill.name}`}
                className="rounded-md border border-hairline text-ink py-1 px-3 text-xs font-medium hover:bg-paper disabled:opacity-60"
              >
                Add
              </button>
            </li>
          ))}
          {matches.length > MAX_RESULTS && (
            <li className="px-3 py-2 text-xs text-secondary">
              {matches.length - MAX_RESULTS} more match{matches.length - MAX_RESULTS === 1 ? '' : 'es'} — keep typing to narrow.
            </li>
          )}
          {alreadyRequired && (
            <li className="px-3 py-2 text-xs text-secondary">“{trimmed}” is already required for this role.</li>
          )}
          {canCreate && (
            <li className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="flex-1 min-w-[8rem] text-sm text-ink">
                Create “{trimmed}” as a new skill
              </span>
              <button
                type="button"
                onClick={() => addSkill({ name: trimmed, targetLevel: level })}
                disabled={saving}
                className="rounded-md border border-hairline text-ink py-1 px-3 text-xs font-medium hover:bg-paper disabled:opacity-60"
              >
                Create and add
              </button>
            </li>
          )}
          {matches.length === 0 && !canCreate && !alreadyRequired && (
            <li className="px-3 py-2 text-xs text-secondary">No other matching skills.</li>
          )}
        </ul>
      )}
    </div>
  )
}
