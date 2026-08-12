import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import { listConnections } from '../lib/connections'
import AppHeader from '../components/AppHeader'
import RecordExperienceSection from '../components/RecordExperienceSection'

async function countRows(table, userId) {
  const { count } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
  return count ?? 0
}

export default function Dashboard() {
  const { user } = useAuth()
  const [counts, setCounts] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadSummary()
  }, [])

  async function loadSummary() {
    setLoading(true)
    const [skills, courses, experience, connections] = await Promise.all([
      countRows('skills', user.id),
      countRows('courses', user.id),
      countRows('experience', user.id),
      listConnections(user.id).then((c) => c.length),
    ])
    setCounts({ skills, courses, experience, connections })
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-16">
        <div>
          <h2 className="font-display text-xl text-ink mb-6">Your overview</h2>

          {loading ? (
            <p className="text-secondary">Loading…</p>
          ) : (
            <div className="grid sm:grid-cols-3 gap-4">
              <SummaryCard
                to="/skills"
                title="Skills"
                value={counts.skills}
                unit={counts.skills === 1 ? 'skill tracked' : 'skills tracked'}
              />
              <SummaryCard
                to="/experience"
                title="Experience"
                value={counts.experience + counts.courses}
                unit={`${counts.experience} role${counts.experience === 1 ? '' : 's'}/study period${counts.experience === 1 ? '' : 's'} · ${counts.courses} course${counts.courses === 1 ? '' : 's'}`}
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

        <RecordExperienceSection />
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
