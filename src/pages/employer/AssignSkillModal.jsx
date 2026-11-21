import { useEffect, useMemo, useState } from 'react'
import AccessibleDialog from '../../components/AccessibleDialog'
import MutationFeedback from '../../components/MutationFeedback'
import StatusBadge from '../../components/StatusBadge'
import { SortableTh, TablePagination } from '../../components/TableControls'
import { suggestSkillToEmployerMembers, listEmployerSkillSuggestions } from '../../lib/admin/employers'
import { SKILL_SUGGESTION_SORT_ACCESSORS, SKILL_SUGGESTION_STATUS_LABELS } from '../../lib/employerLearnerTables'
import { LEVELS, LEVEL_LABELS } from '../../lib/levels'
import { listLibrarySkills } from '../../lib/skillLibrary'
import { useSortedPage, useUrlParam, writeUrlParams } from '../../lib/useSortedPage'

// Skill (+ optional target level/date) picker for the "Assign skill" bulk
// action on the Users tab's learner roster (EmployerLearnersPanel) -- used
// to be its own top-level "Suggest skills" tab with its own copy of the
// learner picker; folded into a modal opened from a selection made on that
// one roster instead, mirroring AssignTrainingModal's shape exactly.
// Suggesting never creates or modifies anyone's actual skills/skill_targets
// rows by itself -- suggest_skill_to_employer_members only creates a
// manager_skill_suggestions row; the learner still has to click "Add to my
// skills" on their own /actions page (adoptManagerSkillSuggestion) to create the
// real skill (and, if they choose, a target) via the same unmodified
// findOrCreatePersonalSkill/skill_targets path any other learner-initiated
// skill-add already uses. Skill choices come from listLibrarySkills
// (src/lib/skillLibrary.js) -- the same active, public-or-own-private
// library search every learner-facing "Find skill" flow already uses,
// rather than the platform-admin-only listAllLibrarySkills
// (src/lib/admin/skills.js), which surfaces inactive/moderated entries and
// pulls in owner-identity fields that have no place in this picker.
export default function AssignSkillModal({ employer, members, skippedCount = 0, onClose, onAssigned }) {
  const [historyParams, setHistoryParams] = useState(() => new URLSearchParams())
  const [librarySkills, setLibrarySkills] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [skillQuery, setSkillQuery] = useState('')
  const [selectedSkill, setSelectedSkill] = useState(null)
  const [targetLevel, setTargetLevel] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [comments, setComments] = useState('')
  const [assigning, setAssigning] = useState(false)

  useEffect(() => {
    listLibrarySkills()
      .then(setLibrarySkills)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const skillMatches = useMemo(() => {
    const q = skillQuery.trim().toLowerCase()
    if (!q) return []
    return librarySkills.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 20)
  }, [librarySkills, skillQuery])

  function chooseSkill(skill) {
    setSelectedSkill(skill)
    setSkillQuery(skill.name)
  }

  function clearSkill() {
    setSelectedSkill(null)
    setSkillQuery('')
  }

  async function handleAssign(e) {
    e.preventDefault()
    if (!selectedSkill) return
    if (targetLevel && !targetDate) {
      setError('A target date is required when a target level is set.')
      return
    }
    setAssigning(true)
    setError(null)
    try {
      const requestedIds = members.map((m) => m.user_id)
      const inserted = await suggestSkillToEmployerMembers(
        employer.id,
        selectedSkill.id,
        selectedSkill.name,
        requestedIds,
        {
          targetLevel: targetLevel ? Number(targetLevel) : null,
          targetDate: targetDate || null,
          comments: comments.trim() || null,
        }
      )
      const insertedIds = new Set(inserted.map((row) => row.learner_id))
      // Everyone passed in here already cleared the roster's own "active"
      // filter -- the only reason the RPC would still skip one is an
      // existing live ('suggested'/'adopted') suggestion for this skill.
      const skippedEmails = requestedIds
        .filter((id) => !insertedIds.has(id))
        .map((id) => members.find((m) => m.user_id === id)?.email || id)
      onAssigned({ kind: 'skill', count: inserted.length, skippedEmails })
    } catch (err) {
      setError(err.message)
      setAssigning(false)
    }
  }

  return (
    <AccessibleDialog
      labelledBy="assign-skill-dialog-title"
      onClose={assigning ? undefined : onClose}
      closeOnBackdrop={!assigning}
      panelClassName="w-full max-w-3xl bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
      <h2 id="assign-skill-dialog-title" className="font-display text-xl text-ink mb-1">Assign skill</h2>
      <p className="text-sm text-secondary mb-4">
        Suggest a skill (and optionally a target level/date) to {members.length} selected learner{members.length === 1 ? '' : 's'}.
        They'll see it on their Actions page and decide whether to add it to their own profile — this doesn't
        touch their skills automatically.
      </p>
      {skippedCount > 0 && (
        <p className="text-xs text-secondary mb-4">
          {skippedCount} of the selected user{skippedCount === 1 ? '' : 's'} {skippedCount === 1 ? 'is' : 'are'} not an active employer member and won't be included.
        </p>
      )}

      <MutationFeedback status="error" message={error} size="xs" className="mb-3" />

      {loading ? (
        <p className="text-sm text-secondary">Loading the skill library…</p>
      ) : (
        <form onSubmit={handleAssign} className="space-y-3">
          <div className="relative">
            <label className="block text-xs text-secondary mb-1" htmlFor="employerAssignSkill">
              Skill
            </label>
            <input
              id="employerAssignSkill"
              value={skillQuery}
              onChange={(e) => {
                setSkillQuery(e.target.value)
                if (selectedSkill) setSelectedSkill(null)
              }}
              placeholder="Search the skill library…"
              autoComplete="off"
              className="w-full rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            />
            {selectedSkill && (
              <button
                type="button"
                onClick={clearSkill}
                className="mt-1 text-xs text-secondary hover:text-ink hover:underline"
              >
                Change
              </button>
            )}
            {!selectedSkill && skillQuery.trim() && (
              <div className="absolute z-10 mt-1 w-full bg-card border border-hairline rounded-md shadow-sm max-h-56 overflow-y-auto">
                {skillMatches.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-secondary">No matching skills.</p>
                ) : (
                  skillMatches.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => chooseSkill(s)}
                      className="block w-full text-left px-3 py-2 text-sm text-ink hover:bg-paper"
                    >
                      {s.name}
                      {s.category && <span className="text-xs text-secondary ml-1.5">({s.category})</span>}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-3">
            <div>
              <label className="block text-xs text-secondary mb-1" htmlFor="employerAssignLevel">
                Target level (optional)
              </label>
              <select
                id="employerAssignLevel"
                value={targetLevel}
                onChange={(e) => setTargetLevel(e.target.value)}
                className="rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              >
                <option value="">No specific level</option>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>{LEVEL_LABELS[l]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-secondary mb-1" htmlFor="employerAssignDate">
                Target date {targetLevel ? '' : '(optional)'}
              </label>
              <input
                id="employerAssignDate"
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className="rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-secondary mb-1" htmlFor="employerAssignComments">
              Why this matters (optional)
            </label>
            <textarea
              id="employerAssignComments"
              rows={2}
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              className="w-full rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={assigning}
              className="rounded-md border border-hairline text-ink py-2 px-4 text-sm font-medium hover:bg-paper disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!selectedSkill || assigning}
              className="rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90 disabled:opacity-60"
            >
              {assigning ? 'Assigning…' : `Assign to ${members.length}`}
            </button>
          </div>
        </form>
      )}
      <section aria-labelledby="employer-skill-history-heading" className="mt-6 border-t border-hairline pt-6">
        <EmployerSkillAssignmentsHistory
          employer={employer}
          members={members}
          searchParams={historyParams}
          setSearchParams={setHistoryParams}
        />
      </section>
    </AccessibleDialog>
  )
}

// Assignment history for the selected users in the matching assignment dialog.

function EmployerSkillAssignmentsHistory({ employer, members, searchParams, setSearchParams }) {
  const [suggestions, setSuggestions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the listed values change; the loaders are recreated every render
  }, [employer.id, members])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const rows = await listEmployerSkillSuggestions(employer.id)
      const selectedUserIds = new Set(members.map((member) => member.user_id))
      setSuggestions(rows.filter((row) => selectedUserIds.has(row.learner_id)))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const emailByUserId = useMemo(() => new Map(members.map((m) => [m.user_id, m.email || m.user_id])), [members])
  const suggestionsWithEmail = useMemo(
    () => suggestions.map((s) => ({ ...s, learnerEmail: emailByUserId.get(s.learner_id) })),
    [suggestions, emailByUserId]
  )
  const [suggestionQuery, setSuggestionQuery] = useUrlParam(searchParams, setSearchParams, 'sq', '', { resetParams: ['sPage'] })
  const sq = suggestionQuery.trim().toLowerCase()
  const filteredSuggestions = useMemo(
    () =>
      sq
        ? suggestionsWithEmail.filter(
            (s) => s.skill_name?.toLowerCase().includes(sq) || (s.learnerEmail || '').toLowerCase().includes(sq)
          )
        : suggestionsWithEmail,
    [suggestionsWithEmail, sq]
  )
  const suggestionFiltersActive = suggestionQuery !== ''

  function resetSuggestionFilters() {
    writeUrlParams(searchParams, setSearchParams, { sq: null, sPage: null })
  }

  const {
    sortKey: sSortKey,
    sortDir: sSortDir,
    toggleSort: sToggleSort,
    page: sPage,
    setPage: sSetPage,
    pageSize: sPageSize,
    setPageSize: sSetPageSize,
    pageItems: sPageItems,
    totalItems: sTotalItems,
  } = useSortedPage(filteredSuggestions, SKILL_SUGGESTION_SORT_ACCESSORS, {
    defaultSortKey: 'created_at',
    defaultSortDir: 'desc',
    urlSync: { searchParams, setSearchParams, paramNames: { sort: 'sSort', dir: 'sDir', page: 'sPage', pageSize: 'sPageSize' } },
  })

  return (
    <div>
      <h3 id="employer-skill-history-heading" className="font-display text-base text-ink mb-3">Skills assigned so far</h3>
      <MutationFeedback status="error" message={error} size="xs" className="mb-3" />
      {loading ? (
        <p className="text-xs text-secondary">Loading…</p>
      ) : suggestions.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-hairline rounded-lg">
          <p className="text-secondary">No skills assigned to the selected users yet.</p>
        </div>
      ) : (
        <div className="bg-card border border-hairline rounded-lg">
          <div className="flex flex-wrap items-center gap-2 p-3">
            <input
              aria-label="Search suggestions"
              type="text"
              value={suggestionQuery}
              onChange={(e) => setSuggestionQuery(e.target.value)}
              placeholder="Search by skill or learner…"
              className="flex-1 min-w-[220px] rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
            />
            {suggestionFiltersActive && (
              <button
                type="button"
                onClick={resetSuggestionFilters}
                className="text-xs text-secondary hover:text-ink py-1.5 px-2 whitespace-nowrap"
              >
                Reset filters
              </button>
            )}
          </div>
          {filteredSuggestions.length === 0 ? (
            <p className="text-center text-xs text-secondary py-8">No suggestions match your search.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-hairline text-left text-secondary">
                      <SortableTh label="Skill" columnKey="skill" sortKey={sSortKey} sortDir={sSortDir} onSort={sToggleSort} />
                      <SortableTh label="Learner" columnKey="learner" sortKey={sSortKey} sortDir={sSortDir} onSort={sToggleSort} />
                      <th className="px-4 py-2 font-medium whitespace-nowrap">Target</th>
                      <SortableTh label="Status" columnKey="status" sortKey={sSortKey} sortDir={sSortDir} onSort={sToggleSort} className="whitespace-nowrap" />
                      <SortableTh label="Suggested" columnKey="created_at" sortKey={sSortKey} sortDir={sSortDir} onSort={sToggleSort} className="whitespace-nowrap" />
                    </tr>
                  </thead>
                  <tbody>
                    {sPageItems.map((s) => (
                      <tr key={s.id} className="border-b border-hairline last:border-0">
                        <td className="px-4 py-2 text-ink text-xs truncate max-w-[220px]">{s.skill_name}</td>
                        <td className="px-4 py-2 text-secondary text-xs truncate max-w-[220px]">{s.learnerEmail || s.learner_id}</td>
                        <td className="px-4 py-2 text-secondary text-xs whitespace-nowrap">
                          {s.suggested_target_level ? LEVEL_LABELS[s.suggested_target_level] : '—'}
                          {s.target_date ? ` by ${new Date(`${s.target_date}T00:00:00`).toLocaleDateString()}` : ''}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap">
                          <StatusBadge label={SKILL_SUGGESTION_STATUS_LABELS[s.status] || s.status} tone={s.status === 'dismissed' ? 'danger' : 'neutral'} />
                        </td>
                        <td className="px-4 py-2 text-secondary text-xs whitespace-nowrap">{new Date(s.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TablePagination page={sPage} setPage={sSetPage} pageSize={sPageSize} setPageSize={sSetPageSize} totalItems={sTotalItems} idPrefix={`employer-skill-suggestions-${employer.id}`} />
            </>
          )}
        </div>
      )}
    </div>
  )
}
