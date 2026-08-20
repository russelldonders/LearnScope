import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../context/AuthContext'
import { listLibrarySkills, listLibrarySkillIdsForTags } from '../../lib/skillLibrary'
import { listTags } from '../../lib/skillTags'
import { isDuplicateSkillNameError } from '../../lib/skillDuplicates'

const MAX_VISIBLE = 30

export default function SkillsToLearnStep({ onDone }) {
  const { user } = useAuth()
  const [allTags, setAllTags] = useState([])
  const [selectedTagIds, setSelectedTagIds] = useState(new Set())
  const [matchedLibraryIds, setMatchedLibraryIds] = useState(null)
  const [libraryLoading, setLibraryLoading] = useState(true)
  const [librarySkills, setLibrarySkills] = useState([])
  const [ownedNames, setOwnedNames] = useState(new Set())
  const [query, setQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    listTags().then(setAllTags)
    listLibrarySkills()
      .then(setLibrarySkills)
      .finally(() => setLibraryLoading(false))
    supabase
      .from('skills')
      .select('name')
      .eq('user_id', user.id)
      .then(({ data }) => setOwnedNames(new Set((data ?? []).map((s) => s.name.toLowerCase().trim()))))
  }, [])

  useEffect(() => {
    if (selectedTagIds.size === 0) {
      setMatchedLibraryIds(null)
      return
    }
    let cancelled = false
    listLibrarySkillIdsForTags([...selectedTagIds]).then((ids) => {
      if (!cancelled) setMatchedLibraryIds(new Set(ids))
    })
    return () => {
      cancelled = true
    }
  }, [selectedTagIds])

  function toggleTag(id) {
    setSelectedTagIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSkill(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const available = useMemo(
    () => librarySkills.filter((s) => !ownedNames.has(s.name.toLowerCase().trim())),
    [librarySkills, ownedNames]
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let pool = available
    if (matchedLibraryIds && matchedLibraryIds.size > 0) {
      pool = pool.filter((s) => matchedLibraryIds.has(s.id))
    }
    if (q) pool = pool.filter((s) => s.name.toLowerCase().includes(q))
    return pool
  }, [available, matchedLibraryIds, query])

  const noMatchesForInterests =
    matchedLibraryIds !== null && matchedLibraryIds.size === 0 && !query.trim()

  async function handleFinish() {
    if (selectedIds.size === 0) {
      onDone()
      return
    }
    setError(null)
    setSaving(true)

    let chosen = librarySkills.filter((s) => selectedIds.has(s.id))
    const rows = () =>
      chosen.map((s) => ({
        name: s.name,
        level: null,
        lifecycle_stage: 'identified',
        source: 'manual',
        library_skill_id: s.id,
        user_id: user.id,
      }))

    let { error } = await supabase.from('skills').insert(rows())

    if (error && isDuplicateSkillNameError(error)) {
      // Someone else's tab (or the CV-import step) added one of these names
      // since we last checked -- drop whatever's now a duplicate and retry
      // with the rest, rather than failing the whole selection over one row.
      const { data: current } = await supabase.from('skills').select('name').eq('user_id', user.id)
      const currentNames = new Set((current ?? []).map((s) => s.name.toLowerCase().trim()))
      chosen = chosen.filter((s) => !currentNames.has(s.name.toLowerCase().trim()))
      if (chosen.length === 0) {
        setSaving(false)
        onDone()
        return
      }
      ;({ error } = await supabase.from('skills').insert(rows()))
    }

    setSaving(false)
    if (error) {
      setError(
        isDuplicateSkillNameError(error)
          ? 'One of these is already in your skills — deselect it and try again.'
          : error.message
      )
      return
    }
    onDone()
  }

  return (
    <div>
      <h2 className="font-display text-2xl text-ink mb-1">Skills you want to learn</h2>
      <p className="text-sm text-secondary mb-6">
        Pick a few skills to start tracking — no level or assessment needed yet, this just adds
        them to your list so you can develop them over time. You can always add more later from
        the Skills page.
      </p>

      <div className="mb-4">
        <p className="font-mono text-xs uppercase tracking-wide text-secondary mb-2">
          What are you interested in?
        </p>
        <div className="flex flex-wrap gap-2">
          {allTags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              onClick={() => toggleTag(tag.id)}
              className={`rounded-full border px-3 py-1 text-sm ${
                selectedTagIds.has(tag.id)
                  ? 'bg-moss text-paper border-moss'
                  : 'border-hairline text-ink hover:bg-paper'
              }`}
            >
              {tag.name}
            </button>
          ))}
        </div>
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search skills…"
        className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink mb-3 focus:outline-none focus:ring-2 focus:ring-moss"
      />

      {noMatchesForInterests && (
        <p className="text-xs text-secondary mb-2">
          No library matches for those interests yet — search above to browse everything instead.
        </p>
      )}

      <div className="max-h-64 overflow-y-auto divide-y divide-hairline border border-hairline rounded-md">
        {libraryLoading && <p className="text-sm text-secondary p-3">Loading…</p>}
        {!libraryLoading && filtered.length === 0 && !noMatchesForInterests && (
          <p className="text-sm text-secondary p-3">No matches.</p>
        )}
        {filtered.slice(0, MAX_VISIBLE).map((s) => (
          <label key={s.id} className="flex items-center gap-3 p-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={selectedIds.has(s.id)}
              onChange={() => toggleSkill(s.id)}
              className="rounded border-hairline"
            />
            <span className="text-sm text-ink">{s.name}</span>
          </label>
        ))}
      </div>
      {filtered.length > MAX_VISIBLE && (
        <p className="text-xs text-secondary mt-1">
          Showing the first {MAX_VISIBLE} — search to narrow it down.
        </p>
      )}

      {error && <p className="text-sm text-red-700 mt-3">{error}</p>}

      <div className="flex items-center gap-2 pt-5 mt-5 border-t border-hairline">
        <button
          type="button"
          onClick={handleFinish}
          disabled={saving}
          className="rounded-md bg-moss text-paper py-2 px-4 font-medium hover:opacity-90 disabled:opacity-60"
        >
          {saving
            ? 'Saving…'
            : selectedIds.size > 0
              ? `Add ${selectedIds.size} skill${selectedIds.size === 1 ? '' : 's'} & finish`
              : 'Finish'}
        </button>
        <button
          type="button"
          onClick={onDone}
          disabled={saving}
          className="rounded-md border border-hairline text-ink py-2 px-4 hover:bg-paper"
        >
          Skip
        </button>
      </div>
    </div>
  )
}
