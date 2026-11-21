// How far a learner is through a plan, worked out from the records each item
// points at (see 20261116100000_0295_learner_plans.sql). Nothing here is
// stored: a course counts as done once it's completed, a skill once its level
// reaches the skill's own target, a goal once it's achieved or its target is
// reached. Only resources and free-text steps are ticked off on the plan.
//
// Item states:
//   done        -- finished
//   in_progress -- under way
//   not_started -- nothing yet
//   needs_target-- a skill with no target set, so nothing to measure against
//   stopped     -- a course cancelled or a goal stopped; not counted
//   removed     -- its record was deleted; not counted

import { localDateString } from './skillGoalProgress'
import { formatFullDate } from './dates'

// A goal whose target changed was replaced by a new goal (replaces_goal_id).
// A plan item keeps pointing at the goal it was given, so follow the chain to
// the goal in force now.
export function currentGoal(goalId, goalsById, replacedBy) {
  let id = goalId
  const seen = new Set()
  while (replacedBy.has(id) && !seen.has(id)) {
    seen.add(id)
    id = replacedBy.get(id)
  }
  return goalsById.get(id) ?? null
}

// context:
//   goalsById / replacedBy: the learner's goals, for currentGoal
//   goalProgressById: Map(goalId -> computeGoalProgress result), active goals
//   today: 'YYYY-MM-DD'
export function planItemStatus(item, context) {
  const today = context.today ?? localDateString()
  const state = baseState(item, context)
  const finished = state === 'done' || state === 'stopped' || state === 'removed'
  const dueOn = item.target_on ?? null
  return { state, overdue: !finished && Boolean(dueOn) && dueOn < today }
}

function baseState(item, context) {
  // On a shared plan, an item someone else added that the viewer hasn't yet
  // added to their own records (get_my_learner_plans' needs_link): nothing of
  // theirs to measure yet, but it's still part of the plan.
  if (item.needs_link && ['course', 'skill', 'skill_goal'].includes(item.item_type)) return 'not_started'
  switch (item.item_type) {
    case 'course': {
      const course = item.courses
      if (!item.course_id || !course) return 'removed'
      if (course.status === 'cancelled') return 'stopped'
      if (course.completed_date) return 'done'
      if (course.status === 'planned') return 'not_started'
      return 'in_progress'
    }
    case 'skill': {
      const skill = item.skills
      if (!item.skill_id || !skill) return 'removed'
      const knowledgeTarget = item.plan_knowledge_level
      const practicalTarget = item.plan_practical_level
      if (!knowledgeTarget && !practicalTarget) return 'needs_target'
      const knowledgeReached = !knowledgeTarget || Number(skill.knowledge_level ?? 0) >= Number(knowledgeTarget)
      const practicalReached = !practicalTarget || Number(skill.level ?? 0) >= Number(practicalTarget)
      return knowledgeReached && practicalReached ? 'done' : 'in_progress'
    }
    case 'skill_goal': {
      if (!item.skill_goal_id) return 'removed'
      const goal = currentGoal(item.skill_goal_id, context.goalsById ?? new Map(), context.replacedBy ?? new Map())
      if (!goal) return 'removed'
      if (goal.status === 'achieved') return 'done'
      if (goal.status === 'stopped') return 'stopped'
      const progress = context.goalProgressById?.get(goal.id)
      if (progress?.reached) return 'done'
      return progress?.lastLogged ? 'in_progress' : 'not_started'
    }
    case 'skill_resource':
      if (!item.skill_resource_id || !item.skill_resources) return 'removed'
      return item.completed_on ? 'done' : 'not_started'
    case 'step':
      return item.completed_on ? 'done' : 'not_started'
    default:
      return 'not_started'
  }
}

// Done out of what still counts: stopped and removed items are left out, so
// they neither hold progress back nor count as achieved.
export function summariseProgress(statuses) {
  const counted = statuses.filter((s) => s.state !== 'stopped' && s.state !== 'removed')
  const done = counted.filter((s) => s.state === 'done').length
  const total = counted.length
  return {
    done,
    total,
    percent: total ? Math.round((done / total) * 100) : 0,
    overdue: statuses.filter((s) => s.overdue).length,
  }
}

// Which items are locked in a plan worked through in order
// (learner_plans.sequence). `lists` are the plan's activity lists in the
// order shown -- the top of the plan, then each section. In 'plan' order
// they run on from one to the next; in 'sections' order each is its own.
// An item is locked while anything before it isn't finished; stopped and
// removed items count as finished, so they never hold the rest up.
export function sequenceLocks(sequence, lists, statusById) {
  const locked = new Set()
  if (sequence !== 'plan' && sequence !== 'sections') return locked
  const runs = sequence === 'plan' ? [lists.flat()] : lists
  for (const items of runs) {
    let open = true
    for (const item of items) {
      if (!open) locked.add(item.id)
      const state = statusById.get(item.id)?.state ?? 'not_started'
      if (!['done', 'stopped', 'removed'].includes(state)) open = false
    }
  }
  return locked
}

// 'YYYY-MM-DD' plus a period. A month on from the 31st lands on the last
// day of a shorter month rather than spilling into the next.
export function addPeriod(day, amount, unit) {
  const [year, month, date] = day.split('-').map(Number)
  const result = new Date(Date.UTC(year, month - 1, date))
  if (unit === 'months') {
    const target = new Date(Date.UTC(year, month - 1 + amount, 1))
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
    target.setUTCDate(Math.min(date, lastDay))
    return target.toISOString().slice(0, 10)
  }
  result.setUTCDate(result.getUTCDate() + amount * (unit === 'weeks' ? 7 : 1))
  return result.toISOString().slice(0, 10)
}

// The viewer's own timeframe on a plan: its fixed dates, or, for a plan
// given as a period from when each person starts (duration_amount and
// duration_unit), from the later of the plan's start and the day they
// joined it to that period on. A plan still being prepared hasn't started.
//   { startsOn, targetOn, period: { amount, unit } | null }
export function planTimeframe(plan) {
  if (!plan.duration_amount || !plan.duration_unit) {
    return { startsOn: plan.starts_on ?? null, targetOn: plan.target_on ?? null, period: null }
  }
  const period = { amount: Number(plan.duration_amount), unit: plan.duration_unit }
  if (plan.status === 'planning') return { startsOn: null, targetOn: null, period }
  const startsOn = [plan.starts_on, plan.my_joined_on].filter(Boolean).sort().at(-1) ?? null
  return { startsOn, targetOn: startsOn ? addPeriod(startsOn, period.amount, period.unit) : null, period }
}

// How much of the plan's timeframe has passed, 0-100, or null without both
// dates. Compared with percent done, it says whether the learner is on track.
export function timeElapsedPercent(plan, today = localDateString()) {
  // The viewer's own timeframe, for a plan given as a period.
  const { startsOn, targetOn } = planTimeframe(plan)
  if (!startsOn || !targetOn) return null
  const start = Date.parse(`${startsOn}T00:00:00`)
  const end = Date.parse(`${targetOn}T00:00:00`)
  const now = Date.parse(`${today}T00:00:00`)
  if (end <= start) return now >= end ? 100 : 0
  return Math.max(0, Math.min(100, Math.round(((now - start) / (end - start)) * 100)))
}

// 'ahead' | 'on_track' | 'behind' | null: done compared with time gone, with
// a little slack so a plan isn't "behind" a day after it starts.
export function paceOf(progress, elapsed) {
  if (elapsed == null || progress.total === 0) return null
  if (progress.percent >= 100) return 'ahead'
  const gap = progress.percent - elapsed
  if (gap >= 10) return 'ahead'
  if (gap <= -15) return 'behind'
  return 'on_track'
}

// "6 months", "1 week": a plan's period in words.
export function formatPlanPeriod(period, t) {
  return t(`plans.period.units.${period.unit}.${period.amount === 1 ? 'one' : 'other'}`, { count: period.amount })
}

// A plan's timeframe in a line, as the viewer sees it: its fixed dates, or
// its period from when they start, with their own end date once they have.
export function formatPlanTimeframe(plan, t, { short = false } = {}) {
  const { startsOn, targetOn, period } = planTimeframe(plan)
  if (period) {
    const text = formatPlanPeriod(period, t)
    return targetOn ? t('plans.period.yours', { period: text, date: formatFullDate(targetOn) }) : t('plans.period.summary', { period: text })
  }
  if (!short && startsOn && targetOn) return t('plans.timeframe', { start: formatFullDate(startsOn), end: formatFullDate(targetOn) })
  return targetOn ? t('plans.byDate', { date: formatFullDate(targetOn) }) : t('plans.noEndDate')
}

// What a member records of their progress on a plan (record_learner_plan_progress):
// done out of total, and, on an organisation's plan only, each step's status,
// which the organisation sees (0328). A personal plan's owners see the counts.
export function planProgressEntry(plan, context) {
  const statuses = plan.items.map((item) => ({ itemId: item.id, ...planItemStatus(item, context) }))
  const { done, total } = summariseProgress(statuses)
  return {
    planId: plan.id,
    done,
    total,
    ...(plan.organisation_id ? { items: statuses.map((s) => ({ item_id: s.itemId, status: s.state })) } : {}),
  }
}
