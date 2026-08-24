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
// own member (admin or trainer) submits into their own organisation_id at
// 'pending_approval' -- RLS (0066) rejects anything else from this role, so
// there's no way to self-approve from here even if the app layer tried.
export async function submitProviderCourse(userId, organisationId, { name, provider, courseType, duration, synopsis }) {
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
      status: 'pending_approval',
    })
    .select()
    .single()
  if (error) throw error
  return data
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
