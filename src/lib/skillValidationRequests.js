import { supabase } from './supabaseClient'

// Everyone eligible to validate this skill at this level, for the current
// user to pick from -- already filtered server-side by the view (opted in,
// in the maintaining phase, and either open to anyone or a connection of
// the current user), scoped here to the same skill (by library entry) at or
// above the level the requester is aiming for.
export async function listValidatorCandidates(librarySkillId, minLevel) {
  if (!librarySkillId) return []
  const { data, error } = await supabase
    .from('validator_directory')
    .select('skill_id, validator_id, level, full_name, avatar_url, is_connection')
    .eq('library_skill_id', librarySkillId)
    .gte('level', minLevel)
    .order('is_connection', { ascending: false })
    .order('full_name', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function createValidationRequest({ skillId, requesterId, validatorId, targetLevel }) {
  const { data, error } = await supabase
    .from('skill_validation_requests')
    .insert({ skill_id: skillId, requester_id: requesterId, validator_id: validatorId, target_level: targetLevel })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

// The validator's email is never exposed while browsing candidates -- only
// once a request naming them already exists, and only to the requester who
// created it, via this security-definer lookup.
export async function getValidationRequestContact(requestId) {
  const { data, error } = await supabase.rpc('get_validation_request_contact', { p_request_id: requestId })
  if (error) throw error
  return data?.[0] ?? null
}

export async function sendValidationRequestEmail({ toEmail, requesterName, skillName, reviewUrl }) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const res = await fetch('/api/send-validation-request', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ toEmail, requesterName, skillName, reviewUrl }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || 'Failed to send validation request email.')
  }
}

// Requests the current user has sent for one of their own skills -- both
// still-pending (shown as an upcoming item on the timeline) and already
// decided (shown as a dated entry).
export async function listOutgoingValidationRequests(skillId) {
  const { data, error } = await supabase
    .from('skill_validation_requests')
    .select('id, status, target_level, decision_comments, created_at, decided_at, validator_id')
    .eq('skill_id', skillId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

// Requests addressed to the current user as validator, still awaiting their
// decision -- surfaced outside the skill itself (e.g. on Connections) since
// the validator doesn't necessarily track this skill's owner's page.
export async function listIncomingPendingValidationRequests() {
  const { data, error } = await supabase
    .from('skill_validation_requests')
    .select('id, target_level, created_at, skill_id, requester_id, skills(name)')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function decideValidationRequest(requestId, confirmed, comments) {
  const { error } = await supabase.rpc('decide_validation_request', {
    p_request_id: requestId,
    p_confirmed: confirmed,
    p_comments: comments || '',
  })
  if (error) throw error
}
