import { supabase } from './supabaseClient'

const CATALOGUE_SELECT = `*,
  course_catalogue_skills(id, level, skill_library(id, name)),
  course_catalogue_tags(id, tags(id, name)),
  organisations(logo_url, slug, public_profile_enabled)`

function mapCatalogueCourse(course) {
  return {
    ...course,
    skillEntries: (course.course_catalogue_skills ?? [])
      .filter((e) => e.skill_library)
      .map((e) => ({ level: e.level, skillId: e.skill_library.id, skillName: e.skill_library.name })),
    tags: (course.course_catalogue_tags ?? [])
      .filter((t) => t.tags)
      .map((t) => ({ id: t.tags.id, name: t.tags.name })),
    // Platform-curated entries (organisation_id null, 0066) have no
    // organisation to embed, and a provider that's never set a logo (0081)
    // has organisations.logo_url null -- both just mean no badge to show.
    logoUrl: course.organisations?.logo_url ?? null,
    // Only set when the provider has actually opted into a public page
    // (0090) -- otherwise the provider name stays plain text rather than
    // linking to a page that would just say "not available".
    providerSlug: course.organisations?.public_profile_enabled ? (course.organisations?.slug ?? null) : null,
  }
}

// Learner-facing browse: only approved entries. RLS already scopes what a
// non-admin/non-org-member can see (0066), but filtering explicitly here
// keeps a platform admin's own normal browsing from surfacing every other
// provider's drafts/pending entries too (RLS lets them see those since
// they're an admin, but this view isn't the moderation queue).
export async function listCatalogueCourses() {
  const { data, error } = await supabase
    .from('course_catalogue')
    .select(CATALOGUE_SELECT)
    .eq('status', 'approved')
    .order('name')
  if (error) throw error
  return (data ?? []).map(mapCatalogueCourse)
}

// Same approved-only scoping as listCatalogueCourses, for the same
// defence-in-depth reason: RLS (0066) already restricts a non-admin/
// non-org-member caller to approved rows, but filtering explicitly here
// keeps this learner-facing detail lookup from depending solely on RLS.
export async function getCatalogueCourse(id) {
  const { data, error } = await supabase
    .from('course_catalogue')
    .select(CATALOGUE_SELECT)
    .eq('id', id)
    .eq('status', 'approved')
    .maybeSingle()
  if (error) throw error
  return data ? mapCatalogueCourse(data) : null
}

// Maps catalogue_course_id -> { id, completed_date } for the learner's own
// courses row, so an already-enrolled catalogue card can link straight to
// that personal record and show whether it's actually been completed.
export async function listEnrolledCatalogueIds(userId) {
  const { data, error } = await supabase
    .from('courses')
    .select('id, catalogue_course_id, completed_date')
    .eq('user_id', userId)
    .not('catalogue_course_id', 'is', null)
  if (error) throw error
  return new Map((data ?? []).map((c) => [c.catalogue_course_id, { id: c.id, completedDate: c.completed_date }]))
}

// skillId (optional) links the new course straight to the skill the learner
// enrolled from, via skill_course_links -- without this, enrolling scoped to
// a skill would insert a personal course record but never surface it back
// on that skill's page.
export async function enrolInCatalogueCourse(userId, course, skillId = null) {
  const { data, error } = await supabase
    .from('courses')
    .insert({
      user_id: userId,
      name: course.name,
      provider: course.provider,
      course_type: course.course_type,
      duration: course.duration,
      catalogue_course_id: course.id,
    })
    .select()
    .single()
  if (error) throw error

  if (skillId) {
    const { error: linkError } = await supabase.from('skill_course_links').insert({
      user_id: userId,
      skill_id: skillId,
      course_id: data.id,
      relationship: 'developed',
    })
    if (linkError) throw linkError
  }

  return data
}

// Same same-browser-only/cross-device pattern as connections.js's
// pendingInviteCode: clicking "Log in to enrol" on the public provider page
// (reachable logged out) stores the catalogue course id here before sending
// the visitor to auth; resumePendingEnrolment below completes the
// enrolment once they're actually authenticated, wherever that landing
// happens (Login.jsx/Signup.jsx for an immediate session, Welcome.jsx for
// email confirmation or a Google OAuth redirect -- see AuthContext.jsx's
// signUp for why Welcome.jsx also accepts this as a URL query param rather
// than relying solely on localStorage).
const PENDING_ENROL_KEY = 'learnscope_pending_enrol_catalogue_id'

export function setPendingEnrolCourseId(id) {
  localStorage.setItem(PENDING_ENROL_KEY, id)
}

export function getPendingEnrolCourseId() {
  return localStorage.getItem(PENDING_ENROL_KEY)
}

export function clearPendingEnrolCourseId() {
  localStorage.removeItem(PENDING_ENROL_KEY)
}

// explicitCourseId (from a URL query param) takes priority over the stored
// value, matching Welcome.jsx's existing invite-code handling -- always
// clears storage regardless of which source was used, so a stale id can
// never be resumed twice. Refetches the course fresh via getCatalogueCourse
// rather than trusting anything carried across the auth redirect, since RLS
// only allows that read now that the caller is authenticated, and the
// course's own details may have changed since the link was clicked.
export async function resumePendingEnrolment(userId, explicitCourseId = null) {
  const pendingId = explicitCourseId || getPendingEnrolCourseId()
  clearPendingEnrolCourseId()
  if (!pendingId) return null
  const course = await getCatalogueCourse(pendingId)
  if (!course) return null
  return enrolInCatalogueCourse(userId, course)
}
