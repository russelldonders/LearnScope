import { useCallback, useEffect, useMemo, useState } from 'react'
import PersonAvatar from '../../components/PersonAvatar'
import GrowthRing from '../../components/GrowthRing'
import KnowledgeLevelBar from '../../components/KnowledgeLevelBar'
import MutationFeedback from '../../components/MutationFeedback'
import AccessibleDialog from '../../components/AccessibleDialog'
import { LEVELS, LEVEL_LABELS, KNOWLEDGE_LEVEL_LABELS } from '../../lib/levels'
import { formatAbsoluteDate } from '../../lib/dates'
import { listLibrarySkills } from '../../lib/skillLibrary'
import { RateSkillDialog } from './ManagerTeamPanel'

const actionClass = 'rounded-md border border-hairline px-3 py-2 text-sm font-medium text-ink hover:bg-paper focus-visible:outline-2 focus-visible:outline-moss'

export default function ManagerMemberProfile({
  member, initialSkillId = null, onBack, onRateSkill, onLoadSkillAssessments, onLoadSkillDetail, onSetTarget, onSuggestSkill,
}) {
  const [skillId, setSkillId] = useState(initialSkillId)
  const [suggestOpen, setSuggestOpen] = useState(false)
  const skill = member.sharedSkills?.find((item) => item.id === skillId)
  return <div className="space-y-6">
    <nav aria-label="Team profile navigation" className="flex flex-wrap gap-3 text-sm">
      <button className="text-moss underline underline-offset-4" onClick={onBack}>Back to team</button>
      {skill && <button className="text-moss underline underline-offset-4" onClick={() => setSkillId(null)}>Back to {member.name}’s skills</button>}
    </nav>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <PersonAvatar name={member.name} avatarUrl={member.avatarUrl} size={10} />
        <div><h2 className="font-display text-2xl text-ink">{member.name}’s skills profile</h2>
          <p className="text-sm text-secondary">Skills shared with you · Select a skill to review progress, rate it and set targets.</p></div>
      </div>
      {!skill && onSuggestSkill && (
        <button type="button" onClick={() => setSuggestOpen(true)} className={`${actionClass} shrink-0`}>
          Suggest a skill
        </button>
      )}
    </div>
    {skill ? <ManagerSkillDetail key={skill.id} member={member} skill={skill} onRateSkill={onRateSkill}
      onLoadSkillAssessments={onLoadSkillAssessments} onLoadSkillDetail={onLoadSkillDetail} onSetTarget={onSetTarget} />
      : <div className="divide-y divide-hairline border-y border-hairline">
        {member.sharedSkills?.length ? member.sharedSkills.map((item) => <button key={item.id}
          onClick={() => setSkillId(item.id)} aria-label={`View skill detail for ${item.name}`}
          className="flex w-full items-center gap-4 py-4 px-2 text-left hover:bg-card focus-visible:outline-2 focus-visible:outline-moss">
          <GrowthRing level={item.level} size={56} />
          <span className="min-w-0 flex-1"><span className="block font-medium text-ink">{item.name}</span>
            <span className="block text-sm text-secondary">{LEVEL_LABELS[item.level] ?? 'Not yet self-assessed'} · {item.evidenceCount ?? 0} evidence items</span></span>
          <span className="text-sm text-moss">View skill detail</span>
        </button>) : <p className="py-8 text-sm text-secondary">No skills shared yet. Their skills will appear here when they share them with you.</p>}
      </div>}
    {suggestOpen && (
      <SuggestSkillModal member={member} onClose={() => setSuggestOpen(false)}
        onSuggest={(skillLibraryId, skillName, payload) => onSuggestSkill(member.id, skillLibraryId, skillName, payload)} />
    )}
  </div>
}

// Push, don't force -- mirrors AssignSkillModal (src/pages/employer/
// EmployerConsole.jsx) exactly, scoped to this one member instead of a
// bulk-selected roster. Never creates or modifies the member's own skills/
// skill_targets rows itself; they still choose to add it (or not) from
// their own Actions page. Skill choices come from listLibrarySkills, the
// same active, public-or-own-private library search every learner-facing
// "Find skill" flow already uses.
function SuggestSkillModal({ member, onClose, onSuggest }) {
  const [librarySkills, setLibrarySkills] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [skillQuery, setSkillQuery] = useState('')
  const [selectedSkill, setSelectedSkill] = useState(null)
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

  async function handleSubmit(event) {
    event.preventDefault()
    if (!selectedSkill) return
    if (targetLevel && !targetDate) {
      setError('A target date is required when a target level is set.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await onSuggest(selectedSkill.id, selectedSkill.name, {
        targetLevel: targetLevel ? Number(targetLevel) : null,
        targetDate: targetDate || null,
        comments: comments.trim() || null,
      })
      onClose()
    } catch (err) {
      setError(err.message || 'Could not suggest this skill. Try again.')
      setSubmitting(false)
    }
  }

  return (
    <AccessibleDialog
      label="Suggest a skill"
      onClose={submitting ? undefined : onClose}
      closeOnBackdrop={!submitting}
      panelClassName="w-full max-w-lg bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
      <h2 className="font-display text-xl text-ink mb-1">Suggest a skill</h2>
      <p className="text-sm text-secondary mb-4">
        Suggest a skill (and optionally a target level/date) to {member.name}. They’ll see it on their Actions page
        and decide whether to add it to their own profile -- this doesn’t touch their skills automatically.
      </p>
      {loadError && <MutationFeedback status="error" message={loadError} className="mb-4" />}
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="relative">
          <label htmlFor="suggest-skill-query" className="block text-sm font-medium text-ink mb-1">Skill</label>
          <input
            id="suggest-skill-query"
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
          <label htmlFor="suggest-skill-level" className="block text-sm font-medium text-ink mb-1">Target level (optional)</label>
          <select id="suggest-skill-level" value={targetLevel} disabled={submitting}
            onChange={(e) => setTargetLevel(e.target.value)}
            className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss">
            <option value="">No target level</option>
            {LEVELS.map((l) => <option key={l} value={l}>{LEVEL_LABELS[l]}</option>)}
          </select>
        </div>
        {targetLevel && (
          <div>
            <label htmlFor="suggest-skill-date" className="block text-sm font-medium text-ink mb-1">Achieve by</label>
            <input id="suggest-skill-date" type="date" required value={targetDate} disabled={submitting}
              onChange={(e) => setTargetDate(e.target.value)}
              className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss" />
          </div>
        )}
        <div>
          <label htmlFor="suggest-skill-comments" className="block text-sm font-medium text-ink mb-1">Comments (optional)</label>
          <textarea id="suggest-skill-comments" rows={3} value={comments} disabled={submitting}
            onChange={(e) => setComments(e.target.value)}
            className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss" />
        </div>
        <MutationFeedback status="error" message={error} />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={submitting} className={actionClass}>Cancel</button>
          <button type="submit" disabled={submitting || !selectedSkill} className="rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90 disabled:opacity-60">
            {submitting ? 'Sending…' : 'Suggest skill'}
          </button>
        </div>
      </form>
    </AccessibleDialog>
  )
}

function ManagerSkillDetail({ member, skill, onRateSkill, onLoadSkillAssessments, onLoadSkillDetail, onSetTarget }) {
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [revision, setRevision] = useState(0)
  const [ratingOpen, setRatingOpen] = useState(false)
  const [targetOpen, setTargetOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [savedRating, setSavedRating] = useState(null)
  const loadHistory = useCallback(() => onLoadSkillAssessments?.(member.id, skill.id), [onLoadSkillAssessments, member.id, skill.id])
  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    Promise.resolve().then(() => onLoadSkillDetail?.(member.id, skill.id))
      .then((data) => { if (active) setDetail(data ?? { targets: [], assessments: [] }) })
      .catch((err) => { if (active) setError(err.message || 'Could not load skill detail. Try again.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [member.id, skill.id, onLoadSkillDetail, revision])
  const target = detail?.targets?.[0]
  return <section aria-label={`${skill.name} skill detail`} className="space-y-6">
    <h3 className="font-display text-2xl text-ink">{skill.name}</h3>
    {loading ? <p role="status" className="text-sm text-secondary">Loading skill detail…</p> : error ? <div>
      <MutationFeedback status="error" message={error} /><button className={actionClass} onClick={() => setRevision((n) => n + 1)}>Retry skill detail</button>
    </div> : <>
      <div className="grid gap-6 sm:grid-cols-2 border-y border-hairline py-6">
        <div className="flex gap-4 items-center"><GrowthRing level={detail?.level ?? skill.level} size={80} targetLevel={target?.target_level} />
          <div><h4 className="font-medium text-ink">Can do</h4><p className="text-secondary">{LEVEL_LABELS[detail?.level ?? skill.level] ?? 'Not yet self-assessed'}</p>
            <p className="text-xs text-secondary">Learner’s self-assessment</p></div></div>
        <div className="flex items-center gap-4"><KnowledgeLevelBar level={detail?.knowledge_level} size={64} />
          <div><h4 className="font-medium text-ink">Understands</h4><p className="text-sm text-secondary">{KNOWLEDGE_LEVEL_LABELS[detail?.knowledge_level] ?? 'Not yet assessed'}</p></div></div>
      </div>
      <section className="space-y-2"><h4 className="font-display text-lg text-ink">Your assessment</h4>
        <p className="text-sm text-secondary">Practical skill rating: {LEVEL_LABELS[savedRating ?? skill.managerRating?.level] ?? 'Not rated yet'}</p>
        {onRateSkill && <button className={actionClass} onClick={() => setRatingOpen(true)}>Rate skill</button>}
      </section>
      <section className="space-y-3"><h4 className="font-display text-lg text-ink">Target</h4>
        {target ? <div className="text-sm text-secondary"><p className="font-medium text-ink">{LEVEL_LABELS[target.target_level]} · By {formatAbsoluteDate(target.target_date)}</p>
          {target.set_by_manager && <p>Set by manager</p>}{target.comments && <p className="mt-1 whitespace-pre-wrap">{target.comments}</p>}</div>
          : <p className="text-sm text-secondary">No target set yet. Agree a level and date to work towards.</p>}
        {onSetTarget && !targetOpen && <button className={actionClass} onClick={() => setTargetOpen(true)}>{target ? 'Set new target' : 'Set target'}</button>}
        {targetOpen && <TargetForm current={target} onCancel={() => setTargetOpen(false)} onSave={async (payload) => {
          const saved = await onSetTarget(member.id, skill.id, payload)
          setDetail((previous) => ({ ...previous, targets: [saved, ...(previous.targets ?? [])] }))
          setTargetOpen(false)
          setNotice('Target saved. It is now visible in the learner’s skill detail.')
        }} />}
      </section>
      <p role="status" className="text-sm text-moss">{notice}</p>
      <section className="space-y-3"><h4 className="font-display text-lg text-ink">Self-assessment history</h4>
        {detail?.assessments?.length ? detail.assessments.map((entry) => <div key={entry.id} className="border-b border-hairline pb-3 text-sm">
          <p className="text-ink">{LEVEL_LABELS[entry.level] ?? 'Not assessed'} · {formatAbsoluteDate(entry.assessed_at)}</p>
          {entry.comments && <p className="text-secondary whitespace-pre-wrap">{entry.comments}</p>}
        </div>) : <p className="text-sm text-secondary">No self-assessments recorded yet.</p>}
      </section>
    </>}
    {ratingOpen && <RateSkillDialog member={member} skill={skill} onClose={() => setRatingOpen(false)} onLoadHistory={loadHistory}
      onRate={async (payload) => { await onRateSkill(member.id, skill.id, payload); setSavedRating(payload.level); setNotice('Rating saved.'); }} />}
  </section>
}

function TargetForm({ current, onSave, onCancel }) {
  const [level, setLevel] = useState(current?.target_level ?? 3)
  const [date, setDate] = useState('')
  const [comments, setComments] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  return <form className="max-w-lg space-y-3" onSubmit={async (event) => {
    event.preventDefault(); setSaving(true); setError(null)
    try { await onSave({ level, date, comments: comments.trim() }) }
    catch (err) { setError(err.message || 'Could not save target. Try again.'); setSaving(false) }
  }}>
    <fieldset disabled={saving} className="space-y-3">
      <legend className="text-sm text-secondary mb-3">This target will appear in the learner’s skill detail.</legend>
      <label className="block text-sm text-ink">Target level<select value={level} onChange={(e) => setLevel(Number(e.target.value))} className="mt-1 block w-full rounded-md border border-hairline bg-card p-2">
        {LEVELS.map((value) => <option value={value} key={value}>{LEVEL_LABELS[value]}</option>)}
      </select></label>
      <label className="block text-sm text-ink">Achieve by<input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 block w-full rounded-md border border-hairline bg-card p-2" /></label>
      <label className="block text-sm text-ink">What should they work towards? (optional)<textarea rows={3} value={comments} onChange={(e) => setComments(e.target.value)} className="mt-1 block w-full rounded-md border border-hairline bg-card p-2" /></label>
      <MutationFeedback status="error" message={error} />
      <div className="flex gap-2"><button type="submit" className="rounded-md bg-moss text-paper px-4 py-2 text-sm disabled:opacity-60">{saving ? 'Saving…' : 'Save target'}</button>
        <button type="button" className={actionClass} onClick={onCancel}>Cancel</button></div>
    </fieldset>
  </form>
}
