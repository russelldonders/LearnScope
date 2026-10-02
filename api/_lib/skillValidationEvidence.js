// Loads everything the AI validation weighs straight from the database, so a
// "validated" result can only rest on evidence the learner actually has --
// never on a target level, activities or peer ratings the browser sent.
//
// api/ can't import src/lib (its extensionless imports don't resolve under
// Node's ESM loader on Vercel), so the level labels and rater weighting below
// mirror src/lib/levels.js and src/lib/skillLifecycle.js. The colocated test
// fails if either copy drifts.

export const LEVEL_LABELS = { 1: 'Beginner', 2: 'Developing', 3: 'Capable', 4: 'Skilled', 5: 'Expert' }

// Forward lifecycle flow, in order, with the learner-facing label for each.
const FLOW_STAGES = [
  ['identified', 'Getting Started'],
  ['confirming_baseline', 'Confirming Baseline'],
  ['baseline_assessed', 'Target Setting'],
  ['target_set', 'Developing'],
  ['developing', 'Demonstrating'],
  ['demonstrated', 'Validating'],
  ['validated', 'Maintaining'],
  ['maintained', 'Maintaining'],
]
const STAGE_LABELS = Object.fromEntries(FLOW_STAGES)
const VALIDATED_INDEX = FLOW_STAGES.findIndex(([value]) => value === 'validated')

export function lifecycleWeight(stage) {
  const idx = FLOW_STAGES.findIndex(([value]) => value === stage)
  if (idx < 0) return 1
  return 1 + (Math.min(idx, VALIDATED_INDEX) / VALIDATED_INDEX) * 2
}

const DIAGNOSTIC_EXTENSION_IRI = 'https://learnscope.app/xapi/extensions/diagnostic'
const PEER_RATING_EXTENSION_IRI = 'https://learnscope.app/xapi/extensions/peer-rating'

// Diagnostic quizzes and connection ratings are logged as statements too, but
// neither is practical activity -- same exclusion as SkillDetail's
// practicalStatements.
function isPracticalStatement(statement) {
  const extensions = statement?.result?.extensions
  return !extensions?.[DIAGNOSTIC_EXTENSION_IRI] && !extensions?.[PEER_RATING_EXTENSION_IRI]
}

function localised(map, fallback) {
  if (!map) return fallback
  return map['en-US'] ?? Object.values(map)[0] ?? fallback
}

export function toActivity(row) {
  const statement = row.statement ?? {}
  return {
    verb: localised(statement.verb?.display, statement.verb?.id ?? '(verb)'),
    activity: localised(statement.object?.definition?.name, '(untitled activity)'),
    description: statement.object?.definition?.description?.['en-US'] ?? null,
    date: String(row.recorded_at ?? '').slice(0, 10),
  }
}

export function toWeightedPeerRating(rating, raterStage) {
  return {
    level: LEVEL_LABELS[rating.level],
    comments: rating.comments || null,
    raterTracksThisSkill: Boolean(raterStage),
    raterOwnStage: raterStage ? STAGE_LABELS[raterStage] ?? null : null,
    weight: Math.round(lifecycleWeight(raterStage) * 100) / 100,
  }
}

async function run(query) {
  const { data, error } = await query
  if (error) throw error
  return data
}

// Returns null when the skill isn't the caller's or has no target to check
// against; otherwise the evidence for buildPrompt.
export async function loadValidationEvidence(db, userId, skillId) {
  if (typeof skillId !== 'string') return null
  const skill = await run(
    db.from('skills').select('id, name, library_skill_id').eq('id', skillId).eq('user_id', userId).maybeSingle()
  )
  if (!skill) return null

  const [targets, selfAssessments, ratings, primaryStatements, statementLinks] = await Promise.all([
    run(db.from('skill_targets').select('target_level').eq('skill_id', skillId).eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(1)),
    run(db.from('skill_assessments').select('level, comments, source').eq('skill_id', skillId).eq('user_id', userId)
      .eq('axis', 'practical').or('source.eq.self,source.is.null').order('assessed_at', { ascending: false }).limit(1)),
    run(db.from('skill_peer_ratings').select('level, comments, rater_id').eq('skill_id', skillId)
      .order('rated_at', { ascending: false }).limit(15)),
    run(db.from('xapi_statements').select('id, statement, recorded_at').eq('skill_id', skillId).eq('user_id', userId)),
    run(db.from('xapi_statement_skills').select('statement_id').eq('skill_id', skillId)),
  ])
  const target = targets?.[0]
  if (!target) return null

  const primaryIds = new Set((primaryStatements ?? []).map((row) => row.id))
  const linkedIds = [...new Set((statementLinks ?? []).map((link) => link.statement_id))].filter((id) => !primaryIds.has(id))
  const linkedStatements = linkedIds.length > 0
    ? await run(db.from('xapi_statements').select('id, statement, recorded_at').in('id', linkedIds).eq('user_id', userId))
    : []
  const activities = [...(primaryStatements ?? []), ...(linkedStatements ?? [])]
    .filter((row) => isPracticalStatement(row.statement))
    .sort((a, b) => new Date(b.recorded_at) - new Date(a.recorded_at))
    .slice(0, 10)
    .map(toActivity)

  // A rater carries more weight when they track the same library skill
  // themselves -- same rule as get_peer_rater_progress.
  const raterIds = [...new Set((ratings ?? []).map((rating) => rating.rater_id).filter(Boolean))]
  const raterStages = new Map()
  if (skill.library_skill_id && raterIds.length > 0) {
    const raterSkills = await run(
      db.from('skills').select('user_id, lifecycle_stage').eq('library_skill_id', skill.library_skill_id).in('user_id', raterIds)
    )
    for (const row of raterSkills ?? []) raterStages.set(row.user_id, row.lifecycle_stage)
  }

  const self = selfAssessments?.[0]
  return {
    skillName: skill.name,
    targetLevel: LEVEL_LABELS[target.target_level],
    selfLevel: self ? LEVEL_LABELS[self.level] ?? null : null,
    selfComments: self?.comments ? String(self.comments).slice(0, 4000) : null,
    activities,
    peerRatings: (ratings ?? []).map((rating) => toWeightedPeerRating(rating, raterStages.get(rating.rater_id) ?? null)),
  }
}
