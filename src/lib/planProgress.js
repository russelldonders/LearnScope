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
//   latestTargetBySkill: Map(skillId -> { target_level, target_date })
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
      const target = context.latestTargetBySkill?.get(skill.id)
      if (!target) return 'needs_target'
      return Number(skill.level ?? 0) >= Number(target.target_level) ? 'done' : 'in_progress'
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

// How much of the plan's timeframe has passed, 0-100, or null without both
// dates. Compared with percent done, it says whether the learner is on track.
export function timeElapsedPercent(plan, today = localDateString()) {
  if (!plan.starts_on || !plan.target_on) return null
  const start = Date.parse(`${plan.starts_on}T00:00:00`)
  const end = Date.parse(`${plan.target_on}T00:00:00`)
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
