import { useState } from 'react'
import MutationFeedback from '../../../components/MutationFeedback'
import { LEVELS, LEVEL_LABELS } from '../../../lib/levels'

// AI-assisted companion to RoleProfileSkillsPanel: suggests skills for the
// role from its name/description, one at a time, for the role's creator to
// add (at a level they can adjust) or skip. Nothing is saved unless they
// choose "Add to role". Skills already in the system are suggested ahead of
// new ones (the server orders them that way); a new one is only created in
// the skill library when it's actually added.
//
// onRequestSuggestions(excludedNames) resolves to
// [{ name, reason, targetLevel, isExisting }]; onAcceptSuggestion(suggestion)
// resolves truthy once the skill has been added to the role.
export default function RoleProfileSkillSuggestions({
  roleName,
  requiredSkillNames = [],
  saving = false,
  onRequestSuggestions,
  onAcceptSuggestion,
}) {
  const [queue, setQueue] = useState([])
  const [shownNames, setShownNames] = useState([])
  const [handledNames, setHandledNames] = useState(() => new Set())
  const [levelOverrides, setLevelOverrides] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [requested, setRequested] = useState(false)

  const requiredKeys = new Set(requiredSkillNames.map((name) => name.toLowerCase()))
  const remaining = queue.filter((s) => {
    const key = s.name.toLowerCase()
    return !handledNames.has(key) && !requiredKeys.has(key)
  })
  const current = remaining[0] ?? null
  const currentLevel = current ? (levelOverrides[current.name.toLowerCase()] ?? current.targetLevel) : 3

  async function requestMore() {
    setLoading(true)
    setError(null)
    try {
      const excluded = [...requiredSkillNames, ...shownNames]
      const results = await onRequestSuggestions(excluded)
      setQueue(results)
      setShownNames((names) => [...names, ...results.map((s) => s.name)])
      setRequested(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function markHandled(name) {
    setHandledNames((current) => new Set(current).add(name.toLowerCase()))
  }

  async function handleAccept() {
    const added = await onAcceptSuggestion?.({ ...current, targetLevel: Number(currentLevel) })
    if (added) markHandled(current.name)
  }

  const busy = loading || saving

  return (
    <div className="bg-card border border-hairline rounded-lg p-6">
      <h3 className="font-display text-lg text-ink mb-1">Suggest skills with AI</h3>
      <p className="text-sm text-secondary mb-4">
        Get suggestions one at a time from this role&apos;s name and description. Skills already in the skill
        library are suggested first. Nothing is added unless you choose it.
      </p>

      <MutationFeedback status="error" message={error} className="mb-3" />

      {current ? (
        <div className="rounded-md border border-hairline bg-paper p-4" aria-live="polite">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="text-sm font-medium text-ink">{current.name}</span>
            <span className="rounded-full border border-hairline px-2 py-0.5 text-xs text-secondary">
              {current.isExisting ? 'In skill library' : 'New skill'}
            </span>
          </div>
          <p className="text-sm text-secondary mb-1">{current.reason}</p>
          {!current.isExisting && (
            <p className="text-xs text-secondary mb-2">Adding it will also create it in the skill library.</p>
          )}
          <div className="flex flex-wrap items-end gap-2 mt-3">
            <div>
              <label htmlFor="role-profile-suggestion-level" className="block text-xs text-secondary mb-1">
                Target level
              </label>
              <select
                id="role-profile-suggestion-level"
                value={currentLevel}
                disabled={busy}
                onChange={(e) => setLevelOverrides((o) => ({ ...o, [current.name.toLowerCase()]: Number(e.target.value) }))}
                className="rounded-md border border-hairline bg-card px-2 py-1.5 text-sm text-ink"
              >
                {LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {LEVEL_LABELS[level]}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={handleAccept}
              disabled={busy}
              className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
            >
              Add to role
            </button>
            <button
              type="button"
              onClick={() => markHandled(current.name)}
              disabled={busy}
              className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-card disabled:opacity-60"
            >
              Skip
            </button>
          </div>
          {remaining.length > 1 && (
            <p className="text-xs text-secondary mt-3">
              {remaining.length - 1} more suggestion{remaining.length - 1 === 1 ? '' : 's'} after this one.
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={requestMore}
            disabled={busy || !roleName?.trim()}
            className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
          >
            {loading ? 'Thinking…' : requested ? 'Suggest more skills' : 'Suggest a skill'}
          </button>
          {requested && !loading && (
            <span className="text-xs text-secondary">
              {queue.length === 0 ? 'No new suggestions this time.' : "You've been through these suggestions."}
            </span>
          )}
          {!roleName?.trim() && <span className="text-xs text-secondary">Give the role a name first.</span>}
        </div>
      )}
    </div>
  )
}
