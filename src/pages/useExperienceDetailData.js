import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'

// The experience page's records: the experience itself, what was learned
// during it (courses, skills, levels reached, logged activity) and the
// experiences nested under or above it. The loaders are returned so the
// page can reload after the learner changes something.
export function useExperienceDetailData(id) {
  const { user } = useAuth()
  const [item, setItem] = useState(null)
  const [loadingItem, setLoadingItem] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [linkedCourses, setLinkedCourses] = useState([])
  const [skillLinks, setSkillLinks] = useState([])
  const [achievements, setAchievements] = useState([])
  const [skillHistory, setSkillHistory] = useState([])
  const [experienceActivities, setExperienceActivities] = useState([])
  const [allExperienceActivities, setAllExperienceActivities] = useState([])
  const [activitySkills, setActivitySkills] = useState([])
  const [learningLoaded, setLearningLoaded] = useState(false)
  const [childExperiences, setChildExperiences] = useState([])
  const [parentExperience, setParentExperience] = useState(null)

  useEffect(() => {
    loadItem()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the listed values change; the loaders are recreated every render
  }, [id])

  useEffect(() => {
    if (item) {
      loadLearning()
      loadRelated()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the listed values change; the loaders are recreated every render
  }, [item?.id])

  async function loadItem() {
    setLoadingItem(true)
    setNotFound(false)
    const { data, error } = await supabase
      .from('experience')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()
    if (error || !data) {
      setNotFound(true)
    } else {
      setItem(data)
    }
    setLoadingItem(false)
  }

  async function loadLearning() {
    // Skills linked to a child experience (e.g. a subject under this
    // education, or a project under this job) count as developed under
    // this experience too -- a subject is a chapter of the parent, not a
    // separate one, so its skills roll up into the parent's own "Skills
    // developed" section rather than only ever showing on the subject's
    // own page.
    const { data: children } = await supabase
      .from('experience')
      .select('id')
      .eq('parent_experience_id', item.id)
    const experienceIds = [item.id, ...(children ?? []).map((c) => c.id)]

    const [{ data: cl }, { data: sl }, { data: ach }, { data: activities }, { data: allSkills }] = await Promise.all([
      supabase
        .from('course_experience_links')
        .select('id, course_id, courses(id, name, provider, completed_date)')
        .eq('experience_id', item.id),
      supabase
        .from('skill_experience_links')
        .select('id, skill_id, skills(id, name, level, source)')
        .in('experience_id', experienceIds)
        .order('created_at'),
      supabase
        .from('skill_assessments')
        .select('*, skills(name), courses(name)')
        .eq('experience_id', item.id)
        .order('assessed_at', { ascending: false }),
      supabase
        .from('xapi_statements')
        .select('id, statement, recorded_at, skill_id, experience_id, evidence_url, evidence_paths, skills(id, name)')
        .in('experience_id', experienceIds)
        .order('recorded_at', { ascending: false }),
      supabase
        .from('skills')
        .select('id, name')
        .eq('user_id', user.id)
        .order('name'),
    ])
    // A skill linked both directly and via a child experience would
    // otherwise appear twice -- keep one row per skill (earliest-linked,
    // since sl is ordered by created_at).
    const uniqueSkillLinks = [...new Map((sl ?? []).map((link) => [link.skill_id, link])).values()]
    const skillIds = uniqueSkillLinks.map((link) => link.skill_id)
    const { data: history } = skillIds.length
      ? await supabase
          .from('skill_assessments')
          .select('id, skill_id, level, axis, source, comments, assessed_at')
          .in('skill_id', skillIds)
          .eq('axis', 'practical')
          .order('assessed_at', { ascending: true })
      : { data: [] }
    setLinkedCourses(cl ?? [])
    setSkillLinks(uniqueSkillLinks)
    setAchievements(ach ?? [])
    setSkillHistory(history ?? [])
    // The Overview timeline only ever shows this experience's own logged
    // activity; a child's activity stays on the child's own page. The
    // broader set (including children) is used only for the "activities
    // logged" count in the skills rollup below.
    setExperienceActivities((activities ?? []).filter((a) => a.experience_id === item.id))
    setAllExperienceActivities(activities ?? [])
    setActivitySkills(allSkills ?? [])
    setLearningLoaded(true)
  }

  async function loadRelated() {
    const [{ data: children }, parentResult] = await Promise.all([
      supabase
        .from('experience')
        .select('id, type, title, other_type, start_date, end_date, study_duration, study_duration_value, study_duration_unit')
        .eq('parent_experience_id', item.id)
        .order('start_date', { ascending: false }),
      item.parent_experience_id
        ? supabase
            .from('experience')
            .select('id, type, title, organization, organization_url, start_date, end_date')
            .eq('id', item.parent_experience_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ])
    setChildExperiences(children ?? [])
    setParentExperience(parentResult.data ?? null)
  }

  return {
    item,
    loadingItem,
    notFound,
    linkedCourses,
    skillLinks,
    achievements,
    skillHistory,
    experienceActivities,
    allExperienceActivities,
    activitySkills,
    learningLoaded,
    childExperiences,
    parentExperience,
    loadItem,
    loadLearning,
    loadRelated,
  }
}
