import { formatMonthYear } from './dates'
import { english } from './i18n/translations'
import { relatedSkillsFromStatement } from './xapiStatement'

// The experience page's rules and calculations (see pages/ExperienceDetail.jsx):
// date checks against a parent experience, the page's timeline and tabs,
// and how a skill's level moved while the experience lasted.

// A plain (non-component) translator used as this function's default `t` --
// falls back to English so every existing caller/test that doesn't pass one
// (this is exported and used outside the React tree) keeps working exactly
// as before. The real page passes its live useLanguage() `t` through instead.
function defaultT(key, params) {
  const value = key.split('.').reduce((v, part) => v?.[part], english)
  if (typeof value !== 'string' || !params) return value ?? key
  return value.replace(/\{(\w+)\}/g, (match, name) => (name in params ? params[name] : match))
}

// Keeps a nested experience's dates from silently
// drifting outside the parent role's dates -- an open-ended parent
// (end_date null) places no upper bound on its children.
export function validateWithinParent(values, parent, t = defaultT) {
  if (!parent) return null
  if (values.start_date && values.start_date < parent.start_date) {
    return t('experience.startDateBeforeParentStart', { date: formatMonthYear(parent.start_date), title: parent.title })
  }
  if (parent.end_date) {
    if (values.start_date && values.start_date > parent.end_date) {
      return t('experience.startDateAfterParentEnd', { date: formatMonthYear(parent.end_date), title: parent.title })
    }
    if (values.end_date && values.end_date > parent.end_date) {
      return t('experience.endDateAfterParentEnd', { date: formatMonthYear(parent.end_date), title: parent.title })
    }
    if (values.type !== 'subject' && !values.end_date) {
      return t('experience.endDateAfterParentEnd', { date: formatMonthYear(parent.end_date), title: parent.title })
    }
  }
  if (values.end_date && values.end_date < parent.start_date) {
    return t('experience.endDateBeforeParentStart', { date: formatMonthYear(parent.start_date), title: parent.title })
  }
  if (values.start_date && values.end_date && values.end_date < values.start_date) {
    return t('experience.endDateBeforeStartDate')
  }
  return null
}

function undatedChildTimelineDate(item, today) {
  const start = item.start_date
    ? new Date(`${item.start_date}T00:00:00Z`).getTime()
    : today.getTime()
  const end = item.end_date
    ? new Date(`${item.end_date}T00:00:00Z`).getTime()
    : today.getTime()
  return new Date(start + Math.max(0, end - start) / 2).toISOString()
}

export function buildExperienceTimelineEvents(item, childExperiences, linkedCourses, achievements, activities = [], today = new Date()) {
  const undatedChildDate = undatedChildTimelineDate(item, today)
  return [
    ...(item.start_date ? [{ type: 'start', date: item.start_date }] : []),
    ...(item.start_date ? [item.end_date ? { type: 'end', date: item.end_date } : { type: 'today', date: today.toISOString() }] : []),
    ...(childExperiences ?? []).map((child) => ({
      type: 'child',
      date: child.start_date ?? undatedChildDate,
      child,
    })),
    ...linkedCourses
      .filter((link) => link.courses?.completed_date)
      .map((link) => ({ type: 'course', date: link.courses.completed_date, link })),
    ...achievements.map((entry) => ({ type: 'achievement', date: entry.assessed_at, entry })),
    ...activities.map((activity) => ({ type: 'activity', date: activity.recorded_at, activity })),
  ].sort((a, b) => dateKey(b.date).localeCompare(dateKey(a.date)))
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'courses', label: 'Courses' },
  { id: 'skills', label: 'Skills' },
]

export function getExperienceTabs(item, linkedCourses) {
  return TABS.filter((tab) => {
    if (tab.id === 'courses') return !item.parent_experience_id && linkedCourses.length > 0
    // Skill management (adding/suggesting/viewing what's being worked on)
    // only makes sense for a still-open experience -- a historical one is
    // done, so there's nothing left to add to it.
    if (tab.id === 'skills') return !item.end_date
    return true
  })
}

function dateKey(value) {
  return value ? new Date(value).toISOString().slice(0, 10) : null
}

export function buildExperienceSkillProgress(skillLink, assessments, item, today = new Date()) {
  const startDate = dateKey(item.start_date)
  const endDate = dateKey(item.end_date ?? today)
  const rows = assessments
    .filter((entry) => entry.skill_id === skillLink.skill_id && entry.level)
    .sort((a, b) => dateKey(a.assessed_at).localeCompare(dateKey(b.assessed_at)))
  const entryAssessment = [...rows].reverse().find((entry) => dateKey(entry.assessed_at) <= startDate)
  const duringRole = rows.filter((entry) => {
    const assessedDate = dateKey(entry.assessed_at)
    return assessedDate >= startDate && assessedDate <= endDate
  })
  const exitAssessment = item.end_date
    ? [...rows].reverse().find((entry) => dateKey(entry.assessed_at) <= endDate)
    : null

  return {
    entryLevel: entryAssessment?.level ?? null,
    endLevel: item.end_date ? (exitAssessment?.level ?? null) : (skillLink.skills?.level ?? null),
    // A translation key, not display text -- this is a plain (non-component)
    // function with no useLanguage() access, so the actual t() lookup
    // happens where this is rendered (SkillLevelPoint), same reasoning as
    // validateWithinParent's defaultT fallback above.
    endLabel: item.end_date ? 'experience.whenRoleEnded' : 'skillDetail.currentLevel',
    duringRole,
  }
}

export function getDevelopedSkills(skillLinks, assessments, item, today = new Date()) {
  return skillLinks
    .map((link) => ({ link, progress: buildExperienceSkillProgress(link, assessments, item, today) }))
    .filter(({ progress }) => progress.entryLevel && progress.endLevel > progress.entryLevel)
}

// An activity's statement carries its full related-skill list (not just the
// row's primary skill_id) -- checked here rather than the column so a
// skill tagged as a secondary related skill still counts as "worked on".
export function activityIncludesSkill(activity, skillId) {
  return relatedSkillsFromStatement(activity.statement).some((s) => s.id === skillId)
}
