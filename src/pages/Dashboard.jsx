import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import { listConnections, listConnectionsActivity } from '../lib/connections'
import AppHeader from '../components/AppHeader'
import RecordActivitySection from '../components/RecordActivitySection'
import GrowthRing from '../components/GrowthRing'
import CourseThumbnail from '../components/CourseThumbnail'
import PersonAvatar from '../components/PersonAvatar'
import { LEVEL_LABELS } from '../lib/levels'
import { computeUpNextItems } from '../lib/skillNextAction'
import { SKILL_LIFECYCLE_FLOW_STAGES } from '../lib/skillLifecycle'
import { isDiagnosticStatement } from '../lib/xapiStatement'

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
    .select('id, name, provider, course_type, duration')
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
// edge case in practice.
async function loadConnectionsActivity() {
  try {
    return await listConnectionsActivity(20)
  } catch {
    return []
  }
}

async function loadRecentGrowth(userId) {
  // Practical only -- the knowledge axis uses a different label scale, and
  // this widget only knows LEVEL_LABELS.
  const { data, error } = await supabase
    .from('skill_assessments')
    .select('id, skill_id, level, assessed_at, skills(name)')
    .eq('user_id', userId)
    .eq('axis', 'practical')
    .order('assessed_at', { ascending: false })
    .limit(3)
  if (error) return []
  return data ?? []
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
    .select('id, name, level, lifecycle_stage, knowledge_level')
    .eq('user_id', userId)
    .not('lifecycle_stage', 'is', null)
  if (!skills || skills.length === 0) return []

  const ids = skills.map((s) => s.id)
  const [
    { data: assessments },
    { data: peerRatings },
    { data: sentInvites },
    { data: statements },
    { data: courseLinks },
    { data: targets },
    { data: validationRequests },
  ] = await Promise.all([
    supabase.from('skill_assessments').select('skill_id, source, axis').in('skill_id', ids),
    supabase.from('skill_peer_ratings').select('skill_id').in('skill_id', ids),
    supabase.from('connection_invites').select('skill_id').in('skill_id', ids),
    supabase.from('xapi_statements').select('skill_id, statement').eq('user_id', userId).in('skill_id', ids),
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
  const statementCounts = countBy((statements ?? []).filter((s) => !isDiagnosticStatement(s.statement)))
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
  const [counts, setCounts] = useState(null)
  const [recentGrowth, setRecentGrowth] = useState([])
  const [upNext, setUpNext] = useState([])
  const [currentLearning, setCurrentLearning] = useState([])
  const [connectionsActivity, setConnectionsActivity] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadSummary()
  }, [])

  async function loadSummary() {
    setLoading(true)
    const [skills, courses, experience, connections, growth, upNextRecommendations, learning, activity] =
      await Promise.all([
        countRows('skills', user.id),
        countRows('courses', user.id),
        countRows('experience', user.id),
        listConnections(user.id).then((c) => c.length),
        loadRecentGrowth(user.id),
        loadUpNextRecommendations(user.id),
        loadCurrentLearning(user.id),
        loadConnectionsActivity(),
      ])
    setCounts({ skills, courses, experience, connections })
    setRecentGrowth(growth)
    setUpNext(upNextRecommendations)
    setCurrentLearning(learning)
    setConnectionsActivity(activity)
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-16">
        <div>
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-display text-xl text-ink">Your overview</h2>
          </div>

          {loading ? (
            <p className="text-secondary">Loading…</p>
          ) : counts.skills + counts.experience + counts.courses + counts.connections === 0 ? (
            <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
              <p className="text-secondary mb-4">
                Your profile is empty. Start by adding a skill you already have.
              </p>
              <Link
                to="/skills"
                className="inline-block rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90"
              >
                Add your first skill
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <SummaryCard
                to="/skills"
                title="Skills"
                value={counts.skills}
                unit={counts.skills === 1 ? 'skill tracked' : 'skills tracked'}
              />
              <SummaryCard
                to="/experience"
                title="Experience"
                value={counts.experience}
                unit={counts.experience === 1 ? 'role/study period' : 'roles/study periods'}
              />
              <SummaryCard
                to="/learning"
                title="Courses"
                value={counts.courses}
                unit={counts.courses === 1 ? 'course completed' : 'courses completed'}
              />
              <SummaryCard
                to="/connections"
                title="Connections"
                value={counts.connections}
                unit={counts.connections === 1 ? 'connection' : 'connections'}
              />
            </div>
          )}
        </div>

        {!loading && upNext.length > 0 && (
          <div>
            <h2 className="font-display text-xl text-ink mb-6">Up next</h2>
            <UpNextSlider recommendations={upNext} />
          </div>
        )}

        {!loading && currentLearning.length > 0 && (
          <div>
            <h2 className="font-display text-xl text-ink mb-6">Current learning</h2>
            <CurrentLearningSlider courses={currentLearning} />
          </div>
        )}

        {!loading && recentGrowth.length > 0 && (
          <div>
            <h2 className="font-display text-xl text-ink mb-6">Recent growth</h2>
            <div className="space-y-2">
              {recentGrowth.map((row) => (
                <Link
                  key={row.id}
                  to={`/skills/${row.skill_id}`}
                  className="flex items-center justify-between gap-2 bg-card border border-hairline rounded-lg px-4 py-3 hover:border-moss transition-colors"
                >
                  <p className="text-sm text-ink">
                    {row.skills?.name ?? 'Skill'}{' '}
                    <span className="text-secondary">→ {LEVEL_LABELS[row.level]}</span>
                  </p>
                  <p className="font-mono text-xs text-secondary shrink-0">
                    {new Date(row.assessed_at).toLocaleDateString()}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        )}

        {!loading && connectionsActivity.length > 0 && (
          <div>
            <h2 className="font-display text-xl text-ink mb-6">What your connections are up to</h2>
            <ConnectionsActivityFeed events={connectionsActivity} />
          </div>
        )}

        <RecordActivitySection />
      </main>
    </div>
  )
}

// Turns one list_connections_activity (0063) row into a plain-language
// sentence -- everything the RPC needs to say is already in the row itself
// (skill_name/level/detail), never a client-side lookup, since each row is
// independently privacy-checked server-side and shouldn't need extra trust.
function describeActivityEvent(event) {
  const level = event.level ? LEVEL_LABELS[event.level] : null
  switch (event.event_type) {
    case 'skill_confirmed':
      return `confirmed ${level ?? 'a level'} in ${event.skill_name}`
    case 'skill_validated':
      return `had ${event.skill_name} validated at ${level ?? 'their target level'}`
    case 'skill_added':
      return `started tracking ${event.skill_name}`
    case 'experience_added':
      return `added ${event.detail}`
    case 'course_started':
      return `started ${event.detail}`
    case 'target_set':
      return `set a target of ${level ?? 'a new level'} for ${event.skill_name}`
    default:
      return null
  }
}

function ConnectionsActivityFeed({ events }) {
  return (
    <div className="space-y-2">
      {events.map((event, i) => {
        const description = describeActivityEvent(event)
        if (!description) return null
        return (
          <div
            key={`${event.event_type}-${event.actor_id}-${event.event_at}-${i}`}
            className="flex items-start gap-3 bg-card border border-hairline rounded-lg px-4 py-3"
          >
            <PersonAvatar name={event.full_name} avatarUrl={event.avatar_url} size={9} />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-ink">
                <span className="font-medium">{event.full_name || 'A connection'}</span> {description}
              </p>
              {event.event_type === 'skill_confirmed' && event.detail && (
                <p className="text-xs text-secondary mt-0.5">{event.detail}</p>
              )}
            </div>
            <p className="font-mono text-xs text-secondary shrink-0">
              {new Date(event.event_at).toLocaleDateString()}
            </p>
          </div>
        )
      })}
    </div>
  )
}

// Shared by every horizontally scrollable row on this page (native scroll
// snapping rather than a JS carousel, so it degrades to a plain scrollable
// list anywhere the extras below don't apply). The scrollbar itself is
// hidden (see .scrollbar-hide in index.css) and this redirects ordinary
// vertical mouse-wheel input into horizontal scroll while hovering --
// desktop mice only have a vertical wheel, so without this a mouse user
// would have no way to move the slider at all once the scrollbar is hidden.
function useHorizontalWheelScroll() {
  const scrollerRef = useRef(null)

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
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
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [])

  return scrollerRef
}

function UpNextSlider({ recommendations }) {
  const scrollerRef = useHorizontalWheelScroll()

  return (
    <div
      ref={scrollerRef}
      className="scrollbar-hide flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 -mx-4 px-4 sm:mx-0 sm:px-0"
    >
      {recommendations.map(({ skill, item }) => (
        <Link
          key={skill.id}
          to={`/skills/${skill.id}`}
          className="snap-start shrink-0 w-64 bg-card border border-hairline rounded-lg p-4 hover:border-moss transition-colors"
        >
          <div className="flex items-center gap-3 mb-3">
            <GrowthRing level={skill.level} size={40} />
            <h3 className="font-display text-base text-ink truncate min-w-0">{skill.name}</h3>
          </div>
          <p className="text-sm text-ink font-medium">{item.label}</p>
          <p className="text-xs text-secondary mt-1">{item.description}</p>
        </Link>
      ))}
    </div>
  )
}

function CurrentLearningSlider({ courses }) {
  const scrollerRef = useHorizontalWheelScroll()

  return (
    <div
      ref={scrollerRef}
      className="scrollbar-hide flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 -mx-4 px-4 sm:mx-0 sm:px-0"
    >
      {courses.map((course) => (
        <Link
          key={course.id}
          to={`/courses/${course.id}`}
          state={{ backTo: '/dashboard', backLabel: 'Dashboard' }}
          className="snap-start shrink-0 w-56 bg-card border border-hairline rounded-lg overflow-hidden hover:border-moss transition-colors"
        >
          <CourseThumbnail name={course.name} provider={course.provider} className="h-20 w-full" />
          <div className="p-3">
            <h3 className="font-display text-base text-ink truncate">{course.name}</h3>
            <p className="font-mono text-xs text-secondary mt-1 truncate">
              {[course.provider, course.course_type, course.duration].filter(Boolean).join(' · ') || 'In progress'}
            </p>
          </div>
        </Link>
      ))}
    </div>
  )
}

function SummaryCard({ to, title, value, unit }) {
  return (
    <Link
      to={to}
      className="bg-card border border-hairline rounded-lg p-5 hover:border-moss transition-colors block"
    >
      <h3 className="font-mono text-xs uppercase tracking-wide text-secondary mb-2">{title}</h3>
      <p className="font-display text-3xl text-ink">{value}</p>
      <p className="text-xs text-secondary mt-1">{unit}</p>
      <p className="text-xs text-moss font-medium mt-3">View {title.toLowerCase()} →</p>
    </Link>
  )
}
