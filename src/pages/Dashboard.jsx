import { useEffect, useId, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useNavVisibility } from '../context/NavVisibilityContext'
import { supabase } from '../lib/supabaseClient'
import {
  listConnections,
  listConnectionsActivity,
  listIncomingRateInvites,
  listIncomingRecommendInvites,
  getProfiles,
} from '../lib/connections'
import { listIncomingPendingValidationRequests } from '../lib/skillValidationRequests'
import { listMyAssignedCourseEmployers } from '../lib/courseCatalogue'
import AppHeader from '../components/AppHeader'
import RecordActivitySection from '../components/RecordActivitySection'
import RecordActivityModal from '../components/RecordActivityModal'
import SetTargetModal from '../components/SetTargetModal'
import InviteRaterModal from '../components/InviteRaterModal'
import FindSkillModal from '../components/FindSkillModal'
import AccessibleDialog from '../components/AccessibleDialog'
import GrowthRing from '../components/GrowthRing'
import CourseThumbnail from '../components/CourseThumbnail'
import ConnectionsActivityFeed from '../components/ConnectionsActivityFeed'
import GrowthArrow from '../components/GrowthArrow'
import { LEVEL_LABELS } from '../lib/levels'
import { computeUpNextItems } from '../lib/skillNextAction'
import { SKILL_LIFECYCLE_FLOW_STAGES } from '../lib/skillLifecycle'
import { isDiagnosticStatement } from '../lib/xapiStatement'
import { insertStatementSkillLinks } from '../lib/activitySkillLinks'
import { uploadEvidenceFiles } from '../lib/skillEvidence'
import { isSelfAssessmentDue, todayDateString } from '../lib/checkin'
import { formatRelativeDate, formatAbsoluteDate } from '../lib/dates'

// Drives the dashboard's "import your CV/history" banner -- shown until
// the learner has actually run an import once (cv_imported_at, set by
// ResumeImportReviewModal on first successful import from either the
// onboarding wizard or /profile/import) or explicitly dismissed it --
// and the "add your current role" banner, dismissible independently.
async function loadImportBannerState(userId) {
  const { data } = await supabase
    .from('profiles')
    .select('cv_imported_at, cv_import_banner_dismissed_at, current_role_banner_dismissed_at')
    .eq('id', userId)
    .single()
  return (
    data ?? {
      cv_imported_at: null,
      cv_import_banner_dismissed_at: null,
      current_role_banner_dismissed_at: null,
    }
  )
}

async function countRows(table, userId) {
  const { count } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
  return count ?? 0
}

// "In progress" isn't a stored flag anywhere -- a course counts as current
// training purely by having no completed_date, independent of whether it's
// linked to any skill (see courses/skill_course_links in the schema).
async function loadCurrentLearning(userId) {
  const { data, error } = await supabase
    .from('courses')
    .select('id, name, provider, course_type, duration, catalogue_course_id, course_catalogue(image_url, organisations(logo_url))')
    .eq('user_id', userId)
    .is('completed_date', null)
    .order('created_at', { ascending: false })
    .limit(8)
  if (error) return []
  return data ?? []
}

// Failing this shouldn't take down the rest of the dashboard -- the RPC is
// brand new and this is the one query on the page reading other people's
// data, so it's the most likely to surface an unexpected RLS/permission
// edge case in practice. The error is still reported back rather than
// swallowed, though, so a real failure isn't indistinguishable on screen
// from a connection with no activity to show.
async function loadConnectionsActivity() {
  try {
    // Fetch beyond the five visible rows so several related skill events can
    // collapse without leaving the feed unexpectedly sparse.
    return { data: await listConnectionsActivity(30), error: null }
  } catch (err) {
    return { data: [], error: err.message || 'Something went wrong.' }
  }
}

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

  const ids = skills.map((s) => s.id)
  const [
    { data: assessments },
    { data: peerRatings },
    { data: sentInvites },
    { data: statementLinks },
    { data: courseLinks },
    { data: targets },
    { data: validationRequests },
  ] = await Promise.all([
    supabase.from('skill_assessments').select('skill_id, source, axis').in('skill_id', ids),
    supabase.from('skill_peer_ratings').select('skill_id').in('skill_id', ids),
    // invite_type='rate' only -- see the matching filter in SkillDetail.jsx.
    supabase.from('connection_invites').select('skill_id').in('skill_id', ids).eq('invite_type', 'rate'),
    // Reads through xapi_statement_skills (every related skill, primary
    // included, see 20260901090000) rather than xapi_statements.skill_id
    // directly, so an activity logged against several skills counts for
    // all of them, not just whichever was picked first.
    supabase
      .from('xapi_statement_skills')
      .select('skill_id, xapi_statements(statement)')
      .eq('user_id', userId)
      .in('skill_id', ids),
    supabase.from('skill_course_links').select('skill_id, courses(completed_date)').in('skill_id', ids),
    supabase.from('skill_targets').select('skill_id').in('skill_id', ids),
    supabase.from('skill_validation_requests').select('skill_id, status').in('skill_id', ids),
  ])

  const countBy = (rows) => {
    const map = {}
    for (const r of rows ?? []) map[r.skill_id] = (map[r.skill_id] ?? 0) + 1
    return map
  }
  const selfAssessedCounts = {}
  const knowledgeSelfAssessedCounts = {}
  for (const a of assessments ?? []) {
    if (a.source !== 'self' && a.source) continue
    if (a.axis === 'knowledge') {
      knowledgeSelfAssessedCounts[a.skill_id] = (knowledgeSelfAssessedCounts[a.skill_id] ?? 0) + 1
    } else {
      selfAssessedCounts[a.skill_id] = (selfAssessedCounts[a.skill_id] ?? 0) + 1
    }
  }
  const peerCounts = countBy(peerRatings)
  const inviteCounts = countBy(sentInvites)
  // Excludes the Confirming Baseline knowledge quiz's own xAPI attempt --
  // that's knowledge-axis evidence, not practical activity (see
  // isDiagnosticStatement / SkillDetail.jsx for the full reasoning).
  const statementCounts = countBy(
    (statementLinks ?? []).filter((link) => link.xapi_statements && !isDiagnosticStatement(link.xapi_statements.statement))
  )
  const targetSkillIds = new Set((targets ?? []).map((t) => t.skill_id))
  const pendingValidationSkillIds = new Set(
    (validationRequests ?? []).filter((r) => r.status === 'pending').map((r) => r.skill_id)
  )
  const courseLinksBySkill = {}
  for (const link of courseLinks ?? []) {
    if (!courseLinksBySkill[link.skill_id]) courseLinksBySkill[link.skill_id] = []
    courseLinksBySkill[link.skill_id].push(link)
  }

  const recommendations = skills
    .map((skill) => {
      const items = computeUpNextItems({
        stage: skill.lifecycle_stage,
        selfAssessedCount: selfAssessedCounts[skill.id] ?? 0,
        knowledgeSelfAssessedCount: knowledgeSelfAssessedCounts[skill.id] ?? 0,
        hasKnowledgeLevel: Boolean(skill.knowledge_level),
        peerRatingsCount: peerCounts[skill.id] ?? 0,
        invitesSentCount: inviteCounts[skill.id] ?? 0,
        statementsCount: statementCounts[skill.id] ?? 0,
        courseLinks: courseLinksBySkill[skill.id] ?? [],
        hasTarget: targetSkillIds.has(skill.id),
        hasPendingExpertValidation: pendingValidationSkillIds.has(skill.id),
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

export default function Dashboard() {
  const { user } = useAuth()
  const { refreshNavVisibility } = useNavVisibility()
  const navigate = useNavigate()
  const [addSkillOpen, setAddSkillOpen] = useState(false)
  const [counts, setCounts] = useState(null)
  const [recentGrowth, setRecentGrowth] = useState([])
  const [upNext, setUpNext] = useState([])
  const [currentLearning, setCurrentLearning] = useState([])
  const [assignedByCatalogueId, setAssignedByCatalogueId] = useState(new Map())
  const [connectionsActivity, setConnectionsActivity] = useState([])
  const [connectionsActivityError, setConnectionsActivityError] = useState(null)
  const [upcomingSelfAssessments, setUpcomingSelfAssessments] = useState([])
  const [upcomingTargets, setUpcomingTargets] = useState([])
  const [pendingReviewTasks, setPendingReviewTasks] = useState([])
  const [importBanner, setImportBanner] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadSummary()
  }, [])

  async function loadSummary() {
    setLoading(true)
    const [
      skills,
      courses,
      experience,
      connections,
      growth,
      upNextRecommendations,
      learning,
      activityResult,
      selfAssessmentsDue,
      targetsDue,
      reviewTasks,
      importBannerState,
      assignedCourseEmployers,
    ] = await Promise.all([
      countRows('skills', user.id),
      countRows('courses', user.id),
      countRows('experience', user.id),
      listConnections(user.id).then((c) => c.length),
      loadRecentGrowth(user.id),
      loadUpNextRecommendations(user.id),
      loadCurrentLearning(user.id),
      loadConnectionsActivity(),
      loadUpcomingSelfAssessments(user.id),
      loadUpcomingTargets(user.id),
      loadPendingReviewTasks(user.id),
      loadImportBannerState(user.id),
      listMyAssignedCourseEmployers(user.id),
    ])
    setCounts({ skills, courses, experience, connections })
    setRecentGrowth(growth)
    setUpNext(upNextRecommendations)
    setCurrentLearning(learning)
    setAssignedByCatalogueId(assignedCourseEmployers)
    setConnectionsActivity(activityResult.data)
    setConnectionsActivityError(activityResult.error)
    setUpcomingSelfAssessments(selfAssessmentsDue)
    setUpcomingTargets(targetsDue)
    setPendingReviewTasks(reviewTasks)
    setImportBanner(importBannerState)
    setLoading(false)
  }

  // A quick action taken straight from an Up Next card (logging activity,
  // setting a target, an invite sent...) can change what a skill's next
  // recommended step is -- refetched on its own rather than via loadSummary
  // so the rest of the dashboard doesn't flash back to its loading skeleton
  // for what should feel like an inline update.
  async function refreshUpNext() {
    setUpNext(await loadUpNextRecommendations(user.id))
  }

  async function retryConnectionsActivity() {
    const result = await loadConnectionsActivity()
    setConnectionsActivity(result.data)
    setConnectionsActivityError(result.error)
  }

  // Best-effort, same as persistProfileFields elsewhere -- if it fails, the
  // banner just reappears next visit rather than blocking anything.
  async function dismissImportBanner() {
    setImportBanner((prev) => ({ ...prev, cv_import_banner_dismissed_at: new Date().toISOString() }))
    await supabase
      .from('profiles')
      .update({ cv_import_banner_dismissed_at: new Date().toISOString() })
      .eq('id', user.id)
  }

  async function dismissCurrentRoleBanner() {
    setImportBanner((prev) => ({ ...prev, current_role_banner_dismissed_at: new Date().toISOString() }))
    await supabase
      .from('profiles')
      .update({ current_role_banner_dismissed_at: new Date().toISOString() })
      .eq('id', user.id)
  }

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />

      <main id="main-content" tabIndex={-1} className="max-w-4xl mx-auto px-4 py-8 space-y-12">
        {!loading && importBanner && !importBanner.cv_imported_at && !importBanner.cv_import_banner_dismissed_at && (
          <ImportCvBanner onDismiss={dismissImportBanner} />
        )}

        <section aria-labelledby="dashboard-heading">
          <div className="max-w-2xl mb-7">
            <h1 id="dashboard-heading" className="font-display text-3xl sm:text-4xl text-ink text-balance">
              Keep your skills moving
            </h1>
            <p className="text-secondary mt-2 text-pretty">
              Focus on one useful step, then see how the rest of your learning is taking shape.
            </p>
          </div>

          {loading ? (
            <DashboardSkeleton />
          ) : counts.skills + counts.experience + counts.courses + counts.connections === 0 ? (
            <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
              <p className="text-secondary mb-4">
                Your profile is empty. Start by adding a skill you already have.
              </p>
              <button
                type="button"
                onClick={() => setAddSkillOpen(true)}
                className="inline-block rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90"
              >
                Add your first skill
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              <FocusPanel recommendation={upNext[0]} recentGrowth={recentGrowth[0]} />
              <OverviewStrip counts={counts} />
            </div>
          )}
        </section>

        {!loading &&
          counts.experience === 0 &&
          counts.skills + counts.courses + counts.connections > 0 &&
          !importBanner?.current_role_banner_dismissed_at && (
            <div className="rounded-lg border border-dashed border-hairline bg-card p-6 text-center">
              <h2 className="font-display text-xl text-ink mb-1">Add your current role</h2>
              <p className="text-sm text-secondary mb-4 max-w-md mx-auto text-pretty">
                Your Experience timeline is empty. Record the job you're in now so LearnScope can
                start linking your skills, courses and achievements to it.
              </p>
              <div className="flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => navigate('/experience', { state: { autoOpenType: 'employment' } })}
                  className="inline-block rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90"
                >
                  Record your current role
                </button>
                <button
                  type="button"
                  onClick={dismissCurrentRoleBanner}
                  className="text-sm text-secondary hover:text-ink whitespace-nowrap"
                >
                  Don't show this again
                </button>
              </div>
            </div>
          )}

        {!loading &&
          (upcomingSelfAssessments.length > 0 || upcomingTargets.length > 0 || pendingReviewTasks.length > 0) && (
            <div>
              <h2 className="font-display text-xl text-ink mb-6">Needs your attention</h2>
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
                {upcomingTargets.length > 0 && (
                  <ReminderGroup title="Target dates">
                    {upcomingTargets.map((t) => (
                      <ReminderRow
                        key={t.id}
                        to={`/skills/${t.skill_id}`}
                        label={`${t.skills?.name ?? 'Skill'} → ${LEVEL_LABELS[t.target_level]}`}
                        date={t.target_date}
                        overdue={t.target_date <= todayDateString()}
                      />
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

        {!loading && upNext.length > 1 && (
          <div>
            <h2 className="font-display text-xl text-ink mb-2">More ways to make progress</h2>
            <p className="text-sm text-secondary mb-6">Useful next steps across your other skills.</p>
            <UpNextSlider recommendations={upNext.slice(1)} onActionComplete={refreshUpNext} />
          </div>
        )}

        {!loading && currentLearning.length > 0 && (
          <div>
            <h2 className="font-display text-xl text-ink mb-6">Current learning</h2>
            <CurrentLearningPanel courses={currentLearning} assignedByCatalogueId={assignedByCatalogueId} />
          </div>
        )}

        {!loading && recentGrowth.length > 1 && (
          <div>
            <h2 className="font-display text-xl text-ink mb-6">More recent progress</h2>
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
                  <p
                    className="font-mono text-xs text-secondary shrink-0 self-start"
                    title={formatAbsoluteDate(row.assessed_at)}
                  >
                    {formatRelativeDate(row.assessed_at)}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        )}

        {!loading && (connectionsActivity.length > 0 || connectionsActivityError) && (
          <div>
            <h2 className="font-display text-xl text-ink mb-6">What your connections are up to</h2>
            {connectionsActivityError ? (
              <div className="flex items-center justify-between gap-3 bg-card border border-hairline rounded-lg px-4 py-3">
                <p className="text-sm text-secondary">Couldn't load your connections' activity.</p>
                <button
                  type="button"
                  onClick={retryConnectionsActivity}
                  className="shrink-0 text-sm text-moss font-medium hover:opacity-90"
                >
                  Retry
                </button>
              </div>
            ) : (
              <ConnectionsActivityFeed events={connectionsActivity} />
            )}
          </div>
        )}

        {!loading && counts.skills > 0 && <RecordActivitySection />}
      </main>

      {addSkillOpen && (
        <FindSkillModal
          onClose={() => setAddSkillOpen(false)}
          onCreated={() => {
            refreshNavVisibility()
            navigate('/skills')
          }}
        />
      )}
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Loading your dashboard…</span>
      <div aria-hidden="true" className="grid gap-4 lg:grid-cols-3 animate-pulse motion-reduce:animate-none">
        <div className="h-48 rounded-lg bg-card border border-hairline lg:col-span-2" />
        <div className="h-48 rounded-lg bg-card border border-hairline" />
        <div className="h-20 rounded-lg bg-card border border-hairline lg:col-span-3" />
      </div>
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

export function OverviewStrip({ counts }) {
  const items = [
    { to: '/skills', label: 'Skills', value: counts.skills, unit: 'tracked' },
    { to: '/experience', label: 'Experience', value: counts.experience, unit: 'entries' },
    { to: '/learning', label: 'Courses', value: counts.courses, unit: 'completed' },
    { to: '/connections', label: 'Connections', value: counts.connections, unit: 'people' },
  ]

  return (
    <div className="grid grid-cols-2 border-y border-hairline lg:grid-cols-4">
      {items.map((item, index) => (
        <Link
          key={item.to}
          to={item.to}
          className={`group flex items-baseline gap-2 py-4 hover:text-moss ${
            index % 2 === 0 ? 'pr-4' : 'pl-4'
          } ${index % 2 === 1 ? 'border-l border-hairline' : ''} ${
            index > 1 ? 'border-t border-hairline lg:border-t-0' : ''
          } ${index > 0 ? 'lg:border-l lg:pl-5' : ''}`}
        >
          <span className="font-display text-2xl text-ink group-hover:text-moss">{item.value}</span>
          <span className="min-w-0 text-sm text-secondary">
            <span className="block text-ink group-hover:text-moss">{item.label}</span>
            <span className="text-xs">{item.unit}</span>
          </span>
        </Link>
      ))}
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
          const { data } = await supabase.from('profiles').select('full_name').eq('id', user.id).single()
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
            backTo: '/dashboard',
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
    const { data, error } = await supabase
      .from('xapi_statements')
      .insert({
        user_id: user.id,
        statement,
        recorded_at: statement.timestamp,
        skill_id: skill.id,
        evidence_url: evidence?.evidenceUrl || null,
      })
      .select()
      .single()
    if (error) throw error
    await insertStatementSkillLinks(user.id, data.id, [skill.id])
    if (evidence?.files.length > 0) {
      const paths = await uploadEvidenceFiles(user.id, skill.id, data.id, evidence.files)
      const { error: updateError } = await supabase
        .from('xapi_statements')
        .update({ evidence_paths: paths })
        .eq('id', data.id)
      if (updateError) throw updateError
    }
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

function CurrentLearningPanel({ courses, assignedByCatalogueId }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {courses.map((course) => {
        const assignedByEmployer = assignedByCatalogueId?.get(course.catalogue_course_id)
        return (
          <Link
            key={course.id}
            to={`/courses/${course.id}/learn`}
            state={{ backTo: '/dashboard', backLabel: 'Dashboard' }}
            className="bg-card border border-hairline rounded-lg overflow-hidden hover:border-moss transition-colors"
          >
            <CourseThumbnail
              name={course.name}
              provider={course.provider}
              imageUrl={course.course_catalogue?.image_url}
              logoUrl={course.course_catalogue?.organisations?.logo_url}
              className="h-20 w-full"
            />
            <div className="p-3">
              {assignedByEmployer && (
                <span className="inline-block font-mono text-[10px] uppercase tracking-wide text-paper bg-moss rounded-full px-2 py-0.5 mb-1">
                  Assigned by {assignedByEmployer}
                </span>
              )}
              <h3 className="font-display text-base text-ink truncate">{course.name}</h3>
              <p className="font-mono text-xs text-secondary mt-1 truncate">
                {[course.provider, course.course_type, course.duration].filter(Boolean).join(' · ') || 'In progress'}
              </p>
            </div>
          </Link>
        )
      })}
    </div>
  )
}

function ImportCvBanner({ onDismiss }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-lg border border-hairline bg-card px-5 py-4">
      <div>
        <p className="text-sm font-medium text-ink">Have a CV or LinkedIn export handy?</p>
        <p className="text-sm text-secondary mt-0.5">
          Import it to pull in your skills, courses and experience automatically — you'll choose
          exactly what to keep before anything is saved.
        </p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <Link
          to="/profile/import"
          className="rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90 whitespace-nowrap"
        >
          Import now
        </Link>
        <button
          type="button"
          onClick={onDismiss}
          className="text-sm text-secondary hover:text-ink whitespace-nowrap"
        >
          Don't show this again
        </button>
      </div>
    </div>
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

function ReminderRow({ to, label, date, overdue = false }) {
  return (
    <Link
      to={to}
      className="flex items-center justify-between gap-3 bg-card border border-hairline rounded-lg px-4 py-3 hover:border-moss transition-colors"
    >
      <span className="text-sm text-ink truncate min-w-0">{label}</span>
      <span
        className={`font-mono text-xs shrink-0 ${overdue ? 'text-gold' : 'text-secondary'}`}
        title={formatAbsoluteDate(date)}
      >
        {formatRelativeDate(date)}
      </span>
    </Link>
  )
}
