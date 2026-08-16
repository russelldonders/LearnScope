import { useEffect, useState } from 'react'
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { uploadEvidenceFiles, getEvidenceSignedUrl } from '../lib/skillEvidence'
import { computeNextSelfAssessmentDate, isSelfAssessmentDue } from '../lib/checkin'
import { formatMonthYear } from '../lib/dates'
import AppHeader from '../components/AppHeader'
import GrowthRing from '../components/GrowthRing'
import EvidenceFields from '../components/EvidenceFields'
import TrackingReasonPicker from '../components/TrackingReasonPicker'
import { LEVELS, LEVEL_LABELS } from '../lib/levels'
import { SKILL_LIFECYCLE_LABELS, SKILL_LIFECYCLE_FLOW_STAGES } from '../lib/skillLifecycle'
import { SKILL_SOURCE_LABELS } from '../lib/skillSource'
import { activityName, verbLabel } from '../lib/xapiStatement'
import { syncCurrentRoleLinks } from '../lib/currentRole'
import { listTags, listSkillTags, addTagToSkill, removeSkillTagLink } from '../lib/skillTags'
import { SKILL_RELATIONSHIP_LABELS } from '../lib/skillRelationships'
import { isDuplicateSkillNameError, duplicateSkillMessage } from '../lib/skillDuplicates'
import InviteRaterModal from '../components/InviteRaterModal'
import RecordExperienceModal from '../components/RecordExperienceModal'
import BaselineQuizModal from '../components/BaselineQuizModal'
import AssessBaselineModal from '../components/AssessBaselineModal'
import SetTargetModal from '../components/SetTargetModal'
import ValidateSkillModal from '../components/ValidateSkillModal'
import LifecycleStageIcon from '../components/LifecycleStageIcon'
import TagsField from '../components/TagsField'

const TABS = [
  { id: 'history', label: 'Overview' },
  { id: 'ratings', label: 'Ratings' },
  { id: 'experiences', label: 'Experiences' },
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
  const [raterAvatars, setRaterAvatars] = useState({})
  const [relationshipLinks, setRelationshipLinks] = useState([])
  const [statements, setStatements] = useState([])
  const [skillTags, setSkillTags] = useState([])
  const [allTags, setAllTags] = useState([])
  const [quizResults, setQuizResults] = useState([])
  const [targets, setTargets] = useState([])
  const [courseLinks, setCourseLinks] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [assessorName, setAssessorName] = useState(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [selfAssessOpen, setSelfAssessOpen] = useState(false)
  const [recordExperienceOpen, setRecordExperienceOpen] = useState(false)
  const [quizOpen, setQuizOpen] = useState(false)
  const [assessMode, setAssessMode] = useState(null)
  const [targetOpen, setTargetOpen] = useState(false)
  const [validateOpen, setValidateOpen] = useState(false)

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
      { data: links },
      { data: st },
      tags,
      { data: quizzes },
      { data: skillTargets },
      { data: courses },
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
          .from('skill_baseline_quizzes')
          .select('id, score, total, created_at')
          .eq('skill_id', skill.id),
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
      ])
    setHistory(assessments ?? [])
    setPeerRatings(ratings ?? [])
    setRelationshipLinks(links ?? [])
    setStatements(st ?? [])
    setTargets(skillTargets ?? [])
    setSkillTags(tags ?? [])
    setQuizResults(quizzes ?? [])
    setCourseLinks(courses ?? [])
    setLoadingHistory(false)

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

  async function handleRecordExperience(statement) {
    const { error } = await supabase.from('xapi_statements').insert({
      user_id: user.id,
      statement,
      recorded_at: statement.timestamp,
      skill_id: skill.id,
    })
    if (error) throw error
    setRecordExperienceOpen(false)
    await loadHistory()
  }

  const selfAssessedCount = history.filter((a) => a.source === 'self' || !a.source).length
  const hasAnyEvaluationInput =
    selfAssessedCount > 0 || peerRatings.length > 0 || statements.length > 0 || quizResults.length > 0
  const trainingScopeState = skill
    ? {
        skillId: skill.id,
        skillName: skill.name,
        librarySkillId: skill.library_skill_id,
        skillLevel: skill.level,
        backTo: `/skills/${skill.id}`,
      }
    : null

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
            <div className="flex items-center gap-4 mb-4">
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

            {skill.lifecycle_stage && <LifecycleProgress stage={skill.lifecycle_stage} />}

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

            {recordExperienceOpen && (
              <RecordExperienceModal
                actor={{ name: assessorName, email: user.email }}
                skills={[]}
                relatedSkill={{ id: skill.id, name: skill.name }}
                onSave={handleRecordExperience}
                onClose={() => setRecordExperienceOpen(false)}
              />
            )}

            {quizOpen && (
              <BaselineQuizModal
                skill={skill}
                user={user}
                onClose={() => setQuizOpen(false)}
                onCompleted={loadHistory}
              />
            )}

            {assessMode && (
              <AssessBaselineModal
                skill={skill}
                user={user}
                assessments={history}
                peerRatings={peerRatings}
                statements={statements}
                quizzes={quizResults}
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
                statements={statements}
                quizzes={quizResults}
                courseLinks={courseLinks}
                onClose={() => setValidateOpen(false)}
                onValidated={() => {
                  loadHistory()
                  loadSkill()
                  setValidateOpen(false)
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
                    Baseline
                  </h3>
                  <button
                    type="button"
                    onClick={() => setAssessMode('evaluate')}
                    disabled={!hasAnyEvaluationInput}
                    title={
                      !hasAnyEvaluationInput
                        ? 'Self-assess, invite a rating, record activity, or take the quiz first'
                        : undefined
                    }
                    className="w-full rounded-md bg-moss text-paper py-2.5 px-4 font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Evaluate Baseline
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
                relationshipLinks={relationshipLinks}
                statements={statements}
                courseLinks={courseLinks}
                quizResults={quizResults}
                targets={targets}
                loading={loadingHistory}
                assessorName={assessorName}
                raterAvatars={raterAvatars}
                hasAnyEvaluationInput={hasAnyEvaluationInput}
                onSelfAssess={() => setSelfAssessOpen(true)}
                onInvite={() => setInviteOpen(true)}
                onRecordExperience={() => setRecordExperienceOpen(true)}
                onQuiz={() => setQuizOpen(true)}
                onAssessBaseline={() => setAssessMode('baseline')}
                onSetTarget={() => setTargetOpen(true)}
                onFindCourse={() => navigate('/training', { state: trainingScopeState })}
                onDemonstrateSkill={handleDemonstrateSkill}
                onValidateSkillStage={handleValidateSkillStage}
                onRequestValidation={() => setValidateOpen(true)}
              />
            )}

            {tab === 'ratings' && (
              <RatingsSection peerRatings={peerRatings} loading={loadingHistory} raterAvatars={raterAvatars} />
            )}

            {tab === 'experiences' && <ExperiencesSection statements={statements} loading={loadingHistory} />}

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

function LifecycleProgress({ stage }) {
  const currentIndex = SKILL_LIFECYCLE_FLOW_STAGES.findIndex((s) => s.value === stage)
  const isException = stage === 'at_risk' || stage === 'archived'
  // Stages the learner has already moved past are dropped from view rather
  // than just dimmed -- the diagram only shows where things stand from here.
  const slicedStages = currentIndex >= 0 ? SKILL_LIFECYCLE_FLOW_STAGES.slice(currentIndex) : SKILL_LIFECYCLE_FLOW_STAGES
  // validated/maintained intentionally share a label (see skillLifecycle.js)
  // -- collapse consecutive duplicates so the diagram never repeats a chip.
  const visibleStages = slicedStages.filter((s, i) => i === 0 || s.label !== slicedStages[i - 1].label)

  return (
    <div className="mb-6">
      <div className="flex items-center flex-wrap gap-y-1">
        {visibleStages.map((s, i) => {
          const isCurrent = !isException && i === 0
          return (
            <div key={s.value} className="flex items-center">
              <span
                className={`flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide rounded-full px-2.5 py-1 border whitespace-nowrap ${
                  isCurrent
                    ? 'bg-moss text-paper border-moss'
                    : 'border-hairline text-secondary'
                }`}
              >
                <LifecycleStageIcon stage={s.value} />
                {s.label}
              </span>
              {i < visibleStages.length - 1 && <span className="w-4 h-px mx-1 shrink-0 bg-hairline" />}
            </div>
          )
        })}
      </div>
      {isException && (
        <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide text-gold border border-gold rounded-full px-2.5 py-1 mt-2">
          <LifecycleStageIcon stage={stage} />
          {SKILL_LIFECYCLE_LABELS[stage]}
        </span>
      )}
    </div>
  )
}

// A persistent row of common actions -- self-assessing, inviting a rater and
// recording experience are useful at every stage, not just while
// establishing a baseline, so these live outside the stage-specific Up Next
// checklist below. Find a course/Demonstrate Skill join the row only while
// actively working toward a target.
function QuickActionsRow({
  stage,
  hasAnyCourse,
  onSelfAssess,
  onInvite,
  onRecordExperience,
  onFindCourse,
  onDemonstrateSkill,
  onValidateSkillStage,
}) {
  const buttonClass = 'rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper'
  return (
    <div className="flex flex-wrap items-center gap-2 mb-6">
      <button type="button" onClick={onSelfAssess} className={buttonClass}>
        Self-assess
      </button>
      <button type="button" onClick={onInvite} className={buttonClass}>
        Invite someone to rate
      </button>
      <button type="button" onClick={onRecordExperience} className={buttonClass}>
        Record Experience
      </button>
      {stage === 'target_set' && (
        <button type="button" onClick={onFindCourse} className={buttonClass}>
          {hasAnyCourse ? 'Find more training' : 'Find a course'}
        </button>
      )}
      {stage === 'target_set' && (
        <button type="button" onClick={onDemonstrateSkill} className={buttonClass}>
          Demonstrate Skill
        </button>
      )}
      {stage === 'developing' && (
        <button type="button" onClick={onValidateSkillStage} className={buttonClass}>
          Validate Skill
        </button>
      )}
    </div>
  )
}

// The recommended next actions for a skill, keyed by lifecycle stage.
// Only stages with a defined next step render this section at all --
// later stages (demonstrated onward) have no single recommended action yet.
function UpNextSection({
  stage,
  selfAssessedCount,
  peerRatingsCount,
  statementsCount,
  quizCount,
  onSelfAssess,
  onInvite,
  onRecordExperience,
  onQuiz,
  onSetTarget,
  onDemonstrateSkill,
  onFindCourse,
  courseLinks,
  onValidateSkillStage,
  onRequestValidation,
  hasTarget,
}) {
  let items = []
  if (stage === 'identified') {
    items = [
      {
        key: 'self-assess',
        label: 'Self-assess your own level',
        description: 'Rate where you think you are right now.',
        done: selfAssessedCount > 0,
        onClick: onSelfAssess,
      },
      {
        key: 'invite',
        label: 'Invite others to assess your skill',
        description: 'Get an outside perspective on your level.',
        done: peerRatingsCount > 0,
        onClick: onInvite,
      },
      {
        key: 'experience',
        label: 'Add experience activity',
        description: 'Log something you did that shows this skill in action.',
        done: statementsCount > 0,
        onClick: onRecordExperience,
      },
      {
        key: 'quiz',
        label: 'Ask me questions to assess me',
        description: 'Answer a short AI-generated quiz on your baseline knowledge.',
        done: quizCount > 0,
        onClick: onQuiz,
      },
    ]
  } else if (stage === 'baseline_assessed') {
    items = [
      {
        key: 'target',
        label: 'Set a target',
        description: 'Choose a level and date you are aiming to reach next.',
        done: false,
        onClick: onSetTarget,
      },
    ]
  } else if (stage === 'target_set') {
    // "Find a course" leads while nothing is currently in progress; once at
    // least one course has ever been completed for this skill, moving on to
    // demonstrating it becomes an option too (in addition to, not instead
    // of, finding further training).
    const hasPendingCourse = courseLinks.some((link) => link.courses && !link.courses.completed_date)
    const hasCompletedCourse = courseLinks.some((link) => link.courses?.completed_date)
    items = []
    if (!hasPendingCourse) {
      items.push({
        key: 'find-course',
        label: 'Find a course',
        description: 'Browse the training catalogue for something that fits your target.',
        done: false,
        onClick: onFindCourse,
      })
    }
    if (hasCompletedCourse) {
      items.push({
        key: 'demonstrate',
        label: 'Demonstrate Skill',
        description: 'Move on to actively demonstrating this skill once you feel ready.',
        done: false,
        onClick: onDemonstrateSkill,
      })
    }
  } else if (stage === 'developing') {
    items = [
      {
        key: 'record-activity',
        label: 'Record activity',
        description: 'Log something that shows you demonstrating this skill.',
        done: false,
        onClick: onRecordExperience,
      },
      {
        key: 'self-assess-demonstrating',
        label: 'Self-assess your own level',
        description: 'Rate where you think you are now.',
        done: selfAssessedCount > 0,
        onClick: onSelfAssess,
      },
      {
        key: 'invite-demonstrating',
        label: 'Invite others to assess your skill',
        description: 'Get an outside perspective on your level.',
        done: peerRatingsCount > 0,
        onClick: onInvite,
      },
      {
        key: 'validate',
        label: 'Validate Skill',
        description: 'Move on to validating this skill against your target once you feel ready.',
        done: false,
        onClick: onValidateSkillStage,
      },
    ]
  } else if (stage === 'demonstrated') {
    items = [
      {
        key: 'invite-validating',
        label: 'Invite others to assess your skill',
        description: 'Get an outside perspective on your level.',
        done: peerRatingsCount > 0,
        onClick: onInvite,
      },
    ]
    if (hasTarget) {
      items.push({
        key: 'ai-assessment',
        label: 'Request AI Assessment',
        description: 'Weigh all your evidence against your target level and get feedback.',
        done: false,
        onClick: onRequestValidation,
      })
    }
  }

  if (items.length === 0) return null

  return (
    <div className="mb-6 rounded-md border border-hairline bg-paper p-4">
      <h3 className="font-mono text-xs uppercase tracking-wide text-secondary mb-3">Up Next</h3>
      <div className="space-y-2">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={item.onClick}
            className="w-full flex items-center justify-between gap-3 rounded-md border border-hairline bg-card px-3 py-2.5 text-left hover:border-moss transition-colors"
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
                <span className="block text-xs text-secondary truncate">{item.description}</span>
              </span>
            </div>
            <span className="shrink-0 text-xs text-moss font-medium">{item.done ? 'Redo' : 'Start'}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function SelfAssessModal({ skill, user, onClose, onAssessed }) {
  return (
    <div className="fixed inset-0 bg-ink/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        className="w-full max-w-md bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-2xl text-ink">Self-assess</h2>
          <button type="button" onClick={onClose} className="text-secondary hover:text-ink text-sm">
            Close
          </button>
        </div>
        <SelfAssessSection skill={skill} user={user} onAssessed={onAssessed} />
      </div>
    </div>
  )
}

function SelfAssessSection({ skill, user, onAssessed }) {
  const [level, setLevel] = useState(skill.level ?? 1)
  const [comments, setComments] = useState('')
  const [evidenceUrl, setEvidenceUrl] = useState('')
  const [evidenceFiles, setEvidenceFiles] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

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
      // baseline" / "Evaluate Baseline" action does that.
      if (skill.checkin_frequency_value && skill.checkin_frequency_unit) {
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
        <span className="block text-sm text-secondary mb-2">Level now</span>
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
              <GrowthRing level={l} size={36} />
              <span className="font-mono text-[10px] text-secondary">{LEVEL_LABELS[l]}</span>
            </button>
          ))}
        </div>
      </div>

      <textarea
        rows={3}
        value={comments}
        onChange={(e) => setComments(e.target.value)}
        placeholder="Why this level? What changed since last time…"
        className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
      />

      <EvidenceFields
        evidenceUrl={evidenceUrl}
        onEvidenceUrlChange={setEvidenceUrl}
        files={evidenceFiles}
        onFilesChange={setEvidenceFiles}
      />

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

const TIMELINE_DETAIL_TYPES = new Set(['assessment', 'peer', 'relationship', 'activity', 'training'])

function HistorySection({
  skill,
  history,
  peerRatings,
  relationshipLinks,
  statements,
  courseLinks,
  quizResults,
  targets,
  loading,
  assessorName,
  raterAvatars,
  hasAnyEvaluationInput,
  onSelfAssess,
  onInvite,
  onRecordExperience,
  onQuiz,
  onAssessBaseline,
  onSetTarget,
  onFindCourse,
  onDemonstrateSkill,
  onValidateSkillStage,
  onRequestValidation,
}) {
  const navigate = useNavigate()
  const due = isSelfAssessmentDue(skill.next_checkin_date)
  const currentTarget = targets[0]
  const showBaselineFlow = skill.lifecycle_stage === 'identified'
  const selfAssessedCount = history.filter((a) => a.source === 'self' || !a.source).length
  const hasAnyCourse = courseLinks.some((link) => link.courses)
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
          ...statements.map((s) => ({ type: 'activity', date: s.recorded_at, createdAt: s.created_at, statement: s })),
          ...courseLinks
            .filter((link) => link.courses?.completed_date)
            .map((link) => ({
              type: 'training',
              date: link.courses.completed_date,
              createdAt: link.created_at,
              link,
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
        const mostRecentRatingIndex = events.findIndex((e) => e.type === 'assessment' || e.type === 'peer')
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
                hasMore={pendingCourseLinks.length > 0 || events.length > 0}
                onClick={onSetTarget}
              />
            )}
            {pendingCourseLinks.map((link, i) => (
              <PendingTrainingEntry
                key={link.id}
                link={link}
                hasMore={i < pendingCourseLinks.length - 1 || events.length > 0}
                onClick={() => goToCourse(link.courses.id)}
              />
            ))}
            <UpNextSection
              stage={skill.lifecycle_stage}
              selfAssessedCount={selfAssessedCount}
              peerRatingsCount={peerRatings.length}
              statementsCount={statements.length}
              quizCount={quizResults.length}
              onSelfAssess={onSelfAssess}
              onInvite={onInvite}
              onRecordExperience={onRecordExperience}
              onQuiz={onQuiz}
              onSetTarget={onSetTarget}
              onDemonstrateSkill={onDemonstrateSkill}
              onFindCourse={onFindCourse}
              courseLinks={courseLinks}
              onValidateSkillStage={onValidateSkillStage}
              onRequestValidation={onRequestValidation}
              hasTarget={targets.length > 0}
            />
            <QuickActionsRow
              stage={skill.lifecycle_stage}
              hasAnyCourse={hasAnyCourse}
              onSelfAssess={onSelfAssess}
              onInvite={onInvite}
              onRecordExperience={onRecordExperience}
              onFindCourse={onFindCourse}
              onDemonstrateSkill={onDemonstrateSkill}
              onValidateSkillStage={onValidateSkillStage}
            />
            {events.map((event, i) => (
              <TimelineEntry
                key={event.entry?.id ?? event.rating?.id ?? event.link?.id ?? event.statement?.id ?? event.type}
                event={event}
                isLast={i === events.length - 1}
                isMostRecent={i === mostRecentRatingIndex}
                isBaseline={i === mostRecentBaselineIndex}
                assessorName={assessorName}
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
          assessorName={assessorName}
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

function TimelineEntry({
  event,
  isLast,
  isMostRecent,
  isBaseline,
  assessorName,
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
          <span className="truncate">{activityName(s.statement)}</span>
          <span className="font-mono text-[10px] text-secondary/70 shrink-0">
            {new Date(s.recorded_at).toLocaleDateString()}
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
          <span className="truncate">{course.name}</span>
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
          <div className="flex items-center justify-center w-8 h-8 rounded-full border border-hairline bg-paper">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-secondary">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </div>
          {!isLast && <span className="w-px flex-1 bg-hairline mt-1" />}
        </div>
        <div className={`min-w-0 flex-1 mb-6 ${boxClass}`}>
          <p className="text-sm font-medium text-ink">Skill added</p>
          <p className="font-mono text-xs text-secondary mt-0.5">
            {new Date(event.date).toLocaleDateString()}
          </p>
          <p className="font-mono text-[10px] text-secondary/80 mt-0.5">
            {assessorName ? `By ${assessorName}` : 'By you'}
            {event.source ? ` · ${SKILL_SOURCE_LABELS[event.source] ?? event.source}` : ''}
          </p>
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

  const entry = event.entry
  const paths = entry.evidence_paths?.length
    ? entry.evidence_paths
    : entry.evidence_path
      ? [entry.evidence_path]
      : []

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center w-12 shrink-0">
        <GrowthRing level={entry.level} size={isMostRecent ? 48 : 32} />
        {!isLast && <span className="w-px flex-1 bg-hairline mt-1" />}
      </div>
      <div
        className={`min-w-0 flex-1 mb-6 ${boxClass} ${onSelect ? 'cursor-pointer hover:border-moss/60 transition-colors' : ''}`}
        {...clickableProps}
      >
        <div className="flex items-center gap-2">
          <p className={isMostRecent ? 'text-base font-semibold text-ink' : 'text-sm font-medium text-ink'}>
            {LEVEL_LABELS[entry.level]}
          </p>
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
            AI-assessed baseline, from self-assessment, peer ratings, activity and quiz inputs
          </p>
        ) : (
          assessorName && (
            <p className="font-mono text-[10px] text-secondary/80 mt-0.5">
              Self-assessed by {assessorName}
            </p>
          )
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

function TimelineDetailModal({ event, assessorName, raterAvatars, onClose }) {
  let title = 'Details'
  let body = null

  if (event.type === 'assessment') {
    const entry = event.entry
    const paths = entry.evidence_paths?.length
      ? entry.evidence_paths
      : entry.evidence_path
        ? [entry.evidence_path]
        : []
    title = LEVEL_LABELS[entry.level]
    body = (
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <GrowthRing level={entry.level} size={48} />
          <p className="font-mono text-xs text-secondary">
            {new Date(entry.assessed_at).toLocaleDateString()}
          </p>
        </div>
        {entry.source === 'course' && entry.courses?.name ? (
          <p className="text-sm text-secondary">Earned by completing {entry.courses.name}</p>
        ) : entry.source === 'ai_baseline' ? (
          <p className="text-sm text-secondary">
            AI-assessed baseline, from self-assessment, peer ratings, activity and quiz inputs
          </p>
        ) : (
          assessorName && <p className="text-sm text-secondary">Self-assessed by {assessorName}</p>
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

function RatingsSection({ peerRatings, loading, raterAvatars }) {
  return (
    <div>
      {loading ? (
        <p className="text-sm text-secondary">Loading…</p>
      ) : peerRatings.length === 0 ? (
        <p className="text-sm text-secondary">No ratings from others yet.</p>
      ) : (
        <ul className="space-y-3">
          {peerRatings.map((rating) => (
            <li key={rating.id} className="flex items-start gap-3 bg-paper border border-hairline rounded-md p-3">
              <GrowthRing level={rating.level} size={40} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{LEVEL_LABELS[rating.level]}</p>
                <p className="font-mono text-xs text-secondary mt-0.5 flex items-center gap-1.5">
                  {new Date(rating.rated_at).toLocaleDateString()} ·
                  <RaterAvatar url={raterAvatars?.[rating.rater_id]} />
                  Rated by {rating.rater_name || rating.rater_email || 'a connection'}
                </p>
                {rating.comments && <p className="text-sm text-ink mt-1">{rating.comments}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ExperiencesSection({ statements, loading }) {
  return (
    <div>
      {loading ? (
        <p className="text-sm text-secondary">Loading…</p>
      ) : statements.length === 0 ? (
        <p className="text-sm text-secondary">Nothing recorded yet for this skill.</p>
      ) : (
        <ul className="space-y-2">
          {statements.map((s) => (
            <li key={s.id} className="bg-paper border border-hairline rounded-md px-3 py-2">
              <p className="text-sm text-ink">
                <span className="font-mono text-[10px] uppercase tracking-wide text-secondary">
                  {verbLabel(s.statement)}
                </span>{' '}
                {activityName(s.statement)}
              </p>
              <p className="font-mono text-xs text-secondary mt-0.5">
                {new Date(s.recorded_at).toLocaleDateString()}
              </p>
              {s.statement.object?.definition?.description?.['en-US'] && (
                <p className="text-sm text-ink mt-1">
                  {s.statement.object.definition.description['en-US']}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
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
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

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

  return (
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
      {error && <p className="text-sm text-red-700 mt-2">{error}</p>}
    </div>
  )
}
