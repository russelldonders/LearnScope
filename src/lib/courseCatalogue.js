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
