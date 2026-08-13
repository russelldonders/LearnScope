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
import {
  SKILL_LIFECYCLE_LABELS,
  SKILL_LIFECYCLE_FLOW_STAGES,
  SKILL_LIFECYCLE_ACTIVITY_LABELS,
} from '../lib/skillLifecycle'
import { SKILL_SOURCE_LABELS } from '../lib/skillSource'
import { activityName, verbLabel } from '../lib/xapiStatement'
import { syncCurrentRoleLinks } from '../lib/currentRole'
import { listTags, listSkillTags, addTagToSkill, removeSkillTagLink } from '../lib/skillTags'
import { isDuplicateSkillNameError, duplicateSkillMessage } from '../lib/skillDuplicates'
import InviteRaterModal from '../components/InviteRaterModal'
import RecordExperienceModal from '../components/RecordExperienceModal'
import BaselineQuizModal from '../components/BaselineQuizModal'
import TagsField from '../components/TagsField'

const TABS = [
  { id: 'history', label: 'Overview' },
  { id: 'ratings', label: 'Ratings' },
  { id: 'experiences', label: 'Experiences' },
  { id: 'details', label: 'Details' },
  { id: 'settings', label: 'Settings' },
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
  const [relationshipLinks, setRelationshipLinks] = useState([])
  const [statements, setStatements] = useState([])
  const [skillTags, setSkillTags] = useState([])
  const [allTags, setAllTags] = useState([])
  const [quizResults, setQuizResults] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [assessorName, setAssessorName] = useState(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [selfAssessOpen, setSelfAssessOpen] = useState(false)
  const [recordExperienceOpen, setRecordExperienceOpen] = useState(false)
  const [quizOpen, setQuizOpen] = useState(false)

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
    const [{ data: assessments }, { data: ratings }, { data: links }, { data: st }, tags, { data: quizzes }] =
      await Promise.all([
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
          .select('id, experience(id, title, organization, type, start_date, end_date)')
          .eq('skill_id', skill.id),
        supabase
          .from('xapi_statements')
          .select('*')
          .eq('skill_id', skill.id)
          .eq('user_id', user.id)
          .order('recorded_at', { ascending: false }),
        listSkillTags(skill.id),
        supabase.from('skill_baseline_quizzes').select('id').eq('skill_id', skill.id),
      ])
    setHistory(assessments ?? [])
    setPeerRatings(ratings ?? [])
    setRelationshipLinks(links ?? [])
    setStatements(st ?? [])
    setSkillTags(tags ?? [])
    setQuizResults(quizzes ?? [])
    setLoadingHistory(false)
  }

  async function handleAddTag(tagName) {
    await addTagToSkill(user.id, skill.id, tagName)
    await loadHistory()
  }

  async function handleRemoveTag(skillTagLinkId) {
    await removeSkillTagLink(skillTagLinkId)
    await loadHistory()
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
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-4">
                <GrowthRing level={skill.level} size={56} />
                <div>
                  <h2 className="font-display text-2xl text-ink">{skill.name}</h2>
                  <p className="text-sm text-secondary">
                    {skill.level
                      ? LEVEL_LABELS[skill.level]
                      : skill.lifecycle_stage
                        ? (SKILL_LIFECYCLE_ACTIVITY_LABELS[skill.lifecycle_stage] ??
                          SKILL_LIFECYCLE_LABELS[skill.lifecycle_stage])
                        : 'Not yet self-assessed'}
                  </p>
                  {skillTags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {skillTags.map((t) => (
                        <span
                          key={t.id}
                          className="font-mono text-[10px] uppercase tracking-wide text-secondary border border-hairline rounded-full px-2 py-0.5"
                        >
                          {t.tags?.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {skill.lifecycle_stage && <LifecycleProgress stage={skill.lifecycle_stage} />}

            {skill.lifecycle_stage === 'identified' && (
              <BaselineChecklist
                skill={skill}
                peerRatingsCount={peerRatings.length}
                statementsCount={statements.length}
                quizCount={quizResults.length}
                onSelfAssess={() => setSelfAssessOpen(true)}
                onInvite={() => setInviteOpen(true)}
                onRecordExperience={() => setRecordExperienceOpen(true)}
                onQuiz={() => setQuizOpen(true)}
              />
            )}

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

            <div className="flex items-center gap-1 border-b border-hairline mb-4 overflow-x-auto">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`shrink-0 px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
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
            )}

            {tab === 'history' && (
              <HistorySection
                skill={skill}
                history={history}
                peerRatings={peerRatings}
                relationshipLinks={relationshipLinks}
                loading={loadingHistory}
                assessorName={assessorName}
              />
            )}

            {tab === 'ratings' && <RatingsSection peerRatings={peerRatings} loading={loadingHistory} />}

            {tab === 'experiences' && (
              <ExperiencesSection statements={statements} loading={loadingHistory} />
            )}

            {tab === 'settings' && (
              <div className="space-y-6">
                <SettingsSection skill={skill} onUpdated={loadSkill} />
                <ScheduleSection skill={skill} onUpdated={loadSkill} />
              </div>
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

  return (
    <div className="mb-6">
      <div className="flex items-center overflow-x-auto pb-1">
        {SKILL_LIFECYCLE_FLOW_STAGES.map((s, i) => {
          const isCurrent = !isException && i === currentIndex
          const isPast = !isException && currentIndex >= 0 && i < currentIndex
          return (
            <div key={s.value} className="flex items-center shrink-0">
              <span
                className={`font-mono text-[10px] uppercase tracking-wide rounded-full px-2.5 py-1 border whitespace-nowrap ${
                  isCurrent
                    ? 'bg-moss text-paper border-moss'
                    : isPast
                      ? 'border-moss text-moss'
                      : 'border-hairline text-secondary'
                }`}
              >
                {s.label}
              </span>
              {i < SKILL_LIFECYCLE_FLOW_STAGES.length - 1 && (
                <span className={`w-4 h-px mx-1 shrink-0 ${isPast ? 'bg-moss' : 'bg-hairline'}`} />
              )}
            </div>
          )
        })}
      </div>
      {isException && (
        <span className="inline-block font-mono text-[10px] uppercase tracking-wide text-gold border border-gold rounded-full px-2.5 py-1 mt-2">
          {SKILL_LIFECYCLE_LABELS[stage]}
        </span>
      )}
    </div>
  )
}

function BaselineChecklist({
  skill,
  peerRatingsCount,
  statementsCount,
  quizCount,
  onSelfAssess,
  onInvite,
  onRecordExperience,
  onQuiz,
}) {
  const items = [
    {
      key: 'self-assess',
      label: 'Self-assess your own level',
      description: 'Rate where you think you are right now.',
      done: Boolean(skill.level),
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

  return (
    <div className="mb-6 rounded-md border border-hairline bg-paper p-4">
      <h3 className="font-mono text-xs uppercase tracking-wide text-secondary mb-3">
        Baseline checklist
      </h3>
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

      const skillUpdate = { level }
      if (skill.checkin_frequency_value && skill.checkin_frequency_unit) {
        skillUpdate.next_checkin_date = computeNextSelfAssessmentDate(
          null,
          skill.checkin_frequency_value,
          skill.checkin_frequency_unit
        )
      }
      const { error: skillError } = await supabase
        .from('skills')
        .update(skillUpdate)
        .eq('id', skill.id)
      if (skillError) throw skillError

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

function HistorySection({ skill, history, peerRatings, relationshipLinks, loading, assessorName }) {
  const due = isSelfAssessmentDue(skill.next_checkin_date)

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
        const events = [
          ...history.map((entry) => ({ type: 'assessment', date: entry.assessed_at, entry })),
          ...peerRatings.map((rating) => ({ type: 'peer', date: rating.rated_at, rating })),
          ...relationshipLinks
            .filter((link) => link.experience)
            .map((link) => ({ type: 'relationship', date: link.experience.start_date, link })),
          { type: 'added', date: skill.date_added, source: skill.source },
        ].sort((a, b) => new Date(b.date) - new Date(a.date))
        const mostRecentRatingIndex = events.findIndex((e) => e.type === 'assessment' || e.type === 'peer')

        return (
          <div>
            {events.map((event, i) => (
              <TimelineEntry
                key={
                  event.type === 'added'
                    ? 'added'
                    : (event.entry ?? event.rating ?? event.link).id
                }
                event={event}
                isLast={i === events.length - 1}
                isMostRecent={i === mostRecentRatingIndex}
                assessorName={assessorName}
              />
            ))}
          </div>
        )
      })()}
    </div>
  )
}

function TimelineEntry({ event, isLast, isMostRecent, assessorName }) {
  const boxClass = isMostRecent
    ? 'rounded-md border border-moss/40 bg-moss/5 p-3'
    : 'rounded-md border border-hairline bg-paper p-3'

  if (event.type === 'added') {
    return (
      <div className="flex gap-3">
        <div className="flex flex-col items-center">
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
        <div className="flex flex-col items-center">
          <GrowthRing level={rating.level} size={isMostRecent ? 48 : 32} />
          {!isLast && <span className="w-px flex-1 bg-hairline mt-1" />}
        </div>
        <div className={`min-w-0 flex-1 mb-6 ${boxClass}`}>
          <div className="flex items-center gap-2">
            <p className={isMostRecent ? 'text-base font-semibold text-ink' : 'text-sm font-medium text-ink'}>
              {LEVEL_LABELS[rating.level]}
            </p>
            {isMostRecent && (
              <span className="font-mono text-[10px] uppercase tracking-wide text-moss border border-moss rounded-full px-2 py-0.5">
                Current
              </span>
            )}
          </div>
          <p className="font-mono text-xs text-secondary mt-0.5">
            {new Date(rating.rated_at).toLocaleDateString()}
          </p>
          <p className="font-mono text-[10px] text-secondary/80 mt-0.5">
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
        <div className="flex flex-col items-center">
          <div className="flex items-center justify-center w-8 h-8 rounded-full border border-hairline bg-paper">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-secondary">
              <path d="M3 7l9-4 9 4-9 4-9-4z" />
              <path d="M3 12l9 4 9-4" />
              <path d="M3 17l9 4 9-4" />
            </svg>
          </div>
          {!isLast && <span className="w-px flex-1 bg-hairline mt-1" />}
        </div>
        <div className="min-w-0 flex-1 mb-6 rounded-md border border-hairline bg-paper p-3">
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
      <div className="flex flex-col items-center">
        <GrowthRing level={entry.level} size={isMostRecent ? 48 : 32} />
        {!isLast && <span className="w-px flex-1 bg-hairline mt-1" />}
      </div>
      <div className={`min-w-0 flex-1 mb-6 ${boxClass}`}>
        <div className="flex items-center gap-2">
          <p className={isMostRecent ? 'text-base font-semibold text-ink' : 'text-sm font-medium text-ink'}>
            {LEVEL_LABELS[entry.level]}
          </p>
          {isMostRecent && (
            <span className="font-mono text-[10px] uppercase tracking-wide text-moss border border-moss rounded-full px-2 py-0.5">
              Current
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
    </div>
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
          className="rounded-md border border-hairline text-red-700 py-1.5 px-3 text-sm hover:bg-paper disabled:opacity-60"
        >
          Delete skill
        </button>
      </div>
    </form>
  )
}

function RatingsSection({ peerRatings, loading }) {
  if (loading) return <p className="text-sm text-secondary">Loading…</p>
  if (peerRatings.length === 0) {
    return (
      <p className="text-sm text-secondary">
        No ratings from others yet. Invite someone to rate this skill.
      </p>
    )
  }
  return (
    <ul className="space-y-3">
      {peerRatings.map((rating) => (
        <li key={rating.id} className="flex items-start gap-3 bg-paper border border-hairline rounded-md p-3">
          <GrowthRing level={rating.level} size={40} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink">{LEVEL_LABELS[rating.level]}</p>
            <p className="font-mono text-xs text-secondary mt-0.5">
              {new Date(rating.rated_at).toLocaleDateString()} · Rated by{' '}
              {rating.rater_name || rating.rater_email || 'a connection'}
            </p>
            {rating.comments && <p className="text-sm text-ink mt-1">{rating.comments}</p>}
          </div>
        </li>
      ))}
    </ul>
  )
}

function ExperiencesSection({ statements, loading }) {
  return (
    <div>
      <h4 className="font-mono text-xs uppercase tracking-wide text-secondary mb-3">Experiences</h4>

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
