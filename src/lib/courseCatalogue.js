import { supabase } from './supabaseClient'

// Informational only -- LearnScope has no payment/checkout mechanism, this
// just displays what the provider recorded (0113). null means "not
// specified" (nothing shown); 0 means free; price_currency has no fixed-list
// constraint (a future payments feature would add real validation), so an
// unrecognised ISO code falls back to a plain "amount CODE" string instead
// of letting Intl.NumberFormat throw.
export function formatCoursePrice(course) {
  if (course.price_amount === null || course.price_amount === undefined) return null
  const amount = Number(course.price_amount)
  if (amount === 0) return 'Free'
  if (course.price_currency) {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: course.price_currency }).format(amount)
    } catch {
      return `${amount.toFixed(2)} ${course.price_currency}`
    }
  }
  return amount.toFixed(2)
}

const CATALOGUE_SELECT = `*,
  course_catalogue_skills(
    id, level,
    skill_library(id, name, skill_composite_definitions(status, skill_composite_components(id)))
  ),
  course_catalogue_tags(id, tags(id, name)),
  course_catalogue_publications!inner(published_at, catalogues!inner(id, name, is_global)),
  organisations(logo_url, slug, public_profile_enabled)`

function mapCatalogueCourse(course) {
  return {
    ...course,
    skillEntries: (course.course_catalogue_skills ?? [])
      .filter((e) => e.skill_library)
      .map((e) => {
        const publishedComposite = e.skill_library.skill_composite_definitions?.find((definition) => definition.status === 'published')
        return {
          level: e.level,
          skillId: e.skill_library.id,
          skillName: e.skill_library.name,
          isComposite: Boolean(publishedComposite),
          componentCount: publishedComposite?.skill_composite_components?.length ?? 0,
        }
      }),
    tags: (course.course_catalogue_tags ?? [])
      .filter((t) => t.tags)
      .map((t) => ({ id: t.tags.id, name: t.tags.name })),
    catalogues: (course.course_catalogue_publications ?? [])
      .filter((publication) => publication.published_at && publication.catalogues)
      .map((publication) => publication.catalogues),
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
    .eq('is_current_published', true)
    .eq('course_catalogue_publications.catalogues.is_global', true)
    .not('course_catalogue_publications.published_at', 'is', null)
    .order('name')
  if (error) throw error
  return (data ?? []).map(mapCatalogueCourse)
}

// Same approved-only scoping as listCatalogueCourses, for the same
// defence-in-depth reason: RLS (0066) already restricts a non-admin/
// non-org-member caller to approved rows, but filtering explicitly here
// keeps this learner-facing detail lookup from depending solely on RLS.
export async function getCatalogueCourse(id, { currentOnly = true } = {}) {
  let query = supabase
    .from('course_catalogue')
    .select(CATALOGUE_SELECT)
    .eq('id', id)
  if (currentOnly) {
    query = query
      .eq('status', 'approved')
      .eq('is_current_published', true)
      .eq('course_catalogue_publications.catalogues.is_global', true)
      .not('course_catalogue_publications.published_at', 'is', null)
  }
  const { data, error } = await query.maybeSingle()
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

// Phase 3 employer course assignment ("push training" -- see
// src/lib/admin/employers.js's assignCourseToEmployerMembers/
// listEmployerCourseAssignments). course_assignments rows still 'assigned'
// (not yet enrolled or dismissed) for the current user, joined to the
// course's own details and the employer that assigned it -- mirrors
// listMyPendingOrgInvites/listMyPendingEmployerInvites' join-shape, surfaced
// on /actions the same way. Filters out any row whose course_catalogue join
// came back null (RLS-invisible, e.g. later unpublished) -- same defensive
// pattern as mapCatalogueCourse's own tag/skill filters above.
export async function listMyCourseAssignments(userId) {
  const { data, error } = await supabase
    .from('course_assignments')
    .select('id, catalogue_course_id, status, created_at, course_catalogue(id, name, provider, course_type, duration), employers(id, name)')
    .eq('assigned_to', userId)
    .eq('status', 'assigned')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).filter((a) => a.course_catalogue)
}

// The learner's own response to a pushed assignment -- never enrols them
// silently. "Start" calls the existing, unchanged enrolInCatalogueCourse to
// create the real courses row (that's still the only thing that puts
// anything on their profile), then marks this assignment 'enrolled' purely
// to drop it off their assigned-training list. "Dismiss" just marks it
// 'dismissed' without ever touching courses. courseForEnrolment is the
// joined course_catalogue row from listMyCourseAssignments (already has the
// id/name/provider/course_type/duration enrolInCatalogueCourse needs).
// userId is explicit (not read from the session internally) to match every
// other function in this file, e.g. enrolInCatalogueCourse(userId, ...).
export async function respondToCourseAssignment(userId, assignmentId, { enrol, courseForEnrolment, skillId = null } = {}) {
  if (enrol) {
    await enrolInCatalogueCourse(userId, courseForEnrolment, skillId)
  }
  const { error } = await supabase
    .from('course_assignments')
    .update({ status: enrol ? 'enrolled' : 'dismissed' })
    .eq('id', assignmentId)
  if (error) throw error
}

// Phase 6: powers the "Assigned by X" badge on Learning.jsx/Dashboard.jsx,
// distinguishing a learner's organisation-assigned training from their own
// personal enrolments. Distinct from listMyCourseAssignments above (which
// only surfaces still-pending 'assigned' rows for the /actions card) --
// this is the 'enrolled' ones, where respondToCourseAssignment has already
// created the real courses row. Keyed by catalogue_course_id -> employer
// name so a courses list can badge each card with a single Map lookup
// instead of a per-course query.
export async function listMyAssignedCourseEmployers(userId) {
  const { data, error } = await supabase
    .from('course_assignments')
    .select('catalogue_course_id, employers(name)')
    .eq('assigned_to', userId)
    .eq('status', 'enrolled')
  if (error) throw error
  const map = new Map()
  for (const row of data ?? []) {
    if (row.employers?.name) map.set(row.catalogue_course_id, row.employers.name)
  }
  return map
}

// Cohorts (20260902270000): a specific scheduled run of a catalogue course
// (e.g. "Jan 2026 intake"), with its own live sessions. Purely additive --
// a course with no cohorts enrols exactly as before via
// enrolInCatalogueCourse above, untouched. These functions are read by both
// the provider-management view (ProviderCourseEditor.jsx's Cohorts tab) and
// the learner-facing cohort picker (CourseCatalogue.jsx/ProviderProfile.jsx/
// Actions.jsx), so they live here rather than split across
// lib/admin/catalogue.js -- RLS already scopes what each caller can see or
// manage, the same as every other function in this file.
function mapCohort(cohort, enrolledCount) {
  const sessions = (cohort.course_cohort_sessions ?? [])
    .slice()
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
  return {
    ...cohort,
    sessions,
    enrolledCount,
    seatsRemaining: cohort.capacity == null ? null : Math.max(0, cohort.capacity - enrolledCount),
  }
}

// Cohorts + their sessions + a seats-remaining count, for one course.
// Enrolled counts come from the get_cohort_seat_counts RPC rather than a
// plain count against `courses` -- courses' own RLS only lets a caller see
// their own rows, so a client-side count here would silently undercount
// for anyone but a provider admin of this course. enrolled_count comes
// back from Postgres as a bigint (serialized as a string by supabase-js),
// hence the explicit Number() below.
export async function listCourseCohorts(courseCatalogueId) {
  const { data, error } = await supabase
    .from('course_cohorts')
    .select('*, course_cohort_sessions(*)')
    .eq('course_catalogue_id', courseCatalogueId)
    .order('start_date', { ascending: true, nullsFirst: false })
  if (error) throw error
  const cohorts = data ?? []
  if (cohorts.length === 0) return []

  const { data: counts, error: countError } = await supabase.rpc('get_cohort_seat_counts', {
    p_cohort_ids: cohorts.map((c) => c.id),
  })
  if (countError) throw countError
  const countByCohortId = new Map((counts ?? []).map((row) => [row.cohort_id, Number(row.enrolled_count)]))

  return cohorts.map((cohort) => mapCohort(cohort, countByCohortId.get(cohort.id) ?? 0))
}

// One cohort's own name/schedule -- used by CourseLearn.jsx to show an
// already-enrolled learner when their cohort's live sessions actually are.
// No seats-remaining count here (unlike listCourseCohorts above): a
// learner viewing their own enrolled course doesn't need capacity info,
// just the schedule.
export async function getCourseCohort(cohortId) {
  const { data, error } = await supabase
    .from('course_cohorts')
    .select('*, course_cohort_sessions(*)')
    .eq('id', cohortId)
    .maybeSingle()
  if (error) throw error
  return data ? mapCohort(data, 0) : null
}

export async function createCourseCohort(courseCatalogueId, { name, startDate, capacity }) {
  const { data, error } = await supabase
    .from('course_cohorts')
    .insert({
      course_catalogue_id: courseCatalogueId,
      name: name.trim(),
      start_date: startDate || null,
      capacity: capacity === '' || capacity === null || capacity === undefined ? null : Number(capacity),
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateCourseCohort(cohortId, { name, startDate, capacity, enrolmentOpen }) {
  const { error } = await supabase
    .from('course_cohorts')
    .update({
      name: name.trim(),
      start_date: startDate || null,
      capacity: capacity === '' || capacity === null || capacity === undefined ? null : Number(capacity),
      enrolment_open: enrolmentOpen,
    })
    .eq('id', cohortId)
  if (error) throw error
}

// Deletes the cohort and its sessions (course_cohort_sessions is "on delete
// cascade") -- any learner already enrolled into it keeps their own
// `courses` row (cohort_id is "on delete set null"), they just lose the
// specific-cohort link, not their record of having taken the course.
export async function deleteCourseCohort(cohortId) {
  const { error } = await supabase.from('course_cohorts').delete().eq('id', cohortId)
  if (error) throw error
}

export async function addCohortSession(cohortId, { title, startsAt, endsAt, locationOrLink }) {
  const { data, error } = await supabase
    .from('course_cohort_sessions')
    .insert({
      cohort_id: cohortId,
      title: title?.trim() || null,
      starts_at: startsAt,
      ends_at: endsAt || null,
      location_or_link: locationOrLink?.trim() || null,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateCohortSession(sessionId, { title, startsAt, endsAt, locationOrLink }) {
  const { error } = await supabase
    .from('course_cohort_sessions')
    .update({
      title: title?.trim() || null,
      starts_at: startsAt,
      ends_at: endsAt || null,
      location_or_link: locationOrLink?.trim() || null,
    })
    .eq('id', sessionId)
  if (error) throw error
}

export async function deleteCohortSession(sessionId) {
  const { error } = await supabase.from('course_cohort_sessions').delete().eq('id', sessionId)
  if (error) throw error
}

// Capacity-safe enrolment into a specific cohort -- routed through the
// enrol_in_course_cohort RPC (20260902270000) rather than a plain insert
// like enrolInCatalogueCourse above, since it needs to lock the cohort row
// and check capacity/enrolment_open atomically (a plain client insert can't
// serialize against a concurrent enrolment into the same cohort the way a
// security-definer function holding a row lock can). Returns the created
// `courses` row, same shape enrolInCatalogueCourse returns.
export async function enrolInCourseCohort(cohortId, skillId = null) {
  const { data, error } = await supabase.rpc('enrol_in_course_cohort', {
    p_cohort_id: cohortId,
    p_skill_id: skillId,
  })
  if (error) throw error
  return data
}

// Cohort equivalent of respondToCourseAssignment's "Start" branch -- same
// two-step shape (create the real `courses` row, then mark this assignment
// 'enrolled' so it drops off Actions.jsx's assigned-training list), just
// enrolling into a specific cohort of the assigned course instead of the
// abstract course itself.
export async function respondToCourseAssignmentWithCohort(assignmentId, cohortId, skillId = null) {
  await enrolInCourseCohort(cohortId, skillId)
  const { error } = await supabase
    .from('course_assignments')
    .update({ status: 'enrolled' })
    .eq('id', assignmentId)
  if (error) throw error
}
