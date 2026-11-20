import { supabase } from './supabaseClient'

// The five level definitions for a skill ("You can…" per level, one set for
// knowledge and one for practical ability). They are generated once and
// then always shown the same:
//
// - For a skill in the shared library (skill.library_skill_id) the one copy
//   lives on that skill_library row. It is generated when the library entry
//   is created (prepareLibraryLevelGuides), or on first need for an entry
//   that predates that, and written server-side by
//   api/generate-level-guide, which only ever fills an empty column and
//   hands back whatever is stored -- so two people asking at once still see
//   the same text. Platform admins can edit it in the skill library.
// - Only a fully custom skill with no readable library entry keeps its own
//   copy on the learner's skills row.
//
// Older learner skills may still carry a personal copy from before the
// shared cache (0089); for a library skill that copy is ignored so the
// library's (possibly edited) text is the only one anyone sees.
export const LEVEL_GUIDE_AXES = ['knowledge', 'practical']

const inFlight = new Map()

export function isCompleteLevelGuide(statements) {
  return Array.isArray(statements) && statements.length === 5 && statements.every((s) => typeof s === 'string' && s.trim())
}

export async function generateLevelGuide(axis, skillName, librarySkillId = null) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const res = await fetch('/api/generate-level-guide', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ skillName, axis, librarySkillId }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || 'Failed to generate level guidance.')
  }
  const data = await res.json()
  return data.statements ?? []
}

async function readLibraryGuide(librarySkillId, column) {
  const { data, error } = await supabase
    .from('skill_library')
    .select(`id, ${column}`)
    .eq('id', librarySkillId)
    .maybeSingle()
  if (error) throw error
  return data // null when the entry isn't visible to this user
}

async function resolveLevelGuide(skill, axis) {
  const column = `${axis}_level_guide`

  if (skill.library_skill_id) {
    const libRow = await readLibraryGuide(skill.library_skill_id, column)
    if (libRow) {
      if (isCompleteLevelGuide(libRow[column])) return libRow[column]
      // Server generates from the library entry's own name, caches it on
      // the shared row and returns the stored copy.
      return generateLevelGuide(axis, skill.name, skill.library_skill_id)
    }
    // Library entry not readable (e.g. deactivated) -- fall through to the
    // per-skill copy so it's still generated once rather than every time.
  }

  if (isCompleteLevelGuide(skill[column])) return skill[column]
  if (!skill.id) return []

  const statements = await generateLevelGuide(axis, skill.name)
  if (statements.length === 5) {
    const { error } = await supabase.from('skills').update({ [column]: statements }).eq('id', skill.id)
    if (error) console.error(`Failed to cache ${axis} level guide:`, error)
  }
  return statements
}

// One request per skill+axis at a time: a skill created a moment ago may
// still be generating when its first self-assessment opens, and that should
// wait for the same result rather than pay for (and show) a second one.
export function ensureLevelGuide(skill, axis) {
  const key = skill.library_skill_id ? `library:${skill.library_skill_id}:${axis}` : `skill:${skill.id}:${axis}`
  if (inFlight.has(key)) return inFlight.get(key)
  const promise = resolveLevelGuide(skill, axis).finally(() => inFlight.delete(key))
  inFlight.set(key, promise)
  return promise
}

// Called right after a new library entry is created, so its definitions
// exist from the start. Best-effort: if it fails (offline, quota), the
// first view generates them instead.
export function prepareLibraryLevelGuides(librarySkillId, name) {
  if (!librarySkillId || !name) return
  for (const axis of LEVEL_GUIDE_AXES) {
    ensureLevelGuide({ id: null, name, library_skill_id: librarySkillId }, axis).catch((err) =>
      console.error(`Preparing ${axis} level guide failed:`, err)
    )
  }
}
