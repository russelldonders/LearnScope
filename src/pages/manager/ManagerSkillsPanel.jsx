import { useEffect, useMemo, useState } from 'react'
import PersonAvatar from '../../components/PersonAvatar'
import MutationFeedback from '../../components/MutationFeedback'
import AccessibleDialog from '../../components/AccessibleDialog'
import { LEVELS, LEVEL_LABELS } from '../../lib/levels'
import { listLibrarySkills } from '../../lib/skillLibrary'
import ManagerMemberProfile from './ManagerMemberProfile'

const actionClass = 'rounded-md border border-hairline px-3 py-2 text-sm font-medium text-ink hover:bg-paper focus-visible:outline-2 focus-visible:outline-moss'

function skillKey(skill) {
  return skill.name?.trim().toLocaleLowerCase() ?? skill.id
}

export default function ManagerSkillsPanel({
  members = [], loading = false, error = null, onRateSkill, onLoadSkillAssessments, onLoadSkillDetail, onSetTarget, onSuggestSkill,
}) {
  const [selection, setSelection] = useState(null)
  const [addSkillOpen, setAddSkillOpen] = useState(false)
  const selectedMember = members.find((member) => member.id === selection?.memberId)
  // Row-per-skill, column-per-member matrix -- byMemberId gives each row an
  // O(1) lookup for whether a given member has it, and at what level,
  // rather than the flat learners list a grouped-by-skill layout needed.
  const skills = useMemo(() => {
    const grouped = new Map()
    members.forEach((member) => member.sharedSkills?.forEach((skill) => {
      const key = skillKey(skill)
      const current = grouped.get(key) ?? { key, name: skill.name, byMemberId: new Map(), learnerCount: 0 }
      current.byMemberId.set(member.id, skill)
      current.learnerCount += 1
      grouped.set(key, current)
    }))
    return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [members])
  const ratedCount = skills.reduce(
    (total, group) => total + [...group.byMemberId.values()].filter((skill) => skill.managerRating).length,
    0
  )

  if (selectedMember) return <ManagerMemberProfile member={selectedMember} initialSkillId={selection.skillId}
    onBack={() => setSelection(null)} onRateSkill={onRateSkill} onLoadSkillAssessments={onLoadSkillAssessments}
    onLoadSkillDetail={onLoadSkillDetail} onSetTarget={onSetTarget} />

  return <section aria-labelledby="team-skills-title" className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="max-w-3xl">
        <h2 id="team-skills-title" className="font-display text-2xl text-ink">Skills across your team</h2>
        <p className="mt-1 text-sm text-secondary">Compare who has which skill and at what level, add your own rating or a target, or suggest a skill for the team to work on together.</p>
      </div>
      {onSuggestSkill && members.length > 0 && (
        <button type="button" onClick={() => setAddSkillOpen(true)} className={`${actionClass} shrink-0`}>
          + Add a skill
        </button>
      )}
    </div>
    <MutationFeedback status="error" message={error} />
    {loading ? <p role="status" className="text-sm text-secondary">Loading team skills…</p> : skills.length === 0 ?
      <div className="rounded-lg border border-dashed border-hairline px-5 py-12 text-center">
        <h3 className="font-display text-lg text-ink">No shared skills yet</h3>
        <p className="mx-auto mt-1 max-w-xl text-sm text-secondary">
          {onSuggestSkill && members.length > 0
            ? 'Suggest a skill for the team to work on, or wait for learners to share their own from the Members tab.'
            : 'Invite learners from the Members tab. Their skills will appear here when they choose to share them with you.'}
        </p>
      </div> : <>
        <p className="border-y border-hairline py-3 text-sm text-secondary">
          <span className="font-medium text-ink">{skills.length} {skills.length === 1 ? 'skill' : 'skills'}</span>
          {' · '}{members.length} team {members.length === 1 ? 'member' : 'members'}
          {' · '}{ratedCount} rated by you
        </p>
        <div className="overflow-x-auto border border-hairline rounded-lg">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 bg-card px-3 py-2 text-left font-medium text-secondary border-b border-r border-hairline">Skill</th>
                {members.map((member) => (
                  <th key={member.id} scope="col" className="px-3 py-2 text-center font-medium text-secondary border-b border-hairline whitespace-nowrap">
                    <div className="flex flex-col items-center gap-1">
                      <PersonAvatar name={member.name} avatarUrl={member.avatarUrl} size={7} />
                      <span>{member.name}</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {skills.map((group) => (
                <tr key={group.key}>
                  <th scope="row" className="sticky left-0 bg-card px-3 py-2 text-left font-medium text-ink border-r border-b border-hairline whitespace-nowrap">{group.name}</th>
                  {members.map((member) => {
                    const skill = group.byMemberId.get(member.id)
                    return (
                      <td key={member.id} className="px-3 py-2 text-center border-b border-hairline">
                        {skill ? (
                          <button type="button" onClick={() => setSelection({ memberId: member.id, skillId: skill.id })}
                            aria-label={`Review ${group.name} for ${member.name}`}
                            className="inline-flex flex-col items-center gap-0.5 rounded-md px-2 py-1 hover:bg-paper focus-visible:outline-2 focus-visible:outline-moss">
                            <span className="text-xs font-medium text-ink whitespace-nowrap">{LEVEL_LABELS[skill.level] ?? 'Not assessed'}</span>
                            {skill.managerRating && <span className="text-[10px] text-moss">Rated by you</span>}
                          </button>
                        ) : <span className="text-secondary" aria-hidden="true">—</span>}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>}
    {addSkillOpen && (
      <AddTeamSkillModal members={members} onClose={() => setAddSkillOpen(false)} onSuggest={onSuggestSkill} />
    )}
  </section>
}

// Push, don't force -- mirrors AssignSkillModal (src/pages/employer/
// EmployerConsole.jsx) exactly, just scoped to this team's own members
// instead of an employer's roster: never creates or modifies anyone's
// skills/skill_targets rows itself, each selected member still chooses to
// add it (or not) from their own Actions page. Suggests to each selected
// member independently (mirrors InviteToTeamDialog's own email batching) so
// one bad/duplicate suggestion doesn't sink the rest -- on a partial
// failure only the still-failed members stay checked, ready to retry.
function AddTeamSkillModal({ members, onClose, onSuggest }) {
  const [librarySkills, setLibrarySkills] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [skillQuery, setSkillQuery] = useState('')
  const [selectedSkill, setSelectedSkill] = useState(null)
  const [selectedMemberIds, setSelectedMemberIds] = useState(new Set())
  const [targetLevel, setTargetLevel] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [comments, setComments] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    listLibrarySkills().then(setLibrarySkills).catch((err) => setLoadError(err.message)).finally(() => setLoading(false))
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

  function toggleMember(id) {
    setSelectedMemberIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (!selectedSkill || selectedMemberIds.size === 0) return
    if (targetLevel && !targetDate) {
      setError('A target date is required when a target level is set.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const payload = {
        targetLevel: targetLevel ? Number(targetLevel) : null,
        targetDate: targetDate || null,
        comments: comments.trim() || null,
      }
      const memberIds = [...selectedMemberIds]
      const results = await Promise.allSettled(
        memberIds.map((id) => onSuggest(id, selectedSkill.id, selectedSkill.name, payload))
      )
      const failures = memberIds
        .map((id, i) => ({ id, result: results[i] }))
        .filter(({ result }) => result.status === 'rejected')
      if (failures.length === 0) {
        onClose()
        return
      }
      const nameById = new Map(members.map((m) => [m.id, m.name]))
      setSelectedMemberIds(new Set(failures.map((f) => f.id)))
      setError(
        (failures.length < memberIds.length ? `Suggested to ${memberIds.length - failures.length}. ` : '') +
        `Could not suggest to: ${failures.map(({ id, result }) => `${nameById.get(id)} (${result.reason?.message || 'failed'})`).join('; ')}`
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AccessibleDialog
      label="Add a skill for the team"
      onClose={submitting ? undefined : onClose}
      closeOnBackdrop={!submitting}
      panelClassName="w-full max-w-lg bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
      <h2 className="font-display text-xl text-ink mb-1">Add a skill for the team</h2>
      <p className="text-sm text-secondary mb-4">
        Suggest a skill (and optionally a target level/date) to the team members you pick below. They’ll each see it
        on their own Actions page and decide whether to add it to their profile -- this doesn’t touch anyone’s
        skills automatically.
      </p>
      {loadError && <MutationFeedback status="error" message={loadError} className="mb-4" />}
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="relative">
          <label htmlFor="add-team-skill-query" className="block text-sm font-medium text-ink mb-1">Skill</label>
          <input
            id="add-team-skill-query"
            data-dialog-initial-focus
            value={skillQuery}
            disabled={loading || submitting}
            onChange={(e) => { setSkillQuery(e.target.value); setSelectedSkill(null) }}
            placeholder="Search skills…"
            autoComplete="off"
            className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
          />
          {skillQuery.trim() && !selectedSkill && (
            <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-card border border-hairline rounded-md">
              {skillMatches.length === 0 ? (
                <p className="px-3 py-2 text-xs text-secondary">No matching skills.</p>
              ) : (
                skillMatches.map((s) => (
                  <button type="button" key={s.id} onClick={() => chooseSkill(s)}
                    className="block w-full text-left px-3 py-2 text-sm text-ink hover:bg-paper">
                    {s.name}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium text-ink">Team members</span>
            <div className="flex gap-3 text-xs">
              <button type="button" onClick={() => setSelectedMemberIds(new Set(members.map((m) => m.id)))}
                disabled={submitting} className="text-moss hover:underline disabled:opacity-60">
                Select all
              </button>
              <button type="button" onClick={() => setSelectedMemberIds(new Set())}
                disabled={submitting} className="text-moss hover:underline disabled:opacity-60">
                Clear
              </button>
            </div>
          </div>
          <div className="max-h-40 overflow-y-auto rounded-md border border-hairline divide-y divide-hairline">
            {members.map((member) => (
              <label key={member.id} className="flex items-center gap-2 px-3 py-1.5 text-sm text-ink">
                <input type="checkbox" checked={selectedMemberIds.has(member.id)} disabled={submitting}
                  onChange={() => toggleMember(member.id)} className="rounded border-hairline accent-moss" />
                {member.name}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label htmlFor="add-team-skill-level" className="block text-sm font-medium text-ink mb-1">Target level (optional)</label>
          <select id="add-team-skill-level" value={targetLevel} disabled={submitting}
            onChange={(e) => setTargetLevel(e.target.value)}
            className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss">
            <option value="">No target level</option>
            {LEVELS.map((l) => <option key={l} value={l}>{LEVEL_LABELS[l]}</option>)}
          </select>
        </div>
        {targetLevel && (
          <div>
            <label htmlFor="add-team-skill-date" className="block text-sm font-medium text-ink mb-1">Achieve by</label>
            <input id="add-team-skill-date" type="date" required value={targetDate} disabled={submitting}
              onChange={(e) => setTargetDate(e.target.value)}
              className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss" />
          </div>
        )}
        <div>
          <label htmlFor="add-team-skill-comments" className="block text-sm font-medium text-ink mb-1">Comments (optional)</label>
          <textarea id="add-team-skill-comments" rows={3} value={comments} disabled={submitting}
            onChange={(e) => setComments(e.target.value)}
            className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss" />
        </div>
        <MutationFeedback status="error" message={error} />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={submitting} className={actionClass}>Cancel</button>
          <button type="submit" disabled={submitting || !selectedSkill || selectedMemberIds.size === 0}
            className="rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90 disabled:opacity-60">
            {submitting ? 'Sending…' : selectedMemberIds.size > 1 ? `Suggest to ${selectedMemberIds.size}` : 'Suggest skill'}
          </button>
        </div>
      </form>
    </AccessibleDialog>
  )
}
