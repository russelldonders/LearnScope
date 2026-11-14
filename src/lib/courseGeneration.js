import { supabase } from './supabaseClient'

export async function generateCourseDraft(brief) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Your session has expired. Sign in and try again.')
  const response = await fetch('/api/generate-course-draft', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(brief),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || 'Failed to generate the course.')
  return body.draft
}

export async function createGeneratedCourseDraft(organisationId, draft) {
  const { data, error } = await supabase.rpc('create_generated_course_draft', {
    p_organisation_id: organisationId,
    p_draft: draft,
  })
  if (error) throw error
  return data
}
