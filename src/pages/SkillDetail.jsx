import { useEffect, useState } from 'react'
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { getEvidenceSignedUrl } from '../lib/skillEvidence'
import { isSelfAssessmentDue, todayDateString } from '../lib/checkin'
import { formatMonthYear } from '../lib/dates'
import AppHeader from '../components/AppHeader'
import GrowthRing from '../components/GrowthRing'
import PeopleWithSkillModal from '../components/PeopleWithSkillModal'
import { getSearchPrivacySettings, listSearchableSkillIds, setSkillSearchable } from '../lib/skillDiscovery'
import KnowledgeLevelBar from '../components/KnowledgeLevelBar'
import SelfAssessSection from '../components/SelfAssessSection'
import TrackingReasonPicker from '../components/TrackingReasonPicker'
import { LEVEL_LABELS, LEVEL_DESCRIPTIONS, KNOWLEDGE_LEVEL_LABELS } from '../lib/levels'
import { SKILL_LIFECYCLE_LABELS } from '../lib/skillLifecycle'
import { SKILL_SOURCE_LABELS } from '../lib/skillSource'
import { activityName, verbLabel, formatDuration, isDiagnosticStatement } from '../lib/xapiStatement'
import { enableCurrentRole, disableCurrentRole, applyCurrentRoleSelection, syncSkillIsCurrentRole } from '../lib/currentRole'
import CurrentRoleSelectModal from '../components/CurrentRoleSelectModal'
import { listTags, listSkillTags, addTagToSkill, removeSkillTagLink } from '../lib/skillTags'
import { isDuplicateSkillNameError, duplicateSkillMessage } from '../lib/skillDuplicates'
import InviteRaterModal from '../components/InviteRaterModal'
import RecordActivityModal from '../components/RecordActivityModal'
import AssessBaselineModal from '../components/AssessBaselineModal'
import SetTargetModal from '../components/SetTargetModal'
import ValidateSkillModal from '../components/ValidateSkillModal'
import RequestValidationModal from '../components/RequestValidationModal'
import ConfirmingBaselineQuizModal from '../components/ConfirmingBaselineQuizModal'
import InterviewModal from '../components/InterviewModal'
import LifecycleStageIcon from '../components/LifecycleStageIcon'
import TagsField from '../components/TagsField'
import { listOutgoingValidationRequests } from '../lib/skillValidationRequests'
import { computeUpNextItems } from '../lib/skillNextAction'
import { ensureKnowledgeLevelGuide } from '../lib/knowledgeLevelGuide'
import { ensurePracticalLevelGuide } from '../lib/practicalLevelGuide'
import { computeTrustStatus, TRUST_STATUS, TRUST_STATUS_COLORS } from '../lib/skillProficiencyModel'
import { countSkillTrackers, listConnectionsWithSkill } from '../lib/skillStats'

export default function SkillDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const backTo = location.state?.from ?? '/skills'
  const backLabel = location.state?.from ? '← Back to experience' : '← Back to skills'
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
  const [selfAssessOpen, setSelfAssessOpen] = useState(false)
  const [selfAssessKnowledgeOpen, setSelfAssessKnowledgeOpen] = useState(false)
  const [confirmingBaselineOpen, setConfirmingBaselineOpen] = useState(false)
  const [interviewOpen, setInterviewOpen] = useState(false)
  const [recordActivityOpen, setRecordActivityOpen] = useState(false)
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

  useEffect(() => {
    loadSkill()
    loadAssessorName()
    listTags().then(setAllTags)
  }, [id])

  useEffect(() => {
    if (skill) loadHistory()
  }, [skill?.id])

  useEffect(() => {
    if (!skill?.library_skill_id) {
      setConnectionsWithSkill([])
      setTotalTrackersCount(0)
      return
    }
    listConnectionsWithSkill(skill.library_skill_id, user.id).then(setConnectionsWithSkill)
    countSkillTrackers(skill.library_skill_id).then(setTotalTrackersCount)
  }, [skill?.library_skill_id])

  async function loadSkill() {
    setLoadingSkill(true)
    setNotFound(false)
    const { data, error } = await supabase
      .from('skills')
      .select('*, skill_library(is_private)')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()
    if (error || !data) {
      setNotFound(true)
    } else {
      setSkill(data)
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
      { data: st },
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
        supabase.from('connection_invites').select('id, status').eq('skill_id', skill.id),
        supabase
          .from('skill_experience_links')
          .select('id, created_at, experience(id, title, organization, type, start_date, end_date)')
          .eq('skill_id', skill.id),
        supabase
          .from('xapi_statements')
          .select('*')
          .eq('skill_id', skill.id)
          .eq('user_id', user.id)
          .order('recorded_at', { ascending: false }),
        listSkillTags(skill.id),
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

  async function handleRecordActivity(statement) {
    const { error } = await supabase.from('xapi_statements').insert({
      user_id: user.id,
      statement,
      recorded_at: statement.timestamp,
      skill_id: skill.id,
    })
    if (error) throw error
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
  const practicalStatements = statements.filter((s) => !isDiagnosticStatement(s.statement))
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
        formallyValidated: ['validated', 'maintained'].includes(skill.lifecycle_stage),
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
      <AppHeader />
      <main className="max-w-4xl mx-auto px-4 py-8">
        <Link
          to={backTo}
          state={{ tab: 'skills' }}
          className="text-sm text-secondary hover:text-ink mb-6 inline-block"
        >
          {backLabel}
        </Link>

        {loadingSkill && <p className="text-secondary">Loading…</p>}
        {notFound && <p className="text-secondary">Skill not found.</p>}

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
                  <h2 className="font-display text-2xl text-ink">{skill.name}</h2>
                  <p className="text-sm text-secondary flex items-center gap-1.5">
                    {!displayedPracticalLevel && skill.lifecycle_stage && (
                      <LifecycleStageIcon stage={skill.lifecycle_stage} />
                    )}
                    {displayedPracticalLevel
                      ? LEVEL_LABELS[displayedPracticalLevel]
                      : skill.lifecycle_stage
                        ? SKILL_LIFECYCLE_LABELS[skill.lifecycle_stage]
                        : 'Not yet self-assessed'}
                  </p>
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
                  aria-label="Request AI assessment"
                  title={
                    !hasAnyEvaluationInput
                      ? 'Self-assess, invite a rating, or record activity first'
                      : 'Request AI assessment'
                  }
                  className="rounded-full bg-moss text-paper text-xs font-medium px-2.5 sm:px-3 py-1.5 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span aria-hidden="true">✨</span>
                  <span className="hidden sm:inline"> Request AI assessment</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  aria-label="Skill settings"
                  title="Skill settings"
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
                <p className="font-mono text-[10px] uppercase tracking-wide text-secondary">Next milestone</p>
                <p className="text-sm text-ink mt-0.5">{nextMilestone.label}</p>
                <p className="text-xs text-secondary mt-0.5">{nextMilestone.description}</p>
                {nextMilestoneAction && (
                  <button
                    type="button"
                    onClick={nextMilestoneAction}
                    className="mt-2 rounded-md bg-moss text-paper text-xs font-medium px-3 py-1.5 hover:opacity-90"
                  >
                    Start
                  </button>
                )}
              </div>
            )}

            <div className="mt-4 pt-4 border-t border-hairline grid grid-cols-1 sm:grid-cols-2 gap-4">
              <SkillPanel
                title="Knowledge"
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
                          : 'Not yet self-assessed'}
                      </p>
                      <p className="font-mono text-[10px] uppercase tracking-wide text-secondary/70 mt-0.5">
                        {knowledgeVerification ?? 'Knowledge foundation'}
                      </p>
                    </div>
                  </button>
                }
                actions={[]}
                nested={
                  <div className="space-y-3">
                    <NestedSkillPanel
                      title="Learn"
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
                                      navigate(`/courses/${link.courses.id}`, {
                                        state: { backTo: `/skills/${skill.id}`, backLabel: skill.name },
                                      })
                                    }
                                    className="text-sm text-ink underline decoration-dotted underline-offset-2 hover:text-moss text-left"
                                  >
                                    {link.courses.name}
                                  </button>
                                  <span className="text-xs text-secondary"> · enrolled</span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            completedCourseLinksCount === 0 && (
                              <p className="text-sm text-secondary">No training linked yet</p>
                            )
                          )}
                        </div>
                      }
                      actions={[
                        {
                          label: 'Find a course',
                          onClick: () => navigate('/training', { state: trainingScopeState }),
                        },
                      ]}
                    />
                    <NestedSkillPanel
                      title="Verify"
                      status={
                        <p className="text-sm text-secondary">
                          {knowledgeConfirmed ? 'Confirmed' : 'Not yet confirmed'}
                        </p>
                      }
                      actions={[
                        { label: 'Take a quiz', onClick: () => setConfirmingBaselineOpen(true) },
                        { label: '✨ Interview me', onClick: () => setInterviewOpen(true) },
                      ]}
                    />
                  </div>
                }
              />

              <SkillPanel
                title="Application"
                status={
                  <button
                    type="button"
                    onClick={() => setLevelDetailAxis('practical')}
                    className="w-full flex items-center gap-3 text-left rounded-md -m-1 p-1 hover:bg-card transition-colors"
                  >
                    <GrowthRing
                      level={displayedPracticalLevel}
                      size={35}
                      targetLevel={currentTarget?.target_level}
                      color={TRUST_STATUS_COLORS[practicalVerification]}
                    />
                    <div>
                      <p className="text-sm text-secondary">
                        {displayedPracticalLevel ? LEVEL_LABELS[displayedPracticalLevel] : 'Not yet self-assessed'}
                      </p>
                      <p className="font-mono text-[10px] uppercase tracking-wide text-secondary/70 mt-0.5">
                        {practicalVerification ?? 'Practical foundation'}
                      </p>
                    </div>
                  </button>
                }
                actions={[]}
                nested={
                  <div className="space-y-3">
                    <NestedSkillPanel
                      title="Demonstrate"
                      status={
                        <p className="text-sm text-secondary">
                          {practicalStatements.length} activit{practicalStatements.length === 1 ? 'y' : 'ies'} logged
                          {relationshipLinks.length > 0
                            ? ` · linked to ${relationshipLinks.length} experience entr${relationshipLinks.length === 1 ? 'y' : 'ies'}`
                            : ''}
                        </p>
                      }
                      actions={[
                        { label: 'Record activity', onClick: () => setRecordActivityOpen(true) },
                        ...(canShowDemonstrateAction
                          ? [{ label: 'Demonstrate skill', onClick: handleDemonstrateSkill }]
                          : []),
                        ...(canShowValidateAction
                          ? [{ label: 'Move to validating', onClick: handleValidateSkillStage }]
                          : []),
                      ]}
                    />
                    <NestedSkillPanel
                      title="Validate"
                      status={
                        <p className="text-sm text-secondary">
                          {peerRatings.length > 0
                            ? `${peerRatings.length} peer rating${peerRatings.length === 1 ? '' : 's'}`
                            : 'No peer ratings yet'}
                          {pendingValidationRequestsCount > 0
                            ? ` · ${pendingValidationRequestsCount} request${pendingValidationRequestsCount === 1 ? '' : 's'} pending`
                            : ''}
                          {decidedValidationRequestsCount > 0 ? ` · ${decidedValidationRequestsCount} decided` : ''}
                        </p>
                      }
                      actions={[
                        { label: 'Invite others to assess', onClick: () => setInviteOpen(true) },
                        // "✨ Request AI assessment" now lives in the header next
                        // to the skill name -- see the button beside setSettingsOpen
                        // above, which shares this exact same onClick/disabled logic.
                        ...(targets.length > 0
                          ? [{ label: 'Request validation', onClick: () => setExpertValidationOpen(true) }]
                          : []),
                      ]}
                    />
                  </div>
                }
              />
            </div>

            {skill.library_skill_id && (
              <div className="mt-4 pt-4 border-t border-hairline">
                <h3 className="font-mono text-[10px] uppercase tracking-wide text-secondary mb-2">Skill Network</h3>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
                  <button
                    type="button"
                    onClick={() => setConnectionsListOpen(true)}
                    disabled={connectionsWithSkill.length === 0}
                    className="flex items-center gap-1.5 text-ink underline decoration-dotted underline-offset-2 hover:text-moss disabled:no-underline disabled:cursor-default disabled:hover:text-ink"
                  >
                    <PeopleIcon />
                    {connectionsWithSkill.length} of your connections have this skill
                  </button>
                  <button
                    type="button"
                    onClick={() => setPeopleWithSkillOpen(true)}
                    className="flex items-center gap-1.5 text-ink underline decoration-dotted underline-offset-2 hover:text-moss"
                  >
                    <PeopleIcon />
                    {totalTrackersCount} {totalTrackersCount === 1 ? 'person' : 'people'} in total have this skill
                  </button>
                </div>
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

            {inviteOpen && <InviteRaterModal skill={skill} onClose={() => setInviteOpen(false)} />}

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
                user={user}
                target={targets[0]}
                assessments={history}
                peerRatings={peerRatings}
                statements={practicalStatements}
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
              <div
                className="fixed inset-0 bg-ink/40 flex items-center justify-center p-4 z-40"
                onClick={() => setSettingsOpen(false)}
              >
                <div
                  className="w-full max-w-md bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="font-display text-2xl text-ink">Skill settings</h2>
                    <button
                      type="button"
                      onClick={() => setSettingsOpen(false)}
                      className="text-secondary hover:text-ink text-sm"
                    >
                      Close
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
                      onDeleted={() => navigate(backTo, { state: { tab: 'skills' } })}
                    />
                    <SettingsSection skill={skill} user={user} onUpdated={loadSkill} />
                    <ScheduleSection skill={skill} onUpdated={loadSkill} />
                  </div>
                </div>
              </div>
            )}

            {(skill.next_checkin_date || currentTarget) && (
              <div className="mt-4 pt-4 border-t border-hairline">
                <h3 className="font-mono text-[10px] uppercase tracking-wide text-secondary mb-3">Upcoming</h3>
                <div className="space-y-2">
                  {skill.next_checkin_date && (
                    <div
                      className={`flex items-center justify-between rounded-md border px-3 py-2 ${
                        isSelfAssessmentDue(skill.next_checkin_date)
                          ? 'border-gold bg-gold/10'
                          : 'border-hairline bg-paper'
                      }`}
                    >
                      <span className="font-mono text-xs uppercase tracking-wide text-secondary">
                        Next self-assessment
                      </span>
                      <span
                        className={`text-sm font-medium ${
                          isSelfAssessmentDue(skill.next_checkin_date) ? 'text-gold' : 'text-ink'
                        }`}
                      >
                        {new Date(`${skill.next_checkin_date}T00:00:00`).toLocaleDateString()}
                        {isSelfAssessmentDue(skill.next_checkin_date) ? ' · Due' : ''}
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
                        Target {LEVEL_LABELS[currentTarget.target_level]}
                      </span>
                      <span className="text-sm font-medium text-ink">
                        {new Date(`${currentTarget.target_date}T00:00:00`).toLocaleDateString()}
                      </span>
                    </button>
                  )}
                </div>
              </div>
            )}

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
            />
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
function ConnectionsWithSkillModal({ connections, skillName, onClose }) {
  return (
    <div className="fixed inset-0 bg-ink/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        className="w-full max-w-md bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-2xl text-ink">Connections with {skillName}</h2>
          <button type="button" onClick={onClose} className="text-secondary hover:text-ink text-sm">
            Close
          </button>
        </div>
        {connections.length === 0 ? (
          <p className="text-sm text-secondary">None of your connections track this skill yet.</p>
        ) : (
          <ul className="space-y-2">
            {connections.map((c) => (
              <li key={c.id} className="text-sm text-ink">
                {c.name}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
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
  }, [isKnowledge, skill.id])

  const description = level
    ? guideStatements[level - 1] ?? (!isKnowledge ? LEVEL_DESCRIPTIONS[level] : undefined)
    : null

  return (
    <div className="fixed inset-0 bg-ink/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        className="w-full max-w-md bg-card border border-hairline rounded-lg p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-2xl text-ink">{isKnowledge ? 'Knowledge' : 'Application'}</h2>
          <button type="button" onClick={onClose} className="text-secondary hover:text-ink text-sm">
            Close
          </button>
        </div>
        <div className="flex items-center gap-3 mb-3">
          {isKnowledge ? (
            <KnowledgeLevelBar level={level} size={32} color={TRUST_STATUS_COLORS[trustStatus]} />
          ) : (
            <GrowthRing level={level} size={40} color={TRUST_STATUS_COLORS[trustStatus]} />
          )}
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wide text-secondary">Current level</p>
            <p className="text-base font-medium text-ink">{level ? labels[level] : 'Not yet self-assessed'}</p>
          </div>
        </div>
        {level ? (
          guideLoading && description == null ? (
            <p className="text-sm text-secondary mb-4">Loading guidance…</p>
          ) : (
            description && <p className="text-sm text-secondary mb-4">{description}</p>
          )
        ) : (
          <p className="text-sm text-secondary mb-4">
            {isKnowledge
              ? "You haven't rated your knowledge of this skill yet."
              : "You haven't self-assessed your practical level for this skill yet."}
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
                  <p className="font-mono text-[10px] uppercase tracking-wide text-secondary">Confirmed</p>
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
                  <p className="font-mono text-[10px] uppercase tracking-wide text-secondary">Target</p>
                  <p className="text-base font-medium text-ink">{LEVEL_LABELS[currentTarget.target_level]}</p>
                  <p className="font-mono text-xs text-secondary/80 mt-0.5">
                    By {new Date(`${currentTarget.target_date}T00:00:00`).toLocaleDateString()}
                  </p>
                </div>
              </div>
              {targetDescription && <p className="text-sm text-secondary mt-2">{targetDescription}</p>}
            </div>
          )
        })()}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onSelfAssess}
            className="rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90"
          >
            {isKnowledge ? 'Rate your current level' : 'Self-assess your current level'}
          </button>
          {!isKnowledge && (
            <button
              type="button"
              onClick={onSetTarget}
              className="rounded-md border border-hairline text-ink py-2 px-4 text-sm font-medium hover:bg-paper"
            >
              Set target
            </button>
          )}
        </div>
      </div>
    </div>
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
  return (
    <div className="fixed inset-0 bg-ink/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        className="w-full max-w-md bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-2xl text-ink">
            {axis === 'knowledge' ? 'Self-assess your knowledge' : 'Self-assess'}
          </h2>
          <button type="button" onClick={onClose} className="text-secondary hover:text-ink text-sm">
            Close
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
                  {axis === 'knowledge' ? 'Knowledge' : 'Self-assessment'} history
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
      </div>
    </div>
  )
}

const TIMELINE_DETAIL_TYPES = new Set(['assessment', 'peer', 'relationship', 'activity', 'training'])

function HistorySection({
  skill,
  assessorName,
  history,
  peerRatings,
  relationshipLinks,
  statements,
  courseLinks,
  validationRequests,
  validatorNames,
  loading,
  raterAvatars,
}) {
  const navigate = useNavigate()
  // The Confirming Baseline knowledge quiz logs its own xAPI attempt --
  // exclude it here too, same reasoning as the top-level SkillDetail
  // component (see there for the full comment).
  const practicalStatements = statements.filter((s) => !isDiagnosticStatement(s.statement))
  const pendingValidationRequests = validationRequests.filter((r) => r.status === 'pending')
  const decidedValidationRequests = validationRequests.filter((r) => r.status !== 'pending')
  const [selectedEvent, setSelectedEvent] = useState(null)

  function goToCourse(courseId) {
    navigate(`/courses/${courseId}`, { state: { backTo: `/skills/${skill.id}`, backLabel: skill.name } })
  }

  return (
    <div className="mt-4 pt-4 border-t border-hairline">
      <h3 className="font-mono text-[10px] uppercase tracking-wide text-secondary mb-3">Timeline</h3>

      {loading && <p className="text-sm text-secondary">Loading…</p>}
      {!loading && (() => {
        // Enrolled-but-not-completed courses have no real date yet -- they
        // haven't happened. Rather than fake a date (which risked sorting
        // them below "today", as if already done), they render as pending
        // items above "today", the same way an unmet target does.
        const pendingCourseLinks = courseLinks.filter((link) => link.courses && !link.courses.completed_date)
        const events = [
          ...history.map((entry) => ({ type: 'assessment', date: entry.assessed_at, createdAt: entry.created_at, entry })),
          ...peerRatings.map((rating) => ({ type: 'peer', date: rating.rated_at, createdAt: rating.rated_at, rating })),
          ...relationshipLinks
            .filter((link) => link.experience)
            .map((link) => ({
              type: 'relationship',
              date: link.experience.start_date,
              createdAt: link.created_at,
              link,
            })),
          ...practicalStatements.map((s) => ({ type: 'activity', date: s.recorded_at, createdAt: s.created_at, statement: s })),
          ...courseLinks
            .filter((link) => link.courses?.completed_date)
            .map((link) => ({
              type: 'training',
              date: link.courses.completed_date,
              createdAt: link.created_at,
              link,
            })),
          ...decidedValidationRequests.map((request) => ({
            type: 'validation',
            date: request.decided_at,
            createdAt: request.decided_at,
            request,
          })),
          { type: 'added', date: skill.date_added, createdAt: skill.date_added, source: skill.source },
          { type: 'today', date: new Date().toISOString(), createdAt: new Date().toISOString() },
          // Same-day events sort by day first, then by when the record was
          // actually created/assigned -- e.g. a course completed today
          // should rank above a skill added earlier today, even though both
          // show "today" as their display date.
        ].sort((a, b) => {
          const dayDiff = new Date(b.date).toISOString().slice(0, 10).localeCompare(
            new Date(a.date).toISOString().slice(0, 10)
          )
          if (dayDiff !== 0) return dayDiff
          return new Date(b.createdAt ?? b.date) - new Date(a.createdAt ?? a.date)
        })
        // "Most recent" and "Baseline" badges track the practical axis --
        // the axis GrowthRing in the header and skills.level are shown --
        // so a knowledge self-assessment shouldn't claim either badge.
        const mostRecentRatingIndex = events.findIndex(
          (e) => (e.type === 'assessment' && e.entry.axis === 'practical') || e.type === 'peer'
        )
        // The "Baseline" badge marks the most recent AI-assessed baseline
        // specifically -- self-assessments and peer ratings are additional
        // input toward an evaluation, not a baseline in their own right.
        const mostRecentBaselineIndex = events.findIndex(
          (e) => e.type === 'assessment' && e.entry.source === 'ai_baseline'
        )

        return (
          <div>
            {pendingCourseLinks.map((link, i) => (
              <PendingTrainingEntry
                key={link.id}
                link={link}
                hasMore={i < pendingCourseLinks.length - 1 || pendingValidationRequests.length > 0 || events.length > 0}
                onClick={() => goToCourse(link.courses.id)}
              />
            ))}
            {pendingValidationRequests.map((request, i) => (
              <PendingValidationEntry
                key={request.id}
                request={request}
                validatorName={validatorNames[request.validator_id]}
                hasMore={i < pendingValidationRequests.length - 1 || events.length > 0}
              />
            ))}
            {events.map((event, i) => (
              <TimelineEntry
                key={
                  event.entry?.id ?? event.rating?.id ?? event.link?.id ?? event.statement?.id ??
                  event.request?.id ?? event.type
                }
                event={event}
                isLast={i === events.length - 1}
                isMostRecent={i === mostRecentRatingIndex}
                isBaseline={i === mostRecentBaselineIndex}
                raterAvatars={raterAvatars}
                assessorName={assessorName}
                onSelect={
                  event.type === 'training'
                    ? () => goToCourse(event.link.courses.id)
                    : TIMELINE_DETAIL_TYPES.has(event.type)
                      ? () => setSelectedEvent(event)
                      : undefined
                }
              />
            ))}
          </div>
        )
      })()}

      {selectedEvent && (
        <TimelineDetailModal
          event={selectedEvent}
          knowledgeLevelGuide={skill.knowledge_level_guide}
          raterAvatars={raterAvatars}
          assessorName={assessorName}
          onClose={() => setSelectedEvent(null)}
        />
      )}
    </div>
  )
}

function PendingTrainingEntry({ link, hasMore, onClick }) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center w-12 shrink-0">
        <div className="flex items-center justify-center w-8 h-8 rounded-full border-2 border-dashed border-hairline">
          <span className="w-1.5 h-1.5 rounded-full bg-secondary/40" />
        </div>
        {hasMore && <span className="w-px flex-1 bg-hairline mt-1" />}
      </div>
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onClick()
          }
        }}
        className="min-w-0 flex-1 mb-6 rounded-md border border-hairline bg-paper/60 p-3 cursor-pointer hover:border-moss/60 transition-colors"
      >
        <p className="text-sm text-secondary">
          Enrolled in <span className="text-ink font-medium">{link.courses.name}</span> — in progress
        </p>
      </div>
    </div>
  )
}

function PendingValidationEntry({ request, validatorName, hasMore }) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center w-12 shrink-0">
        <div className="flex items-center justify-center w-8 h-8 rounded-full border-2 border-dashed border-hairline">
          <span className="w-1.5 h-1.5 rounded-full bg-secondary/40" />
        </div>
        {hasMore && <span className="w-px flex-1 bg-hairline mt-1" />}
      </div>
      <div className="min-w-0 flex-1 mb-6 rounded-md border border-hairline bg-paper/60 p-3">
        <p className="text-sm text-secondary">
          Waiting on <span className="text-ink font-medium">{validatorName || 'a validator'}</span> to confirm{' '}
          {LEVEL_LABELS[request.target_level]}
        </p>
      </div>
    </div>
  )
}

function TimelineEntry({
  event,
  isLast,
  isMostRecent,
  isBaseline,
  raterAvatars,
  assessorName,
  onSelect,
}) {
  const boxClass = isMostRecent
    ? 'rounded-md border border-moss/40 bg-moss/5 p-3'
    : 'rounded-md border border-hairline bg-paper p-3'
  const clickableProps = onSelect
    ? {
        role: 'button',
        tabIndex: 0,
        onClick: onSelect,
        onKeyDown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onSelect()
          }
        },
      }
    : {}

  if (event.type === 'today') {
    return (
      <div className="flex gap-3">
        <div className="flex flex-col items-center w-12 shrink-0">
          <span className="w-2.5 h-2.5 rounded-full bg-ink shrink-0" />
          {!isLast && <span className="w-px flex-1 bg-hairline mt-1" />}
        </div>
        <div className="min-w-0 flex-1 mb-6 flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wide text-ink font-semibold">
            Today · {new Date(event.date).toLocaleDateString()}
          </span>
          <span className="flex-1 h-px bg-hairline" />
        </div>
      </div>
    )
  }

  if (event.type === 'activity') {
    const s = event.statement
    return (
      <div className="flex gap-3">
        <div className="flex flex-col items-center w-12 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-secondary/40 shrink-0 mt-1.5" />
          {!isLast && <span className="w-px flex-1 bg-hairline mt-1" />}
        </div>
        <div
          className="min-w-0 flex-1 mb-3 flex items-center gap-2 text-xs text-secondary cursor-pointer hover:text-ink transition-colors"
          {...clickableProps}
        >
          <span className="font-mono text-[10px] uppercase tracking-wide shrink-0">{verbLabel(s.statement)}</span>
          <span className="truncate min-w-0">{activityName(s.statement)}</span>
          <span className="font-mono text-[10px] text-secondary/70 shrink-0">
            {new Date(s.recorded_at).toLocaleDateString()}
            {formatDuration(s.statement) ? ` · ${formatDuration(s.statement)}` : ''}
          </span>
        </div>
      </div>
    )
  }

  if (event.type === 'training') {
    const course = event.link.courses
    return (
      <div className="flex gap-3">
        <div className="flex flex-col items-center w-12 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-secondary/40 shrink-0 mt-1.5" />
          {!isLast && <span className="w-px flex-1 bg-hairline mt-1" />}
        </div>
        <div
          className="min-w-0 flex-1 mb-3 flex items-center gap-2 text-xs text-secondary cursor-pointer hover:text-ink transition-colors"
          {...clickableProps}
        >
          <span className="font-mono text-[10px] uppercase tracking-wide shrink-0">Training</span>
          <span className="truncate min-w-0">{course.name}</span>
          <span className="font-mono text-[10px] text-secondary/70 shrink-0">
            {new Date(course.completed_date).toLocaleDateString()}
          </span>
        </div>
      </div>
    )
  }

  if (event.type === 'added') {
    return (
      <div className="flex gap-3">
        <div className="flex flex-col items-center w-12 shrink-0">
          <LifecycleStageIcon stage="identified" size={14} className="text-secondary/70 mt-1" />
          {!isLast && <span className="w-px flex-1 bg-hairline mt-1" />}
        </div>
        <div className="min-w-0 flex-1 mb-3 flex items-center gap-2 text-xs text-secondary">
          <span className="font-mono text-[10px] uppercase tracking-wide shrink-0">Skill added</span>
          {event.source && (
            <span className="truncate min-w-0">{SKILL_SOURCE_LABELS[event.source] ?? event.source}</span>
          )}
          <span className="font-mono text-[10px] text-secondary/70 shrink-0 ml-auto">
            {new Date(event.date).toLocaleDateString()}
          </span>
        </div>
      </div>
    )
  }

  if (event.type === 'peer') {
    const rating = event.rating
    return (
      <div className="flex gap-3">
        <div className="flex flex-col items-center w-12 shrink-0">
          <GrowthRing level={rating.level} size={isMostRecent ? 48 : 32} />
          {!isLast && <span className="w-px flex-1 bg-hairline mt-1" />}
        </div>
        <div
          className={`min-w-0 flex-1 mb-6 ${boxClass} ${onSelect ? 'cursor-pointer hover:border-moss/60 transition-colors' : ''}`}
          {...clickableProps}
        >
          <p className={isMostRecent ? 'text-base font-semibold text-ink' : 'text-sm font-medium text-ink'}>
            {LEVEL_LABELS[rating.level]}
          </p>
          <p className="font-mono text-xs text-secondary mt-0.5">
            {new Date(rating.rated_at).toLocaleDateString()}
          </p>
          <p className="font-mono text-[10px] text-secondary/80 mt-0.5 flex items-center gap-1.5">
            <RaterAvatar url={raterAvatars?.[rating.rater_id]} />
            Rated by {rating.rater_name || rating.rater_email || 'a connection'}
          </p>
          {rating.comments && <p className="text-sm text-ink mt-1">{rating.comments}</p>}
        </div>
      </div>
    )
  }

  if (event.type === 'relationship') {
    const { link } = event
    const exp = link.experience
    return (
      <div className="flex gap-3">
        <div className="flex flex-col items-center w-12 shrink-0">
          <div className="flex items-center justify-center w-8 h-8 rounded-full border border-hairline bg-paper">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-secondary">
              <path d="M3 7l9-4 9 4-9 4-9-4z" />
              <path d="M3 12l9 4 9-4" />
              <path d="M3 17l9 4 9-4" />
            </svg>
          </div>
          {!isLast && <span className="w-px flex-1 bg-hairline mt-1" />}
        </div>
        <div
          className={`min-w-0 flex-1 mb-6 rounded-md border border-hairline bg-paper p-3 ${onSelect ? 'cursor-pointer hover:border-moss/60 transition-colors' : ''}`}
          {...clickableProps}
        >
          <p className="text-sm font-medium text-ink">{exp.title}</p>
          <p className="font-mono text-xs text-secondary mt-0.5">
            {formatMonthYear(exp.start_date)} – {exp.end_date ? formatMonthYear(exp.end_date) : 'present'}
          </p>
          <p className="font-mono text-[10px] text-secondary/80 mt-0.5">
            {exp.type === 'education' ? 'Used during study' : 'Used during employment'} · {exp.organization}
          </p>
        </div>
      </div>
    )
  }

  if (event.type === 'validation') {
    const { request } = event
    const confirmed = request.status === 'confirmed'
    return (
      <div className="flex gap-3">
        <div className="flex flex-col items-center w-12 shrink-0">
          <div
            className={`flex items-center justify-center w-8 h-8 rounded-full border ${
              confirmed ? 'border-moss bg-moss/10' : 'border-hairline bg-paper'
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={confirmed ? 'text-moss' : 'text-secondary'}>
              {confirmed ? <path d="M20 6L9 17l-5-5" /> : <path d="M18 6L6 18M6 6l12 12" />}
            </svg>
          </div>
          {!isLast && <span className="w-px flex-1 bg-hairline mt-1" />}
        </div>
        <div className="min-w-0 flex-1 mb-6 rounded-md border border-hairline bg-paper p-3">
          <p className="text-sm font-medium text-ink">
            {confirmed ? `Validated at ${LEVEL_LABELS[request.target_level]}` : 'Validation declined'}
          </p>
          <p className="font-mono text-xs text-secondary mt-0.5">
            {new Date(request.decided_at).toLocaleDateString()}
          </p>
          {request.decision_comments && <p className="text-sm text-ink mt-1">"{request.decision_comments}"</p>}
        </div>
      </div>
    )
  }

  const entry = event.entry
  const entryLabels = entry.axis === 'knowledge' ? KNOWLEDGE_LEVEL_LABELS : LEVEL_LABELS
  const paths = entry.evidence_paths?.length
    ? entry.evidence_paths
    : entry.evidence_path
      ? [entry.evidence_path]
      : []

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center w-12 shrink-0">
        <GrowthRing
          level={entry.level}
          size={isMostRecent ? 48 : 32}
          labels={entryLabels}
          color={entry.axis === 'knowledge' ? 'var(--color-slate)' : undefined}
        />
        {!isLast && <span className="w-px flex-1 bg-hairline mt-1" />}
      </div>
      <div
        className={`min-w-0 flex-1 mb-6 ${boxClass} ${onSelect ? 'cursor-pointer hover:border-moss/60 transition-colors' : ''}`}
        {...clickableProps}
      >
        <div className="flex items-center gap-2">
          <p className={isMostRecent ? 'text-base font-semibold text-ink' : 'text-sm font-medium text-ink'}>
            {entryLabels[entry.level]}
          </p>
          {entry.axis === 'knowledge' && (
            <span className="font-mono text-[10px] uppercase tracking-wide text-secondary border border-hairline rounded-full px-2 py-0.5">
              Knowledge
            </span>
          )}
          {isBaseline && (
            <span className="font-mono text-[10px] uppercase tracking-wide text-moss border border-moss rounded-full px-2 py-0.5">
              Baseline
            </span>
          )}
        </div>
        <p className="font-mono text-xs text-secondary mt-0.5">
          {new Date(entry.assessed_at).toLocaleDateString()}
        </p>
        {entry.source === 'course' && entry.courses?.name ? (
          <p className="font-mono text-[10px] text-secondary/80 mt-0.5">
            Earned by completing {entry.courses.name}
          </p>
        ) : entry.source === 'ai_baseline' ? (
          <p className="font-mono text-[10px] text-secondary/80 mt-0.5">
            AI-assessed baseline, from self-assessment, peer ratings and activity
          </p>
        ) : entry.source === 'ai_evaluation' ? (
          <p className="font-mono text-[10px] text-secondary/80 mt-0.5">
            AI assessment, evaluated against your target level
          </p>
        ) : entry.source === 'diagnostic_confirmed' ? (
          <p className="font-mono text-[10px] text-secondary/80 mt-0.5">Confirmed via knowledge check</p>
        ) : (
          <p className="font-mono text-[10px] text-secondary/80 mt-0.5">
            Self-assessed by {assessorName || 'you'}
          </p>
        )}
        {entry.experience?.title && (
          <p className="font-mono text-[10px] text-secondary/80 mt-0.5">
            During {entry.experience.title} · {entry.experience.organization}
          </p>
        )}
        {entry.comments && <p className="text-sm text-ink mt-1">{entry.comments}</p>}
        {(entry.evidence_url || paths.length > 0) && (
          <div className="mt-2">
            <h5 className="font-mono text-[10px] uppercase tracking-wide text-secondary mb-1">
              Evidence
            </h5>
            <div className="flex flex-wrap items-center gap-3" onClick={(e) => e.stopPropagation()}>
            {entry.evidence_url && (
              <a
                href={entry.evidence_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-moss font-medium"
              >
                Evidence link
              </a>
            )}
            {paths.map((path, i) => (
              <EvidenceAttachmentLink key={path} path={path} index={i} />
            ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function TimelineDetailModal({ event, knowledgeLevelGuide, raterAvatars, assessorName, onClose }) {
  let title = 'Details'
  let body = null

  if (event.type === 'assessment') {
    const entry = event.entry
    const entryLabels = entry.axis === 'knowledge' ? KNOWLEDGE_LEVEL_LABELS : LEVEL_LABELS
    const paths = entry.evidence_paths?.length
      ? entry.evidence_paths
      : entry.evidence_path
        ? [entry.evidence_path]
        : []
    title = entryLabels[entry.level]
    body = (
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <GrowthRing
            level={entry.level}
            size={48}
            labels={entryLabels}
            color={entry.axis === 'knowledge' ? 'var(--color-slate)' : undefined}
          />
          <p className="font-mono text-xs text-secondary">
            {new Date(entry.assessed_at).toLocaleDateString()}
          </p>
          {entry.axis === 'knowledge' && (
            <span className="font-mono text-[10px] uppercase tracking-wide text-secondary border border-hairline rounded-full px-2 py-0.5">
              Knowledge
            </span>
          )}
        </div>
        {entry.axis === 'knowledge' && knowledgeLevelGuide?.[entry.level - 1] && (
          <p className="text-sm text-ink bg-paper border border-hairline rounded-md p-2">
            {knowledgeLevelGuide[entry.level - 1]}
          </p>
        )}
        {entry.source === 'course' && entry.courses?.name ? (
          <p className="text-sm text-secondary">Earned by completing {entry.courses.name}</p>
        ) : entry.source === 'ai_baseline' ? (
          <p className="text-sm text-secondary">
            AI-assessed baseline, from self-assessment, peer ratings and activity
          </p>
        ) : entry.source === 'ai_evaluation' ? (
          <p className="text-sm text-secondary">AI assessment, evaluated against your target level</p>
        ) : entry.source === 'diagnostic_confirmed' ? (
          <p className="text-sm text-secondary">Confirmed via knowledge check</p>
        ) : (
          <p className="text-sm text-secondary">Self-assessed by {assessorName || 'you'}</p>
        )}
        {entry.experience?.title && (
          <p className="text-sm text-secondary">
            During {entry.experience.title} · {entry.experience.organization}
          </p>
        )}
        {entry.comments && <p className="text-sm text-ink">{entry.comments}</p>}
        {(entry.evidence_url || paths.length > 0) && (
          <div>
            <h5 className="font-mono text-[10px] uppercase tracking-wide text-secondary mb-1">Evidence</h5>
            <div className="flex flex-wrap items-center gap-3">
              {entry.evidence_url && (
                <a
                  href={entry.evidence_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-moss font-medium"
                >
                  Evidence link
                </a>
              )}
              {paths.map((path, i) => (
                <EvidenceAttachmentLink key={path} path={path} index={i} />
              ))}
            </div>
          </div>
        )}
      </div>
    )
  } else if (event.type === 'peer') {
    const rating = event.rating
    title = LEVEL_LABELS[rating.level]
    body = (
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <GrowthRing level={rating.level} size={48} />
          <p className="font-mono text-xs text-secondary">
            {new Date(rating.rated_at).toLocaleDateString()}
          </p>
        </div>
        <p className="text-sm text-secondary flex items-center gap-1.5">
          <RaterAvatar url={raterAvatars?.[rating.rater_id]} size={20} />
          Rated by {rating.rater_name || rating.rater_email || 'a connection'}
        </p>
        {rating.comments && <p className="text-sm text-ink">{rating.comments}</p>}
      </div>
    )
  } else if (event.type === 'relationship') {
    const exp = event.link.experience
    title = exp.title
    body = (
      <div className="space-y-2">
        <p className="font-mono text-xs text-secondary">
          {formatMonthYear(exp.start_date)} – {exp.end_date ? formatMonthYear(exp.end_date) : 'present'}
        </p>
        <p className="text-sm text-secondary">
          {exp.type === 'education' ? 'Used during study' : 'Used during employment'} · {exp.organization}
        </p>
      </div>
    )
  } else if (event.type === 'activity') {
    const s = event.statement
    title = activityName(s.statement)
    body = (
      <div className="space-y-2">
        <p className="font-mono text-[10px] uppercase tracking-wide text-secondary">{verbLabel(s.statement)}</p>
        <p className="font-mono text-xs text-secondary">
          {new Date(s.recorded_at).toLocaleDateString()}
          {formatDuration(s.statement) ? ` · ${formatDuration(s.statement)}` : ''}
        </p>
        {s.statement.object?.definition?.description?.['en-US'] && (
          <p className="text-sm text-ink">{s.statement.object.definition.description['en-US']}</p>
        )}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-ink/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        className="w-full max-w-md bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4 gap-4">
          <h2 className="font-display text-xl text-ink">{title}</h2>
          <button type="button" onClick={onClose} className="shrink-0 text-secondary hover:text-ink text-sm">
            Close
          </button>
        </div>
        {body}
      </div>
    </div>
  )
}

function RaterAvatar({ url, size = 16 }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-full border border-hairline bg-paper overflow-hidden shrink-0"
      style={{ width: size, height: size }}
    >
      {url ? (
        <img src={url} alt="" className="w-full h-full object-cover" />
      ) : (
        <svg
          width={size * 0.6}
          height={size * 0.6}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-secondary"
        >
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" />
        </svg>
      )}
    </span>
  )
}

function EvidenceAttachmentLink({ path, index }) {
  const [signedUrl, setSignedUrl] = useState(null)
  const [loadingUrl, setLoadingUrl] = useState(false)

  async function handleViewEvidence() {
    if (signedUrl) {
      window.open(signedUrl, '_blank', 'noopener')
      return
    }
    setLoadingUrl(true)
    try {
      const url = await getEvidenceSignedUrl(path)
      setSignedUrl(url)
      window.open(url, '_blank', 'noopener')
    } finally {
      setLoadingUrl(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleViewEvidence}
      disabled={loadingUrl}
      className="text-xs text-moss font-medium"
    >
      {loadingUrl ? 'Loading…' : `Attachment ${index + 1}`}
    </button>
  )
}

function ScheduleSection({ skill, onUpdated }) {
  const [nextCheckinDate, setNextCheckinDate] = useState(skill.next_checkin_date ?? '')
  const [recurring, setRecurring] = useState(Boolean(skill.checkin_frequency_unit))
  const [frequencyValue, setFrequencyValue] = useState(skill.checkin_frequency_value ?? 1)
  const [frequencyUnit, setFrequencyUnit] = useState(skill.checkin_frequency_unit ?? 'months')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)

  // Re-sync local form state when the skill changes elsewhere (e.g. a new
  // self-assessment auto-advances next_checkin_date) — useState's initial
  // value is only read on mount, so without this the date field would go
  // stale.
  useEffect(() => {
    setNextCheckinDate(skill.next_checkin_date ?? '')
    setRecurring(Boolean(skill.checkin_frequency_unit))
    setFrequencyValue(skill.checkin_frequency_value ?? 1)
    setFrequencyUnit(skill.checkin_frequency_unit ?? 'months')
  }, [skill.next_checkin_date, skill.checkin_frequency_value, skill.checkin_frequency_unit])

  async function handleSave(e) {
    e.preventDefault()
    setError(null)
    // The date input's min attribute is just a UI hint -- browsers still
    // let a typed/pasted value through, so this is the actual guarantee a
    // check-in can never be scheduled in the past.
    if (nextCheckinDate && nextCheckinDate < todayDateString()) {
      setError("Next self-assessment date can't be in the past.")
      return
    }
    setSaving(true)
    setSaved(false)
    try {
      const { error } = await supabase
        .from('skills')
        .update({
          next_checkin_date: nextCheckinDate || null,
          checkin_frequency_value: recurring ? Math.max(1, Math.floor(Number(frequencyValue)) || 1) : null,
          checkin_frequency_unit: recurring ? frequencyUnit : null,
        })
        .eq('id', skill.id)
      if (error) throw error
      setSaved(true)
      onUpdated()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSave} className="border-t border-hairline pt-4 space-y-3">
      <h3 className="font-mono text-xs uppercase tracking-wide text-secondary">
        Self-assessment schedule
      </h3>

      <div>
        <label className="block text-sm text-secondary mb-1" htmlFor="nextCheckinDate">
          Next self-assessment date
        </label>
        <input
          id="nextCheckinDate"
          type="date"
          value={nextCheckinDate}
          min={todayDateString()}
          onChange={(e) => setNextCheckinDate(e.target.value)}
          className="w-full min-w-0 rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-secondary">
        <input
          type="checkbox"
          checked={recurring}
          onChange={(e) => setRecurring(e.target.checked)}
          className="rounded border-hairline"
        />
        Set up regular self-assessments
      </label>

      {recurring && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-secondary">Every</span>
          <input
            type="number"
            min={1}
            value={frequencyValue}
            onChange={(e) => setFrequencyValue(e.target.value)}
            onBlur={(e) => setFrequencyValue(Math.max(1, Math.floor(Number(e.target.value)) || 1))}
            className="w-16 min-w-0 rounded-md border border-hairline bg-paper px-2 py-1.5 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
          />
          <select
            value={frequencyUnit}
            onChange={(e) => setFrequencyUnit(e.target.value)}
            className="rounded-md border border-hairline bg-paper px-2 py-1.5 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
          >
            <option value="weeks">weeks</option>
            <option value="months">months</option>
            <option value="years">years</option>
          </select>
        </div>
      )}

      {error && <p className="text-sm text-red-700">{error}</p>}
      {saved && <p className="text-sm text-moss">Schedule saved.</p>}

      <button
        type="submit"
        disabled={saving}
        className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
      >
        {saving ? 'Saving…' : 'Save schedule'}
      </button>
    </form>
  )
}

function DetailsSection({ skill, skillTags, allTags, onAddTag, onRemoveTag, user, onUpdated, onDeleted }) {
  const isCustom = !skill.library_skill_id || skill.skill_library?.is_private
  const [name, setName] = useState(skill.name)
  const [isCurrentRole, setIsCurrentRole] = useState(skill.is_current_role)
  const [trackingReason, setTrackingReason] = useState(skill.tracking_reason ?? null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [currentRolePrompt, setCurrentRolePrompt] = useState(null)

  async function handleSave(e) {
    e.preventDefault()
    if (!name.trim()) {
      setError('Name is required.')
      return
    }
    setError(null)
    setSaving(true)
    try {
      const { error } = await supabase
        .from('skills')
        .update({
          name: name.trim(),
          tracking_reason: trackingReason,
        })
        .eq('id', skill.id)
      if (error) {
        if (isDuplicateSkillNameError(error)) throw new Error(duplicateSkillMessage(name))
        throw error
      }

      // is_current_role itself is never written directly here -- it's set
      // by enableCurrentRole/disableCurrentRole/syncSkillIsCurrentRole
      // below, which only ever mark it true once actually linked to a
      // current-role experience, so it can't end up stuck true with
      // nothing behind it (e.g. if the multi-role picker gets abandoned).
      // Only re-resolve when the checkbox actually changed -- otherwise
      // every unrelated edit (renaming, tags) would re-prompt a learner
      // with multiple current roles all over again.
      if (isCurrentRole !== skill.is_current_role) {
        if (isCurrentRole) {
          const result = await enableCurrentRole(user.id, skill.id)
          if (result.needsSelection) {
            setCurrentRolePrompt({ roles: result.roles })
            return
          }
        } else {
          await disableCurrentRole(user.id, skill.id)
        }
      }

      onUpdated()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleCurrentRoleConfirm(experienceIds) {
    await applyCurrentRoleSelection(user.id, skill.id, experienceIds)
    setCurrentRolePrompt(null)
    onUpdated()
  }

  async function handleCurrentRoleCancel() {
    await syncSkillIsCurrentRole(user.id, skill.id)
    setCurrentRolePrompt(null)
    onUpdated()
  }

  async function handleDelete() {
    if (!confirm(`Delete "${skill.name}" and all of its self-assessment history? This can't be undone.`)) {
      return
    }
    setSaving(true)
    try {
      const { error } = await supabase.from('skills').delete().eq('id', skill.id)
      if (error) throw error
      onDeleted()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <>
      {currentRolePrompt && (
        <CurrentRoleSelectModal
          roles={currentRolePrompt.roles}
          onConfirm={handleCurrentRoleConfirm}
          onCancel={handleCurrentRoleCancel}
        />
      )}
      <form onSubmit={handleSave} className="space-y-3">
      <p className="font-mono text-[10px] uppercase tracking-wide text-secondary">
        {isCustom ? 'Custom skill — private to you' : 'From the shared skill library'}
      </p>
      {isCustom ? (
        <div>
          <label className="block text-sm text-secondary mb-1" htmlFor="detailName">
            Name
          </label>
          <input
            id="detailName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
          />
        </div>
      ) : (
        <div>
          <span className="block text-sm text-secondary mb-1">Name</span>
          <p className="text-ink text-sm">{skill.name}</p>
        </div>
      )}

      <TagsField
        tags={skillTags.map((t) => ({ id: t.id, name: t.tags?.name }))}
        onAddTag={onAddTag}
        onRemoveTag={onRemoveTag}
        skillName={name}
        allTags={allTags}
        datalistId="tags-options-detail"
        readOnly={!isCustom}
      />

      <label className="flex items-start gap-2 text-sm text-secondary">
        <input
          type="checkbox"
          checked={isCurrentRole}
          onChange={(e) => setIsCurrentRole(e.target.checked)}
          className="mt-0.5 rounded border-hairline"
        />
        <span>
          Part of my current role
          <span className="block text-xs text-secondary/80 mt-0.5">
            Links this skill to your current job on the Experience timeline — creates one called
            "Current role" if you don't have one yet, or asks which one if you have more than
            one.
          </span>
        </span>
      </label>

      <TrackingReasonPicker value={trackingReason} onChange={setTrackingReason} />

      {error && <p className="text-sm text-red-700">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save details'}
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={saving}
          className="rounded-md border border-hairline text-red-700 py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
        >
          Delete skill
        </button>
      </div>
      </form>
    </>
  )
}

function SettingsSection({ skill, user, onUpdated }) {
  const [visible, setVisible] = useState(skill.visible_on_profile ?? false)
  const [validateConnections, setValidateConnections] = useState(skill.offer_validate_connections ?? false)
  const [validateOthers, setValidateOthers] = useState(skill.offer_validate_others ?? false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const canOfferValidation = skill.lifecycle_stage === 'validated' || skill.lifecycle_stage === 'maintained'
  const [searchVisibilityMode, setSearchVisibilityMode] = useState(null)
  const [searchable, setSearchable] = useState(false)
  const [searchableLoading, setSearchableLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    Promise.all([getSearchPrivacySettings(user.id), listSearchableSkillIds(user.id)])
      .then(([settings, ids]) => {
        if (cancelled) return
        setSearchVisibilityMode(settings.skill_search_visibility)
        setSearchable(ids.has(skill.id))
      })
      .finally(() => {
        if (!cancelled) setSearchableLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [user.id, skill.id])

  async function handleSearchableToggle(checked) {
    setError(null)
    setSaving(true)
    try {
      await setSkillSearchable(user.id, skill.id, checked)
      setSearchable(checked)
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  async function handleToggle(checked) {
    setError(null)
    setSaving(true)
    const { error } = await supabase
      .from('skills')
      .update({ visible_on_profile: checked })
      .eq('id', skill.id)
    if (error) {
      setError(error.message)
    } else {
      setVisible(checked)
      onUpdated()
    }
    setSaving(false)
  }

  async function handleValidationToggle(field, checked, setLocal) {
    setError(null)
    setSaving(true)
    const { error } = await supabase
      .from('skills')
      .update({ [field]: checked })
      .eq('id', skill.id)
    if (error) {
      setError(error.message)
    } else {
      setLocal(checked)
      onUpdated()
    }
    setSaving(false)
  }

  return (
    <div className="space-y-6">
      <div>
        <h4 className="font-mono text-xs uppercase tracking-wide text-secondary mb-3">Profile visibility</h4>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={visible}
            disabled={saving}
            onChange={(e) => handleToggle(e.target.checked)}
            className="mt-0.5 rounded border-hairline"
          />
          <span className="text-sm text-ink">
            Show this skill on your skills profile
            <span className="block text-xs text-secondary mt-0.5">
              Only skills marked visible here can appear to your connections — and only if you've also
              turned on "Let connections view your skills profile" in your Profile's Privacy settings.
            </span>
          </span>
        </label>
      </div>

      {!searchableLoading && searchVisibilityMode === 'selective' && skill.library_skill_id && (
        <div>
          <h4 className="font-mono text-xs uppercase tracking-wide text-secondary mb-3">Skill search</h4>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={searchable}
              disabled={saving}
              onChange={(e) => handleSearchableToggle(e.target.checked)}
              className="mt-0.5 rounded border-hairline"
            />
            <span className="text-sm text-ink">
              Show this skill when others search
              <span className="block text-xs text-secondary mt-0.5">
                Your Privacy settings are set to "Choose which skills to show" — this is the same
                list, editable from either place.
              </span>
            </span>
          </label>
        </div>
      )}

      {canOfferValidation && (
        <div>
          <h4 className="font-mono text-xs uppercase tracking-wide text-secondary mb-3">Validating others</h4>
          <p className="text-xs text-secondary mb-3">
            Since you've reached this level yourself, other people working toward it can ask you to review
            their evidence and confirm they've got there too. If you accept a request, you get read-only
            access to that one skill's record for as long as the request exists.
          </p>
          <div className="space-y-3">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={validateConnections}
                disabled={saving}
                onChange={(e) =>
                  handleValidationToggle('offer_validate_connections', e.target.checked, setValidateConnections)
                }
                className="mt-0.5 rounded border-hairline"
              />
              <span className="text-sm text-ink">Let your connections ask you to validate this skill</span>
            </label>
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={validateOthers}
                disabled={saving}
                onChange={(e) =>
                  handleValidationToggle('offer_validate_others', e.target.checked, setValidateOthers)
                }
                className="mt-0.5 rounded border-hairline"
              />
              <span className="text-sm text-ink">Let anyone on LearnScope ask you to validate this skill</span>
            </label>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-700 mt-2">{error}</p>}
    </div>
  )
}
