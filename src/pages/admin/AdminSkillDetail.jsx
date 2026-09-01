import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import AdminLayout from './AdminLayout'
import { getLibrarySkill } from '../../lib/admin/skills'
import {
  countSkillTrackers,
  getSkillLevelStats,
  getSkillLevelGuideSample,
  getSkillKnowledgeLevelSourceStats,
} from '../../lib/skillStats'
import { LEVEL_LABELS, LEVEL_DESCRIPTIONS, KNOWLEDGE_LEVEL_LABELS, LEVELS } from '../../lib/levels'
import SkillTestQuestionsModal from '../../components/SkillTestQuestionsModal'
import SkillKnowledgeStatsModal from '../../components/SkillKnowledgeStatsModal'

const TYPE_LABELS = { global: 'Global', personal: 'Personal', provider: 'Provider' }

// Read-only overview for a platform admin drilling into one skill_library
// entry -- who owns it, how many people track it at each ability level (with
// that level's application-guide statement revealed on click, a real
// learner's already-generated text via the anonymous skill_level_guide_sample
// RPC -- see 0083 for why this can't be a direct `skills` query), and per
// knowledge level how many self-assessed vs were verified, plus links into
// that level's cached test questions and assessment results. Level stats come
// from the count-only skill_level_stats / skill_knowledge_level_source_stats
// RPCs (0076, 0092) rather than a direct `skills` query, since a platform
// admin has no standing RLS access to every learner's personal skills rows.
export default function AdminSkillDetail() {
  const { skillId } = useParams()
  const [skill, setSkill] = useState(null)
  const [totalTrackers, setTotalTrackers] = useState(0)
  const [levelStats, setLevelStats] = useState([])
  const [knowledgeStats, setKnowledgeStats] = useState([])
  const [guideSample, setGuideSample] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [openAbilityLevel, setOpenAbilityLevel] = useState(null)
  const [questionsLevel, setQuestionsLevel] = useState(null)
  const [statsLevel, setStatsLevel] = useState(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    Promise.all([
      getLibrarySkill(skillId),
      countSkillTrackers(skillId),
      getSkillLevelStats(skillId),
      getSkillKnowledgeLevelSourceStats(skillId),
      getSkillLevelGuideSample(skillId),
    ])
      .then(([skillData, total, stats, knowledgeSourceStats, sample]) => {
        setSkill(skillData)
        setTotalTrackers(total)
        setLevelStats(stats)
        setKnowledgeStats(knowledgeSourceStats)
        setGuideSample(sample)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [skillId])

  const countByLevel = new Map(levelStats.map((s) => [s.level, s.tracker_count]))
  const knowledgeStatsByLevel = new Map(knowledgeStats.map((s) => [s.level, s]))
  // Shared library cache (0089) is the current source of truth going
  // forward; guideSample (0083's per-tracker sample) only still matters for
  // skills that predate that cache, or unlinked skills that never get a
  // shared entry.
  const knowledgeGuide =
    (skill?.knowledge_level_guide?.length === 5 ? skill.knowledge_level_guide : null) ??
    (guideSample?.knowledge_level_guide?.length === 5 ? guideSample.knowledge_level_guide : null)
  const practicalGuide =
    (skill?.practical_level_guide?.length === 5 ? skill.practical_level_guide : null) ??
    (guideSample?.practical_level_guide?.length === 5 ? guideSample.practical_level_guide : null)

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="mb-2">
          <Link to="/admin/skills" className="text-sm text-moss font-medium">
            ← Back to skill library
          </Link>
        </div>

        {loading ? (
          <p className="text-secondary">Loading…</p>
        ) : error ? (
          <p className="text-sm text-red-700">{error}</p>
        ) : (
          <>
            <div className="bg-card border border-hairline rounded-lg p-6">
              <h2 className="font-display text-xl text-ink mb-1">{skill.name}</h2>
              <p className="font-mono text-xs text-secondary">{skill.skill_code}</p>
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
              <h3 className="font-display text-lg text-ink mb-2">
                Statistics ({totalTrackers} {totalTrackers === 1 ? 'person tracks' : 'people track'} this skill)
              </h3>
              <div className="bg-card border border-hairline rounded-lg overflow-hidden">
                <ul className="divide-y divide-hairline">
                  {LEVELS.map((level) => {
                    const count = countByLevel.get(level) ?? 0
                    const pct = totalTrackers ? Math.round((count / totalTrackers) * 100) : 0
                    const isOpen = openAbilityLevel === level
                    const description = practicalGuide ? practicalGuide[level - 1] : LEVEL_DESCRIPTIONS[level]
                    return (
                      <li key={level} className="px-4 py-2 text-sm">
                        <button
                          type="button"
                          onClick={() => setOpenAbilityLevel(isOpen ? null : level)}
                          aria-expanded={isOpen}
                          className="w-full flex items-center gap-3 text-left"
                        >
                          <span className="text-ink w-28 shrink-0">
                            {level}. {LEVEL_LABELS[level]}
                          </span>
                          <div className="flex-1 h-2 rounded-full bg-paper overflow-hidden">
                            <div className="h-full bg-moss" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-secondary text-xs w-16 text-right shrink-0">
                            {count} ({pct}%)
                          </span>
                        </button>
                        {isOpen && (
                          <div className="mt-2 pl-1">
                            {description && <p className="text-secondary text-xs">{description}</p>}
                            {!practicalGuide && (
                              <p className="text-xs text-secondary mt-1">
                                No learner has generated an application guide for {skill.name} yet — showing the
                                generic scale.
                              </p>
                            )}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            </div>

            <div>
              <h3 className="font-display text-lg text-ink mb-2">Knowledge levels</h3>
              <div className="bg-card border border-hairline rounded-lg overflow-hidden">
                <ul className="divide-y divide-hairline">
                  {LEVELS.map((level) => {
                    const description = knowledgeGuide ? knowledgeGuide[level - 1] : null
                    const stats = knowledgeStatsByLevel.get(level)
                    const selfCount = stats?.self_count ?? 0
                    const assessedCount = stats?.assessed_count ?? 0
                    return (
                      <li key={level} className="px-4 py-3 text-sm">
                        <p className="text-ink font-medium">
                          {level}. {KNOWLEDGE_LEVEL_LABELS[level]}
                        </p>
                        {description && <p className="text-secondary text-xs mt-0.5">{description}</p>}
                        <div className="flex items-center gap-4 text-xs text-secondary mt-2">
                          <span>{selfCount} self-assessed at this level</span>
                          <span>{assessedCount} verified at this level</span>
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          <button
                            type="button"
                            onClick={() => setQuestionsLevel(level)}
                            className="rounded-md border border-hairline text-ink py-1 px-2.5 text-xs font-medium hover:bg-paper"
                          >
                            View test questions
                          </button>
                          <button
                            type="button"
                            onClick={() => setStatsLevel(level)}
                            className="rounded-md border border-hairline text-ink py-1 px-2.5 text-xs font-medium hover:bg-paper"
                          >
                            View assessment results
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>
              {!knowledgeGuide && (
                <p className="text-xs text-secondary mt-1">
                  No learner has generated a knowledge guide for {skill.name} yet.
                </p>
              )}
            </div>
          </>
        )}

        {questionsLevel && (
          <SkillTestQuestionsModal
            librarySkillId={skillId}
            skillName={skill?.name}
            initialLevel={questionsLevel}
            onClose={() => setQuestionsLevel(null)}
          />
        )}
        {statsLevel && (
          <SkillKnowledgeStatsModal
            librarySkillId={skillId}
            skillName={skill?.name}
            onClose={() => setStatsLevel(null)}
          />
        )}
      </div>
    </AdminLayout>
  )
}
