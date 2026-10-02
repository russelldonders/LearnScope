import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, useLocation, useSearchParams, Link } from 'react-router-dom'
import { handleTabListKeyDown } from '../lib/tabsKeyboard'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import { isSelfAssessmentDue } from '../lib/checkin'
import AppHeader from '../components/AppHeader'
import GrowthRing from '../components/GrowthRing'
import PeopleWithSkillModal from '../components/PeopleWithSkillModal'
import PersonAvatar from '../components/PersonAvatar'
import KnowledgeLevelBar from '../components/KnowledgeLevelBar'
import SelfAssessSection from '../components/SelfAssessSection'
import { LEVEL_LABELS, LEVEL_DESCRIPTIONS, KNOWLEDGE_LEVEL_LABELS } from '../lib/levels'
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
import { ensureKnowledgeLevelGuide } from '../lib/knowledgeLevelGuide'
import { ensurePracticalLevelGuide } from '../lib/practicalLevelGuide'
import { computeTrustStatus, isPersonValidated, TRUST_STATUS, TRUST_STATUS_COLORS } from '../lib/skillProficiencyModel'
import { countSkillTrackers, listConnectionsWithSkill } from '../lib/skillStats'
import { getLearnerCompositeProgress, getParentCompositesForSkill } from '../lib/skillComposites'
import { listTargetsSetByOthers, listLatestManagerRatings, pickTargetSetByOthers } from '../lib/managerSkillActions'
import { computeVisibleTarget } from '../lib/skillTargetPrecedence'
import CompositeSkillProgress from '../components/CompositeSkillProgress'
import { HistorySection, TimelineEntry, TimelineDetailModal } from './SkillHistorySection'
import { ScheduleSection, DetailsSection, DeleteSection, SettingsSection } from './SkillSettingsSections'

const SKILL_DETAIL_TABS = [
  { key: 'overview' },
  { key: 'history' },
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
  // A deep link that highlights a specific timeline entry (from Activity.jsx
  // or elsewhere) needs to land on History by default, or the highlighted
  // entry is hidden behind the Overview tab.
  const tab = SKILL_DETAIL_TABS.some((d) => d.key === requestedTab)
    ? requestedTab
    : location.state?.highlightActivityId
      ? 'history'
      : 'overview'
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
  const [connectionsListOpen, setConnectionsListOpen] = useState(false)
  const [peopleWithSkillOpen, setPeopleWithSkillOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [levelDetailAxis, setLevelDetailAxis] = useState(null)
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
        supabase.from('connection_invites').select('id, status').eq('skill_id', skill.id).eq('invite_type', 'rate'),
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
            'id, relationship, created_at, courses(id, name, provider, course_type, duration, completed_date, catalogue_course_id)'
          )
          .eq('skill_id', skill.id),
        listOutgoingValidationRequests(skill.id),
      ])
    setHistory(assessments ?? [])
    setPeerRatings(ratings ?? [])
    setInvites(sentInvites ?? [])
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
    activity: () => setRecordActivityOpen(true),
    target: () => setTargetOpen(true),
    'find-course': () => navigate('/training', { state: trainingScopeState }),
    demonstrate: handleDemonstrateSkill,
    'record-activity': () => setRecordActivityOpen(true),
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
  const pendingCourseLinks = courseLinks.filter((l) => l.courses && !l.courses.completed_date)
  const completedCourseLinksCount = courseLinks.filter((l) => l.courses?.completed_date).length
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
        <Link
          to={backTo}
          state={{ tab: 'skills' }}
          className="text-sm text-secondary hover:text-ink mb-6 inline-block"
        >
          {backLabel}
        </Link>

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
                    <h2 className="font-display text-2xl text-ink">{skill.name}</h2>
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
              {SKILL_DETAIL_TABS.map((tabDef) => (
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
                      keys: SKILL_DETAIL_TABS.map((d) => d.key),
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

            {tab === 'overview' && (
            <div id="skill-detail-panel-overview" role="tabpanel" aria-labelledby="skill-detail-tab-overview">
            <div className="mt-4 pt-4 border-t border-hairline grid grid-cols-1 sm:grid-cols-2 gap-4">
              <SkillPanel
                title={t('skillDetail.knowledge')}
                accent="slate"
                status={
                  <button
                    type="button"
                    onClick={() => setLevelDetailAxis('knowledge')}
                    className="w-full flex items-center gap-3 text-left rounded-md -m-1 p-1 hover:bg-card transition-colors"
                  >
                    <KnowledgeLevelBar
                      level={displayedKnowledgeLevel}
                      size={28}
                      color={TRUST_STATUS_COLORS[knowledgeVerification]}
                      milestoneLevel={knowledgeMilestone}
                      milestoneColor={TRUST_STATUS_COLORS[TRUST_STATUS.CONFIRMED]}
                    />
                    <div>
                      <p className="text-sm text-secondary">
                        {displayedKnowledgeLevel
                          ? KNOWLEDGE_LEVEL_LABELS[displayedKnowledgeLevel]
                          : t('skillDetail.notYetSelfAssessed')}
                      </p>
                      <p className="font-mono text-[10px] uppercase tracking-wide text-secondary/70 mt-0.5">
                        {knowledgeVerification ?? t('skillDetail.knowledgeFoundation')}
                      </p>
                    </div>
                  </button>
                }
                actions={[]}
                nested={
                  <div className="space-y-3">
                    <NestedSkillPanel
                      title={t('skillDetail.stages.learn')}
                      status={
                        <div>
                          {completedCourseLinksCount > 0 && (
                            <p className="text-sm text-secondary">{completedCourseLinksCount} completed</p>
                          )}
                          {pendingCourseLinks.length > 0 ? (
                            <ul className="space-y-1 mt-1 first:mt-0">
                              {pendingCourseLinks.map((link) => (
                                <li key={link.id}>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      navigate(`/courses/${link.courses.id}/learn`, {
                                        state: { backTo: `/skills/${skill.id}`, backLabel: skill.name },
                                      })
                                    }
                                    className="text-sm text-ink underline decoration-dotted underline-offset-2 hover:text-moss text-left"
                                  >
                                    {link.courses.name}
                                  </button>
                                  <span className="text-xs text-secondary"> · {t('skillDetail.enrolledSuffix')}</span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            completedCourseLinksCount === 0 && (
                              <p className="text-sm text-secondary">{t('skillDetail.noTrainingLinkedYet')}</p>
                            )
                          )}
                        </div>
                      }
                      actions={[
                        {
                          label: t('skillDetail.findACourse'),
                          onClick: () => navigate('/training', { state: trainingScopeState }),
                        },
                      ]}
                    />
                    <NestedSkillPanel
                      title={t('skillDetail.stages.verify')}
                      status={
                        <p className="text-sm text-secondary">
                          {knowledgeConfirmed ? t('skillDetail.confirmed') : t('skillDetail.notYetConfirmed')}
                        </p>
                      }
                      actions={[
                        { label: t('skillDetail.takeAQuiz'), onClick: () => setConfirmingBaselineOpen(true) },
                        { label: t('skillDetail.interviewMe'), onClick: () => setInterviewOpen(true) },
                      ]}
                    />
                  </div>
                }
              />

              <SkillPanel
                title={t('skillDetail.application')}
                status={
                  <button
                    type="button"
                    onClick={() => setLevelDetailAxis('practical')}
                    className="w-full flex items-center gap-3 text-left rounded-md -m-1 p-1 hover:bg-card transition-colors"
                  >
                    <GrowthRing
                      level={displayedPracticalLevel}
                      size={35}
                      targetLevel={visibleTarget?.level}
                      color={TRUST_STATUS_COLORS[practicalVerification]}
                    />
                    <div>
                      <p className="text-sm text-secondary">
                        {displayedPracticalLevel ? LEVEL_LABELS[displayedPracticalLevel] : t('skillDetail.notYetSelfAssessed')}
                      </p>
                      <p className="font-mono text-[10px] uppercase tracking-wide text-secondary/70 mt-0.5">
                        {practicalVerification ?? t('skillDetail.practicalFoundation')}
                      </p>
                    </div>
                  </button>
                }
                actions={[]}
                nested={
                  <div className="space-y-3">
                    <NestedSkillPanel
                      title={t('skillDetail.stages.demonstrate')}
                      status={
                        practicalStatements.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => setActivitiesListOpen(true)}
                            className="text-sm text-secondary underline decoration-dotted underline-offset-2 hover:text-moss text-left"
                          >
                            {practicalStatements.length} {practicalStatements.length === 1 ? t('skillDetail.activityLoggedSingular') : t('skillDetail.activityLoggedPlural')}
                            {relationshipLinks.length > 0
                              ? ` · ${t('skillDetail.linkedToPrefix')} ${relationshipLinks.length} ${relationshipLinks.length === 1 ? t('skillDetail.experienceEntrySingular') : t('skillDetail.experienceEntryPlural')}`
                              : ''}
                          </button>
                        ) : (
                          <p className="text-sm text-secondary">
                            {practicalStatements.length} {practicalStatements.length === 1 ? t('skillDetail.activityLoggedSingular') : t('skillDetail.activityLoggedPlural')}
                            {relationshipLinks.length > 0
                              ? ` · ${t('skillDetail.linkedToPrefix')} ${relationshipLinks.length} ${relationshipLinks.length === 1 ? t('skillDetail.experienceEntrySingular') : t('skillDetail.experienceEntryPlural')}`
                              : ''}
                          </p>
                        )
                      }
                      actions={[
                        { label: t('skillDetail.logSkillActivity'), onClick: () => setRecordActivityOpen(true) },
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
                        <p className="text-sm text-secondary">
                          {peerRatings.length > 0
                            ? `${peerRatings.length} ${peerRatings.length === 1 ? t('skillDetail.peerRatingSingular') : t('skillDetail.peerRatingPlural')}`
                            : t('skillDetail.noPeerRatingsYet')}
                          {pendingValidationRequestsCount > 0
                            ? ` · ${pendingValidationRequestsCount} ${pendingValidationRequestsCount === 1 ? t('skillDetail.requestPendingSingular') : t('skillDetail.requestPendingPlural')}`
                            : ''}
                          {decidedValidationRequestsCount > 0 ? ` · ${decidedValidationRequestsCount} ${t('skillDetail.decidedSuffix')}` : ''}
                        </p>
                      }
                      actions={[
                        { label: t('skillDetail.inviteOthersToAssess'), onClick: () => setInviteOpen(true) },
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

            <CompositeSkillProgress
              composite={composite}
              loading={loadingComposite}
              error={compositeError}
              onStartComponent={handleStartComponent}
              startingComponentId={startingComponentId}
              startError={startComponentError}
            />

            {skill.library_skill_id && (
              <div className="mt-4 pt-4 border-t border-hairline">
                <h3 className="font-mono text-[10px] uppercase tracking-wide text-secondary mb-2">{t('skillDetail.skillNetwork')}</h3>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
                  <button
                    type="button"
                    onClick={() => setConnectionsListOpen(true)}
                    disabled={connectionsWithSkill.length === 0}
                    className="flex items-center gap-1.5 text-ink underline decoration-dotted underline-offset-2 hover:text-moss disabled:no-underline disabled:cursor-default disabled:hover:text-ink"
                  >
                    <PeopleIcon />
                    {connectionsWithSkill.length} {t('skillDetail.connectionsHaveSkillSuffix')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPeopleWithSkillOpen(true)}
                    className="flex items-center gap-1.5 text-ink underline decoration-dotted underline-offset-2 hover:text-moss"
                  >
                    <PeopleIcon />
                    {totalTrackersCount} {totalTrackersCount === 1 ? t('skillDetail.personSingular') : t('skillDetail.peoplePlural')} {t('skillDetail.inTotalHaveThisSkillSuffix')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRecommendOpen(true)}
                    className="rounded-full border border-hairline px-3 py-1.5 text-xs font-medium text-ink hover:border-moss hover:text-moss transition-colors"
                  >
                    {t('skillDetail.recommendThisSkill')}
                  </button>
                </div>
              </div>
            )}
            </div>
            )}
            </div>

            {peopleWithSkillOpen && (
              <PeopleWithSkillModal
                librarySkillId={skill.library_skill_id}
                skillName={skill.name}
                skillId={skill.id}
                onClose={() => setPeopleWithSkillOpen(false)}
              />
            )}

            {connectionsListOpen && (
              <ConnectionsWithSkillModal
                connections={connectionsWithSkill}
                skillName={skill.name}
                onClose={() => setConnectionsListOpen(false)}
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

            {levelDetailAxis && (
              <LevelDetailModal
                skill={skill}
                axis={levelDetailAxis}
                level={levelDetailAxis === 'knowledge' ? displayedKnowledgeLevel : displayedPracticalLevel}
                trustStatus={levelDetailAxis === 'knowledge' ? knowledgeVerification : practicalVerification}
                currentTarget={levelDetailAxis === 'practical' ? currentTarget : null}
                onClose={() => setLevelDetailAxis(null)}
                onSelfAssess={() => {
                  setLevelDetailAxis(null)
                  if (levelDetailAxis === 'knowledge') setSelfAssessKnowledgeOpen(true)
                  else setSelfAssessOpen(true)
                }}
                onSetTarget={() => {
                  setLevelDetailAxis(null)
                  setTargetOpen(true)
                }}
                onGuideGenerated={(statements) =>
                  setSkill((s) =>
                    s
                      ? {
                          ...s,
                          [levelDetailAxis === 'knowledge' ? 'knowledge_level_guide' : 'practical_level_guide']:
                            statements,
                        }
                      : s
                  )
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
                onClose={() => {
                  setTargetOpen(false)
                  setLevelDetailAxis('practical')
                }}
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

            {tab === 'history' && (
            <div id="skill-detail-panel-history" role="tabpanel" aria-labelledby="skill-detail-tab-history">
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
            </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

function PeopleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

// Only ever populated with connections who both track this skill AND have
// opted into showing it (see listConnectionsWithSkill) -- no separate
// privacy check needed here, the list itself is already scoped correctly.
// Same per-row card treatment as PeopleWithSkillModal (avatar, name linking
// to their skills profile, GrowthRing for their level) -- these two modals
// are opened from adjacent lines in the Skill Network section and should
// read as one visual language, not a plain list next to a rich one.
// Lists just the logged-activity entries the "Demonstrate" panel counts --
// reuses TimelineEntry's activity card so the summary and the full Timeline
// further down the page stay visually consistent. Selecting one hands off
// to TimelineDetailModal instead of stacking a second dialog on top of this
// one, so only one AccessibleDialog is ever mounted at a time.
function ActivitiesModal({ statements, onSelect, onClose }) {
  const { t } = useLanguage()
  const sorted = [...statements].sort((a, b) => new Date(b.recorded_at) - new Date(a.recorded_at))
  return (
    <AccessibleDialog
      labelledBy="activities-dialog-title"
      onClose={onClose}
      panelClassName="w-full max-w-md bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
        <div className="flex items-center justify-between mb-4">
          <h2 id="activities-dialog-title" className="font-display text-2xl text-ink">
            {sorted.length} {sorted.length === 1 ? t('skillDetail.activityLoggedSingular') : t('skillDetail.activityLoggedPlural')}
          </h2>
          <button type="button" onClick={onClose} className="text-secondary hover:text-ink text-sm shrink-0">
            {t('skillDetail.close')}
          </button>
        </div>
        <div>
          {sorted.map((s, i) => (
            <TimelineEntry
              key={s.id}
              event={{ type: 'activity', statement: s }}
              isLast={i === sorted.length - 1}
              onSelect={() => onSelect({ type: 'activity', statement: s })}
            />
          ))}
        </div>
    </AccessibleDialog>
  )
}

function ConnectionsWithSkillModal({ connections, skillName, onClose }) {
  const { t } = useLanguage()
  return (
    <AccessibleDialog
      labelledBy="connections-with-skill-dialog-title"
      onClose={onClose}
      panelClassName="w-full max-w-md bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
        <div className="flex items-center justify-between mb-4">
          <h2 id="connections-with-skill-dialog-title" className="font-display text-2xl text-ink">{t('skillDetail.connectionsWithPrefix')} {skillName}</h2>
          <button type="button" onClick={onClose} className="text-secondary hover:text-ink text-sm shrink-0">
            {t('skillDetail.close')}
          </button>
        </div>
        {connections.length === 0 ? (
          <p className="text-sm text-secondary">{t('skillDetail.noConnectionsTrackSkill')}</p>
        ) : (
          <ul className="space-y-2">
            {connections.map((c) => (
              <li key={c.id} className="rounded-md border border-hairline p-3">
                <div className="flex items-center gap-3">
                  <Link to={`/skills-profile/${c.id}`} className="flex items-center gap-3 min-w-0 group flex-1">
                    <PersonAvatar name={c.name} avatarUrl={c.avatarUrl} />
                    <span className="text-sm text-ink font-medium truncate group-hover:text-moss group-hover:underline">
                      {c.name}
                    </span>
                  </Link>
                  <GrowthRing level={c.level} size={24} labels={LEVEL_LABELS} />
                  <span className="font-mono text-[10px] uppercase tracking-wide text-secondary/70 shrink-0">
                    {t('skillDetail.connected')}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
    </AccessibleDialog>
  )
}

// Always-available actions for a skill, grouped by axis -- unlike Up Next
// (which recommends the single next step for the skill's current lifecycle
// stage), every action here is reachable regardless of stage, so a learner
// isn't limited to following the guided checklist in order.
function ActionGroup({ title, accent, actions, headerExtra }) {
  const accentClass = accent === 'slate' ? 'hover:border-slate hover:text-slate' : 'hover:border-moss hover:text-moss'
  return (
    <div>
      {title && <h3 className="font-mono text-[10px] uppercase tracking-wide text-secondary mb-2">{title}</h3>}
      {headerExtra}
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={action.onClick}
            disabled={action.disabled}
            title={action.title}
            className={`rounded-full border border-hairline px-3 py-1.5 text-xs font-medium text-ink transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              action.disabled ? '' : accentClass
            }`}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// One card in the skill page's status layout (Know / Can Do) -- each axis
// gets its own status + actions, rather than the stage-linear single-file
// "Up Next" checklist implying the axes must progress in lockstep. Learn
// and Verify nest inside Know; Demonstrate and Validate nest inside Can Do
// (via `nested`), since they're the supporting evidence/verification for
// those axes rather than peer-level axes of their own.
function SkillPanel({ title, accent, status, actions, nested }) {
  return (
    <div className="rounded-md border border-hairline bg-paper p-4">
      <ActionGroup
        title={title}
        accent={accent}
        headerExtra={status && <div className="mb-3">{status}</div>}
        actions={actions}
      />
      {nested && <div className="mt-4 pt-4 border-t border-hairline">{nested}</div>}
    </div>
  )
}

// Smaller variant of SkillPanel for a panel nested inside another (Learn
// and Verify inside Know; Demonstrate and Validate inside Can Do) -- same
// title/status/actions shape, lighter card so it reads as "part of" the
// parent rather than a sibling.
function NestedSkillPanel({ title, accent, status, actions }) {
  return (
    <div className="rounded-md border border-hairline bg-card p-3">
      <ActionGroup
        title={title}
        accent={accent}
        headerExtra={status && <div className="mb-2">{status}</div>}
        actions={actions}
      />
    </div>
  )
}

// Explains what the learner's current (or most recent self-assessed)
// level actually means, then offers the same self-assess/rate action as
// the panel's own button -- reached by clicking the level itself rather
// than only the explicit action button. Both axes reuse the same
// per-skill AI guide as their self-assess picker (see ensureKnowledgeLevelGuide
// / ensurePracticalLevelGuide); LEVEL_DESCRIPTIONS is only a fallback for
// the practical axis if generation hasn't completed or fails.
function LevelDetailModal({
  skill,
  axis,
  level,
  trustStatus,
  currentTarget,
  onClose,
  onSelfAssess,
  onSetTarget,
  onGuideGenerated,
}) {
  const { t } = useLanguage()
  const isKnowledge = axis === 'knowledge'
  const labels = isKnowledge ? KNOWLEDGE_LEVEL_LABELS : LEVEL_LABELS
  // A newer self-assessment can claim higher than the last confirmed
  // knowledge_level -- when it has, the bar splits at the confirmed level so
  // "verified" and "claimed since" read as visually distinct, not one flat
  // colour overstating how settled the higher number is.
  const knowledgeMilestone =
    isKnowledge && skill.knowledge_level && level && skill.knowledge_level < level ? skill.knowledge_level : null
  const [guideStatements, setGuideStatements] = useState([])
  const [guideLoading, setGuideLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setGuideLoading(true)
    const ensureGuide = isKnowledge ? ensureKnowledgeLevelGuide : ensurePracticalLevelGuide
    ensureGuide(skill)
      .then((statements) => {
        if (!cancelled) setGuideStatements(statements)
        if (statements.length === 5) onGuideGenerated?.(statements)
      })
      .catch(() => {
        if (!cancelled) setGuideStatements([])
      })
      .finally(() => {
        if (!cancelled) setGuideLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads its inputs once when opened, by design
  }, [isKnowledge, skill.id])

  const description = level
    ? guideStatements[level - 1] ?? (!isKnowledge ? LEVEL_DESCRIPTIONS[level] : undefined)
    : null

  return (
    <AccessibleDialog
      labelledBy="axis-summary-dialog-title"
      onClose={onClose}
      panelClassName="w-full max-w-md bg-card border border-hairline rounded-lg p-6"
    >
        <div className="flex items-center justify-between mb-4">
          <h2 id="axis-summary-dialog-title" className="font-display text-2xl text-ink">{isKnowledge ? t('skillDetail.knowledge') : t('skillDetail.application')}</h2>
          <button type="button" onClick={onClose} className="text-secondary hover:text-ink text-sm">
            {t('skillDetail.close')}
          </button>
        </div>
        <div className="flex items-center gap-3 mb-3">
          {isKnowledge ? (
            <KnowledgeLevelBar level={level} size={32} color={TRUST_STATUS_COLORS[trustStatus]} />
          ) : (
            <GrowthRing level={level} size={40} color={TRUST_STATUS_COLORS[trustStatus]} />
          )}
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wide text-secondary">{t('skillDetail.currentLevel')}</p>
            <p className="text-base font-medium text-ink">{level ? labels[level] : t('skillDetail.notYetSelfAssessed')}</p>
          </div>
        </div>
        {level ? (
          guideLoading && description == null ? (
            <p className="text-sm text-secondary mb-4">{t('skillDetail.loadingGuidance')}</p>
          ) : (
            description && <p className="text-sm text-secondary mb-4">{description}</p>
          )
        ) : (
          <p className="text-sm text-secondary mb-4">
            {isKnowledge
              ? t('skillDetail.knowledgeNotRatedYet')
              : t('skillDetail.practicalNotAssessedYet')}
          </p>
        )}
        {/* Mirrors the practical Current/Target pair below -- a newer
            self-assessment claiming higher than the last confirmed
            knowledge_level is shown as its own block rather than folded
            into the current level's icon, same reasoning as Target. */}
        {knowledgeMilestone && (() => {
          const confirmedDescription = guideStatements[knowledgeMilestone - 1]
          return (
            <div className="mb-4">
              <div className="flex items-center gap-3">
                <KnowledgeLevelBar
                  level={knowledgeMilestone}
                  size={32}
                  color={TRUST_STATUS_COLORS[TRUST_STATUS.CONFIRMED]}
                />
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-wide text-secondary">{t('skillDetail.confirmed')}</p>
                  <p className="text-base font-medium text-ink">{KNOWLEDGE_LEVEL_LABELS[knowledgeMilestone]}</p>
                </div>
              </div>
              {confirmedDescription && <p className="text-sm text-secondary mt-2">{confirmedDescription}</p>}
            </div>
          )
        })()}
        {currentTarget && (() => {
          const targetDescription =
            guideStatements[currentTarget.target_level - 1] ?? LEVEL_DESCRIPTIONS[currentTarget.target_level]
          return (
            <div className="mb-4">
              <div className="flex items-center gap-3">
                <GrowthRing level={0} size={40} targetLevel={currentTarget.target_level} />
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-wide text-secondary">{t('skillDetail.target')}</p>
                  <p className="text-base font-medium text-ink">{LEVEL_LABELS[currentTarget.target_level]}</p>
                  <p className="font-mono text-xs text-secondary/80 mt-0.5">
                    {t('skillDetail.byPrefix')} {new Date(`${currentTarget.target_date}T00:00:00`).toLocaleDateString()}
                  </p>
                </div>
              </div>
              {targetDescription && <p className="text-sm text-secondary mt-2">{targetDescription}</p>}
              {currentTarget.comments && <p className="text-sm text-secondary mt-2 whitespace-pre-wrap">{currentTarget.comments}</p>}
            </div>
          )
        })()}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onSelfAssess}
            className="rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90"
          >
            {isKnowledge ? t('skillDetail.rateCurrentLevel') : t('skillDetail.selfAssessCurrentLevel')}
          </button>
          {!isKnowledge && (
            <button
              type="button"
              onClick={onSetTarget}
              className="rounded-md border border-hairline text-ink py-2 px-4 text-sm font-medium hover:bg-paper"
            >
              {t('skillDetail.setTargetAction')}
            </button>
          )}
        </div>
    </AccessibleDialog>
  )
}

function SelfAssessModal({
  skill,
  user,
  axis = 'practical',
  currentLevel = null,
  history = [],
  onClose,
  onAssessed,
  onGuideGenerated,
}) {
  const { t } = useLanguage()
  return (
    <AccessibleDialog
      labelledBy="self-assess-dialog-title"
      onClose={onClose}
      panelClassName="w-full max-w-md bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
        <div className="flex items-center justify-between mb-4">
          <h2 id="self-assess-dialog-title" className="font-display text-2xl text-ink">
            {axis === 'knowledge' ? t('skillDetail.selfAssessKnowledgeTitle') : t('skillDetail.selfAssessTitle')}
          </h2>
          <button type="button" onClick={onClose} className="text-secondary hover:text-ink text-sm">
            {t('skillDetail.close')}
          </button>
        </div>
        <SelfAssessSection
          skill={skill}
          user={user}
          axis={axis}
          currentLevel={currentLevel}
          onAssessed={onAssessed}
          onGuideGenerated={onGuideGenerated}
        />
        {(() => {
          const axisHistory = history.filter((a) => a.axis === axis)
          const labels = axis === 'knowledge' ? KNOWLEDGE_LEVEL_LABELS : LEVEL_LABELS
          return (
            axisHistory.length > 0 && (
              <div className="mt-6 pt-4 border-t border-hairline opacity-50">
                <h3 className="font-mono text-[10px] uppercase tracking-wide text-secondary mb-2">
                  {axis === 'knowledge' ? t('skillDetail.knowledge') : t('skillDetail.selfAssessmentWord')} {t('skillDetail.historySuffix')}
                </h3>
                <ul className="space-y-2">
                  {axisHistory.map((a) => (
                    <li key={a.id} className="flex items-start gap-2 text-sm">
                      {axis === 'knowledge' ? (
                        <KnowledgeLevelBar level={a.level} size={28} />
                      ) : (
                        <GrowthRing level={a.level} size={28} />
                      )}
                      <div className="min-w-0">
                        <p className="text-ink">{labels[a.level]}</p>
                        <p className="font-mono text-xs text-secondary">
                          {new Date(a.assessed_at).toLocaleDateString()}
                        </p>
                        {a.comments && <p className="text-xs text-secondary mt-0.5">{a.comments}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )
          )
        })()}
    </AccessibleDialog>
  )
}

