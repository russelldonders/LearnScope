import { supabase } from '../supabaseClient'

const ADMIN_CATALOGUE_SELECT = '*, organisations(id, name)'

// Unlike src/lib/courseCatalogue.js's listCatalogueCourses (learner-facing,
// approved-only), this surfaces every status -- RLS still applies (a
// platform admin sees everything; this module is only ever used from
// PlatformAdminRoute-gated pages).
export async function listAllCatalogueCourses() {
  const { data, error } = await supabase
    .from('course_catalogue')
    .select(ADMIN_CATALOGUE_SELECT)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

// Platform admins can create a catalogue entry that's immediately live
// (status 'approved') -- providers instead insert as 'draft'/
// 'pending_approval' via the (not-yet-built) provider console, per RLS.
export async function createPlatformCourse(userId, { name, provider, courseType, duration, synopsis, organisationId }) {
  const { data, error } = await supabase
    .from('course_catalogue')
    .insert({
      name: name.trim(),
      provider: provider?.trim() || null,
      course_type: courseType?.trim() || null,
      duration: duration?.trim() || null,
      synopsis: synopsis?.trim() || null,
      organisation_id: organisationId || null,
      created_by: userId,
      status: 'approved',
      approved_by: userId,
      approved_at: new Date().toISOString(),
    })
    .select()
    .single()
  if (error) throw error
  return data
}

// Provider console equivalent of createPlatformCourse: an organisation's
// own member (admin or trainer) creates into their own organisation_id, as
// a 'draft' -- not immediately submitted, so they can keep building it out
// (edit details, attach content) before choosing to submit it for review.
// RLS (0066) rejects anything but draft/pending_approval from this role, so
// there's no way to self-approve from here even if the app layer tried.
export async function createProviderCourse(userId, organisationId, { name, provider, courseType, duration, synopsis }) {
  const { data, error } = await supabase
    .from('course_catalogue')
    .insert({
      name: name.trim(),
      provider: provider?.trim() || null,
      course_type: courseType?.trim() || null,
      duration: duration?.trim() || null,
      synopsis: synopsis?.trim() || null,
      organisation_id: organisationId,
      created_by: userId,
      status: 'draft',
    })
    .select()
    .single()
  if (error) throw error
  return data
}

// Editing is only possible while draft/rejected (RLS 0066's `using` clause
// for the org-members update policy), matching what the provider console UI
// exposes an edit affordance for -- pending_approval/approved rows are
// read-only from here regardless.
export async function updateProviderCourse(id, { name, provider, courseType, duration, synopsis }) {
  const { error } = await supabase
    .from('course_catalogue')
    .update({
      name: name.trim(),
      provider: provider?.trim() || null,
      course_type: courseType?.trim() || null,
      duration: duration?.trim() || null,
      synopsis: synopsis?.trim() || null,
    })
    .eq('id', id)
  if (error) throw error
}

export async function listCourseParticipants(courseId) {
  const [{ data: enrolments, error: enrolmentError }, { data: items, error: itemError }] = await Promise.all([
    supabase
      .from('courses')
      .select('id, user_id, created_at, completed_date')
      .eq('catalogue_course_id', courseId)
      .order('created_at'),
    supabase.from('course_content_links').select('resource_id').eq('course_id', courseId),
  ])
  if (enrolmentError) throw enrolmentError
  if (itemError) throw itemError
  if (!enrolments?.length) return []

  const userIds = enrolments.map((row) => row.user_id)
  const itemIds = [...new Set((items ?? []).map((row) => row.resource_id))]
  const [{ data: profiles, error: profileError }, progressResult] = await Promise.all([
    supabase.from('profiles').select('id, full_name, avatar_url').in('id', userIds),
    itemIds.length
      ? supabase
          .from('course_content_progress')
          .select('content_item_id, user_id, status, updated_at')
          .in('content_item_id', itemIds)
          .in('user_id', userIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (profileError) throw profileError
  if (progressResult.error) throw progressResult.error

  const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]))
  const progressByUser = new Map()
  for (const row of progressResult.data ?? []) {
    if (row.status === 'not_attempted') continue
    const current = progressByUser.get(row.user_id) ?? { completed: 0, startedAt: null }
    if (['completed', 'passed'].includes(row.status)) current.completed += 1
    if (!current.startedAt || row.updated_at < current.startedAt) current.startedAt = row.updated_at
    progressByUser.set(row.user_id, current)
  }

  return enrolments.map((enrolment) => {
    const progress = progressByUser.get(enrolment.user_id)
    const status = enrolment.completed_date ? 'complete' : progress ? 'started' : 'enrolled'
    return {
      ...enrolment,
      profile: profileById.get(enrolment.user_id) ?? null,
      status,
      percent: itemIds.length ? Math.round(((progress?.completed ?? 0) / itemIds.length) * 100) : 0,
      startedAt: progress?.startedAt ?? null,
    }
  })
}

// Providers can only list their own organisation's catalogue entries (RLS
// restricts organisation members to status='approved' rows plus their own
// org's rows of any status -- filtering by organisation_id here just avoids
// pulling every other approved course in the platform catalogue too).
export async function listOrganisationCatalogueCourses(organisationId) {
  const { data, error } = await supabase
    .from('course_catalogue')
    .select('*')
    .eq('organisation_id', organisationId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

// Single-course fetch for the provider course editor page -- RLS (course_
// catalogue's own select policy) already scopes this to approved courses,
// the caller's own organisation's courses, or a platform admin, so a `null`
// result here just means "not found or not visible to you", not an error.
export async function getCatalogueCourse(id) {
  const { data, error } = await supabase.from('course_catalogue').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data
}

export async function approveCatalogueCourse(id, userId) {
  const { error } = await supabase
    .from('course_catalogue')
    .update({ status: 'approved', approved_by: userId, approved_at: new Date().toISOString(), rejection_reason: null })
    .eq('id', id)
  if (error) throw error
}

export async function rejectCatalogueCourse(id, reason) {
  const { error } = await supabase
    .from('course_catalogue')
    .update({ status: 'rejected', rejection_reason: reason || null, approved_by: null, approved_at: null })
    .eq('id', id)
  if (error) throw error
}

export async function setCatalogueCourseStatus(id, status) {
  const { error } = await supabase.from('course_catalogue').update({ status }).eq('id', id)
  if (error) throw error
}

// Same public-bucket, path-scoped-by-owner pattern as uploadOrganisationLogo
// (organisations.js) -- upsert-in-place at a fixed path per course, so
// re-uploading just replaces the file rather than accumulating old ones.
export async function uploadCourseImage(courseId, fileOrBlob) {
  const path = `${courseId}/image.webp`

  const { error: uploadError } = await supabase.storage
    .from('course-catalogue-images')
    .upload(path, fileOrBlob, { upsert: true, contentType: fileOrBlob.type })
  if (uploadError) throw uploadError

  const { data } = supabase.storage.from('course-catalogue-images').getPublicUrl(path)
  const url = `${data.publicUrl}?t=${Date.now()}`

  const { error: courseError } = await supabase.from('course_catalogue').update({ image_url: url }).eq('id', courseId)
  if (courseError) throw courseError

  return url
}

export async function removeCourseImage(courseId) {
  const paths = ['webp', 'jpeg', 'jpg', 'png'].map((extension) => `${courseId}/image.${extension}`)
  const { error: storageError } = await supabase.storage.from('course-catalogue-images').remove(paths)
  if (storageError) throw storageError

  const { error } = await supabase.from('course_catalogue').update({ image_url: null }).eq('id', courseId)
  if (error) throw error
}
