import { useEffect, useId, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import { supabase } from '../lib/supabaseClient'
import { listIncomingRateInvites, listIncomingRecommendInvites, getProfiles } from '../lib/connections'
import { listIncomingPendingValidationRequests } from '../lib/skillValidationRequests'
import { listActiveGoalsForAttention } from '../lib/skillGoals'
import RecordActivityModal from './RecordActivityModal'
import SetTargetModal from './SetTargetModal'
import InviteRaterModal from './InviteRaterModal'
import AccessibleDialog from './AccessibleDialog'
import GrowthRing from './GrowthRing'
import GrowthArrow from './GrowthArrow'
import { LEVEL_LABELS } from '../lib/levels'
import { computeUpNextItems } from '../lib/skillNextAction'
import { SKILL_LIFECYCLE_FLOW_STAGES } from '../lib/skillLifecycle'
import { saveActivity } from '../lib/activitySkillLinks'
import { isSelfAssessmentDue, todayDateString } from '../lib/checkin'
import { formatRelativeDate, formatAbsoluteDate } from '../lib/dates'

// How far ahead a due date has to be before it's worth interrupting the
// dashboard with -- anything already overdue (next_checkin_date/target_date
// in the past) is always included regardless of this window, since that's
// even more urgent than "coming up soon".
const REMINDER_WINDOW_DAYS = 14

function reminderCutoff() {
  return new Date(Date.now() + REMINDER_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

// Skills with a scheduled self-assessment check-in that's already due or
// coming up soon -- see isSelfAssessmentDue/next_checkin_date (SkillCard
// shows the same "due" flag per-card on the skills grid; this surfaces it
// centrally instead of requiring a learner to notice it card-by-card).
async function loadUpcomingSelfAssessments(userId) {
  const { data, error } = await supabase
    .from('skills')
    .select('id, name, next_checkin_date')
    .eq('user_id', userId)
    .not('next_checkin_date', 'is', null)
    .lte('next_checkin_date', reminderCutoff())
    .order('next_checkin_date', { ascending: true })
  if (error) return []
  return data ?? []
}

// Only the most recent target per skill -- a skill can accumulate several
// targets over time (same "latest wins" pattern as latestTargetLevelBySkillId
// in SkillsSection.jsx), so an old, already-superseded target_date shouldn't
// still nag once a newer target has replaced it.
async function loadUpcomingTargets(userId) {
  const { data, error } = await supabase
    .from('skill_targets')
    .select('id, skill_id, target_level, target_date, created_at, skills(name)')
    .eq('user_id', userId)
    .not('target_date', 'is', null)
    .order('created_at', { ascending: false })
  if (error) return []
  const latestBySkill = new Map()
  for (const t of data ?? []) {
    if (!latestBySkill.has(t.skill_id)) latestBySkill.set(t.skill_id, t)
  }
  const cutoff = reminderCutoff()
  return [...latestBySkill.values()]
    .filter((t) => t.target_date <= cutoff)
    .sort((a, b) => a.target_date.localeCompare(b.target_date))
}

// "Reviews of others" -- tasks waiting on this learner to look at someone
// else's skill, not their own: an invite to rate a connection's skill, or a
// validation request naming them as the validator. Reuses the exact same
// lib functions the Actions page's own "Invitations to rate" / "Requests
// to validate" sections already fetch (see Actions.jsx) rather than a
// second implementation of the same query.
async function loadPendingReviewTasks(userId) {
  const [rateInvites, recommendInvites, validationRequests] = await Promise.all([
    listIncomingRateInvites(),
    listIncomingRecommendInvites(),
    listIncomingPendingValidationRequests(userId),
  ])
  const profiles = await getProfiles(validationRequests.map((r) => r.requester_id))
  const rateTasks = rateInvites.map((invite) => ({
    key: `rate-${invite.id}`,
    label: `Rate ${invite.inviter_name || 'someone'}'s "${invite.skill_name}"`,
    date: invite.created_at,
    to: `/rate/${invite.share_code}`,
  }))
  const recommendTasks = recommendInvites.map((invite) => ({
    key: `recommend-${invite.id}`,
    label: `${invite.inviter_name || 'Someone'} recommends you track "${invite.skill_name}"`,
    date: invite.created_at,
    to: `/recommend/${invite.share_code}`,
  }))
  const validationTasks = validationRequests.map((r) => ({
    key: `validate-${r.id}`,
    label: `Confirm ${profiles[r.requester_id]?.name || 'someone'} reached ${LEVEL_LABELS[r.target_level]} in "${r.skills?.name}"`,
    date: r.created_at,
    to: `/validate-request/${r.id}`,
  }))
  return [...rateTasks, ...recommendTasks, ...validationTasks].sort((a, b) => new Date(b.date) - new Date(a.date))
}

const RECENT_GROWTH_WINDOW_DAYS = 28

async function loadRecentGrowth(userId) {
  const cutoff = new Date(Date.now() - RECENT_GROWTH_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
  // Practical only -- the knowledge axis uses a different label scale, and
  // this widget only knows LEVEL_LABELS.
  const { data, error } = await supabase
    .from('skill_assessments')
    .select('id, skill_id, level, assessed_at, skills(name)')
    .eq('user_id', userId)
    .eq('axis', 'practical')
    .gte('assessed_at', cutoff)
    .order('assessed_at', { ascending: false })
    .limit(3)
  if (error || !data || data.length === 0) return []

  const skillIds = [...new Set(data.map((row) => row.skill_id))]

  // One extra pair of queries (not per-row) to attach what each highlighted
  // jump was *from*, and the skill's current target if it has one -- both
  // scoped to just the handful of skills already shown here.
  const [{ data: history }, { data: targets }] = await Promise.all([
    supabase
      .from('skill_assessments')
      .select('skill_id, level, assessed_at')
      .eq('user_id', userId)
      .eq('axis', 'practical')
      .in('skill_id', skillIds)
      .order('assessed_at', { ascending: true }),
    supabase
      .from('skill_targets')
      .select('skill_id, target_level, target_date')
      .eq('user_id', userId)
      .in('skill_id', skillIds)
      .order('created_at', { ascending: false }),
  ])

  // Most recent target per skill wins (a skill can accumulate several over
  // time) -- first match survives since targets is already newest-first.
  const targetBySkill = new Map()
  for (const t of targets ?? []) {
    if (!targetBySkill.has(t.skill_id)) targetBySkill.set(t.skill_id, t)
  }

  return data.map((row) => {
    const priorLevels = (history ?? []).filter(
      (h) => h.skill_id === row.skill_id && h.assessed_at < row.assessed_at
    )
    const previousLevel = priorLevels.length > 0 ? priorLevels[priorLevels.length - 1].level : null
    return { ...row, previousLevel, target: targetBySkill.get(row.skill_id) ?? null }
  })
}

const STAGE_ORDER = Object.fromEntries(SKILL_LIFECYCLE_FLOW_STAGES.map((s, i) => [s.value, i]))

// One recommended next step per skill, reusing the same priority rules as
// the skill page's own Up Next checklist (computeUpNextItems) so the two
// never disagree -- just picking the first thing not already done, across
// every skill rather than one at a time. Ordered earliest-lifecycle-stage
// first, since those skills have the least momentum behind them.
async function loadUpNextRecommendations(userId) {
  const { data: skills } = await supabase
    .from('skills')
    .select('id, name, level, lifecycle_stage, knowledge_level, library_skill_id')
    .eq('user_id', userId)
    .not('lifecycle_stage', 'is', null)
  if (!skills || skills.length === 0) return []

  // One row of counts/flags per skill, computed in the database rather than
  // downloading every assessment, rating and activity to count them here.
  const { data: progressRows, error: progressError } = await supabase.rpc('get_my_skill_progress_counts')
  if (progressError) throw progressError
  const progressBySkill = new Map((progressRows ?? []).map((row) => [row.skill_id, row]))

  const recommendations = skills
    .map((skill) => {
      const progress = progressBySkill.get(skill.id)
      const items = computeUpNextItems({
        stage: skill.lifecycle_stage,
        selfAssessedCount: progress?.self_practical_count ?? 0,
        knowledgeSelfAssessedCount: progress?.self_knowledge_count ?? 0,
        hasKnowledgeLevel: Boolean(skill.knowledge_level),
        peerRatingsCount: progress?.peer_rating_count ?? 0,
        invitesSentCount: progress?.rate_invite_count ?? 0,
        statementsCount: progress?.activity_count ?? 0,
        hasPendingCourse: progress?.has_pending_course ?? false,
        hasCompletedCourse: progress?.has_completed_course ?? false,
        hasTarget: progress?.has_target ?? false,
        hasPendingExpertValidation: progress?.has_pending_validation ?? false,
      })
      const next = items.find((item) => !item.done && !item.locked)
      return next ? { skill, item: next } : null
    })
    .filter(Boolean)

  recommendations.sort(
    (a, b) => (STAGE_ORDER[a.skill.lifecycle_stage] ?? 99) - (STAGE_ORDER[b.skill.lifecycle_stage] ?? 99)
  )

  return recommendations
}

function settled(results, index, fallback) {
  return results[index].status === 'fulfilled' ? results[index].value : fallback
}

// The top of the Skills page: one recommended next step and the latest
// progress, then what needs attention and other useful next steps across
// skills. Each part shows only when it has something to show.
export default function SkillsMomentum() {
  const { user } = useAuth()
  const { t } = useLanguage()
  const [loading, setLoading] = useState(true)
  const [recentGrowth, setRecentGrowth] = useState([])
  const [upNext, setUpNext] = useState([])
  const [upcomingSelfAssessments, setUpcomingSelfAssessments] = useState([])
  const [upcomingTargets, setUpcomingTargets] = useState([])
  const [pendingReviewTasks, setPendingReviewTasks] = useState([])
  const [goals, setGoals] = useState([])

  useEffect(() => {
    let active = true
    Promise.allSettled([
      loadRecentGrowth(user.id),
      loadUpNextRecommendations(user.id),
      loadUpcomingSelfAssessments(user.id),
      loadUpcomingTargets(user.id),
      loadPendingReviewTasks(user.id),
      listActiveGoalsForAttention(user.id),
    ]).then((results) => {
      if (!active) return
      setRecentGrowth(settled(results, 0, []))
      setUpNext(settled(results, 1, []))
      setUpcomingSelfAssessments(settled(results, 2, []))
      setUpcomingTargets(settled(results, 3, []))
      setPendingReviewTasks(settled(results, 4, []))
      setGoals(settled(results, 5, []))
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [user.id])

  // A quick action taken straight from a card (logging activity, setting a
  // target, an invite sent...) can change what a skill's next recommended
  // step is -- refetched on its own so the rest doesn't flash back to loading.
  async function refreshUpNext() {
    setUpNext(await loadUpNextRecommendations(user.id))
  }

  if (loading) return null

  const today = todayDateString()
  const goalTargetsDue = goals.filter(
    (item) => item.goal.target_date && item.goal.target_date <= reminderCutoff() && !item.progress.reached,
  )
  const targetReminders = [
    ...upcomingTargets.map((target) => ({
      key: `target-${target.id}`,
      label: `${target.skills?.name ?? 'Skill'} → ${LEVEL_LABELS[target.target_level]}`,
      to: `/skills/${target.skill_id}`,
      date: target.target_date,
    })),
    ...goalTargetsDue.map(({ goal, skill }) => ({
      key: `goal-target-${goal.id}`,
      label: `${goal.title} · ${skill.name}`,
      to: `/skills/${skill.id}`,
      date: goal.target_date,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date))
  const hasFocus = upNext.length > 0 || recentGrowth.length > 0
  const hasReminders = upcomingSelfAssessments.length > 0 || targetReminders.length > 0 || pendingReviewTasks.length > 0

  if (!hasFocus && !hasReminders) return null

  return (
    <div className="mb-10 space-y-10">
      {hasFocus && (
        <section aria-labelledby="skills-momentum-heading">
          <h2 id="skills-momentum-heading" className="font-display text-2xl text-ink text-balance">
            {t('dashboard.heading')}
          </h2>
          <p className="text-sm text-secondary mt-1 mb-5 text-pretty">{t('dashboard.subheading')}</p>
          <FocusPanel recommendation={upNext[0]} recentGrowth={recentGrowth[0]} />
        </section>
      )}

      {hasReminders && (
        <div>
          <h2 className="font-display text-xl text-ink mb-6">{t('dashboard.needsAttention')}</h2>
          <div className="space-y-6">
            {upcomingSelfAssessments.length > 0 && (
              <ReminderGroup title="Self-assessments due">
                {upcomingSelfAssessments.map((s) => (
                  <ReminderRow
                    key={s.id}
                    to={`/skills/${s.id}`}
                    label={s.name}
                    date={s.next_checkin_date}
                    overdue={isSelfAssessmentDue(s.next_checkin_date)}
                  />
                ))}
              </ReminderGroup>
            )}
            {targetReminders.length > 0 && (
              <ReminderGroup title="Target dates">
                {targetReminders.map((row) => (
                  <ReminderRow key={row.key} to={row.to} label={row.label} date={row.date} overdue={row.date <= today} />
                ))}
              </ReminderGroup>
            )}
            {pendingReviewTasks.length > 0 && (
              <ReminderGroup title="Waiting on your review">
                {pendingReviewTasks.map((task) => (
                  <ReminderRow key={task.key} to={task.to} label={task.label} date={task.date} />
                ))}
              </ReminderGroup>
            )}
          </div>
        </div>
      )}

      {upNext.length > 1 && (
        <div>
          <h2 className="font-display text-xl text-ink mb-2">{t('dashboard.moreWaysToProgress')}</h2>
          <p className="text-sm text-secondary mb-6">Useful next steps across your other skills.</p>
          <UpNextSlider recommendations={upNext.slice(1)} onActionComplete={refreshUpNext} />
        </div>
      )}

      {recentGrowth.length > 1 && (
        <div>
          <h2 className="font-display text-xl text-ink mb-6">{t('dashboard.moreRecentProgress')}</h2>
          <div className="space-y-3">
            {recentGrowth.slice(1).map((row) => (
              <Link
                key={row.id}
                to={`/skills/${row.skill_id}`}
                className="flex items-center gap-4 bg-card border border-hairline rounded-lg px-4 py-4 hover:border-moss transition-colors"
              >
                <div className="flex items-center gap-2 shrink-0">
                  <GrowthRing level={row.previousLevel} size={38} color="var(--color-hairline)" />
                  <GrowthArrow />
                  <GrowthRing level={row.level} size={56} targetLevel={row.target?.target_level} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink truncate">{row.skills?.name ?? 'Skill'}</p>
                  <p className="text-sm">
                    <span className="text-secondary">
                      {row.previousLevel ? LEVEL_LABELS[row.previousLevel] : 'New'} →{' '}
                    </span>
                    <span className="text-ink font-medium">{LEVEL_LABELS[row.level]}</span>
                  </p>
                  {row.target && (
                    <p
                      className="font-mono text-[11px] uppercase tracking-wide text-secondary mt-1"
                      title={formatAbsoluteDate(row.target.target_date)}
                    >
                      Target: {LEVEL_LABELS[row.target.target_level]} ·{' '}
                      {formatRelativeDate(row.target.target_date)}
                    </p>
                  )}
                </div>
                <p className="font-mono text-xs text-secondary shrink-0 self-start" title={formatAbsoluteDate(row.assessed_at)}>
                  {formatRelativeDate(row.assessed_at)}
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function FocusPanel({ recommendation, recentGrowth: growth }) {
  const hasGrowth = Boolean(growth)

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className={`rounded-lg bg-moss text-paper p-6 sm:p-8 ${hasGrowth ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
        <h2 className="font-display text-2xl sm:text-3xl text-balance">
          {recommendation ? recommendation.item.label : 'Choose where to grow next'}
        </h2>
        <p className="mt-3 max-w-xl text-sm sm:text-base text-paper">
          {recommendation
            ? `${recommendation.item.description} Keep ${recommendation.skill.name} moving forward with this next step.`
            : 'Review your skills and choose the one that matters most right now.'}
        </p>
        <Link
          to={recommendation ? `/skills/${recommendation.skill.id}` : '/skills'}
          className="inline-flex items-center rounded-md bg-paper text-ink px-4 py-2.5 mt-6 text-sm font-medium hover:opacity-90"
        >
          {recommendation ? `Continue with ${recommendation.skill.name}` : 'Review your skills'}
          <span aria-hidden="true" className="ml-2">→</span>
        </Link>
      </div>

      {growth && (
        <Link
          to={`/skills/${growth.skill_id}`}
          className="rounded-lg border border-hairline bg-card p-6 hover:border-moss transition-colors"
        >
          <h2 className="font-display text-xl text-ink">Your latest progress</h2>
          <div className="flex items-center gap-3 mt-5">
            <GrowthRing level={growth.previousLevel} size={42} color="var(--color-hairline)" />
            <GrowthArrow />
            <GrowthRing level={growth.level} size={58} targetLevel={growth.target?.target_level} />
          </div>
          <p className="font-medium text-ink mt-4 truncate">{growth.skills?.name ?? 'Skill'}</p>
          <p className="text-sm text-secondary mt-1">
            {growth.previousLevel ? LEVEL_LABELS[growth.previousLevel] : 'New'} → {LEVEL_LABELS[growth.level]}
          </p>
          <p className="font-mono text-xs text-secondary mt-3" title={formatAbsoluteDate(growth.assessed_at)}>
            {formatRelativeDate(growth.assessed_at)}
          </p>
        </Link>
      )}
    </div>
  )
}

// Shared by every horizontally scrollable row on this page (native scroll
// snapping rather than a JS carousel, so it degrades to a plain scrollable
// list anywhere the extras below don't apply). The scrollbar itself is
// hidden (see .scrollbar-hide in index.css). This redirects ordinary
// vertical mouse-wheel input into horizontal scroll while hovering --
// desktop mice only have a vertical wheel, so without this a mouse user
// would have no way to move the slider at all once the scrollbar is hidden
// -- and also tracks scroll position so callers can show/hide click-to-
// scroll arrows for trackpads/mice with no horizontal input at all.
function useHorizontalScroller() {
  const scrollerRef = useRef(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return

    function updateEdges() {
      setCanScrollLeft(el.scrollLeft > 0)
      setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
    }

    function handleWheel(e) {
      if (e.deltaY === 0) return
      // Let the wheel event fall through to normal page scroll once the
      // slider is already at the end in that direction, rather than
      // trapping it -- so scrolling past this section still just scrolls
      // the page.
      const atStart = el.scrollLeft <= 0
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1
      if ((e.deltaY < 0 && atStart) || (e.deltaY > 0 && atEnd)) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }

    updateEdges()
    el.addEventListener('wheel', handleWheel, { passive: false })
    el.addEventListener('scroll', updateEdges, { passive: true })
    window.addEventListener('resize', updateEdges)
    return () => {
      el.removeEventListener('wheel', handleWheel)
      el.removeEventListener('scroll', updateEdges)
      window.removeEventListener('resize', updateEdges)
    }
  }, [])

  function scrollByPage(direction) {
    const el = scrollerRef.current
    if (!el) return
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: 'smooth' })
  }

  return { scrollerRef, canScrollLeft, canScrollRight, scrollByPage }
}

function SliderArrow({ direction, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={direction === 'left' ? 'Scroll left' : 'Scroll right'}
      className={`hidden sm:flex absolute top-1/2 -translate-y-1/2 z-10 items-center justify-center w-8 h-8 rounded-full bg-card border border-hairline shadow-sm hover:border-moss ${
        direction === 'left' ? '-left-3' : '-right-3'
      }`}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--color-ink)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={direction === 'left' ? { transform: 'scaleX(-1)' } : undefined}
      >
        <polyline points="9 6 15 12 9 18" />
      </svg>
    </button>
  )
}

// Above 5 cards, skills sharing the same recommended action (e.g. several
// skills all needing "Self-assess your own level") collapse into a single
// action-focused card instead of each getting its own near-duplicate card --
// an action used by only one skill still gets its normal skill-focused card,
// so the slider ends up with mixed card types rather than all-or-nothing.
// Below the threshold, one card per skill (unchanged) reads fine on its own.
const UPNEXT_GROUPING_THRESHOLD = 5

function buildUpNextSlides(recommendations) {
  if (recommendations.length <= UPNEXT_GROUPING_THRESHOLD) {
    return recommendations.map((rec) => ({ type: 'skill', skill: rec.skill, item: rec.item }))
  }

  // Same action (e.g. "Self-assess your own level") can come from different
  // lifecycle stages with slightly different item.key/description --
  // grouping by label is what reads as "one action" to the learner, so the
  // first description seen for a label wins rather than trying to reconcile
  // them. Insertion order follows upNext's existing stage-priority sort, so
  // the most-urgent actions still lead.
  const groups = new Map()
  for (const rec of recommendations) {
    const { label, description } = rec.item
    if (!groups.has(label)) groups.set(label, { label, description, recs: [] })
    groups.get(label).recs.push(rec)
  }

  return [...groups.values()].map((group) =>
    group.recs.length === 1
      ? { type: 'skill', skill: group.recs[0].skill, item: group.recs[0].item }
      : { type: 'action', label: group.label, description: group.description, recs: group.recs }
  )
}

function UpNextSlider({ recommendations, onActionComplete }) {
  const { scrollerRef, canScrollLeft, canScrollRight, scrollByPage } = useHorizontalScroller()
  const slides = buildUpNextSlides(recommendations)

  return (
    <div className="relative">
      {canScrollLeft && <SliderArrow direction="left" onClick={() => scrollByPage(-1)} />}
      <div
        ref={scrollerRef}
        className="scrollbar-hide flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 -mx-4 px-4 sm:mx-0 sm:px-0"
      >
        {slides.map((slide) =>
          slide.type === 'skill' ? (
            <UpNextActionTrigger
              key={slide.skill.id}
              skill={slide.skill}
              item={slide.item}
              onDone={onActionComplete}
              className="snap-start shrink-0 w-64 bg-card border border-hairline rounded-lg p-4 text-left hover:border-moss transition-colors"
            >
              <div className="flex items-center gap-3 mb-3">
                <GrowthRing level={slide.skill.level} size={40} />
                <h3 className="font-display text-base text-ink truncate min-w-0">{slide.skill.name}</h3>
              </div>
              <p className="text-sm text-ink font-medium">{slide.item.label}</p>
              <p className="text-xs text-secondary mt-1">{slide.item.description}</p>
            </UpNextActionTrigger>
          ) : (
            <div
              key={`action-${slide.label}`}
              className="snap-start shrink-0 w-64 bg-card border border-hairline rounded-lg p-4"
            >
              <h3 className="font-display text-base text-ink">{slide.label}</h3>
              <p className="text-xs text-secondary mt-1 mb-3">{slide.description}</p>
              <ActionSkillsButton label={slide.label} recs={slide.recs} onActionComplete={onActionComplete} />
            </div>
          )
        )}
      </div>
      {canScrollRight && <SliderArrow direction="right" onClick={() => scrollByPage(1)} />}
    </div>
  )
}

// Actions with a clear, self-contained existing modal (or a one-click stage
// update the skill page already performs with no confirmation step -- see
// handleDemonstrateSkill/handleValidateSkillStage in SkillDetail.jsx) get
// triggered right from the card instead of detouring through the skill
// page just to click the same thing again. Item keys without a direct
// equivalent here (self-assessment, the knowledge quiz, requesting
// validation/AI assessment) lean on richer page state -- assessment
// history, AI-generated guide text -- that isn't worth duplicating for a
// dashboard shortcut, so those keep navigating to the skill page as before.
const DIRECT_UPNEXT_ACTION_KEYS = new Set([
  'activity',
  'record-activity',
  'target',
  'invite',
  'invite-demonstrating',
  'invite-validating',
  'find-course',
  'demonstrate',
  'validate',
])

function UpNextActionTrigger({ skill, item, className, children, onDone }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [recordActivityOpen, setRecordActivityOpen] = useState(false)
  const [targetOpen, setTargetOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [actorName, setActorName] = useState('')
  const [targets, setTargets] = useState([])
  const [busy, setBusy] = useState(false)

  async function handleClick() {
    switch (item.key) {
      case 'activity':
      case 'record-activity': {
        if (!actorName) {
          const { data } = await supabase.rpc('get_my_profile').select('full_name').single()
          setActorName(data?.full_name || user.email)
        }
        setRecordActivityOpen(true)
        return
      }
      case 'target': {
        const { data } = await supabase
          .from('skill_targets')
          .select('*')
          .eq('skill_id', skill.id)
          .order('created_at', { ascending: false })
        setTargets(data ?? [])
        setTargetOpen(true)
        return
      }
      case 'invite':
      case 'invite-demonstrating':
      case 'invite-validating':
        setInviteOpen(true)
        return
      case 'find-course':
        navigate('/training', {
          state: {
            skillId: skill.id,
            skillName: skill.name,
            librarySkillId: skill.library_skill_id,
            skillLevel: skill.level,
            backTo: '/skills',
          },
        })
        return
      case 'demonstrate':
        setBusy(true)
        await supabase.from('skills').update({ lifecycle_stage: 'developing' }).eq('id', skill.id)
        setBusy(false)
        onDone?.()
        return
      case 'validate':
        setBusy(true)
        await supabase.from('skills').update({ lifecycle_stage: 'demonstrated' }).eq('id', skill.id)
        setBusy(false)
        onDone?.()
        return
      default:
        navigate(`/skills/${skill.id}`)
    }
  }

  async function handleSaveActivity(statement, evidence) {
    await saveActivity({ userId: user.id, statement, evidence, skillIds: [skill.id] })
    setRecordActivityOpen(false)
    onDone?.()
  }

  if (!DIRECT_UPNEXT_ACTION_KEYS.has(item.key)) {
    return (
      <Link to={`/skills/${skill.id}`} className={className}>
        {children}
      </Link>
    )
  }

  return (
    <>
      <button type="button" onClick={handleClick} disabled={busy} className={className}>
        {children}
      </button>

      {recordActivityOpen && (
        <RecordActivityModal
          actor={{ name: actorName, email: user.email }}
          skills={[]}
          relatedSkill={{ id: skill.id, name: skill.name }}
          onSave={handleSaveActivity}
          onClose={() => setRecordActivityOpen(false)}
        />
      )}
      {targetOpen && (
        <SetTargetModal
          skill={skill}
          user={user}
          targets={targets}
          currentLevel={skill.level}
          onClose={() => setTargetOpen(false)}
          onSet={() => {
            setTargetOpen(false)
            onDone?.()
          }}
        />
      )}
      {inviteOpen && (
        <InviteRaterModal
          skill={skill}
          onClose={() => {
            setInviteOpen(false)
            onDone?.()
          }}
        />
      )}
    </>
  )
}

// Stands in for the skill-focused card's own Link when one action is shared
// by several skills -- picking a skill from here is what replaces having
// them all listed out on the card at once.
// A dropdown anchored to the button would get clipped by the slider's own
// scroll container -- overflow-x-auto forces overflow-y to auto too (they
// can't be visible/auto independently), so anything taller than the row
// gets cut off and can even shift the row's scroll position. A dialog
// avoids that entirely since its fixed overlay isn't part of the row's
// layout or clipping box.
function ActionSkillsButton({ label, recs, onActionComplete }) {
  const [open, setOpen] = useState(false)
  const titleId = useId()

  function handleDone() {
    setOpen(false)
    onActionComplete?.()
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`Choose a skill for: ${label}`}
        className="text-sm font-medium text-moss hover:opacity-80"
      >
        {recs.length} skills
      </button>
      {open && (
        <AccessibleDialog
          labelledBy={titleId}
          onClose={() => setOpen(false)}
          panelClassName="w-full max-w-sm bg-card border border-hairline rounded-lg p-6 max-h-[85vh] overflow-y-auto overscroll-contain"
        >
          <h2 id={titleId} className="font-display text-lg text-ink mb-1">
            {label}
          </h2>
          <p className="text-sm text-secondary mb-4">Choose which skill to continue with.</p>
          <div className="space-y-2">
            {recs.map(({ skill, item }) => (
              <UpNextActionTrigger
                key={skill.id}
                skill={skill}
                item={item}
                onDone={handleDone}
                className="flex items-center gap-3 border border-hairline rounded-md p-2.5 text-left w-full hover:border-moss transition-colors"
              >
                <GrowthRing level={skill.level} size={28} />
                <span className="text-sm text-ink">{skill.name}</span>
              </UpNextActionTrigger>
            ))}
          </div>
        </AccessibleDialog>
      )}
    </>
  )
}

function ReminderGroup({ title, children }) {
  return (
    <div>
      <h3 className="font-mono text-[11px] uppercase tracking-wide text-secondary mb-2">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

// A link to where the reminder is dealt with, or a button when it can be dealt
// with right here on the dashboard (logging a goal).
function ReminderRow({ to, onClick, label, date, overdue = false }) {
  const className =
    'flex w-full items-center justify-between gap-3 bg-card border border-hairline rounded-lg px-4 py-3 text-left hover:border-moss transition-colors'
  const content = (
    <>
      <span className="text-sm text-ink truncate min-w-0">{label}</span>
      <span
        className={`font-mono text-xs shrink-0 ${overdue ? 'text-gold' : 'text-secondary'}`}
        title={formatAbsoluteDate(date)}
      >
        {formatRelativeDate(date)}
      </span>
    </>
  )
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {content}
      </button>
    )
  }
  return (
    <Link to={to} className={className}>
      {content}
    </Link>
  )
}
