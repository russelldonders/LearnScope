// The Skills page's first sections: skills with something due or overdue,
// then skills with recent activity, then neglected skills. Each skill shows
// in one place only.

// How far back an activity counts as recent.
export const RECENT_ACTIVITY_DAYS = 14
// How long without any activity before a skill counts as neglected.
export const NEGLECTED_AFTER_DAYS = 60

const DAY_MS = 24 * 60 * 60 * 1000

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
    // A goal reached (for this period, on a repeating one) isn't due a log.
    if (progress?.reached) continue
    add(skill.id, { kind: 'goalLog', date: nextLog, goalTitle: goal.title })
    add(skill.id, { kind: 'goalDate', date: goal.target_date, goalTitle: goal.title })
  }
  return reasons
}

function isMorePressing(a, b) {
  if (a.overdue !== b.overdue) return a.overdue
  return a.date < b.date
}

// The newest activity date per skill, from rows of { skill_id, recorded_at }:
// the learner's activities, and the further skills each is linked to.
export function latestActivityBySkill(rows = []) {
  const latest = new Map()
  for (const { skill_id: skillId, recorded_at: recordedAt } of rows) {
    if (!skillId || !recordedAt) continue
    if (!latest.has(skillId) || new Date(recordedAt) > new Date(latest.get(skillId))) latest.set(skillId, recordedAt)
  }
  return latest
}

// Splits skills (already filtered, in their usual order) into those due,
// those with recent activity, neglected ones, and the rest.
// - Due: overdue first, then the earliest date.
// - Recent: activity in the last RECENT_ACTIVITY_DAYS, newest first.
// - Neglected: no activity in NEGLECTED_AFTER_DAYS (or none at all, on a
//   skill tracked for longer than that), longest neglected first.
// The rest keep their order.
export function splitSkillsForList(skills, dueBySkillId, activityBySkillId, now = new Date()) {
  const recentSince = now.getTime() - RECENT_ACTIVITY_DAYS * DAY_MS
  const neglectedBefore = now.getTime() - NEGLECTED_AFTER_DAYS * DAY_MS
  const lastActivity = (skill) => {
    const date = activityBySkillId.get(skill.id)
    return date ? new Date(date).getTime() : null
  }
  // Since when nothing has happened: the last activity, else when it was added.
  const quietSince = (skill) => lastActivity(skill) ?? (skill.date_added ? new Date(skill.date_added).getTime() : null)

  const due = []
  const recent = []
  const neglected = []
  const rest = []
  for (const skill of skills) {
    const last = lastActivity(skill)
    const quiet = quietSince(skill)
    if (dueBySkillId.has(skill.id)) due.push(skill)
    else if (last != null && last >= recentSince) recent.push(skill)
    else if (quiet != null && quiet < neglectedBefore) neglected.push(skill)
    else rest.push(skill)
  }
  due.sort((a, b) => {
    const ra = dueBySkillId.get(a.id)
    const rb = dueBySkillId.get(b.id)
    return isMorePressing(ra, rb) ? -1 : isMorePressing(rb, ra) ? 1 : 0
  })
  recent.sort((a, b) => lastActivity(b) - lastActivity(a))
  neglected.sort((a, b) => quietSince(a) - quietSince(b))
  return { due, recent, neglected, rest }
}

// "Last activity …" in days, weeks, months or years, as a translation key and
// its count. Null without an activity.
export function lastActivityLabel(recordedAt, now = new Date()) {
  if (!recordedAt) return null
  const day = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const days = Math.round((day(now) - day(new Date(recordedAt))) / DAY_MS)
  if (days <= 0) return { key: 'skills.sections.lastActivity.today' }
  if (days === 1) return { key: 'skills.sections.lastActivity.yesterday' }
  if (days < 14) return { key: 'skills.sections.lastActivity.daysAgo', count: days }
  if (days < 60) return { key: 'skills.sections.lastActivity.weeksAgo', count: Math.floor(days / 7) }
  if (days < 730) return { key: 'skills.sections.lastActivity.monthsAgo', count: Math.floor(days / 30) }
  return { key: 'skills.sections.lastActivity.yearsAgo', count: Math.floor(days / 365) }
}
