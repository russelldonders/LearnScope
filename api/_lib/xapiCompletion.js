// Turns a package's own "completed" / "passed" statement into progress for
// that course item, so a learner doesn't have to mark an xAPI package done
// by hand after the package already reported it.
//
// Only statements about the launched activity itself count -- the activity
// id LearnScope passes to the package at launch (src/lib/adlLaunch.js,
// xapiActivityId in src/lib/courseContent.js). A package that reports
// completing one of its own questions or modules (a different object id)
// doesn't complete the whole item. "failed" changes nothing: the learner can
// still retry, and a fail never undoes an earlier pass.

const VERB_COMPLETED = 'http://adlnet.gov/expapi/verbs/completed'
const VERB_PASSED = 'http://adlnet.gov/expapi/verbs/passed'
const RANK = { not_attempted: 0, incomplete: 1, failed: 1, completed: 2, passed: 3 }

export function launchedActivityId(resourceId) {
  return `https://learnscope.app/xapi/activities/${resourceId}`
}

function scoreOf(statement) {
  const score = statement?.result?.score
  if (typeof score?.scaled === 'number' && Number.isFinite(score.scaled)) return Math.round(score.scaled * 100)
  if (typeof score?.raw === 'number' && Number.isFinite(score.raw)) {
    if (typeof score.max === 'number' && score.max > 0) return Math.round((score.raw / score.max) * 100)
    return score.raw
  }
  return null
}

// The strongest outcome among the statements about the launched activity:
// { status: 'passed' | 'completed', score } or null.
export function completionFromStatements(statements, activityId) {
  let best = null
  for (const statement of statements ?? []) {
    if (statement?.object?.id !== activityId) continue
    if (statement.object.objectType && statement.object.objectType !== 'Activity') continue
    const verb = statement?.verb?.id
    const status = verb === VERB_PASSED ? 'passed' : verb === VERB_COMPLETED ? 'completed' : null
    if (!status) continue
    if (!best || RANK[status] > RANK[best.status]) best = { status, score: scoreOf(statement) }
  }
  return best
}

// Whether an outcome should replace the learner's current progress: never a
// downgrade (a pass stays a pass), and not a repeat of the same status.
export function shouldRecord(outcome, existingStatus) {
  if (!outcome) return false
  return RANK[outcome.status] > (RANK[existingStatus] ?? 0)
}
