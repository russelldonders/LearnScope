import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate, useLocation, useSearchParams, Link } from 'react-router-dom'
import { handleTabListKeyDown } from '../lib/tabsKeyboard'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import { isSelfAssessmentDue } from '../lib/checkin'
import AppHeader from '../components/AppHeader'
import BackLink from '../components/BackLink'
import GrowthRing from '../components/GrowthRing'
import SkillNetworkSection, { RatingsFromOthers } from '../components/SkillNetworkSection'
import SkillLearningSection from '../components/SkillLearningSection'
import SkillResourcesSection from '../components/SkillResourcesSection'
import ConfirmDialog from '../components/ConfirmDialog'
import QuickActivityLog from '../components/QuickActivityLog'
import { listSkillGoals } from '../lib/skillGoals'
import { computeGoalProgress } from '../lib/skillGoalProgress'
import {
  cancelCourse,
  listCatalogueCourses,
  listMyCatalogueCourseIds,
  planCatalogueCourse,
  removePlannedCourse,
  startedCatalogueCourseIds,
} from '../lib/courseCatalogue'
import PeopleWithSkillModal from '../components/PeopleWithSkillModal'
import { LEVEL_LABELS } from '../lib/levels'
import { SKILL_LIFECYCLE_LABELS } from '../lib/skillLifecycle'
import { isDiagnosticStatement, isPeerRatingStatement } from '../lib/xapiStatement'
import { fetchStatementsForSkill, saveActivity } from '../lib/activitySkillLinks'
import AccessibleDialog from '../components/AccessibleDialog'
import { listTags, listSkillTags, addTagToSkill, removeSkillTagLink } from '../lib/skillTags'
import { isDuplicateSkillNameError, duplicateSkillMessage } from '../lib/skillDuplicates'
import InviteRaterModal from '../components/InviteRaterModal'
import RecommendSkillModal from '../components/RecommendSkillModal'
import RecordActivityModal from '../components/RecordActivityModal'
import AssessBaselineModal from '../components/AssessBaselineModal'
import SetTargetModal from '../components/SetTargetModal'
import ValidateSkillModal from '../components/ValidateSkillModal'
import RequestValidationModal from '../components/RequestValidationModal'
import ConfirmingBaselineQuizModal from '../components/ConfirmingBaselineQuizModal'
import InterviewModal from '../components/InterviewModal'
import LifecycleStageIcon from '../components/LifecycleStageIcon'
import { listOutgoingValidationRequests } from '../lib/skillValidationRequests'
import { computeUpNextItems } from '../lib/skillNextAction'
import { computeTrustStatus, isPersonValidated, TRUST_STATUS_COLORS } from '../lib/skillProficiencyModel'
import { countSkillTrackers, listConnectionsWithSkill } from '../lib/skillStats'
import { getProfiles, listConnections } from '../lib/connections'
import { getLearnerCompositeProgress, getParentCompositesForSkill } from '../lib/skillComposites'
import { listTargetsSetByOthers, listLatestManagerRatings, pickTargetSetByOthers } from '../lib/managerSkillActions'
import { computeVisibleTarget } from '../lib/skillTargetPrecedence'
import CompositeSkillProgress from '../components/CompositeSkillProgress'
import SkillGoalsSection from '../components/SkillGoalsSection'
import { HistorySection, TimelineDetailModal } from './SkillHistorySection'
import { LevelDetail, NestedSkillPanel, SkillPanel } from './SkillDetailPanels'
import { ActivitiesModal, SelfAssessModal } from './SkillDetailModals'
import ActivityTimeline from '../components/ActivityTimeline'
import { timelineRows } from '../lib/activityTimeline'

const DEMONSTRATE_TIMELINE_LENGTH = 5
import { ScheduleSection, DetailsSection, DeleteSection, SettingsSection } from './SkillSettingsSections'

// Knowing about the skill (level, quizzes, learning), doing it (level,
// activities, ratings, goals), who else has it, and everything that's
// happened. Network only for a library skill -- without one the skill can't
// be matched to anyone else's.
const SKILL_DETAIL_TABS = [
  { key: 'knowledge' },
  { key: 'application' },
  { key: 'network', needsLibrarySkill: true },
]

export default function SkillDetail({ skillId, embedded = false }) {
  const { id: routeId } = useParams()
  const id = skillId ?? routeId
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const { t } = useLanguage()
  const backTo = location.state?.from ?? '/skills'
  // fromLabel carries a specific destination name (e.g. the parent
  // composite skill a component was started from) -- falls back to the
  // previous two-way generic wording when it's not set, so every existing
  // caller that only ever passed `from` (never `fromLabel`) keeps reading
  // exactly as it did before.
  const backLabel = location.state?.fromLabel
    ? `${t('skillDetail.backToPrefix')} ${location.state.fromLabel}`
    : location.state?.from ? t('skillDetail.backToExperience') : t('skillDetail.backToSkills')
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab')
  const tabRefs = useRef({})

  function buildTabParams(overrides) {
    const next = new URLSearchParams(searchParams)
    Object.entries(overrides).forEach(([key, value]) => {
      if (value === null || value === undefined) next.delete(key)
      else next.set(key, value)
    })
    return next
  }

  const [skill, setSkill] = useState(null)
  const [loadingSkill, setLoadingSkill] = useState(true)
  // Opening a goal for editing (e.g. Home's "Add a target") lands where goals
  // are. An old ?tab=overview (or ?tab=history) link falls through to the
  // first tab.
  const visibleTabs = SKILL_DETAIL_TABS.filter((d) => !d.needsLibrarySkill || skill?.library_skill_id)
  const tab = visibleTabs.some((d) => d.key === requestedTab)
    ? requestedTab
    : location.state?.editGoalId
      ? 'application'
      : 'knowledge'
  // The timeline opens in a popup over the current tab, like settings. A deep
  // link that highlights a specific timeline entry (from Activity.jsx or
  // elsewhere), or an old ?tab=history link, opens it straight away.
  const [historyOpen, setHistoryOpen] = useState(
    () => requestedTab === 'history' || Boolean(location.state?.highlightActivityId)
  )
  function closeHistory() {
    setHistoryOpen(false)
    if (requestedTab === 'history') setSearchParams(buildTabParams({ tab: null }), { replace: true })
  }
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
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteAfterSelfAssess, setInviteAfterSelfAssess] = useState(false)
  const [recommendOpen, setRecommendOpen] = useState(false)
  const [selfAssessOpen, setSelfAssessOpen] = useState(false)
  const [selfAssessKnowledgeOpen, setSelfAssessKnowledgeOpen] = useState(false)
  const [confirmingBaselineOpen, setConfirmingBaselineOpen] = useState(false)
  const [interviewOpen, setInterviewOpen] = useState(false)
  const [recordActivityOpen, setRecordActivityOpen] = useState(false)
  const [activitiesListOpen, setActivitiesListOpen] = useState(false)
  const [selectedActivityEvent, setSelectedActivityEvent] = useState(null)
  const [assessMode, setAssessMode] = useState(null)
  const [targetOpen, setTargetOpen] = useState(false)
  const [validateOpen, setValidateOpen] = useState(false)
  const [expertValidationOpen, setExpertValidationOpen] = useState(false)
  const [validationRequests, setValidationRequests] = useState([])
  const [validatorNames, setValidatorNames] = useState({})
  const [connectionsWithSkill, setConnectionsWithSkill] = useState([])
  const [totalTrackersCount, setTotalTrackersCount] = useState(0)
  const [findExpertOpen, setFindExpertOpen] = useState(false)
  const [recommendInvites, setRecommendInvites] = useState([])
  const [recommendAcceptors, setRecommendAcceptors] = useState({})
  const [knownPeople, setKnownPeople] = useState({})
  const [availableCourses, setAvailableCourses] = useState(null)
  const [startedCatalogueIds, setStartedCatalogueIds] = useState(new Set())
  // Bumped after planning, removing or cancelling a course, so Recommended
  // reloads along with the page's course links.
  const [learningVersion, setLearningVersion] = useState(0)
  const [cancellingCourse, setCancellingCourse] = useState(null)
  const [learningError, setLearningError] = useState(null)
  const [quickLogOpen, setQuickLogOpen] = useState(false)
  const [quickLogGoals, setQuickLogGoals] = useState([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [composite, setComposite] = useState(null)
  const [loadingComposite, setLoadingComposite] = useState(false)
  const [compositeError, setCompositeError] = useState(null)
  const [startingComponentId, setStartingComponentId] = useState(null)
  const [startComponentError, setStartComponentError] = useState(null)
  const [parentComposites, setParentComposites] = useState([])
  // The target a team or organisation set for this skill, if any -- see
  // pickTargetSetByOthers for which one applies and when it counts as met.
  const [targetSetByOthers, setTargetSetByOthers] = useState(null)

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

  // This skill's active goals, so the quick log can fill in goal values from
  // what was said (only the owner has goals).
  useEffect(() => {
    if (!quickLogOpen || !skill || skill.user_id !== user.id) return
    let live = true
    listSkillGoals(skill.id)
      .then((list) => {
        if (live) setQuickLogGoals(list.filter((goal) => goal.status === 'active'))
      })
      .catch(() => {})
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- when the quick log opens
  }, [quickLogOpen, skill?.id])

  // Which enrolled catalogue courses have a lesson started, so the Learning
  // section can tell In progress from Enrolled.
  const underwayCatalogueKey = courseLinks
    .map((link) => link.courses)
    .filter((course) => course && !course.completed_date && course.catalogue_course_id)
    .map((course) => course.catalogue_course_id)
    .sort()
    .join(',')
  useEffect(() => {
    if (!underwayCatalogueKey || skill?.user_id !== user.id) {
      setStartedCatalogueIds(new Set())
      return
    }
    let live = true
    startedCatalogueCourseIds(user.id, underwayCatalogueKey.split(','))
      .then((ids) => {
        if (live) setStartedCatalogueIds(ids)
      })
      .catch(() => {
        if (live) setStartedCatalogueIds(new Set())
      })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- when the set of underway courses changes
  }, [underwayCatalogueKey, skill?.user_id])

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

  // Starts tracking a not-yet-tracked composite component directly from
  // here, instead of sending the learner off to find and add it themselves
  // from the Skills page. Same shape FindSkillModal's own insert already
  // uses for a fresh manual add (level/lifecycle_stage null/'identified',
  // never pre-filled at the requirement's target level -- creating the row
  // isn't evidence that level is already met). Navigates straight to the
  // new skill's own page since there's nothing left to do on this one.
  async function handleStartComponent(component) {
    setStartComponentError(null)
    setStartingComponentId(component.id)
    try {
      const { data, error } = await supabase
        .from('skills')
        .insert({
          name: component.name,
          category: component.category,
          level: null,
          is_current_role: false,
          tracking_reason: 'career_development',
          lifecycle_stage: 'identified',
          library_skill_id: component.librarySkillId,
          user_id: user.id,
        })
        .select('id')
        .single()
      if (error) throw error
      navigate(`/skills/${data.id}`, { state: { from: `/skills/${skill.id}`, fromLabel: skill.name } })
    } catch (err) {
      setStartComponentError(isDuplicateSkillNameError(err) ? duplicateSkillMessage(component.name) : err.message)
      setStartingComponentId(null)
    }
  }

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
      // The per-instance columns stay authoritative for a fully custom skill
      // (no library_skill_id); for a library-linked one they're only ever
      // populated pre-0089, so fall back to the shared library cache -- same
      // guide text either way, just resolved without an extra round trip if
      // it's already sitting in the join above.
      setSkill({
        ...data,
        knowledge_level_guide: data.knowledge_level_guide ?? data.skill_library?.knowledge_level_guide ?? null,
        practical_level_guide: data.practical_level_guide ?? data.skill_library?.practical_level_guide ?? null,
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

  // Planning, removing or cancelling a course, then reloading what the
  // Learning section shows.
  async function runLearningAction(action) {
    setLearningError(null)
    try {
      await action()
    } catch (err) {
      setLearningError(err.message)
    }
    await loadHistory()
    setLearningVersion((v) => v + 1)
  }

  async function handleAddTag(tagName) {
    await addTagToSkill(user.id, skill.id, tagName)
    await loadHistory()
  }

  async function handleRemoveTag(skillTagLinkId) {
    await removeSkillTagLink(skillTagLinkId)
    await loadHistory()
  }

  async function handleDemonstrateSkill() {
    const { error } = await supabase.from('skills').update({ lifecycle_stage: 'developing' }).eq('id', skill.id)
    if (!error) await loadSkill()
  }

  async function handleValidateSkillStage() {
    const { error } = await supabase.from('skills').update({ lifecycle_stage: 'demonstrated' }).eq('id', skill.id)
    if (!error) await loadSkill()
  }

  async function loadAssessorName() {
    const { data } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single()
    setAssessorName(data?.full_name || user.email)
  }

  async function handleRecordActivity(statement, evidence) {
    await saveActivity({ userId: user.id, statement, evidence, skillIds: [skill.id] })
    setRecordActivityOpen(false)
    await loadHistory()
  }

  const selfAssessedCount = history.filter((a) => (a.source === 'self' || !a.source) && a.axis === 'practical').length
  const knowledgeSelfAssessedCount = history.filter(
    (a) => (a.source === 'self' || !a.source) && a.axis === 'knowledge'
  ).length
  // The Confirming Baseline knowledge quiz logs its own xAPI attempt --
  // that's knowledge-axis evidence, not practical activity, so it must be
  // excluded here or it silently marks "Record an activity" done and
  // inflates practical trust/history for a skill nobody has practiced yet.
  const practicalStatements = statements.filter((s) => !isDiagnosticStatement(s.statement) && !isPeerRatingStatement(s.statement))
  const invitesSentCount = invites.length
  const hasAnyEvaluationInput = selfAssessedCount > 0 || peerRatings.length > 0 || practicalStatements.length > 0
  const latestKnowledgeAssessment = history.find((a) => a.axis === 'knowledge') ?? null
  // The most recent knowledge-axis event wins, whichever kind it is. A fresh
  // self-assessment after a confirmation is a claim of having grown beyond
  // what was verified -- it should immediately become what's shown, with the
  // trust badge dropping back to Self-assessed (see knowledgeConfirmed
  // below), not stay silently shadowed by the older confirmed number. Before
  // anything is confirmed this is just the latest self-assessment, same as
  // before.
  const displayedKnowledgeLevel = latestKnowledgeAssessment?.level ?? skill?.knowledge_level ?? null
  // The confirmed level (skills.knowledge_level, set only by the Confirming
  // Baseline quiz) never moves on a plain self-assessment -- it's the floor
  // a later self-assessment can't be set below (see SelfAssessSection) and,
  // when a newer self-assessment has since claimed higher, the boundary
  // shown in the level bar's colour gradient between "confirmed" and
  // "self-assessed since" (see the milestoneLevel prop below).
  const confirmedKnowledgeLevel = skill?.knowledge_level ?? null
  // Neither tool has anything to pitch a level at yet -- no self-assessment,
  // no prior confirmation. Rather than silently defaulting to "Unfamiliar"
  // (which would test someone who's actually advanced as a total beginner),
  // the quiz/interview switch into calibration mode: find the level from
  // scratch instead of confirming an assumed one. See ConfirmingBaselineQuizModal
  // and InterviewModal.
  const knowledgeCalibrating = latestKnowledgeAssessment == null && confirmedKnowledgeLevel == null
  const knowledgeMilestone =
    confirmedKnowledgeLevel && displayedKnowledgeLevel && confirmedKnowledgeLevel < displayedKnowledgeLevel
      ? confirmedKnowledgeLevel
      : null
  // Same fallback for the practical axis -- skill.level only moves on an
  // explicit baseline evaluation, so without this a self-assessment would
  // leave the Can Do panel stuck on "Not yet self-assessed" through the
  // whole self-assess -> evaluate gap, same reasoning as knowledge above.
  const latestPracticalAssessment = history.find((a) => a.axis === 'practical') ?? null
  const displayedPracticalLevel = skill?.level ?? latestPracticalAssessment?.level ?? null

  // Practical-primary / knowledge-foundation model: derived, not stored --
  // see skillProficiencyModel.js. Trust status is computed independently
  // per axis and never blended into a level.
  // Only the *latest* knowledge event counts as confirmation, not "ever
  // confirmed at any point" -- otherwise a newer self-assessment could never
  // knock the trust badge back down to Self-assessed the way it should.
  const knowledgeConfirmed = latestKnowledgeAssessment?.source === 'diagnostic_confirmed'
  const practicalVerification = skill
    ? computeTrustStatus({
        axis: 'practical',
        selfAssessedCount,
        evidenceCount: practicalStatements.length,
        peerRatingsCount: peerRatings.length,
        formallyValidated: isPersonValidated(
          skill.lifecycle_stage,
          validationRequests.some((r) => r.status === 'confirmed')
        ),
      })
    : null
  const knowledgeVerification = computeTrustStatus({
    axis: 'knowledge',
    selfAssessedCount: knowledgeSelfAssessedCount,
    knowledgeConfirmed,
  })
  // The same object while the skill's id and name stay the same, for the quick log.
  const focusSkillId = skill?.id
  const focusSkillName = skill?.name
  // The Demonstrate box's own timeline: the latest few, plus anything just
  // logged for an earlier date so it shows straight away.
  const demonstrateRows = timelineRows(practicalStatements, { limit: DEMONSTRATE_TIMELINE_LENGTH })
  const focusSkill = useMemo(
    () => (focusSkillId ? { id: focusSkillId, name: focusSkillName } : null),
    [focusSkillId, focusSkillName],
  )
  const trainingScopeState = skill
    ? {
        skillId: skill.id,
        skillName: skill.name,
        librarySkillId: skill.library_skill_id,
        skillLevel: skill.level,
        backTo: `/skills/${skill.id}`,
      }
    : null

  // Next milestone reuses the exact same Up Next logic shown lower on the
  // page (computeUpNextItems), just previewed here as a single headline.
  // upNextHandlers mirrors UpNextSection's own key->handler map (see there)
  // so the preview's button acts identically to clicking the same item in
  // the full list, rather than only describing the action in text.
  const upNextHandlers = {
    'self-assess': () => setSelfAssessOpen(true),
    'self-assess-knowledge': () => setSelfAssessKnowledgeOpen(true),
    'confirm-baseline-quiz': () => setConfirmingBaselineOpen(true),
    invite: () => setInviteOpen(true),
    activity: () => setQuickLogOpen(true),
    target: () => setTargetOpen(true),
    'find-course': () => navigate('/training', { state: trainingScopeState }),
    demonstrate: handleDemonstrateSkill,
    'record-activity': () => setQuickLogOpen(true),
    'self-assess-demonstrating': () => setSelfAssessOpen(true),
    'invite-demonstrating': () => setInviteOpen(true),
    validate: handleValidateSkillStage,
    'invite-validating': () => setInviteOpen(true),
    'request-validation': () => setExpertValidationOpen(true),
    'ai-assessment': () => setValidateOpen(true),
  }
  const upNextPreview = computeUpNextItems({
    stage: skill?.lifecycle_stage,
    selfAssessedCount,
    knowledgeSelfAssessedCount,
    hasKnowledgeLevel: Boolean(skill?.knowledge_level),
    peerRatingsCount: peerRatings.length,
    invitesSentCount,
    statementsCount: practicalStatements.length,
    courseLinks,
    hasTarget: targets.length > 0,
    hasPendingExpertValidation: validationRequests.some((r) => r.status === 'pending'),
  })
  const nextMilestone = upNextPreview.find((item) => !item.done && !item.locked) ?? null
  const nextMilestoneAction = nextMilestone ? upNextHandlers[nextMilestone.key] : undefined

  // Per-panel status figures for the five-panel layout below -- each panel
  // shows its own axis independently of the others (deliberately not gated
  // on lifecycle_stage), since knowledge/practical/training/practice/
  // validation can all progress out of strict order.
  const currentTarget = targets[0] ?? null
  const visibleTarget = computeVisibleTarget({
    employerTargetLevel: targetSetByOthers?.level ?? null,
    employerConfirmedLevel: targetSetByOthers?.met ? targetSetByOthers.level : null,
    personalTargetLevel: currentTarget?.target_level ?? null,
  })
  const pendingValidationRequestsCount = validationRequests.filter((r) => r.status === 'pending').length
  const decidedValidationRequestsCount = validationRequests.length - pendingValidationRequestsCount
  // "Demonstrate skill" / "Move to validating" do advance lifecycle_stage,
  // so unlike the rest of the Demonstrate panel's actions they stay gated --
  // showing them outside their stage would let the stage go backwards or
  // skip ahead of what computeUpNextItems considers reachable.
  const canShowDemonstrateAction = upNextPreview.some((item) => item.key === 'demonstrate')
  const canShowValidateAction = upNextPreview.some((item) => item.key === 'validate')

  return (
    <div className="min-h-screen bg-paper">
      {!embedded && <AppHeader />}
      <main id={embedded ? "lti-skill-content" : "main-content"} tabIndex={-1} className="max-w-4xl mx-auto px-4 py-8">
        {/* Back to whatever opened this skill: a page that said so, else
            the previous page in the app, else the skills list. */}
        <BackLink
          to={location.state?.from ?? null}
          label={backLabel}
          state={{ tab: 'skills' }}
          fallbackTo="/skills"
          fallbackLabel={t('skillDetail.backToSkills')}
          className="text-sm text-secondary hover:text-ink mb-6 inline-block"
        />

        {loadingSkill && <p className="text-secondary">{t('skillDetail.loading')}</p>}
        {notFound && <p className="text-secondary">{t('skillDetail.skillNotFound')}</p>}

        {skill && (
          <div className="bg-card border border-hairline rounded-lg p-6">
            <div className="mb-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                <GrowthRing
                  level={displayedPracticalLevel}
                  size={56}
                  color={TRUST_STATUS_COLORS[practicalVerification]}
                />
                <div>
                  <div className="flex items-center gap-2">
                    <h1 className="font-display text-2xl text-ink">{skill.name}</h1>
                    {skill.source === 'role_profile' && (
                      <span
                        title={t('skillDetail.roleProfileBadgeTitle')}
                        className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-moss border border-moss/40 rounded-full px-2 py-0.5"
                      >
                        {t('skillDetail.roleProfileBadgeLabel')}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-secondary flex items-center gap-1.5">
                    {!displayedPracticalLevel && skill.lifecycle_stage && (
                      <LifecycleStageIcon stage={skill.lifecycle_stage} />
                    )}
                    {displayedPracticalLevel
                      ? LEVEL_LABELS[displayedPracticalLevel]
                      : skill.lifecycle_stage
                        ? SKILL_LIFECYCLE_LABELS[skill.lifecycle_stage]
                        : t('skillDetail.notYetSelfAssessed')}
                  </p>
                  {parentComposites.length > 0 && (
                    <p className="text-xs text-secondary mt-0.5">
                      {t('skillDetail.partOfPrefix')}{' '}
                      {parentComposites.map((parent, index) => (
                        <span key={parent.librarySkillId}>
                          {index > 0 && ', '}
                          {parent.trackedSkillId ? (
                            <Link to={`/skills/${parent.trackedSkillId}`} className="text-moss hover:underline underline-offset-2">
                              {parent.name}
                            </Link>
                          ) : (
                            parent.name
                          )}
                        </span>
                      ))}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    targets.length > 0
                      ? setValidateOpen(true)
                      : setAssessMode(skill.lifecycle_stage === 'identified' ? 'baseline' : 'evaluate')
                  }
                  disabled={!hasAnyEvaluationInput}
                  aria-label={t('skillDetail.requestAiAssessment')}
                  title={
                    !hasAnyEvaluationInput
                      ? t('skillDetail.requestAiAssessmentDisabledHint')
                      : t('skillDetail.requestAiAssessment')
                  }
                  className="rounded-full bg-moss text-paper text-xs font-medium px-2.5 sm:px-3 py-1.5 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span aria-hidden="true">✨</span>
                  <span className="hidden sm:inline"> {t('skillDetail.requestAiAssessment')}</span>
                </button>
                <button
                  type="button"
                  id="skill-detail-history-button"
                  onClick={() => setHistoryOpen(true)}
                  aria-haspopup="dialog"
                  aria-label={t('skillDetail.tabs.history')}
                  title={t('skillDetail.tabs.history')}
                  className="p-1.5 rounded-md text-moss hover:opacity-75 transition-opacity"
                >
                  {/* A clock with an arrow turning back: the skill's timeline. */}
                  <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                    <path d="M3 3v5h5" />
                    <path d="M12 7v5l3 2" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  aria-label={t('skillDetail.skillSettings')}
                  title={t('skillDetail.skillSettings')}
                  className="p-2 -m-2 rounded-md text-moss hover:opacity-75 transition-opacity"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                </button>
              </div>
            </div>

            {nextMilestone && (
              <div className="rounded-md border border-hairline bg-paper px-3 py-2 mt-3">
                <p className="font-mono text-[10px] uppercase tracking-wide text-secondary">{t('skillDetail.nextMilestone')}</p>
                <p className="text-sm text-ink mt-0.5">{nextMilestone.label}</p>
                <p className="text-xs text-secondary mt-0.5">{nextMilestone.description}</p>
                {nextMilestoneAction && (
                  <button
                    type="button"
                    onClick={nextMilestoneAction}
                    className="mt-2 rounded-md bg-moss text-paper text-xs font-medium px-3 py-1.5 hover:opacity-90"
                  >
                    {t('skillDetail.start')}
                  </button>
                )}
              </div>
            )}

            <div
              role="tablist"
              aria-label={t('skillDetail.tabsAriaLabel')}
              className="flex items-center flex-wrap gap-1 mt-4 border-b border-hairline"
            >
              {visibleTabs.map((tabDef) => (
                <button
                  key={tabDef.key}
                  type="button"
                  ref={(el) => { tabRefs.current[tabDef.key] = el }}
                  id={`skill-detail-tab-${tabDef.key}`}
                  role="tab"
                  aria-selected={tab === tabDef.key}
                  aria-controls={`skill-detail-panel-${tabDef.key}`}
                  tabIndex={tab === tabDef.key ? 0 : -1}
                  onClick={() => setSearchParams(buildTabParams({ tab: tabDef.key }))}
                  onKeyDown={(event) =>
                    handleTabListKeyDown(event, {
                      keys: visibleTabs.map((d) => d.key),
                      activeKey: tab,
                      refs: tabRefs,
                      onChange: (key) => setSearchParams(buildTabParams({ tab: key })),
                    })
                  }
                  className={`text-sm px-3 py-2 -mb-px border-b-2 whitespace-nowrap ${
                    tab === tabDef.key
                      ? 'border-moss text-ink font-medium'
                      : 'border-transparent text-secondary hover:text-ink'
                  }`}
                >
                  {t(`skillDetail.tabs.${tabDef.key}`)}
                </button>
              ))}
            </div>

            {tab === 'knowledge' && (
            <div id="skill-detail-panel-knowledge" role="tabpanel" aria-labelledby="skill-detail-tab-knowledge">
            <div className="mt-4 pt-4 border-t border-hairline">
              <SkillPanel
                title={t('skillDetail.knowledge')}
                accent="slate"
                status={
                  <LevelDetail
                    skill={skill}
                    axis="knowledge"
                    level={displayedKnowledgeLevel}
                    trustStatus={knowledgeVerification}
                    trustLabel={knowledgeVerification ?? t('skillDetail.knowledgeFoundation')}
                    milestoneLevel={knowledgeMilestone}
                    onSelfAssess={() => setSelfAssessKnowledgeOpen(true)}
                    onAssess={() => setConfirmingBaselineOpen(true)}
                    onInterview={() => setInterviewOpen(true)}
                    onGuideGenerated={(statements) =>
                      setSkill((s) => (s ? { ...s, knowledge_level_guide: statements } : s))
                    }
                  />
                }
                actions={[]}
              />
            </div>

            {learningError && <p role="alert" className="text-sm text-red-700 mt-3">{learningError}</p>}
            <SkillLearningSection
              courseLinks={courseLinks}
              availableCourses={availableCourses}
              startedCatalogueIds={startedCatalogueIds}
              onPlan={skill.user_id === user.id ? (course) => runLearningAction(() => planCatalogueCourse(user.id, course, skill.id)) : null}
              onRemovePlanned={skill.user_id === user.id ? (course) => runLearningAction(() => removePlannedCourse(course.id)) : null}
              onEnrolPlanned={skill.user_id === user.id ? () => navigate('/training', { state: trainingScopeState }) : null}
              onCancel={skill.user_id === user.id ? (course) => setCancellingCourse(course) : null}
              onFindCourse={skill.user_id === user.id ? () => navigate('/training', { state: trainingScopeState }) : null}
              onOpenAvailable={() => navigate('/training', { state: trainingScopeState })}
            />
            {skill.user_id === user.id && (
              <SkillResourcesSection
                skill={skill}
                user={user}
                knowledgeLevel={displayedKnowledgeLevel}
                practicalLevel={displayedPracticalLevel}
              />
            )}
            </div>
            )}

            {tab === 'application' && (
            <div id="skill-detail-panel-application" role="tabpanel" aria-labelledby="skill-detail-tab-application">
            <div className="mt-4 pt-4 border-t border-hairline">
              <SkillPanel
                title={t('skillDetail.application')}
                status={
                  <LevelDetail
                    skill={skill}
                    axis="practical"
                    level={displayedPracticalLevel}
                    trustStatus={practicalVerification}
                    trustLabel={practicalVerification ?? t('skillDetail.practicalFoundation')}
                    ringTargetLevel={visibleTarget?.level}
                    currentTarget={currentTarget}
                    onSelfAssess={() => setSelfAssessOpen(true)}
                    onSetTarget={() => setTargetOpen(true)}
                    onAskToRate={skill.user_id === user.id ? () => setInviteOpen(true) : null}
                    onGuideGenerated={(statements) =>
                      setSkill((s) => (s ? { ...s, practical_level_guide: statements } : s))
                    }
                  />
                }
                actions={[]}
                nested={
                  <div className="space-y-3">
                    <NestedSkillPanel
                      title={t('skillDetail.stages.demonstrate')}
                      status={
                        // The latest activities right here, drawn as the
                        // dashboard's timeline; the rest are one tap away.
                        <div>
                          <p className="text-sm text-secondary">
                            {practicalStatements.length} {practicalStatements.length === 1 ? t('skillDetail.activityLoggedSingular') : t('skillDetail.activityLoggedPlural')}
                            {relationshipLinks.length > 0
                              ? ` · ${t('skillDetail.linkedToPrefix')} ${relationshipLinks.length} ${relationshipLinks.length === 1 ? t('skillDetail.experienceEntrySingular') : t('skillDetail.experienceEntryPlural')}`
                              : ''}
                          </p>
                          {demonstrateRows.length > 0 && (
                            <div className="mt-3">
                              <ActivityTimeline
                                rows={demonstrateRows}
                                allRows={practicalStatements}
                                onOpen={(row) => setSelectedActivityEvent({ type: 'activity', statement: row })}
                              />
                            </div>
                          )}
                          {practicalStatements.length > demonstrateRows.length && (
                            <button
                              type="button"
                              onClick={() => setActivitiesListOpen(true)}
                              className="mt-3 text-sm text-moss font-medium hover:underline"
                            >
                              {t('activity.timeline.seeAll', { total: practicalStatements.length })}
                            </button>
                          )}
                        </div>
                      }
                      actions={[
                        { label: t('skillDetail.logSkillActivity'), onClick: () => setQuickLogOpen(true) },
                        ...(canShowDemonstrateAction
                          ? [{ label: t('skillDetail.demonstrateSkillAction'), onClick: handleDemonstrateSkill }]
                          : []),
                        ...(canShowValidateAction
                          ? [{ label: t('skillDetail.moveToValidating'), onClick: handleValidateSkillStage }]
                          : []),
                      ]}
                    />
                    <NestedSkillPanel
                      title={t('skillDetail.stages.validate')}
                      status={
                        <div className="space-y-3">
                        <p className="text-sm text-secondary">
                          {peerRatings.length > 0
                            ? `${peerRatings.length} ${peerRatings.length === 1 ? t('skillDetail.peerRatingSingular') : t('skillDetail.peerRatingPlural')}`
                            : t('skillDetail.noPeerRatingsYet')}
                          {pendingValidationRequestsCount > 0
                            ? ` · ${pendingValidationRequestsCount} ${pendingValidationRequestsCount === 1 ? t('skillDetail.requestPendingSingular') : t('skillDetail.requestPendingPlural')}`
                            : ''}
                          {decidedValidationRequestsCount > 0 ? ` · ${decidedValidationRequestsCount} ${t('skillDetail.decidedSuffix')}` : ''}
                        </p>
                        {/* Who has rated you and who you're waiting on -- the
                            learner's own invites and ratings, so only on their
                            own skill. */}
                        {skill.user_id === user.id && (
                          <RatingsFromOthers
                            ratings={peerRatings}
                            raterAvatars={raterAvatars}
                            rateInvites={invites}
                            knownPeople={knownPeople}
                          />
                        )}
                        </div>
                      }
                      actions={[
                        // Ratings are what Validate is about, so asking for one
                        // is here too (as well as in Skill network and beside
                        // the level). Only on the learner's own skill.
                        ...(skill.user_id === user.id
                          ? [{ label: t('skillDetail.askToRateAbility'), onClick: () => setInviteOpen(true) }]
                          : []),
                        // "✨ Request AI assessment" now lives in the header next
                        // to the skill name -- see the button beside setSettingsOpen
                        // above, which shares this exact same onClick/disabled logic.
                        ...(targets.length > 0
                          ? [{ label: t('skillDetail.requestValidationAction'), onClick: () => setExpertValidationOpen(true) }]
                          : []),
                      ]}
                    />
                  </div>
                }
              />
            </div>

            {/* Goals are private to the skill's owner, whoever else can view the skill. */}
            {skill.user_id === user.id && (
              <SkillGoalsSection
                skill={skill}
                user={user}
                actor={{ name: assessorName, email: user.email }}
                statements={statements}
                onActivitiesChanged={loadHistory}
                onSetLevelTarget={() => setTargetOpen(true)}
                editGoalId={location.state?.editGoalId}
                onEditGoalOpened={() =>
                  navigate(`${location.pathname}${location.search}`, {
                    replace: true,
                    state: { ...location.state, editGoalId: undefined },
                  })}
              />
            )}

            <CompositeSkillProgress
              composite={composite}
              loading={loadingComposite}
              error={compositeError}
              onStartComponent={handleStartComponent}
              startingComponentId={startingComponentId}
              startError={startComponentError}
            />
            </div>
            )}

            {tab === 'network' && (
            <div id="skill-detail-panel-network" role="tabpanel" aria-labelledby="skill-detail-tab-network">
            <SkillNetworkSection
              librarySkillId={skill.library_skill_id}
              isOwner={skill.user_id === user.id}
              recommendInvites={recommendInvites}
              recommendAcceptors={recommendAcceptors}
              knownPeople={knownPeople}
              connections={connectionsWithSkill}
              totalTrackersCount={totalTrackersCount}
              onFindExpert={() => setFindExpertOpen(true)}
              onRecommend={() => setRecommendOpen(true)}
            />

            {findExpertOpen && (
              <PeopleWithSkillModal
                librarySkillId={skill.library_skill_id}
                skillName={skill.name}
                skillId={skill.id}
                onClose={() => setFindExpertOpen(false)}
              />
            )}
            </div>
            )}
            </div>

            {cancellingCourse && (
              <ConfirmDialog
                message={t('skillDetail.learning.cancelConfirm', { course: cancellingCourse.name })}
                confirmLabel={t('skillDetail.learning.cancelConfirmLabel')}
                onConfirm={async () => {
                  await runLearningAction(() => cancelCourse(cancellingCourse.id))
                  setCancellingCourse(null)
                }}
                onCancel={() => setCancellingCourse(null)}
              />
            )}

            {inviteOpen && (
              <InviteRaterModal
                skill={skill}
                afterSelfAssessment={inviteAfterSelfAssess}
                onClose={() => {
                  setInviteOpen(false)
                  setInviteAfterSelfAssess(false)
                }}
              />
            )}

            {recommendOpen && <RecommendSkillModal skill={skill} onClose={() => setRecommendOpen(false)} />}

            {selfAssessOpen && (
              <SelfAssessModal
                skill={skill}
                user={user}
                currentLevel={displayedPracticalLevel}
                history={history}
                onClose={() => setSelfAssessOpen(false)}
                onAssessed={() => {
                  loadHistory()
                  loadSkill()
                  setSelfAssessOpen(false)
                  setInviteAfterSelfAssess(true)
                  setInviteOpen(true)
                }}
                onGuideGenerated={(statements) =>
                  setSkill((s) => (s ? { ...s, practical_level_guide: statements } : s))
                }
              />
            )}

            {selfAssessKnowledgeOpen && (
              <SelfAssessModal
                skill={skill}
                user={user}
                axis="knowledge"
                currentLevel={displayedKnowledgeLevel}
                history={history}
                onClose={() => setSelfAssessKnowledgeOpen(false)}
                onAssessed={() => {
                  loadHistory()
                  loadSkill()
                  setSelfAssessKnowledgeOpen(false)
                }}
                onGuideGenerated={(statements) =>
                  setSkill((s) => (s ? { ...s, knowledge_level_guide: statements } : s))
                }
              />
            )}

            {confirmingBaselineOpen && (
              <ConfirmingBaselineQuizModal
                skill={skill}
                user={user}
                actor={{ name: assessorName, email: user.email }}
                latestKnowledgeAssessment={latestKnowledgeAssessment}
                calibrating={knowledgeCalibrating}
                onClose={() => setConfirmingBaselineOpen(false)}
                onConfirmed={() => {
                  loadHistory()
                  loadSkill()
                  setConfirmingBaselineOpen(false)
                }}
              />
            )}

            {interviewOpen && (
              <InterviewModal
                skill={skill}
                user={user}
                actor={{ name: assessorName, email: user.email }}
                latestKnowledgeAssessment={latestKnowledgeAssessment}
                calibrating={knowledgeCalibrating}
                onClose={() => setInterviewOpen(false)}
                onConfirmed={() => {
                  loadHistory()
                  loadSkill()
                  setInterviewOpen(false)
                }}
              />
            )}

            {recordActivityOpen && (
              <RecordActivityModal
                actor={{ name: assessorName, email: user.email }}
                skills={[]}
                relatedSkill={{ id: skill.id, name: skill.name }}
                onSave={handleRecordActivity}
                onClose={() => setRecordActivityOpen(false)}
              />
            )}

            {quickLogOpen && (
              <AccessibleDialog
                labelledBy="quick-log-heading"
                onClose={() => setQuickLogOpen(false)}
                panelClassName="w-full max-w-lg bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
              >
                <div className="flex justify-end -mb-6">
                  <button type="button" onClick={() => setQuickLogOpen(false)} className="text-secondary hover:text-ink text-sm">
                    {t('skillDetail.close')}
                  </button>
                </div>
                <QuickActivityLog
                  user={user}
                  focusSkill={focusSkill}
                  goalItems={quickLogGoals.map((goal) => ({ goal, progress: computeGoalProgress(goal, statements) }))}
                  onLogged={async () => {
                    const fresh = await loadHistory()
                    return quickLogGoals.map((goal) => ({ goal, progress: computeGoalProgress(goal, fresh) }))
                  }}
                  onOpenFullForm={() => {
                    setQuickLogOpen(false)
                    setRecordActivityOpen(true)
                  }}
                />
              </AccessibleDialog>
            )}

            {activitiesListOpen && (
              <ActivitiesModal
                statements={practicalStatements}
                onSelect={(event) => {
                  setActivitiesListOpen(false)
                  setSelectedActivityEvent(event)
                }}
                onClose={() => setActivitiesListOpen(false)}
              />
            )}

            {selectedActivityEvent && (
              <TimelineDetailModal
                event={selectedActivityEvent}
                onClose={() => setSelectedActivityEvent(null)}
              />
            )}

            {assessMode && (
              <AssessBaselineModal
                skill={skill}
                user={user}
                assessments={history}
                peerRatings={peerRatings}
                statements={practicalStatements}
                mode={assessMode}
                onClose={() => setAssessMode(null)}
                onAssessed={() => {
                  loadHistory()
                  loadSkill()
                  setAssessMode(null)
                }}
              />
            )}

            {targetOpen && (
              <SetTargetModal
                skill={skill}
                user={user}
                targets={targets}
                currentLevel={displayedPracticalLevel}
                onClose={() => setTargetOpen(false)}
                onSet={() => {
                  loadHistory()
                  loadSkill()
                  setTargetOpen(false)
                }}
                onGuideGenerated={(statements) =>
                  setSkill((s) => (s ? { ...s, practical_level_guide: statements } : s))
                }
              />
            )}

            {validateOpen && targets[0] && (
              <ValidateSkillModal
                skill={skill}
                target={targets[0]}
                onClose={() => setValidateOpen(false)}
                onValidated={() => {
                  loadHistory()
                  loadSkill()
                  setValidateOpen(false)
                }}
              />
            )}

            {expertValidationOpen && targets[0] && (
              <RequestValidationModal
                skill={skill}
                user={user}
                targetLevel={targets[0].target_level}
                onClose={() => setExpertValidationOpen(false)}
                onRequested={() => {
                  loadHistory()
                  setExpertValidationOpen(false)
                }}
              />
            )}

            {settingsOpen && (
              <AccessibleDialog
                labelledBy="skill-settings-dialog-title"
                onClose={() => setSettingsOpen(false)}
                overlayClassName="z-40"
                panelClassName="w-full max-w-md bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
              >
                  <div className="flex items-center justify-between mb-4">
                    <h2 id="skill-settings-dialog-title" className="font-display text-2xl text-ink">{t('skillDetail.skillSettings')}</h2>
                    <button
                      type="button"
                      onClick={() => setSettingsOpen(false)}
                      className="text-secondary hover:text-ink text-sm"
                    >
                      {t('skillDetail.close')}
                    </button>
                  </div>
                  <div className="space-y-6">
                    <DetailsSection
                      skill={skill}
                      skillTags={skillTags}
                      allTags={allTags}
                      onAddTag={handleAddTag}
                      onRemoveTag={handleRemoveTag}
                      user={user}
                      onUpdated={loadSkill}
                    />
                    <SettingsSection skill={skill} user={user} onUpdated={loadSkill} />
                    <ScheduleSection skill={skill} onUpdated={loadSkill} />
                    <DeleteSection
                      skill={skill}
                      onUpdated={loadSkill}
                      onDeleted={() => navigate(backTo, { state: { tab: 'skills' } })}
                    />
                  </div>
              </AccessibleDialog>
            )}

            {(skill.next_checkin_date || currentTarget || targetSetByOthers) && (
              <div className="mt-4 pt-4 border-t border-hairline">
                <h3 className="font-mono text-[10px] uppercase tracking-wide text-secondary mb-3">{t('skillDetail.upcoming')}</h3>
                <div className="space-y-2">
                  {targetSetByOthers && (
                    <div className="flex items-center justify-between rounded-md border border-hairline bg-paper px-3 py-2">
                      <span className="font-mono text-xs uppercase tracking-wide text-secondary">
                        {t('skillDetail.targetSetByPrefix', { name: targetSetByOthers.contextName })} {LEVEL_LABELS[targetSetByOthers.level]}
                      </span>
                      <span className={`text-sm font-medium ${visibleTarget?.employerTargetMet ? 'text-moss' : 'text-ink'}`}>
                        {visibleTarget?.employerTargetMet
                          ? t('skillDetail.met')
                          : t('skillDetail.workingTowardsNeedsConfirmation')}
                      </span>
                    </div>
                  )}
                  {targetSetByOthers && visibleTarget?.employerTargetMet && visibleTarget.source === 'personal' && (
                    <p className="text-xs text-secondary px-1">
                      {t('skillDetail.otherTargetMetWorkingTowardOwn', { name: targetSetByOthers.contextName })}
                    </p>
                  )}
                  {skill.next_checkin_date && (
                    <div
                      className={`flex items-center justify-between rounded-md border px-3 py-2 ${
                        isSelfAssessmentDue(skill.next_checkin_date)
                          ? 'border-gold bg-gold/10'
                          : 'border-hairline bg-paper'
                      }`}
                    >
                      <span className="font-mono text-xs uppercase tracking-wide text-secondary">
                        {t('skillDetail.nextSelfAssessment')}
                      </span>
                      <span
                        className={`text-sm font-medium ${
                          isSelfAssessmentDue(skill.next_checkin_date) ? 'text-gold' : 'text-ink'
                        }`}
                      >
                        {new Date(`${skill.next_checkin_date}T00:00:00`).toLocaleDateString()}
                        {isSelfAssessmentDue(skill.next_checkin_date) ? ` · ${t('skillDetail.dueSuffix')}` : ''}
                      </span>
                    </div>
                  )}
                  {currentTarget && (
                    <button
                      type="button"
                      onClick={() => setTargetOpen(true)}
                      className="w-full flex items-center justify-between rounded-md border border-hairline bg-paper px-3 py-2 text-left hover:border-moss/60 transition-colors"
                    >
                      <span className="font-mono text-xs uppercase tracking-wide text-secondary">
                        {t('skillDetail.target')} {LEVEL_LABELS[currentTarget.target_level]}
                      </span>
                      <span className="text-sm font-medium text-ink">
                        {new Date(`${currentTarget.target_date}T00:00:00`).toLocaleDateString()}
                      </span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {historyOpen && (
              <AccessibleDialog
                labelledBy="skill-history-dialog-title"
                onClose={closeHistory}
                overlayClassName="z-40"
                panelClassName="w-full max-w-2xl bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
              >
                <div className="flex items-center justify-between">
                  <h2 id="skill-history-dialog-title" className="font-display text-2xl text-ink">
                    {t('skillDetail.tabs.history')}
                  </h2>
                  <button type="button" onClick={closeHistory} className="text-secondary hover:text-ink text-sm">
                    {t('skillDetail.close')}
                  </button>
                </div>
            <HistorySection
              skill={skill}
              assessorName={assessorName}
              history={history}
              peerRatings={peerRatings}
              relationshipLinks={relationshipLinks}
              statements={statements}
              courseLinks={courseLinks}
              validationRequests={validationRequests}
              validatorNames={validatorNames}
              loading={loadingHistory}
              raterAvatars={raterAvatars}
              highlightActivityId={location.state?.highlightActivityId}
            />
              </AccessibleDialog>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
