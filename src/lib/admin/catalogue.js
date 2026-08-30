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
  const ext = fileOrBlob.type?.split('/')[1] || 'jpg'
  const path = `${courseId}/image.${ext}`

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
  const { error } = await supabase.from('course_catalogue').update({ image_url: null }).eq('id', courseId)
  if (error) throw error
}

// Catalogue approvers (0095): an org admin's picks from their own
// organisation_members, able to approve/reject/deactivate that org's own
// course_catalogue submissions without a platform admin. RLS-scoped
// directly (no service-role hop needed) -- unlike listOrganisationMembers,
// nothing here needs an email lookup against auth.users.
export async function listCatalogueApprovers(organisationId) {
  const { data, error } = await supabase
    .from('catalogue_approvers')
    .select('*')
    .eq('organisation_id', organisationId)
  if (error) throw error
  return data ?? []
}

export async function addCatalogueApprover(organisationId, userId, addedBy) {
  const { data, error } = await supabase
    .from('catalogue_approvers')
    .insert({ organisation_id: organisationId, user_id: userId, added_by: addedBy })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function removeCatalogueApprover(approverRowId) {
  const { error } = await supabase.from('catalogue_approvers').delete().eq('id', approverRowId)
  if (error) throw error
}
