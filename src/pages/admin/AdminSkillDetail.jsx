import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import AdminLayout from './AdminLayout'
import { getLibrarySkill } from '../../lib/admin/skills'
import { countSkillTrackers, getSkillLevelStats } from '../../lib/skillStats'
import { LEVEL_LABELS, LEVEL_DESCRIPTIONS, KNOWLEDGE_LEVEL_LABELS, LEVELS } from '../../lib/levels'

const TYPE_LABELS = { global: 'Global', personal: 'Personal', provider: 'Provider' }

// Read-only overview for a platform admin drilling into one skill_library
// entry -- who owns it, what each level actually means (levels.js is
// deliberately skill-agnostic, see its own comments, so there's no
// per-skill definition to show beyond the one shared scale), and how many
// people track it at each level. Level stats come from the count-only
// skill_level_stats RPC (0076) rather than a direct `skills` query, since a
// platform admin has no standing RLS access to every learner's personal
// skills rows.
export default function AdminSkillDetail() {
  const { skillId } = useParams()
  const [skill, setSkill] = useState(null)
  const [totalTrackers, setTotalTrackers] = useState(0)
  const [levelStats, setLevelStats] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    Promise.all([getLibrarySkill(skillId), countSkillTrackers(skillId), getSkillLevelStats(skillId)])
      .then(([skillData, total, stats]) => {
        setSkill(skillData)
        setTotalTrackers(total)
        setLevelStats(stats)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [skillId])

  const countByLevel = new Map(levelStats.map((s) => [s.level, s.tracker_count]))

  return (
    <AdminLayout>
      <div className="space-y-6">
        <Link to="/admin/skills" className="text-sm text-moss font-medium">
          ← Back to skill library
        </Link>

        {loading ? (
          <p className="text-secondary">Loading…</p>
        ) : error ? (
          <p className="text-sm text-red-700">{error}</p>
        ) : (
          <>
            <div className="bg-card border border-hairline rounded-lg p-6">
              <h2 className="font-display text-xl text-ink mb-1">{skill.name}</h2>
              {skill.description && <p className="text-sm text-secondary mb-3">{skill.description}</p>}
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="font-mono uppercase tracking-wide rounded-full px-2 py-0.5 border border-hairline text-secondary">
                  {TYPE_LABELS[skill.type]}
                </span>
                {skill.ownerName && (
                  <span className="font-mono uppercase tracking-wide rounded-full px-2 py-0.5 border border-hairline text-secondary">
                    {skill.ownerName}
                  </span>
                )}
                {skill.category && (
                  <span className="font-mono uppercase tracking-wide rounded-full px-2 py-0.5 border border-hairline text-secondary">
                    {skill.category}
                  </span>
                )}
                <span
                  className={`font-mono uppercase tracking-wide rounded-full px-2 py-0.5 border ${
                    skill.status === 'inactive' ? 'border-red-300 text-red-700' : 'border-hairline text-secondary'
                  }`}
                >
                  {skill.status}
                </span>
              </div>
            </div>

            <div>
              <h3 className="font-display text-lg text-ink mb-2">Level definitions</h3>
              <div className="bg-card border border-hairline rounded-lg overflow-hidden">
                <ul className="divide-y divide-hairline">
                  {LEVELS.map((level) => (
                    <li key={level} className="px-4 py-2 text-sm flex items-start justify-between gap-3">
                      <span className="text-ink shrink-0 w-28">
                        {level}. {LEVEL_LABELS[level]}
                      </span>
                      <span className="text-secondary text-xs text-right">{LEVEL_DESCRIPTIONS[level]}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <p className="text-xs text-secondary mt-1">
                Levels are the same scale across every skill — a learner's knowledge understanding of{' '}
                {skill.name} ({KNOWLEDGE_LEVEL_LABELS[1]}–{KNOWLEDGE_LEVEL_LABELS[5]}) is tracked separately from
                this practical/demonstrated scale.
              </p>
            </div>

            <div>
              <h3 className="font-display text-lg text-ink mb-2">
                Statistics ({totalTrackers} {totalTrackers === 1 ? 'person tracks' : 'people track'} this skill)
              </h3>
              <div className="bg-card border border-hairline rounded-lg overflow-hidden">
                {totalTrackers === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-secondary">No one tracks this skill yet.</p>
                ) : (
                  <ul className="divide-y divide-hairline">
                    {LEVELS.map((level) => {
                      const count = countByLevel.get(level) ?? 0
                      const pct = totalTrackers ? Math.round((count / totalTrackers) * 100) : 0
                      return (
                        <li key={level} className="px-4 py-2 text-sm flex items-center gap-3">
                          <span className="text-ink w-28 shrink-0">
                            {level}. {LEVEL_LABELS[level]}
                          </span>
                          <div className="flex-1 h-2 rounded-full bg-paper overflow-hidden">
                            <div className="h-full bg-moss" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-secondary text-xs w-16 text-right shrink-0">
                            {count} ({pct}%)
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  )
}
