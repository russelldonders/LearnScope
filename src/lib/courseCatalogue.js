import { supabase } from './supabaseClient'

const CATALOGUE_SELECT = `*,
  course_catalogue_skills(id, level, skill_library(id, name)),
  course_catalogue_tags(id, tags(id, name))`

function mapCatalogueCourse(course) {
  return {
    ...course,
    skillEntries: (course.course_catalogue_skills ?? [])
      .filter((e) => e.skill_library)
      .map((e) => ({ level: e.level, skillId: e.skill_library.id, skillName: e.skill_library.name })),
    tags: (course.course_catalogue_tags ?? [])
      .filter((t) => t.tags)
      .map((t) => ({ id: t.tags.id, name: t.tags.name })),
  }
}

export async function listCatalogueCourses() {
  const { data, error } = await supabase.from('course_catalogue').select(CATALOGUE_SELECT).order('name')
  if (error) throw error
  return (data ?? []).map(mapCatalogueCourse)
}

export async function getCatalogueCourse(id) {
  const { data, error } = await supabase
    .from('course_catalogue')
    .select(CATALOGUE_SELECT)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data ? mapCatalogueCourse(data) : null
}

export async function listEnrolledCatalogueIds(userId) {
  const { data, error } = await supabase
    .from('courses')
    .select('catalogue_course_id')
    .eq('user_id', userId)
    .not('catalogue_course_id', 'is', null)
  if (error) throw error
  return new Set((data ?? []).map((c) => c.catalogue_course_id))
}

export async function enrolInCatalogueCourse(userId, course) {
  const { error } = await supabase.from('courses').insert({
    user_id: userId,
    name: course.name,
    provider: course.provider,
    course_type: course.course_type,
    duration: course.duration,
    catalogue_course_id: course.id,
  })
  if (error) throw error
}
