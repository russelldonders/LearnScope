import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import { listConnections } from '../lib/connections'
import AppHeader from '../components/AppHeader'
import RecordActivitySection from '../components/RecordActivitySection'
import { LEVEL_LABELS } from '../lib/levels'

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

export default function Dashboard() {
  const { user } = useAuth()
  const [counts, setCounts] = useState(null)
  const [recentGrowth, setRecentGrowth] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadSummary()
  }, [])

  async function loadSummary() {
    setLoading(true)
    const [skills, courses, experience, connections, growth] = await Promise.all([
      countRows('skills', user.id),
      countRows('courses', user.id),
      countRows('experience', user.id),
      listConnections(user.id).then((c) => c.length),
      loadRecentGrowth(user.id),
    ])
    setCounts({ skills, courses, experience, connections })
    setRecentGrowth(growth)
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
