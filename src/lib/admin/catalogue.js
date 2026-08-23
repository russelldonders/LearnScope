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
