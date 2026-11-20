import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import { fetchStatementsForSkill } from '../lib/activitySkillLinks'
import { listTags, listSkillTags } from '../lib/skillTags'
import { listOutgoingValidationRequests } from '../lib/skillValidationRequests'
import { listCatalogueCourses, listMyCatalogueCourseIds } from '../lib/courseCatalogue'
import { listCourseProgressByCatalogueId } from '../lib/courseContent'
import { countSkillTrackers, listConnectionsWithSkill } from '../lib/skillStats'
import { getProfiles, listConnections } from '../lib/connections'
import { getLearnerCompositeProgress, getParentCompositesForSkill } from '../lib/skillComposites'
import { listTargetsSetByOthers, listLatestManagerRatings, pickTargetSetByOthers } from '../lib/managerSkillActions'

// The skill page's own records: the skill itself and everything recorded
// against it (assessments, ratings, invites, activities, targets, courses,
// validation requests). loadSkill and loadHistory are returned so the page
// can reload after the learner changes something.
export function useSkillDetailData(id) {
  const { user } = useAuth()
  const [skill, setSkill] = useState(null)
  const [loadingSkill, setLoadingSkill] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [history, setHistory] = useState([])
  const [peerRatings, setPeerRatings] = useState([])
  const [invites, setInvites] = useState([])
  const [raterAvatars, setRaterAvatars] = useState({})
  const [relationshipLinks, setRelationshipLinks] = useState([])
  const [statements, setStatements] = useState([])
  const [skillTags, setSkillTags] = useState([])
  const [allTags, setAllTags] = useState([])
  const [targets, setTargets] = useState([])
  const [courseLinks, setCourseLinks] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [assessorName, setAssessorName] = useState(null)
  const [validationRequests, setValidationRequests] = useState([])
  const [validatorNames, setValidatorNames] = useState({})
  const [recommendInvites, setRecommendInvites] = useState([])
  const [recommendAcceptors, setRecommendAcceptors] = useState({})

  useEffect(() => {
    loadSkill()
    loadAssessorName()
    listTags().then(setAllTags)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the listed values change; the loaders are recreated every render
  }, [id])

  useEffect(() => {
    if (skill) loadHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the listed values change; the loaders are recreated every render
  }, [skill?.id])

  async function loadSkill() {
    setLoadingSkill(true)
    setNotFound(false)
    const { data, error } = await supabase
      .from('skills')
      .select('*, skill_library(is_private, knowledge_level_guide, practical_level_guide)')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()
    if (error || !data) {
      setNotFound(true)
    } else {
      // A library skill's level definitions are the shared library copy
      // (which platform admins can edit) -- any personal copy left on the
      // skills row from before 0089 is ignored so everyone tracking the
      // skill sees the same text. Only a fully custom skill, or one whose
      // library entry isn't readable, uses its own copy. See levelGuide.js.
      const library = data.library_skill_id ? data.skill_library : null
      setSkill({
        ...data,
        knowledge_level_guide: library ? library.knowledge_level_guide ?? null : data.knowledge_level_guide,
        practical_level_guide: library ? library.practical_level_guide ?? null : data.practical_level_guide,
      })
    }
    setLoadingSkill(false)
  }

  async function loadHistory() {
    setLoadingHistory(true)
    const [
      { data: assessments },
      { data: ratings },
      { data: sentInvites },
      { data: links },
      st,
      tags,
      { data: skillTargets },
      { data: courses },
      requests,
    ] = await Promise.all([
        supabase
          .from('skill_assessments')
          .select('*, courses(name), experience(title, organization)')
          .eq('skill_id', skill.id)
          .order('assessed_at', { ascending: false }),
        supabase
          .from('skill_peer_ratings')
          .select('*')
          .eq('skill_id', skill.id)
          .order('rated_at', { ascending: false }),
        // invite_type='rate' only -- a "Recommend this skill" invite (see
        // RecommendSkillModal) tracks a different action entirely and
        // shouldn't count toward the "Invite others to assess" milestone
        // below (invitesSentCount).
        // Recommendations too, for the Skill network section's lists -- split
        // apart below so `invites` stays rate-only as before.
        supabase
          .from('connection_invites')
          .select('id, status, invite_type, invitee_email, created_at, accepted_by, accepted_at')
          .eq('skill_id', skill.id)
          .in('invite_type', ['rate', 'recommend'])
          .order('created_at', { ascending: false }),
        supabase
          .from('skill_experience_links')
          .select('id, created_at, experience(id, title, organization, type, start_date, end_date)')
          .eq('skill_id', skill.id),
        fetchStatementsForSkill(skill.id),
        listSkillTags(skill.id),
        // The learner's own targets (skill_targets holds only those): a target
        // someone else set comes from targetSetByOthers instead.
        supabase
          .from('skill_targets')
          .select('*')
          .eq('skill_id', skill.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('skill_course_links')
          .select(
            'id, relationship, created_at, courses(id, name, provider, course_type, duration, completed_date, catalogue_course_id, status, cancelled_at)'
          )
          .eq('skill_id', skill.id),
        listOutgoingValidationRequests(skill.id),
      ])
    setHistory(assessments ?? [])
    setPeerRatings(ratings ?? [])
    setInvites((sentInvites ?? []).filter((invite) => invite.invite_type === 'rate'))
    const recommendations = (sentInvites ?? []).filter((invite) => invite.invite_type === 'recommend')
    setRecommendInvites(recommendations)
    // Who accepted a recommendation, by name, for that list.
    getProfiles(recommendations.map((invite) => invite.accepted_by))
      .then(setRecommendAcceptors)
      .catch(() => setRecommendAcceptors({}))
    setRelationshipLinks(links ?? [])
    setStatements(st ?? [])
    setTargets(skillTargets ?? [])
    setSkillTags(tags ?? [])
    setCourseLinks(courses ?? [])
    setValidationRequests(requests ?? [])
    setLoadingHistory(false)

    const validatorIds = [...new Set((requests ?? []).map((r) => r.validator_id).filter(Boolean))]
    if (validatorIds.length > 0) {
      const { data: validatorProfiles } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', validatorIds)
      setValidatorNames(Object.fromEntries((validatorProfiles ?? []).map((p) => [p.id, p.full_name])))
    } else {
      setValidatorNames({})
    }

    const raterIds = [...new Set((ratings ?? []).map((r) => r.rater_id).filter(Boolean))]
    if (raterIds.length > 0) {
      const { data: raterProfiles } = await supabase
        .from('profiles')
        .select('id, avatar_url')
        .in('id', raterIds)
      setRaterAvatars(Object.fromEntries((raterProfiles ?? []).map((p) => [p.id, p.avatar_url])))
    } else {
      setRaterAvatars({})
    }
    // The fresh activities, for a caller that compares before and after (a
    // goal's "3 more than last time" feedback).
    return st ?? []
  }

  async function loadAssessorName() {
    const { data } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single()
    setAssessorName(data?.full_name || user.email)
  }

  return {
    skill,
    setSkill,
    loadingSkill,
    notFound,
    history,
    peerRatings,
    invites,
    raterAvatars,
    relationshipLinks,
    statements,
    skillTags,
    allTags,
    targets,
    courseLinks,
    loadingHistory,
    assessorName,
    validationRequests,
    validatorNames,
    recommendInvites,
    recommendAcceptors,
    loadSkill,
    loadHistory,
  }
}

// What surrounds the skill on the page: who else tracks it, catalogue
// courses for it, its composite parts and parents, and any target a team or
// organisation set for it. refreshAvailableCourses reloads the Learning
// section's Recommended after a course is planned, removed or cancelled.
export function useSkillRelatedData(skill, courseLinks) {
  const { user } = useAuth()
  const { t } = useLanguage()
  const [connectionsWithSkill, setConnectionsWithSkill] = useState([])
  const [totalTrackersCount, setTotalTrackersCount] = useState(0)
  const [knownPeople, setKnownPeople] = useState({})
  const [availableCourses, setAvailableCourses] = useState(null)
  // catalogue course id -> { completed, total } lessons, for enrolled
  // catalogue courses on the learner's own skill.
  const [progressByCatalogueId, setProgressByCatalogueId] = useState({})
  // Bumped after planning, removing, cancelling or studying a course, so
  // Recommended and course progress reload along with the page's course links.
  const [learningVersion, setLearningVersion] = useState(0)
  const [composite, setComposite] = useState(null)
  const [loadingComposite, setLoadingComposite] = useState(false)
  const [compositeError, setCompositeError] = useState(null)
  const [parentComposites, setParentComposites] = useState([])
  // The target a team or organisation set for this skill, if any -- see
  // pickTargetSetByOthers for which one applies and when it counts as met.
  const [targetSetByOthers, setTargetSetByOthers] = useState(null)

  useEffect(() => {
    if (!skill?.library_skill_id) {
      setConnectionsWithSkill([])
      setTotalTrackersCount(0)
      return
    }
    listConnectionsWithSkill(skill.library_skill_id, user.id).then(setConnectionsWithSkill)
    countSkillTrackers(skill.library_skill_id).then(setTotalTrackersCount)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads its inputs once when opened, by design
  }, [skill?.library_skill_id])

  // How far the learner is through each enrolled catalogue course, so the
  // Learning section can tell In progress from Enrolled and show progress.
  const underwayCatalogueKey = courseLinks
    .map((link) => link.courses)
    .filter((course) => course && !course.completed_date && course.catalogue_course_id)
    .map((course) => course.catalogue_course_id)
    .sort()
    .join(',')
  useEffect(() => {
    if (!underwayCatalogueKey || skill?.user_id !== user.id) {
      setProgressByCatalogueId({})
      return
    }
    let live = true
    listCourseProgressByCatalogueId(underwayCatalogueKey.split(','), user.id)
      .then((progress) => {
        if (live) setProgressByCatalogueId(progress)
      })
      .catch(() => {
        if (live) setProgressByCatalogueId({})
      })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- when the set of underway courses changes, or after studying one
  }, [underwayCatalogueKey, skill?.user_id, learningVersion])

  // Catalogue courses that teach this skill and the learner has no record of
  // (not planned, taken or cancelled), for the Learning section's
  // Recommended. Only on their own skill, and only when it's a library skill
  // a course can be tagged with.
  useEffect(() => {
    if (!skill || skill.user_id !== user.id || !skill.library_skill_id) {
      setAvailableCourses(null)
      return
    }
    let live = true
    Promise.all([listCatalogueCourses(), listMyCatalogueCourseIds(user.id)])
      .then(([catalogue, mine]) => {
        if (!live) return
        setAvailableCourses(
          catalogue
            .filter((course) => !mine.has(course.id))
            .map((course) => ({ course, level: course.skillEntries.find((e) => e.skillId === skill.library_skill_id)?.level ?? null }))
            .filter((entry) => entry.course.skillEntries.some((e) => e.skillId === skill.library_skill_id))
            .sort((a, b) => (a.level ?? 0) - (b.level ?? 0)),
        )
      })
      .catch(() => {
        if (live) setAvailableCourses(null)
      })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per skill
  }, [skill?.id, skill?.library_skill_id, learningVersion])

  // Names for the people invites were sent to: an invite only keeps the
  // email address, so match it to a connection's. Anyone else stays an
  // address until they join and connect.
  useEffect(() => {
    if (!skill || skill.user_id !== user.id) return
    let live = true
    listConnections(user.id)
      .then(async (list) => {
        const withEmail = list.filter((connection) => connection.email)
        const profiles = await getProfiles(withEmail.map((connection) => connection.id))
        if (!live) return
        setKnownPeople(Object.fromEntries(withEmail.map((connection) => [
          connection.email.toLowerCase(),
          { name: connection.name, avatarUrl: profiles[connection.id]?.avatarUrl ?? null },
        ])))
      })
      .catch(() => {})
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per skill
  }, [skill?.id])

  useEffect(() => {
    let active = true
    if (!skill?.library_skill_id) {
      setComposite(null)
      setCompositeError(null)
      return undefined
    }
    setLoadingComposite(true)
    setCompositeError(null)
    getLearnerCompositeProgress(skill.library_skill_id, user.id)
      .then((result) => {
        if (active) setComposite(result)
      })
      .catch((err) => {
        if (active) setCompositeError(`${t('skillDetail.couldntLoadComponentProgressPrefix')} ${err.message}`)
      })
      .finally(() => {
        if (active) setLoadingComposite(false)
      })
    return () => { active = false }
  }, [skill?.library_skill_id, user.id, t])

  useEffect(() => {
    let active = true
    if (!skill?.library_skill_id) {
      setParentComposites([])
      return undefined
    }
    getParentCompositesForSkill(skill.library_skill_id, user.id)
      .then((result) => {
        if (active) setParentComposites(result)
      })
      .catch(() => {
        if (active) setParentComposites([])
      })
    return () => { active = false }
  }, [skill?.library_skill_id, user.id])

  // A target set by a team manager or an organisation for this skill. It
  // shows until a rating from that same context reaches it, then the
  // learner's own higher target takes over -- see computeVisibleTarget.
  useEffect(() => {
    let active = true
    if (!skill?.id) {
      setTargetSetByOthers(null)
      return undefined
    }
    Promise.all([listTargetsSetByOthers(user.id), listLatestManagerRatings(user.id)])
      .then(([targets, ratings]) => {
        if (active) setTargetSetByOthers(pickTargetSetByOthers({ libraryId: skill.library_skill_id, skillId: skill.id }, targets, ratings))
      })
      .catch(() => {
        if (active) setTargetSetByOthers(null)
      })
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads its inputs once when opened, by design
  }, [skill?.id, skill?.library_skill_id])

  return {
    connectionsWithSkill,
    totalTrackersCount,
    knownPeople,
    availableCourses,
    progressByCatalogueId,
    refreshAvailableCourses: () => setLearningVersion((v) => v + 1),
    composite,
    loadingComposite,
    compositeError,
    parentComposites,
    targetSetByOthers,
  }
}
