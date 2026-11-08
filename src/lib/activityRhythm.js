import { isPeerRatingStatement } from './xapiStatement'
import { localDateString } from './skillGoalProgress'

// How far back the dashboard looks when counting streaks.
export const RHYTHM_LOOKBACK_DAYS = 400

function addDays(dateString, days) {
  const date = new Date(`${dateString}T12:00:00`)
  date.setDate(date.getDate() + days)
  return localDateString(date)
}

// The Monday of the week a day falls in.
function weekStart(dateString) {
  const offset = (new Date(`${dateString}T12:00:00`).getDay() + 6) % 7
  return addDays(dateString, -offset)
}

// The local days on which the learner did something. Rows are
// { recorded_at, extensions } where extensions is the statement's
// result.extensions; a rating someone gave doesn't count as activity.
export function activeDays(rows) {
  const days = new Set()
  for (const row of rows) {
    if (!row?.recorded_at) continue
    if (isPeerRatingStatement({ result: { extensions: row.extensions ?? {} } })) continue
    days.add(localDateString(new Date(row.recorded_at)))
  }
  return days
}

// The last seven days, and how many weeks and days in a row have something
// logged. A streak still counts while the current week (or day) is empty,
// because there's still time to keep it going.
export function activityRhythm(days, today = localDateString()) {
  const lastSeven = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(today, index - 6)
    return { date, logged: days.has(date), isToday: index === 6 }
  })

  const weeks = new Set([...days].map(weekStart))
  const thisWeek = weekStart(today)
  const loggedThisWeek = weeks.has(thisWeek)
  let weekStreak = 0
  for (let week = loggedThisWeek ? thisWeek : addDays(thisWeek, -7); weeks.has(week); week = addDays(week, -7)) {
    weekStreak += 1
  }

  const loggedToday = days.has(today)
  let dayStreak = 0
  for (let day = loggedToday ? today : addDays(today, -1); days.has(day); day = addDays(day, -1)) {
    dayStreak += 1
  }

  return {
    lastSeven,
    daysInLastSeven: lastSeven.filter((day) => day.logged).length,
    weekStreak,
    loggedThisWeek,
    dayStreak,
    loggedToday,
  }
}
