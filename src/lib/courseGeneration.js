import { supabase } from './supabaseClient'

export async function generateCourseDraft(brief, organisationId) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Your session has expired. Sign in and try again.')
  const response = await fetch('/api/generate-course-draft', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ ...brief, organisationId }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || 'Failed to generate the course.')
  return body.draft
}

const MAX_PAGE_TITLE = 200

// Every generated course ends in a "Final test" section whose single page is
// also titled "Final test" -- so in an organisation's Resources library,
// several generated courses' tests were indistinguishable. Name each test
// page after its course instead ("Final test – Coaching basics"). The
// section keeps its plain "Final test" title.
export function nameFinalTestPages(draft) {
  const courseName = draft?.name?.trim()
  if (!courseName || !Array.isArray(draft.sections)) return draft
  return {
    ...draft,
    sections: draft.sections.map((section) => ({
      ...section,
      pages: Array.isArray(section?.pages)
        ? section.pages.map((page) =>
            page?.title?.trim().toLocaleLowerCase() === 'final test'
              ? { ...page, title: `Final test – ${courseName}`.slice(0, MAX_PAGE_TITLE) }
              : page
          )
        : section?.pages,
    })),
  }
}

export async function createGeneratedCourseDraft(organisationId, draft) {
  const { data, error } = await supabase.rpc('create_generated_course_draft', {
    p_organisation_id: organisationId,
    p_draft: nameFinalTestPages(draft),
  })
  if (error) throw error
  return data
}
