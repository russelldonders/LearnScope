import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import AdminLayout from './AdminLayout'
import { getLibrarySkill, listCoursesForSkill, promoteSkillToGlobal } from '../../lib/admin/skills'
import {
  countSkillTrackers,
  getSkillLevelStats,
  getSkillKnowledgeLevelSourceStats,
} from '../../lib/skillStats'
import { LEVEL_LABELS, LEVEL_DESCRIPTIONS, KNOWLEDGE_LEVEL_LABELS, LEVELS } from '../../lib/levels'
import { SKILL_TYPE_LABELS } from '../../lib/statusLabels'
import AccessibleDialog from '../../components/AccessibleDialog'
import SkillTestQuestionsModal from '../../components/SkillTestQuestionsModal'
import StatusBadge from '../../components/StatusBadge'
import SkillIconUpload from '../../components/SkillIconUpload'
import SkillCompositionSection from './SkillCompositionSection'
import LevelDefinitionsSection from './LevelDefinitionsSection'
import { countSkillQuestionsByLevel } from '../../lib/admin/skillQuestions'

// Read-only overview for a platform admin drilling into one skill_library
// entry -- who owns it, how many people track it at each ability level (with
// that level's shared practical definition revealed on click), and per
// knowledge level how many self-assessed vs were verified, plus a link into
// that level's cached test questions. Level stats come from the count-only
// skill_level_stats / skill_knowledge_level_source_stats RPCs (0076, 0092)
// rather than a direct `skills` query, since a platform admin has no standing
// RLS access to every learner's personal skills rows.
export default function AdminSkillDetail() {
  const { user } = useAuth()
  const { skillId } = useParams()
  const [skill, setSkill] = useState(null)
  const [totalTrackers, setTotalTrackers] = useState(0)
  const [levelStats, setLevelStats] = useState([])
  const [knowledgeStats, setKnowledgeStats] = useState([])
  const [relatedCourses, setRelatedCourses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [openAbilityLevel, setOpenAbilityLevel] = useState(null)
  const [questionsLevel, setQuestionsLevel] = useState(null)
  const [questionCounts, setQuestionCounts] = useState({})
  const [confirmingPromote, setConfirmingPromote] = useState(false)
  const [promoting, setPromoting] = useState(false)
  const [promoteError, setPromoteError] = useState(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    Promise.all([
      getLibrarySkill(skillId),
      countSkillTrackers(skillId),
      getSkillLevelStats(skillId),
      getSkillKnowledgeLevelSourceStats(skillId),
      listCoursesForSkill(skillId),
    ])
      .then(([skillData, total, stats, knowledgeSourceStats, courses]) => {
        setSkill(skillData)
        setTotalTrackers(total)
        setLevelStats(stats)
        setKnowledgeStats(knowledgeSourceStats)
        setRelatedCourses(courses)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [skillId])

  function loadQuestionCounts() {
    countSkillQuestionsByLevel(skillId)
      .then(setQuestionCounts)
      .catch((err) => console.error('Failed to count skill questions:', err))
  }

  useEffect(() => {
    loadQuestionCounts()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- per skill
  }, [skillId])

  async function handlePromote() {
    setPromoting(true)
    setPromoteError(null)
    try {
      await promoteSkillToGlobal(skillId)
      const refreshed = await getLibrarySkill(skillId)
      setSkill(refreshed)
      setConfirmingPromote(false)
    } catch (err) {
      setPromoteError(err.message)
    } finally {
      setPromoting(false)
    }
  }

  const countByLevel = new Map(levelStats.map((s) => [s.level, s.tracker_count]))
  const knowledgeStatsByLevel = new Map(knowledgeStats.map((s) => [s.level, s]))
  // The shared library copy is the only one learners of this skill see
  // (src/lib/levelGuide.js), so it's the only one shown -- and edited -- here.
  const knowledgeGuide = skill?.knowledge_level_guide?.length === 5 ? skill.knowledge_level_guide : null
  const practicalGuide = skill?.practical_level_guide?.length === 5 ? skill.practical_level_guide : null

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
              {!skill.is_private && (
                <div className="mb-4">
                  <SkillIconUpload skill={skill} onUpdated={async () => setSkill(await getLibrarySkill(skillId))} />
                </div>
              )}
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-xl text-ink mb-1">{skill.name}</h2>
                  <p className="font-mono text-xs text-secondary">{skill.skill_code}</p>
                </div>
                {skill.organisation_id && (
                  <button
                    type="button"
                    onClick={() => setConfirmingPromote(true)}
                    className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper whitespace-nowrap"
                  >
                    Promote to global
                  </button>
                )}
              </div>
              {skill.description && <p className="text-sm text-secondary mb-3 mt-2">{skill.description}</p>}
              <div className="flex flex-wrap gap-2 text-xs">
                <StatusBadge size="inherit" label={SKILL_TYPE_LABELS[skill.type]} />
                {skill.ownerName && <StatusBadge size="inherit" label={skill.ownerName} />}
                {skill.category && <StatusBadge size="inherit" label={skill.category} />}
                <StatusBadge
                  size="inherit"
                  label={skill.status}
                  tone={skill.status === 'inactive' ? 'danger' : 'neutral'}
                />
              </div>
              {promoteError && <p role="alert" className="text-sm text-red-700 mt-3">{promoteError}</p>}
            </div>

            {!skill.is_private && (
              <SkillCompositionSection
                parentSkill={skill}
                userId={user.id}
                componentHref={(component) => `/admin/skills/${component.id}`}
              />
            )}

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
                                No practical level definitions for {skill.name} yet — showing the generic scale.
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

            <LevelDefinitionsSection skill={skill} onSkillChange={setSkill} />

            <div>
              <h3 className="font-display text-lg text-ink mb-2">
                Related courses ({relatedCourses.length})
              </h3>
              <div className="bg-card border border-hairline rounded-lg overflow-hidden">
                {relatedCourses.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-secondary">No courses reference this skill yet.</p>
                ) : (
                  <ul className="divide-y divide-hairline">
                    {relatedCourses.map((c) => (
                      <li key={c.id} className="px-4 py-2 text-sm flex items-center justify-between gap-2">
                        <Link to={`/admin/courses?q=${encodeURIComponent(c.name)}`} className="text-moss font-medium hover:underline">
                          {c.name}
                        </Link>
                        <span className="text-secondary text-xs shrink-0">Targets {LEVEL_LABELS[c.level]}</span>
                      </li>
                    ))}
                  </ul>
                )}
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
                        <div className="mt-2">
                          <button
                            type="button"
                            onClick={() => setQuestionsLevel(level)}
                            className="rounded-md border border-hairline text-ink py-1 px-2.5 text-xs font-medium hover:bg-paper"
                          >
                            Test questions ({questionCounts[level]?.active ?? 0})
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>
              {!knowledgeGuide && (
                <p className="text-xs text-secondary mt-1">
                  No knowledge level definitions for {skill.name} yet.
                </p>
              )}
            </div>
          </>
        )}

        {questionsLevel && (
          <SkillTestQuestionsModal
            librarySkillId={skillId}
            skillName={skill?.name}
            level={questionsLevel}
            userId={user.id}
            onCountsChange={loadQuestionCounts}
            onClose={() => setQuestionsLevel(null)}
          />
        )}

        {confirmingPromote && (
          <PromoteSkillDialog
            skill={skill}
            promoting={promoting}
            error={promoteError}
            onConfirm={handlePromote}
            onCancel={() => setConfirmingPromote(false)}
          />
        )}
      </div>
    </AdminLayout>
  )
}

// One-way and platform-wide -- there's no demote path (see promoteSkillToGlobal's
// own comment in lib/admin/skills.js) -- so this gets the same typed-word
// friction as AdminUsers.jsx's account deletion, not the lighter one-click
// ConfirmDialog used for routine reversible toggles like activate/deactivate.
function PromoteSkillDialog({ skill, promoting, error, onConfirm, onCancel }) {
  const [confirmText, setConfirmText] = useState('')

  return (
    <AccessibleDialog
      labelledBy="promote-skill-title"
      describedBy="promote-skill-description"
      onClose={promoting ? undefined : onCancel}
      closeOnBackdrop={!promoting}
      overlayClassName="z-[60]"
      panelClassName="w-full max-w-md bg-card border border-hairline rounded-lg p-6"
    >
      <h2 id="promote-skill-title" className="font-display text-lg text-ink mb-1">Promote "{skill.name}" to global</h2>
      <p id="promote-skill-description" className="text-sm text-secondary mb-4">
        It will become visible and offerable by every organisation on the platform, not just{' '}
        {skill.ownerName ?? 'its current owner'}. There is no way to demote it back from here afterwards.
      </p>
      <label htmlFor="promote-skill-confirmation" className="block text-sm text-ink mb-2">
        Type <span className="font-mono font-semibold">PROMOTE</span> to confirm
      </label>
      <input
        id="promote-skill-confirmation"
        type="text"
        value={confirmText}
        disabled={promoting}
        onChange={(e) => setConfirmText(e.target.value)}
        className="w-full rounded-md border border-hairline px-3 py-1.5 text-sm mb-4"
      />
      {error && <p role="alert" className="text-sm text-red-700 mb-3">{error}</p>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={promoting}
          className="rounded-md border border-hairline text-ink py-2 px-4 text-sm font-medium hover:bg-paper disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={promoting || confirmText !== 'PROMOTE'}
          className="rounded-md bg-red-700 text-white py-2 px-4 text-sm font-medium hover:bg-red-800 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {promoting ? 'Promoting…' : 'Promote to global'}
        </button>
      </div>
    </AccessibleDialog>
  )
}
