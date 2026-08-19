import { useEffect, useState } from 'react'
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { uploadEvidenceFiles, getEvidenceSignedUrl } from '../lib/skillEvidence'
import { computeNextSelfAssessmentDate, isSelfAssessmentDue } from '../lib/checkin'
import { formatMonthYear } from '../lib/dates'
import AppHeader from '../components/AppHeader'
import GrowthRing from '../components/GrowthRing'
import KnowledgeLevelBar from '../components/KnowledgeLevelBar'
import EvidenceFields from '../components/EvidenceFields'
import TrackingReasonPicker from '../components/TrackingReasonPicker'
import { LEVELS, LEVEL_LABELS, KNOWLEDGE_LEVEL_LABELS } from '../lib/levels'
import { SKILL_LIFECYCLE_LABELS } from '../lib/skillLifecycle'
import { SKILL_SOURCE_LABELS } from '../lib/skillSource'
import { activityName, verbLabel, formatDuration, isDiagnosticStatement } from '../lib/xapiStatement'
import { syncCurrentRoleLinks } from '../lib/currentRole'
import { listTags, listSkillTags, addTagToSkill, removeSkillTagLink } from '../lib/skillTags'
import { SKILL_RELATIONSHIP_LABELS } from '../lib/skillRelationships'
import { isDuplicateSkillNameError, duplicateSkillMessage } from '../lib/skillDuplicates'
import InviteRaterModal from '../components/InviteRaterModal'
import RecordActivityModal from '../components/RecordActivityModal'
import AssessBaselineModal from '../components/AssessBaselineModal'
import SetTargetModal from '../components/SetTargetModal'
import ValidateSkillModal from '../components/ValidateSkillModal'
import RequestValidationModal from '../components/RequestValidationModal'
import ConfirmingBaselineQuizModal from '../components/ConfirmingBaselineQuizModal'
import LifecycleStageIcon from '../components/LifecycleStageIcon'
import TagsField from '../components/TagsField'
import { listOutgoingValidationRequests } from '../lib/skillValidationRequests'
import { computeUpNextItems } from '../lib/skillNextAction'
import { ensureKnowledgeLevelGuide } from '../lib/knowledgeLevelGuide'
import {
  TRUST_STATUS,
  computeTrustStatus,
  classifyApplicationHistory,
  describeApplicationHistory,
} from '../lib/skillProficiencyModel'

const TABS = [
  { id: 'history', label: 'Overview' },
  { id: 'training', label: 'Training' },
  { id: 'details', label: 'Details' },
]

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
  const [tab, setTab] = useState('history')
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
  const [confirmKnowledgeOpen, setConfirmKnowledgeOpen] = useState(false)
  const [confirmingBaselineOpen, setConfirmingBaselineOpen] = useState(false)
  const [recordActivityOpen, setRecordActivityOpen] = useState(false)
  const [assessMode, setAssessMode] = useState(null)
  const [targetOpen, setTargetOpen] = useState(false)
  const [validateOpen, setValidateOpen] = useState(false)
  const [expertValidationOpen, setExpertValidationOpen] = useState(false)
  const [validationRequests, setValidationRequests] = useState([])
  const [validatorNames, setValidatorNames] = useState({})

  useEffect(() => {
    loadSkill()
    loadAssessorName()
    listTags().then(setAllTags)
  }, [id])

  useEffect(() => {
    if (skill) loadHistory()
  }, [skill?.id])

  async function loadSkill() {
    setLoadingSkill(true)
    setNotFound(false)
    const { data, error } = await supabase
      .from('skills')
      .select('*')
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
  const hasAnyKnowledgeEvaluationInput = knowledgeSelfAssessedCount > 0
  const latestKnowledgeAssessment = history.find((a) => a.axis === 'knowledge') ?? null
  // The header shows the confirmed level once one exists; until then it
  // falls back to the latest self-assessment so the header reflects what the
  // learner just told us rather than sitting on "Not yet self-assessed"
  // through the whole self-assess -> confirm gap. The nearby verification
  // badge still says "Self-assessed" vs "Confirmed", so this doesn't overstate
  // how settled the number is -- it's shown, just not claimed as verified.
  const displayedKnowledgeLevel = skill?.knowledge_level ?? latestKnowledgeAssessment?.level ?? null

  // Practical-primary / knowledge-foundation model: derived, not stored --
  // see skillProficiencyModel.js. Trust status is computed independently
  // per axis and never blended into a level; application history only ever
  // produces a descriptive label, never a number.
  const applicationHistory = classifyApplicationHistory(practicalStatements)
  const knowledgeConfirmed = history.some((a) => a.axis === 'knowledge' && a.source === 'diagnostic_confirmed')
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
  const evidenceAttachedCount = history.filter(
    (a) => a.axis === 'practical' && (a.evidence_url || a.evidence_paths?.length)
  ).length
  const supportingSignals = [
    peerRatings.length > 0 ? `${peerRatings.length} peer rating${peerRatings.length === 1 ? '' : 's'}` : null,
    practicalStatements.length > 0
      ? `${practicalStatements.length} activit${practicalStatements.length === 1 ? 'y' : 'ies'} logged`
      : null,
    evidenceAttachedCount > 0 ? `${evidenceAttachedCount} evidence item${evidenceAttachedCount === 1 ? '' : 's'}` : null,
  ].filter(Boolean)
  const lastDemonstrated = practicalStatements[0]?.recorded_at
    ? `Last demonstrated ${new Date(practicalStatements[0].recorded_at).toLocaleDateString()}`
    : null
  // What backs the practical verification tier so far -- shown as a caption
  // under its badge so "Evidence supported" reads together with how much
  // evidence, rather than as a single flat tier with no sense of strength.
  const practicalVerificationDetail = [
    describeApplicationHistory(applicationHistory),
    ...supportingSignals,
    lastDemonstrated,
  ]
    .filter(Boolean)
    .join(' · ')
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
            <div className="flex items-start flex-wrap gap-x-6 gap-y-4">
              <div className="flex items-center gap-4">
                <GrowthRing level={skill.level} size={56} />
                <div>
                  <h2 className="font-display text-2xl text-ink">{skill.name}</h2>
                  <p className="text-sm text-secondary flex items-center gap-1.5">
                    {!skill.level && skill.lifecycle_stage && (
                      <LifecycleStageIcon stage={skill.lifecycle_stage} />
                    )}
                    {skill.level
                      ? LEVEL_LABELS[skill.level]
                      : skill.lifecycle_stage
                        ? SKILL_LIFECYCLE_LABELS[skill.lifecycle_stage]
                        : 'Not yet self-assessed'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4 sm:pl-6 sm:border-l sm:border-hairline">
                <KnowledgeLevelBar level={displayedKnowledgeLevel} size={40} />
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
              </div>
            </div>

            {(practicalVerification || knowledgeVerification) && (
              <div className="flex flex-wrap items-start gap-x-6 gap-y-2 mt-3">
                {practicalVerification && (
                  <VerificationBadge
                    axis="practical"
                    status={practicalVerification}
                    detail={practicalVerificationDetail}
                  />
                )}
                {knowledgeVerification && <VerificationBadge axis="knowledge" status={knowledgeVerification} />}
              </div>
            )}

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

            <div className="grid sm:grid-cols-2 gap-4 mt-4 pt-4 border-t border-hairline">
              <ActionGroup
                title="Knowledge"
                accent="slate"
                actions={[
                  { label: 'Rate your current level', onClick: () => setSelfAssessKnowledgeOpen(true) },
                  { label: 'Assess me', onClick: () => setConfirmingBaselineOpen(true) },
                  { label: 'Interview me', disabled: true, title: 'Coming soon' },
                ]}
              />
              <ActionGroup
                title="Practical Application"
                accent="moss"
                actions={[
                  { label: 'Self-assess your current level', onClick: () => setSelfAssessOpen(true) },
                  { label: 'Invite connection to rate', onClick: () => setInviteOpen(true) },
                  {
                    label: 'Assess my current level',
                    onClick: () => setAssessMode('evaluate'),
                    disabled: !hasAnyEvaluationInput,
                    title: !hasAnyEvaluationInput
                      ? 'Self-assess, invite a rating, or record activity first'
                      : undefined,
                  },
                  { label: 'Set target', onClick: () => setTargetOpen(true) },
                ]}
              />
            </div>
            </div>

            {inviteOpen && <InviteRaterModal skill={skill} onClose={() => setInviteOpen(false)} />}

            {selfAssessOpen && (
              <SelfAssessModal
                skill={skill}
                user={user}
                onClose={() => setSelfAssessOpen(false)}
                onAssessed={() => {
                  loadHistory()
                  loadSkill()
                  setSelfAssessOpen(false)
                }}
              />
            )}

            {selfAssessKnowledgeOpen && (
              <SelfAssessModal
                skill={skill}
                user={user}
                axis="knowledge"
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

            {confirmKnowledgeOpen && (
              <ConfirmKnowledgeLevelModal
                skill={skill}
                latestAssessment={latestKnowledgeAssessment}
                onClose={() => setConfirmKnowledgeOpen(false)}
                onConfirmed={() => {
                  loadSkill()
                  setConfirmKnowledgeOpen(false)
                }}
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
                onClose={() => setTargetOpen(false)}
                onSet={() => {
                  loadHistory()
                  loadSkill()
                  setTargetOpen(false)
                }}
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

            <div className="flex items-center flex-wrap gap-1 border-b border-hairline mb-4">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
                    tab === t.id
                      ? 'border-moss text-ink'
                      : 'border-transparent text-secondary hover:text-ink'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tab === 'details' && (
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
                <div className="border-t border-hairline pt-4">
                  <h3 className="font-mono text-xs uppercase tracking-wide text-secondary mb-3">
                    Knowledge
                  </h3>
                  <button
                    type="button"
                    onClick={() => setConfirmKnowledgeOpen(true)}
                    disabled={!hasAnyKnowledgeEvaluationInput}
                    title={!hasAnyKnowledgeEvaluationInput ? 'Self-assess your knowledge first' : undefined}
                    className="w-full rounded-md bg-moss text-paper py-2.5 px-4 font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Confirm knowledge level
                  </button>
                </div>
                <SettingsSection skill={skill} onUpdated={loadSkill} />
                <ScheduleSection skill={skill} onUpdated={loadSkill} />
              </div>
            )}

            {tab === 'history' && (
              <HistorySection
                skill={skill}
                history={history}
                peerRatings={peerRatings}
                invitesSentCount={invitesSentCount}
                relationshipLinks={relationshipLinks}
                statements={statements}
                courseLinks={courseLinks}
                targets={targets}
                validationRequests={validationRequests}
                validatorNames={validatorNames}
                loading={loadingHistory}
                raterAvatars={raterAvatars}
                hasAnyEvaluationInput={hasAnyEvaluationInput}
                onSelfAssess={() => setSelfAssessOpen(true)}
                onSelfAssessKnowledge={() => setSelfAssessKnowledgeOpen(true)}
                onInvite={() => setInviteOpen(true)}
                onRecordActivity={() => setRecordActivityOpen(true)}
                onAssessBaseline={() => setAssessMode('baseline')}
                onSetTarget={() => setTargetOpen(true)}
                onFindCourse={() => navigate('/training', { state: trainingScopeState })}
                onDemonstrateSkill={handleDemonstrateSkill}
                onValidateSkillStage={handleValidateSkillStage}
                onRequestValidation={() => setValidateOpen(true)}
                onRequestExpertValidation={() => setExpertValidationOpen(true)}
                onConfirmBaselineQuiz={() => setConfirmingBaselineOpen(true)}
              />
            )}

            {tab === 'training' && (
              <TrainingSection
                courseLinks={courseLinks}
                loading={loadingHistory}
                trainingScopeState={trainingScopeState}
              />
            )}
          </div>
        )}
      </main>
    </div>
  )
}

// Verification level is deliberately separate from proficiency -- it says
// how a displayed level was supported (self-assessed, evidence, peer
// confirmation, formal validation), not how high it is, so it's styled as
// a neutral pill rather than echoing the level's own color scale.
// Confirmed/Validated (practical) and Confirmed (knowledge, its ceiling
// today) get the axis's accent color; earlier tiers stay neutral. The tier
// alone doesn't say how much evidence backs it -- `detail`, when given,
// renders underneath as a caption so the badge and its supporting signals
// read as one unit instead of a flat status with no sense of strength.
function VerificationBadge({ axis, status, detail }) {
  const isKnowledge = axis === 'knowledge'
  const isStrong = status === TRUST_STATUS.VALIDATED || status === TRUST_STATUS.CONFIRMED
  const colorClass = isStrong
    ? isKnowledge
      ? 'border-slate text-slate'
      : 'border-moss text-moss'
    : 'border-hairline text-secondary'
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span
        className={`w-fit font-mono text-[10px] uppercase tracking-wide rounded-full px-2 py-0.5 border ${colorClass}`}
      >
        {isKnowledge ? 'Knowledge' : 'Practical'} verification · {status}
      </span>
      {detail && <span className="text-xs text-secondary">{detail}</span>}
    </div>
  )
}

// Always-available actions for a skill, grouped by axis -- unlike Up Next
// (which recommends the single next step for the skill's current lifecycle
// stage), every action here is reachable regardless of stage, so a learner
// isn't limited to following the guided checklist in order.
function ActionGroup({ title, accent, actions }) {
  const accentClass = accent === 'slate' ? 'hover:border-slate hover:text-slate' : 'hover:border-moss hover:text-moss'
  return (
    <div>
      <h3 className="font-mono text-[10px] uppercase tracking-wide text-secondary mb-2">{title}</h3>
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

// The recommended next actions for a skill, keyed by lifecycle stage.
// Only stages with a defined next step render this section at all --
// later stages (demonstrated onward) have no single recommended action yet.
function UpNextSection({
  stage,
  selfAssessedCount,
  knowledgeSelfAssessedCount,
  hasKnowledgeLevel,
  peerRatingsCount,
  invitesSentCount,
  statementsCount,
  onSelfAssess,
  onSelfAssessKnowledge,
  onInvite,
  onRecordActivity,
  onSetTarget,
  onDemonstrateSkill,
  onFindCourse,
  courseLinks,
  onValidateSkillStage,
  onRequestValidation,
  onRequestExpertValidation,
  hasPendingExpertValidation,
  hasTarget,
  onConfirmBaselineQuiz,
}) {
  const handlers = {
    'self-assess': onSelfAssess,
    'self-assess-knowledge': onSelfAssessKnowledge,
    'confirm-baseline-quiz': onConfirmBaselineQuiz,
    invite: onInvite,
    activity: onRecordActivity,
    target: onSetTarget,
    'find-course': onFindCourse,
    demonstrate: onDemonstrateSkill,
    'record-activity': onRecordActivity,
    'self-assess-demonstrating': onSelfAssess,
    'invite-demonstrating': onInvite,
    validate: onValidateSkillStage,
    'invite-validating': onInvite,
    'request-validation': onRequestExpertValidation,
    'ai-assessment': onRequestValidation,
  }
  const items = computeUpNextItems({
    stage,
    selfAssessedCount,
    knowledgeSelfAssessedCount,
    hasKnowledgeLevel,
    peerRatingsCount,
    invitesSentCount,
    statementsCount,
    courseLinks,
    hasTarget,
    hasPendingExpertValidation,
  }).map((item) => ({ ...item, onClick: handlers[item.key] }))

  if (!stage) return null

  return (
    <div className="mb-6 rounded-md border border-hairline bg-paper p-4">
      <h3 className="font-mono text-xs uppercase tracking-wide text-secondary mb-3">Up Next</h3>
      {items.length === 0 ? (
        <p className="text-sm text-secondary">Nothing outstanding right now.</p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={item.locked ? undefined : item.onClick}
              disabled={item.locked}
              title={item.locked ? item.lockedReason : undefined}
              className={`w-full flex items-center justify-between gap-3 rounded-md border border-hairline bg-card px-3 py-2.5 text-left transition-colors ${
                item.locked ? 'opacity-50 cursor-not-allowed' : 'hover:border-moss'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span
                  className={`shrink-0 flex items-center justify-center w-5 h-5 rounded-full border text-[10px] font-bold ${
                    item.done ? 'bg-moss border-moss text-paper' : 'border-hairline text-secondary'
                  }`}
                >
                  {item.done ? '✓' : ''}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm text-ink">{item.label}</span>
                  <span className="block text-xs text-secondary truncate">
                    {item.locked ? item.lockedReason : item.description}
                  </span>
                </span>
              </div>
              <span className={`shrink-0 text-xs font-medium ${item.locked ? 'text-secondary' : 'text-moss'}`}>
                {item.locked ? 'Locked' : item.done ? 'Redo' : 'Start'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function SelfAssessModal({ skill, user, axis = 'practical', onClose, onAssessed, onGuideGenerated }) {
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
          onAssessed={onAssessed}
          onGuideGenerated={onGuideGenerated}
        />
      </div>
    </div>
  )
}

function SelfAssessSection({ skill, user, axis = 'practical', onAssessed, onGuideGenerated }) {
  const isKnowledge = axis === 'knowledge'
  const labels = isKnowledge ? KNOWLEDGE_LEVEL_LABELS : LEVEL_LABELS
  const [level, setLevel] = useState((isKnowledge ? skill.knowledge_level : skill.level) ?? 1)
  const [comments, setComments] = useState('')
  const [evidenceUrl, setEvidenceUrl] = useState('')
  const [evidenceFiles, setEvidenceFiles] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [guideStatements, setGuideStatements] = useState([])
  const [guideLoading, setGuideLoading] = useState(isKnowledge)

  useEffect(() => {
    if (!isKnowledge) return
    let cancelled = false
    setGuideLoading(true)
    ensureKnowledgeLevelGuide(skill)
      .then((statements) => {
        if (!cancelled) setGuideStatements(statements)
        // Cache the result on the in-memory skill too, so reopening this
        // modal in the same session doesn't hit the DB/AI call again.
        if (statements.length === 5) onGuideGenerated?.(statements)
      })
      .catch(() => {
        // Guidance is a nice-to-have, not required to self-assess -- fail
        // quietly and just fall back to the plain level picker.
        if (!cancelled) setGuideStatements([])
      })
      .finally(() => {
        if (!cancelled) setGuideLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isKnowledge, skill.id])

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      const { data: assessment, error: assessmentError } = await supabase
        .from('skill_assessments')
        .insert({
          skill_id: skill.id,
          user_id: user.id,
          level,
          axis,
          comments: comments.trim() || null,
          evidence_url: evidenceUrl.trim() || null,
        })
        .select()
        .single()
      if (assessmentError) throw assessmentError

      if (evidenceFiles.length > 0) {
        const paths = await uploadEvidenceFiles(user.id, skill.id, assessment.id, evidenceFiles)
        const { error: updateError } = await supabase
          .from('skill_assessments')
          .update({ evidence_paths: paths })
          .eq('id', assessment.id)
        if (updateError) throw updateError
      }

      // A self-assessment is recorded as history but doesn't move the
      // skill's official current level -- only an explicit "Assess
      // baseline" / "Evaluate Baseline" (practical) or the Confirming
      // Baseline quiz / "Confirm knowledge level" (knowledge) action does
      // that. The check-in cadence is a practical-review schedule, so only
      // a practical self-assessment reschedules it.
      if (!isKnowledge && skill.checkin_frequency_value && skill.checkin_frequency_unit) {
        const { error: skillError } = await supabase
          .from('skills')
          .update({
            next_checkin_date: computeNextSelfAssessmentDate(
              null,
              skill.checkin_frequency_value,
              skill.checkin_frequency_unit
            ),
          })
          .eq('id', skill.id)
        if (skillError) throw skillError
      }

      // Establishing a baseline's knowledge axis is a self-contained round
      // trip: self-assessing it immediately sends the skill to Confirming
      // Baseline to check it against a calibrated quiz, entirely separate
      // from the practical axis and its own AI-synthesis flow.
      if (isKnowledge && skill.lifecycle_stage === 'identified') {
        const { error: stageError } = await supabase
          .from('skills')
          .update({ lifecycle_stage: 'confirming_baseline' })
          .eq('id', skill.id)
        if (stageError) throw stageError
      }

      onAssessed()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <span className="block text-sm text-secondary mb-2">
          {isKnowledge ? 'What you already know' : 'Level now'}
        </span>
        {isKnowledge ? (
          <div className="space-y-2">
            {LEVELS.map((l) => (
              <div
                key={l}
                className={`rounded-md border overflow-hidden ${
                  level === l ? 'border-moss' : 'border-hairline'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setLevel(l)}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                    level === l ? 'bg-moss/10' : 'hover:bg-paper'
                  }`}
                >
                  <GrowthRing level={l} size={28} labels={labels} color="var(--color-slate)" />
                  <span className="text-sm text-ink font-medium">{labels[l]}</span>
                </button>
                {level === l && (
                  <div className="px-3 pb-3">
                    {guideLoading ? (
                      <p className="text-xs text-secondary">Loading guidance…</p>
                    ) : guideStatements[l - 1] ? (
                      <p className="text-xs text-secondary">{guideStatements[l - 1]}</p>
                    ) : null}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-between">
            {LEVELS.map((l) => (
              <button
                type="button"
                key={l}
                onClick={() => setLevel(l)}
                className={`flex flex-col items-center gap-1 rounded-md px-1 py-1 ${
                  level === l ? 'bg-moss/10' : ''
                }`}
              >
                <GrowthRing level={l} size={36} labels={labels} />
                <span className="font-mono text-[10px] text-secondary">{labels[l]}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        {isKnowledge && (
          <span className="block text-sm text-secondary mb-2">What's shaped this understanding?</span>
        )}
        <textarea
          rows={3}
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          placeholder={
            isKnowledge
              ? 'e.g. courses, reading, work you’ve done…'
              : 'Why this level? What changed since last time…'
          }
          className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
        />
      </div>

      {!isKnowledge && (
        <EvidenceFields
          evidenceUrl={evidenceUrl}
          onEvidenceUrlChange={setEvidenceUrl}
          files={evidenceFiles}
          onFilesChange={setEvidenceFiles}
        />
      )}

      {error && <p className="text-sm text-red-700">{error}</p>}

      <button
        type="submit"
        disabled={saving}
        className="rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90 disabled:opacity-60"
      >
        {saving ? 'Saving…' : 'Save self-assessment'}
      </button>
    </form>
  )
}

// Unlike the practical axis, there's no multi-source AI synthesis feeding
// knowledge_level -- the learner's own self-assessment is the only signal.
// This still keeps it an explicit, separate confirmation step (rather than
// self-assessing silently moving the official value) so it stays under the
// learner's control, same as "Evaluate Baseline" is for the practical axis.
function ConfirmKnowledgeLevelModal({ skill, latestAssessment, onClose, onConfirmed }) {
  const [level, setLevel] = useState(latestAssessment?.level ?? skill.knowledge_level ?? 1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function handleConfirm() {
    setError(null)
    setSaving(true)
    try {
      const { error: updateError } = await supabase
        .from('skills')
        .update({ knowledge_level: level })
        .eq('id', skill.id)
      if (updateError) throw updateError
      onConfirmed()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-ink/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        className="w-full max-w-md bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-2xl text-ink">Confirm knowledge level</h2>
          <button type="button" onClick={onClose} className="text-secondary hover:text-ink text-sm">
            Close
          </button>
        </div>

        {latestAssessment && (
          <p className="text-sm text-secondary mb-3">
            Your latest self-assessment{' '}
            {latestAssessment.comments ? <>said: "{latestAssessment.comments}"</> : 'is set below.'} Adjust if
            needed, then confirm it as your current knowledge level.
          </p>
        )}

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            {LEVELS.map((l) => (
              <button
                type="button"
                key={l}
                onClick={() => setLevel(l)}
                className={`flex flex-col items-center gap-1 rounded-md px-1 py-1 ${
                  level === l ? 'bg-moss/10' : ''
                }`}
              >
                <GrowthRing level={l} size={36} labels={KNOWLEDGE_LEVEL_LABELS} color="var(--color-slate)" />
                <span className="font-mono text-[10px] text-secondary">{KNOWLEDGE_LEVEL_LABELS[l]}</span>
              </button>
            ))}
          </div>

          {error && <p className="text-sm text-red-700">{error}</p>}

          <button
            type="button"
            onClick={handleConfirm}
            disabled={saving}
            className="rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90 disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Confirm knowledge level'}
          </button>
        </div>
      </div>
    </div>
  )
}

const TIMELINE_DETAIL_TYPES = new Set(['assessment', 'peer', 'relationship', 'activity', 'training'])

function HistorySection({
  skill,
  history,
  peerRatings,
  invitesSentCount,
  relationshipLinks,
  statements,
  courseLinks,
  targets,
  validationRequests,
  validatorNames,
  loading,
  raterAvatars,
  hasAnyEvaluationInput,
  onSelfAssess,
  onSelfAssessKnowledge,
  onInvite,
  onRecordActivity,
  onAssessBaseline,
  onSetTarget,
  onFindCourse,
  onDemonstrateSkill,
  onValidateSkillStage,
  onRequestValidation,
  onRequestExpertValidation,
  onConfirmBaselineQuiz,
}) {
  const navigate = useNavigate()
  const due = isSelfAssessmentDue(skill.next_checkin_date)
  const currentTarget = targets[0]
  const showBaselineFlow = skill.lifecycle_stage === 'identified'
  const selfAssessedCount = history.filter((a) => (a.source === 'self' || !a.source) && a.axis === 'practical').length
  const knowledgeSelfAssessedCount = history.filter(
    (a) => (a.source === 'self' || !a.source) && a.axis === 'knowledge'
  ).length
  // The Confirming Baseline knowledge quiz logs its own xAPI attempt --
  // exclude it here too, same reasoning as the top-level SkillDetail
  // component (see there for the full comment).
  const practicalStatements = statements.filter((s) => !isDiagnosticStatement(s.statement))
  const hasKnowledgeLevel = Boolean(skill.knowledge_level)
  const pendingValidationRequests = validationRequests.filter((r) => r.status === 'pending')
  const decidedValidationRequests = validationRequests.filter((r) => r.status !== 'pending')
  const [selectedEvent, setSelectedEvent] = useState(null)

  function goToCourse(courseId) {
    navigate(`/courses/${courseId}`, { state: { backTo: `/skills/${skill.id}`, backLabel: skill.name } })
  }

  return (
    <div>
      {skill.next_checkin_date && (
        <div
          className={`flex items-center justify-between rounded-md border px-3 py-2 mb-6 ${
            due ? 'border-gold bg-gold/10' : 'border-hairline bg-paper'
          }`}
        >
          <span className="font-mono text-xs uppercase tracking-wide text-secondary">
            Next planned self-assessment
          </span>
          <span className={`text-sm font-medium ${due ? 'text-gold' : 'text-ink'}`}>
            {new Date(`${skill.next_checkin_date}T00:00:00`).toLocaleDateString()}
            {due ? ' · Due' : ''}
          </span>
        </div>
      )}

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
            {currentTarget && (
              <TargetTimelineEntry
                target={currentTarget}
                hasMore={pendingCourseLinks.length > 0 || pendingValidationRequests.length > 0 || events.length > 0}
                onClick={onSetTarget}
              />
            )}
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
            <UpNextSection
              stage={skill.lifecycle_stage}
              selfAssessedCount={selfAssessedCount}
              knowledgeSelfAssessedCount={knowledgeSelfAssessedCount}
              hasKnowledgeLevel={hasKnowledgeLevel}
              peerRatingsCount={peerRatings.length}
              invitesSentCount={invitesSentCount}
              statementsCount={practicalStatements.length}
              onSelfAssess={onSelfAssess}
              onSelfAssessKnowledge={onSelfAssessKnowledge}
              onInvite={onInvite}
              onRecordActivity={onRecordActivity}
              onSetTarget={onSetTarget}
              onDemonstrateSkill={onDemonstrateSkill}
              onFindCourse={onFindCourse}
              courseLinks={courseLinks}
              onValidateSkillStage={onValidateSkillStage}
              onRequestValidation={onRequestValidation}
              onRequestExpertValidation={onRequestExpertValidation}
              hasPendingExpertValidation={pendingValidationRequests.length > 0}
              hasTarget={targets.length > 0}
              onConfirmBaselineQuiz={onConfirmBaselineQuiz}
            />
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
                showAssessBaseline={showBaselineFlow && event.type === 'today'}
                onAssessBaseline={onAssessBaseline}
                assessBaselineDisabled={!hasAnyEvaluationInput}
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
          onClose={() => setSelectedEvent(null)}
        />
      )}
    </div>
  )
}

function TargetTimelineEntry({ target, hasMore, onClick }) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center w-12 shrink-0">
        <div className="rounded-full border-2 border-dashed border-hairline p-0.5">
          <GrowthRing level={target.target_level} size={32} />
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
          Target {LEVEL_LABELS[target.target_level]} aimed to be achieved by{' '}
          {new Date(`${target.target_date}T00:00:00`).toLocaleDateString()}
        </p>
      </div>
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
  showAssessBaseline,
  onAssessBaseline,
  assessBaselineDisabled,
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
          {showAssessBaseline && (
            <button
              type="button"
              onClick={onAssessBaseline}
              disabled={assessBaselineDisabled}
              title={assessBaselineDisabled ? 'Complete at least one checklist item first' : undefined}
              className="shrink-0 rounded-md bg-moss text-paper text-xs font-medium py-1 px-2.5 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Assess baseline
            </button>
          )}
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
        ) : (
          <p className="font-mono text-[10px] text-secondary/80 mt-0.5">Self-assessed</p>
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

function TimelineDetailModal({ event, knowledgeLevelGuide, raterAvatars, onClose }) {
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
        ) : (
          <p className="text-sm text-secondary">Self-assessed</p>
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
    setSaving(true)
    setSaved(false)
    try {
      const { error } = await supabase
        .from('skills')
        .update({
          next_checkin_date: nextCheckinDate || null,
          checkin_frequency_value: recurring ? frequencyValue : null,
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
          onChange={(e) => setNextCheckinDate(e.target.value)}
          className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
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
            onChange={(e) => setFrequencyValue(Number(e.target.value) || 1)}
            className="w-16 rounded-md border border-hairline bg-paper px-2 py-1.5 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
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
  const [name, setName] = useState(skill.name)
  const [isCurrentRole, setIsCurrentRole] = useState(skill.is_current_role)
  const [trackingReason, setTrackingReason] = useState(skill.tracking_reason ?? null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

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
          is_current_role: isCurrentRole,
          tracking_reason: trackingReason,
        })
        .eq('id', skill.id)
      if (error) {
        if (isDuplicateSkillNameError(error)) throw new Error(duplicateSkillMessage(name))
        throw error
      }
      await syncCurrentRoleLinks(user.id, skill.id, isCurrentRole)
      onUpdated()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
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
    <form onSubmit={handleSave} className="space-y-3">
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

      <TagsField
        tags={skillTags.map((t) => ({ id: t.id, name: t.tags?.name }))}
        onAddTag={onAddTag}
        onRemoveTag={onRemoveTag}
        skillName={name}
        allTags={allTags}
        datalistId="tags-options-detail"
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
            Also links this skill to any ongoing employment entries on your Experience timeline.
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
  )
}

function TrainingSection({ courseLinks, loading, trainingScopeState }) {
  const navigate = useNavigate()

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Link
          to="/training"
          state={trainingScopeState}
          className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper"
        >
          Find training
        </Link>
      </div>

      {loading ? (
        <p className="text-sm text-secondary">Loading…</p>
      ) : courseLinks.length === 0 ? (
        <p className="text-sm text-secondary">No courses linked to this skill yet.</p>
      ) : (
        <ul className="space-y-2">
          {courseLinks
            .filter((link) => link.courses)
            .map((link) => (
              <li
                key={link.id}
                role="button"
                tabIndex={0}
                onClick={() =>
                  navigate(`/courses/${link.courses.id}`, {
                    state: { backTo: trainingScopeState?.backTo, backLabel: trainingScopeState?.skillName },
                  })
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    navigate(`/courses/${link.courses.id}`, {
                      state: { backTo: trainingScopeState?.backTo, backLabel: trainingScopeState?.skillName },
                    })
                  }
                }}
                className="bg-paper border border-hairline rounded-md px-3 py-2 cursor-pointer hover:border-moss transition-colors"
              >
                <p className="text-sm font-medium text-ink">{link.courses.name}</p>
                <p className="font-mono text-xs text-secondary mt-0.5">
                  {[
                    link.courses.provider,
                    link.courses.course_type,
                    link.courses.duration,
                    link.courses.completed_date &&
                      `Completed ${new Date(link.courses.completed_date).toLocaleDateString()}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                <p className="font-mono text-[10px] uppercase tracking-wide text-secondary/80 mt-0.5">
                  {SKILL_RELATIONSHIP_LABELS[link.relationship] ?? link.relationship}
                </p>
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}

function SettingsSection({ skill, onUpdated }) {
  const [visible, setVisible] = useState(skill.visible_on_profile ?? false)
  const [validateConnections, setValidateConnections] = useState(skill.offer_validate_connections ?? false)
  const [validateOthers, setValidateOthers] = useState(skill.offer_validate_others ?? false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const canOfferValidation = skill.lifecycle_stage === 'validated' || skill.lifecycle_stage === 'maintained'

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
