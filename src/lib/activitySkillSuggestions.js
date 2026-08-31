import { supabase } from './supabaseClient'

// Analyses freeform activity text (what the learner typed while logging an
// activity with no fixed skill context) and suggests which skill it most
// likely relates to -- an existing tracked skill by exact name where one
// fits, otherwise a plausible new skill name. Mirrors
// recommendExperienceSkills' shape/endpoint so the picker UI can reuse the
// same rendering.
export async function suggestActivitySkills({ title, description }, existingSkillNames) {
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
      operation: 'activity-skills',
      activityTitle: title,
      activityDescription: description,
      existingSkillNames,
    }),
  })

  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || 'Failed to suggest skills.')
  return (body.recommendations ?? []).slice(0, 3)
}
