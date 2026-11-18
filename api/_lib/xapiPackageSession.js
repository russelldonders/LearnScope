import { completionFromStatements, launchedActivityId } from './xapiCompletion.js'

// One activity on a skill for each time a learner opens an xAPI package
// resource (0316): "Did it: Fire drill · 14m · Earned: Gold stamp". The
// package's own statements stay tied to the resource; this is what the
// skill's activity list, goals and the Activity page show for the session.
//
// These IRIs must match src/lib/xapiStatement.js (checked by this module's
// test), where the rest of the app reads them.
export const SKILL_EXTENSION_IRI = 'https://learnscope.app/xapi/extensions/skill'
export const PROVENANCE_EXTENSION_IRI = 'https://learnscope.app/xapi/extensions/provenance'
export const PACKAGE_SESSION_EXTENSION_IRI = 'https://learnscope.app/xapi/extensions/package-session'
export const PACKAGE_PROVENANCE_SOURCE = 'package'

const VERBS = {
  passed: { id: 'http://adlnet.gov/expapi/verbs/passed', display: 'Passed' },
  failed: { id: 'http://adlnet.gov/expapi/verbs/failed', display: "Didn't pass" },
  completed: { id: 'http://adlnet.gov/expapi/verbs/completed', display: 'Finished it' },
  experienced: { id: 'http://adlnet.gov/expapi/verbs/experienced', display: 'Did it' },
}
const VERB_FAILED = VERBS.failed.id
// A launch session lasts at most 4 hours (0080), so no session runs longer.
const MAX_SESSION_MS = 4 * 60 * 60 * 1000
const MAX_EARNED_NAMES = 20

function nameOf(object) {
  const names = object?.definition?.name
  if (!names || typeof names !== 'object') return null
  const name = names['en-US'] ?? names['en-GB'] ?? names.en ?? Object.values(names)[0]
  return typeof name === 'string' && name.trim() ? name.trim().slice(0, 200) : null
}

// Stamps, badges and the like the package said were earned, by name, once each.
export function earnedNames(statements) {
  const names = []
  for (const statement of statements ?? []) {
    if (!/\/earned$/i.test(statement?.verb?.id ?? '')) continue
    const name = nameOf(statement.object)
    if (name && !names.includes(name)) names.push(name)
    if (names.length >= MAX_EARNED_NAMES) break
  }
  return names
}

function isoDuration(ms) {
  const minutes = Math.round(ms / 60000)
  if (minutes < 1) return null
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return `PT${hours ? `${hours}H` : ''}${rest || !hours ? `${rest}M` : ''}`
}

// session: the launch session row (id, user_id, skill_resource_id,
// created_at, summary_statement_id). rows: its statements, each with when
// the server received it ({ statement, received_at }). Returns the
// xapi_statements row to upsert. Its time runs from the launch to the last
// statement received, within the session's own lifetime -- never from the
// package's own timestamps, so a package can't stretch it.
export function buildSessionActivity({ session, rows, resourceTitle, skill = null }) {
  const statements = rows.map((row) => row.statement)
  const start = new Date(session.created_at)
  const latest = Math.max(start.getTime(), ...rows.map((row) => new Date(row.received_at).getTime()).filter(Number.isFinite))
  const end = Math.min(latest, start.getTime() + MAX_SESSION_MS)

  const outcome = completionFromStatements(statements, launchedActivityId(session.skill_resource_id))
  const failed = !outcome && statements.some((s) => s?.verb?.id === VERB_FAILED && s?.object?.id === launchedActivityId(session.skill_resource_id))
  const verb = outcome ? VERBS[outcome.status] : failed ? VERBS.failed : VERBS.experienced
  const earned = earnedNames(statements)
  const title = (resourceTitle ?? '').trim() || 'Course package'

  const result = {}
  const duration = isoDuration(end - start.getTime())
  if (duration) result.duration = duration
  if (outcome?.status === 'passed' || outcome?.status === 'completed') result.completion = true
  if (outcome?.status === 'passed') result.success = true
  if (failed) result.success = false
  if (typeof outcome?.score === 'number' && outcome.score >= 0 && outcome.score <= 100) result.score = { scaled: outcome.score / 100 }

  const statement = {
    id: session.summary_statement_id,
    actor: { objectType: 'Agent', account: { homePage: 'https://learnscope.app', name: session.user_id } },
    verb: { id: verb.id, display: { 'en-US': verb.display } },
    object: {
      id: launchedActivityId(session.skill_resource_id),
      objectType: 'Activity',
      definition: {
        name: { 'en-US': title },
        ...(earned.length ? { description: { 'en-US': `Earned: ${earned.join(', ')}` } } : {}),
      },
    },
    timestamp: start.toISOString(),
    ...(Object.keys(result).length ? { result } : {}),
    context: {
      extensions: {
        ...(skill ? { [SKILL_EXTENSION_IRI]: [{ id: skill.id, name: skill.name }] } : {}),
        [PROVENANCE_EXTENSION_IRI]: { source: PACKAGE_PROVENANCE_SOURCE, externalId: session.id },
        [PACKAGE_SESSION_EXTENSION_IRI]: {
          resourceId: session.skill_resource_id,
          sessionId: session.id,
          statementCount: rows.length,
          earned,
        },
      },
    },
  }

  return {
    id: session.summary_statement_id,
    user_id: session.user_id,
    skill_id: skill?.id ?? null,
    // Not the resource's own statements (skill_resource_id), which the
    // activity lists leave out: this is the activity they show instead.
    skill_resource_id: null,
    resource_id: null,
    launch_session_id: session.id,
    recorded_at: start.toISOString(),
    statement,
  }
}
