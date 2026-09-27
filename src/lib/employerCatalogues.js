import { supabase } from './supabaseClient'

export const EMPLOYER_CATALOGUE_VISIBILITY = [
  {
    value: 'public',
    label: 'Public and members',
    description: 'Visible before login and to every active member in this workspace.',
  },
  {
    value: 'all_members',
    label: 'All members',
    description: 'Visible only after an active member signs in to this workspace.',
  },
  {
    value: 'role_profiles',
    label: 'Selected role profiles',
    description: 'Visible to members linked to at least one selected role profile.',
  },
  {
    value: 'hidden',
    label: 'Hidden',
    description: 'Not shown in the public page or member catalogue.',
  },
]

export async function listEmployerCatalogueAccess(employerId) {
  const { data, error } = await supabase.rpc('list_employer_catalogue_access', { p_employer: employerId })
  if (error) throw error
  return data ?? []
}

export async function setEmployerCatalogueAccess(employerId, catalogueId, visibility, roleProfileIds = []) {
  const { error } = await supabase.rpc('set_employer_catalogue_access', {
    p_employer: employerId,
    p_catalogue: catalogueId,
    p_visibility: visibility,
    p_role_profile_ids: roleProfileIds,
  })
  if (error) throw error
}

export async function listMyEmployerCatalogueCourses(employerId) {
  const { data, error } = await supabase.rpc('list_my_employer_catalogue_courses', { p_employer: employerId })
  if (error) throw error
  return data ?? []
}

export async function getPublicEmployerCatalogueCourses(slug) {
  const { data, error } = await supabase.rpc('get_public_employer_catalogue_courses', { p_slug: slug })
  if (error) throw error
  return data ?? []
}
