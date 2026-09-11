// Preparation contract only: this module does not register a tool, persist an
// object, authenticate a launch, or grant access to a learner's personal data.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function requireId(value, label) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error(`${label} must be a UUID`)
  return value.toLowerCase()
}

export function createSkillLtiObject({ id, skillLibraryId, organisationId, title, description = '', targetLevel = null }) {
  if (typeof title !== 'string' || !title.trim() || title.trim().length > 200) throw new Error('Title must contain 1–200 characters')
  if (typeof description !== 'string' || description.length > 2000) throw new Error('Description must be 2000 characters or fewer')
  if (targetLevel !== null && (!Number.isInteger(targetLevel) || targetLevel < 1 || targetLevel > 5)) throw new Error('Target level must be between 1 and 5')
  return {
    schemaVersion: 1,
    kind: 'skill-detail',
    status: 'draft',
    id: requireId(id, 'Object ID'),
    skillLibraryId: requireId(skillLibraryId, 'Catalogue skill ID'),
    organisationId: requireId(organisationId, 'Provider organisation ID'),
    title: title.trim(),
    description: description.trim(),
    targetLevel,
  }
}

// A Deep Linking 2.0 content item, to be placed inside a server-signed response
// AFTER platform/deployment and author permissions have been verified.
// The /lti/resources/:id handler is proposed in docs/architecture/lti-skill-tool.md;
// it is not implemented yet. A generated content item is not a working launch.
export function buildSkillLtiResourceLink(definition, toolOrigin) {
  const object = createSkillLtiObject(definition)
  let origin
  try { origin = new URL(toolOrigin) } catch { throw new Error('Tool origin must be an HTTPS origin') }
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('Tool origin must be an HTTPS origin without credentials, path, query or fragment')
  }
  return {
    type: 'ltiResourceLink',
    title: object.title,
    ...(object.description ? { text: object.description } : {}),
    url: `${origin.origin}/lti/resources/${object.id}`,
    custom: { learnscope_resource_id: object.id },
  }
}
