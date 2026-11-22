// The Skills page's first two sections: skills with something due or overdue,
// then skills with recent activity. Each skill shows in one place only.

// How far back an activity counts as recent.
export const RECENT_ACTIVITY_DAYS = 14

// What is due on each skill, today or earlier: its check-in, its latest
// target's date (while the level isn't reached), and its goals' log or target
// date (while not reached). Only the most pressing reason is kept per skill:
// { kind, date, overdue, goalTitle? }, where overdue means before today.
// latestTargets: the newest target per skill ({ skill_id, target_level,
// target_date }); goalItems: listActiveGoalsForAttention's items.
export function dueReasonsBySkill({ skills, latestTargets = [], goalItems = [], today }) {
  const reasons = new Map()
  const levelBySkillId = new Map(skills.map((skill) => [skill.id, skill.displayedLevel ?? null]))
  const add = (skillId, reason) => {
    if (!levelBySkillId.has(skillId) || !reason.date || reason.date > today) return
    const entry = { ...reason, overdue: reason.date < today }
    const current = reasons.get(skillId)
    if (!current || isMorePressing(entry, current)) reasons.set(skillId, entry)
  }

  for (const skill of skills) add(skill.id, { kind: 'checkin', date: skill.next_checkin_date })
  for (const target of latestTargets) {
    const level = levelBySkillId.get(target.skill_id)
    if (level != null && level >= target.target_level) continue
    add(target.skill_id, { kind: 'target', date: target.target_date })
  }
  for (const { goal, skill, progress, nextLog } of goalItems) {
    if (progress?.reached) {
      // A repeating goal met for this period isn't due a log either.
      continue
    }
    add(skill.id, { kind: 'goalLog', date: nextLog, goalTitle: goal.title })
    add(skill.id, { kind: 'goalDate', date: goal.target_date, goalTitle: goal.title })
  }
  return reasons
}

function isMorePressing(a, b) {
  if (a.overdue !== b.overdue) return a.overdue
  return a.date < b.date
}

// The newest activity date per skill, from the learner's recent activities
// ({ id, skill_id, recorded_at }) and their further skill links
// ({ statement_id, skill_id }).
export function latestActivityBySkill(statements = [], extraLinks = []) {
  const latest = new Map()
  const note = (skillId, recordedAt) => {
    if (!skillId || !recordedAt) return
    if (!latest.has(skillId) || new Date(recordedAt) > new Date(latest.get(skillId))) latest.set(skillId, recordedAt)
  }
  const recordedAtById = new Map()
  for (const row of statements) {
    recordedAtById.set(row.id, row.recorded_at)
    note(row.skill_id, row.recorded_at)
  }
  for (const link of extraLinks) note(link.skill_id, recordedAtById.get(link.statement_id))
  return latest
}

// Splits skills (already filtered, in their usual order) into those due,
// those with recent activity, and the rest. Due: overdue first, then the
// earliest date. Recent: newest activity first. The rest keep their order.
export function splitSkillsForList(skills, dueBySkillId, activityBySkillId) {
  const due = skills
    .filter((skill) => dueBySkillId.has(skill.id))
    .sort((a, b) => {
      const ra = dueBySkillId.get(a.id)
      const rb = dueBySkillId.get(b.id)
      return isMorePressing(ra, rb) ? -1 : isMorePressing(rb, ra) ? 1 : 0
    })
  const recent = skills
    .filter((skill) => !dueBySkillId.has(skill.id) && activityBySkillId.has(skill.id))
    .sort((a, b) => new Date(activityBySkillId.get(b.id)) - new Date(activityBySkillId.get(a.id)))
  const rest = skills.filter((skill) => !dueBySkillId.has(skill.id) && !activityBySkillId.has(skill.id))
  return { due, recent, rest }
}
