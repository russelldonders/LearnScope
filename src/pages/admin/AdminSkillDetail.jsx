import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import AdminLayout from './AdminLayout'
import { getLibrarySkill } from '../../lib/admin/skills'
import { countSkillTrackers, getSkillLevelStats, getSkillLevelGuideSample } from '../../lib/skillStats'
import { LEVEL_LABELS, LEVEL_DESCRIPTIONS, KNOWLEDGE_LEVEL_LABELS, LEVELS } from '../../lib/levels'
import SkillTestQuestionsModal from '../../components/SkillTestQuestionsModal'
import SkillKnowledgeStatsModal from '../../components/SkillKnowledgeStatsModal'

const TYPE_LABELS = { global: 'Global', personal: 'Personal', provider: 'Provider' }

// Read-only overview for a platform admin drilling into one skill_library
// entry -- who owns it, what each level means for *this* skill specifically
// (a real learner's already-generated guide text, via the anonymous
// skill_level_guide_sample RPC -- see 0083 for why this can't be a direct
// `skills` query), shown Knowledge/Application side by side the same way
// SkillDetail.jsx's own two-axis panels are, and how many people track it
// at each level. Level stats come from the count-only skill_level_stats RPC
// (0076) rather than a direct `skills` query, since a platform admin has no
// standing RLS access to every learner's personal skills rows.
export default function AdminSkillDetail() {
  const { skillId } = useParams()
  const [skill, setSkill] = useState(null)
  const [totalTrackers, setTotalTrackers] = useState(0)
  const [levelStats, setLevelStats] = useState([])
  const [guideSample, setGuideSample] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showQuestions, setShowQuestions] = useState(false)
  const [showKnowledgeStats, setShowKnowledgeStats] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(null)
    Promise.all([
      getLibrarySkill(skillId),
      countSkillTrackers(skillId),
      getSkillLevelStats(skillId),
      getSkillLevelGuideSample(skillId),
    ])
      .then(([skillData, total, stats, sample]) => {
        setSkill(skillData)
        setTotalTrackers(total)
        setLevelStats(stats)
        setGuideSample(sample)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [skillId])

  const countByLevel = new Map(levelStats.map((s) => [s.level, s.tracker_count]))
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

            <div>
              <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                <h3 className="font-display text-lg text-ink">Level definitions</h3>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowQuestions(true)}
                    className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper"
                  >
                    View test questions
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowKnowledgeStats(true)}
                    className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper"
                  >
                    View assessment stats
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <LevelGuideColumn
                  title="Knowledge"
                  axisLabel="knowledge"
                  labels={KNOWLEDGE_LEVEL_LABELS}
                  statements={knowledgeGuide}
                  skillName={skill.name}
                />
                <LevelGuideColumn
                  title="Application"
                  axisLabel="application"
                  labels={LEVEL_LABELS}
                  statements={practicalGuide}
                  fallbackDescriptions={LEVEL_DESCRIPTIONS}
                  skillName={skill.name}
                />
              </div>
            </div>
          </>
        )}

        {showQuestions && (
          <SkillTestQuestionsModal
            librarySkillId={skillId}
            skillName={skill?.name}
            onClose={() => setShowQuestions(false)}
          />
        )}
        {showKnowledgeStats && (
          <SkillKnowledgeStatsModal
            librarySkillId={skillId}
            skillName={skill?.name}
            onClose={() => setShowKnowledgeStats(false)}
          />
        )}
      </div>
    </AdminLayout>
  )
}

// One axis's 5 levels -- skill-specific statements when a real learner has
// already generated them (see skill_level_guide_sample), otherwise the
// generic scale (practical only has one to fall back to; knowledge has no
// generic long-form description, just the label, see levels.js).
function LevelGuideColumn({ title, axisLabel, labels, statements, fallbackDescriptions, skillName }) {
  return (
    <div>
      <h4 className="font-display text-base text-ink mb-2">{title}</h4>
      <div className="bg-card border border-hairline rounded-lg overflow-hidden">
        <ul className="divide-y divide-hairline">
          {LEVELS.map((level) => {
            const description = statements ? statements[level - 1] : fallbackDescriptions?.[level]
            return (
              <li key={level} className="px-4 py-2 text-sm">
                <p className="text-ink font-medium">
                  {level}. {labels[level]}
                </p>
                {description && <p className="text-secondary text-xs mt-0.5">{description}</p>}
              </li>
            )
          })}
        </ul>
      </div>
      {!statements && (
        <p className="text-xs text-secondary mt-1">
          No learner has generated a {axisLabel} guide for {skillName} yet
          {fallbackDescriptions ? ' — showing the generic scale' : ''}.
        </p>
      )}
    </div>
  )
}
