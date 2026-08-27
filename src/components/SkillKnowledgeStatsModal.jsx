import { useEffect, useState } from 'react'
import { getSkillKnowledgeLevelSourceStats } from '../lib/skillStats'
import { KNOWLEDGE_LEVEL_LABELS, LEVELS } from '../lib/levels'

// Read-only viewer for how learners currently at each knowledge level got
// there -- self-rated (skill_assessments.source = 'self') vs assessed (any
// other evidence source: course, AI baseline/evaluation, confirmed
// diagnostic quiz). See skill_knowledge_level_source_stats (0092), an
// anonymous count-only RPC -- no individual learner identities are ever
// returned here.
export default function SkillKnowledgeStatsModal({ librarySkillId, skillName, onClose }) {
  const [stats, setStats] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    getSkillKnowledgeLevelSourceStats(librarySkillId)
      .then(setStats)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [librarySkillId])

  const byLevel = new Map(stats.map((s) => [s.level, s]))
  const total = stats.reduce((sum, s) => sum + s.self_count + s.assessed_count, 0)

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-display text-2xl text-ink">Assessment stats — {skillName}</h2>
          <button type="button" onClick={onClose} className="text-secondary hover:text-ink text-sm shrink-0">
            Close
          </button>
        </div>
        <p className="text-xs text-secondary mb-4">
          At each knowledge level, how many learners self-rated versus were assessed (course, AI or a confirmed
          knowledge-check quiz).
        </p>

        {loading ? (
          <p className="text-secondary text-sm">Loading…</p>
        ) : error ? (
          <p className="text-sm text-red-700">{error}</p>
        ) : total === 0 ? (
          <p className="text-sm text-secondary">No one has a knowledge level recorded for this skill yet.</p>
        ) : (
          <ul className="divide-y divide-hairline border border-hairline rounded-md">
            {LEVELS.map((level) => {
              const row = byLevel.get(level)
              const selfCount = row?.self_count ?? 0
              const assessedCount = row?.assessed_count ?? 0
              const levelTotal = selfCount + assessedCount
              return (
                <li key={level} className="p-3 text-sm">
                  <p className="text-ink font-medium mb-1">
                    {level}. {KNOWLEDGE_LEVEL_LABELS[level]}
                  </p>
                  {levelTotal === 0 ? (
                    <p className="text-xs text-secondary">No one at this level.</p>
                  ) : (
                    <div className="flex items-center gap-4 text-xs text-secondary">
                      <span>
                        Self-rated: <span className="text-ink font-medium">{selfCount}</span>
                      </span>
                      <span>
                        Assessed: <span className="text-ink font-medium">{assessedCount}</span>
                      </span>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
