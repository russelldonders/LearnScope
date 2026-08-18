import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import { listConnections } from '../lib/connections'
import AppHeader from '../components/AppHeader'
import RecordActivitySection from '../components/RecordActivitySection'
import GrowthRing from '../components/GrowthRing'
import { LEVEL_LABELS } from '../lib/levels'
import { computeUpNextItems } from '../lib/skillNextAction'
import { SKILL_LIFECYCLE_FLOW_STAGES } from '../lib/skillLifecycle'

async function countRows(table, userId) {
  const { count } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
  return count ?? 0
}

async function loadRecentGrowth(userId) {
  const { data, error } = await supabase
    .from('skill_assessments')
    .select('id, skill_id, level, assessed_at, skills(name)')
    .eq('user_id', userId)
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
    .select('id, name, level, lifecycle_stage')
    .eq('user_id', userId)
    .not('lifecycle_stage', 'is', null)
  if (!skills || skills.length === 0) return []

  const ids = skills.map((s) => s.id)
  const [
    { data: assessments },
    { data: peerRatings },
    { data: statements },
    { data: quizzes },
    { data: courseLinks },
    { data: targets },
    { data: validationRequests },
  ] = await Promise.all([
    supabase.from('skill_assessments').select('skill_id, source').in('skill_id', ids),
    supabase.from('skill_peer_ratings').select('skill_id').in('skill_id', ids),
    supabase.from('xapi_statements').select('skill_id').eq('user_id', userId).in('skill_id', ids),
    supabase.from('skill_baseline_quizzes').select('skill_id').in('skill_id', ids),
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
  for (const a of assessments ?? []) {
    if (a.source === 'self' || !a.source) selfAssessedCounts[a.skill_id] = (selfAssessedCounts[a.skill_id] ?? 0) + 1
  }
  const peerCounts = countBy(peerRatings)
  const statementCounts = countBy(statements)
  const quizCounts = countBy(quizzes)
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
        peerRatingsCount: peerCounts[skill.id] ?? 0,
        statementsCount: statementCounts[skill.id] ?? 0,
        quizCount: quizCounts[skill.id] ?? 0,
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
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadSummary()
  }, [])

  async function loadSummary() {
    setLoading(true)
    const [skills, courses, experience, connections, growth, upNextRecommendations] = await Promise.all([
      countRows('skills', user.id),
      countRows('courses', user.id),
      countRows('experience', user.id),
      listConnections(user.id).then((c) => c.length),
      loadRecentGrowth(user.id),
      loadUpNextRecommendations(user.id),
    ])
    setCounts({ skills, courses, experience, connections })
    setRecentGrowth(growth)
    setUpNext(upNextRecommendations)
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-16">
        <div>
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-display text-xl text-ink">Your overview</h2>
            <Link
              to="/training"
              className="rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90"
            >
              Find training
            </Link>
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

        <RecordActivitySection />
      </main>
    </div>
  )
}

// A horizontally scrollable row rather than a JS carousel -- native scroll
// snapping gives the same swipe-through feel on touch devices without a new
// dependency, and degrades to a plain scrollable list anywhere it doesn't.
function UpNextSlider({ recommendations }) {
  return (
    <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 -mx-4 px-4 sm:mx-0 sm:px-0">
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
