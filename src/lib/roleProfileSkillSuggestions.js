import { supabase } from './supabaseClient'

// Asks the AI for skills a role profile likely needs, from its name and
// description. existingSkillNames are the skills already in the system (the
// employer's own plus the skill library) -- the server prefers and
// canonicalises these, flagging each suggestion's isExisting. excludedSkillNames
// covers skills already required plus anything already shown, so asking again
// returns fresh suggestions. Returns [{ name, reason, targetLevel, isExisting }].
export async function suggestRoleProfileSkills({ roleName, roleDescription }, existingSkillNames, excludedSkillNames) {
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session?.access_token) throw new Error('Your session has expired. Sign in and try again.')

  const res = await fetch('/api/suggest-tags', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      operation: 'role-profile-skills',
      roleName,
      roleDescription,
      existingSkillNames,
      excludedSkillNames,
    }),
  })

  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || 'Failed to suggest skills.')
  return body.recommendations ?? []
}
