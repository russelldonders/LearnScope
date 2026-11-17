// Suggests skills an employer might require for a role profile, from the
// role's own name and description. The model only proposes: suggestions are
// shown one at a time and nothing is saved until the role's creator chooses
// to add one. Skills already in the system are strongly preferred --
// normalizeRoleProfileSkillSuggestions re-resolves every name against the
// supplied existing-skill list (case-insensitive) so an existing skill is
// always reused by its canonical name rather than re-invented.

const BATCH_SIZE = 5
const MAX_EXISTING = 600
const MAX_EXCLUDED = 300
const LEVELS = [1, 2, 3, 4, 5]

export const ROLE_PROFILE_SKILL_SUGGESTIONS_SCHEMA = {
  type: 'object',
  properties: {
    recommendations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          reason: { type: 'string' },
          targetLevel: { type: 'integer', enum: LEVELS },
        },
        required: ['name', 'reason', 'targetLevel'],
        additionalProperties: false,
      },
    },
  },
  required: ['recommendations'],
  additionalProperties: false,
}

function clean(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function cleanNames(values, limit) {
  if (!Array.isArray(values)) return []
  const seen = new Set()
  const names = []
  for (const value of values) {
    const name = clean(value, 120)
    const key = name.toLowerCase()
    if (!name || seen.has(key)) continue
    seen.add(key)
    names.push(name)
    if (names.length === limit) break
  }
  return names
}

export function buildRoleProfileSkillSuggestionRequest(body) {
  const roleName = clean(body?.roleName, 160)
  if (!roleName) return { error: 'Missing roleName' }

  const roleDescription = clean(body?.roleDescription, 2000)
  const existing = cleanNames(body?.existingSkillNames, MAX_EXISTING)
  const excluded = cleanNames(body?.excludedSkillNames, MAX_EXCLUDED)

  return {
    schema: ROLE_PROFILE_SKILL_SUGGESTIONS_SCHEMA,
    maxTokens: 1024,
    existing,
    excluded,
    refusalError: "Couldn't suggest skills for this role.",
    failureError: 'Failed to suggest skills.',
    logLabel: 'suggest-role-profile-skills',
    prompt: `An employer is defining a role profile: the skills someone in this role is expected to have, and the proficiency level needed for each.

Role name: ${roleName}
Role description: ${roleDescription || '(not supplied)'}

Skills that already exist in the system:
${existing.length ? existing.join(', ') : '(none)'}

Skills already required or already suggested (do not suggest these or close synonyms):
${excluded.length ? excluded.join(', ') : '(none)'}

Suggest up to ${BATCH_SIZE} of the most important skills for this role, ordered from most to least important.
- Strongly prefer skills from the existing list above. When one fits, use its exact name as written there.
- Only suggest a new skill name when no existing skill reasonably covers something important for this role. Use an established, reusable skill name, not a responsibility, a narrow tool, or a vague trait.
- targetLevel is the proficiency the role needs on a 1-5 scale: 1 Beginner, 2 Developing, 3 Capable, 4 Skilled, 5 Expert. Base it on the role's seniority and how central the skill is.
- Each reason must be one concise sentence explaining why the skill matters for this role.
If the name and description do not support ${BATCH_SIZE} useful suggestions, return fewer.`,
  }
}

// Drops excluded/duplicate/blank entries, clamps levels, maps any name that
// matches an existing skill onto that skill's canonical spelling, and lists
// existing skills before new ones (keeping the model's order within each).
export function normalizeRoleProfileSkillSuggestions(data, request) {
  const existingByKey = new Map(request.existing.map((name) => [name.toLowerCase(), name]))
  const seen = new Set(request.excluded.map((name) => name.toLowerCase()))
  const existingSuggestions = []
  const newSuggestions = []

  for (const item of data?.recommendations ?? []) {
    const rawName = clean(item?.name, 120)
    const reason = clean(item?.reason, 240)
    const key = rawName.toLowerCase()
    if (!rawName || !reason || seen.has(key)) continue
    seen.add(key)
    const level = Number(item?.targetLevel)
    const targetLevel = LEVELS.includes(level) ? level : 3
    const canonical = existingByKey.get(key)
    if (canonical) existingSuggestions.push({ name: canonical, reason, targetLevel, isExisting: true })
    else newSuggestions.push({ name: rawName, reason, targetLevel, isExisting: false })
  }

  return [...existingSuggestions, ...newSuggestions].slice(0, BATCH_SIZE)
}
