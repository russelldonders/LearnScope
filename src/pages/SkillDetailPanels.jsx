import { useEffect, useState } from 'react'
import { useLanguage } from '../context/LanguageContext'
import GrowthRing from '../components/GrowthRing'
import KnowledgeLevelBar from '../components/KnowledgeLevelBar'
import { LEVEL_LABELS, LEVEL_DESCRIPTIONS, KNOWLEDGE_LEVEL_LABELS } from '../lib/levels'
import { TRUST_STATUS, TRUST_STATUS_COLORS } from '../lib/skillProficiencyModel'
import { ensureKnowledgeLevelGuide } from '../lib/knowledgeLevelGuide'
import { ensurePracticalLevelGuide } from '../lib/practicalLevelGuide'

// The skill page's status cards (see SkillDetail.jsx).

// Always-available actions for a skill, grouped by axis -- unlike Up Next
// (which recommends the single next step for the skill's current lifecycle
// stage), every action here is reachable regardless of stage, so a learner
// isn't limited to following the guided checklist in order.
function ActionGroup({ title, actions, headerExtra }) {
  return (
    <div>
      {title && <h3 className="font-mono text-[10px] uppercase tracking-wide text-secondary mb-2">{title}</h3>}
      {/* The box's actions come straight under its heading, before what it
          shows (a timeline can be long). */}
      {actions.length > 0 && (
      <div className={`flex flex-wrap gap-2 ${headerExtra ? 'mb-3' : ''}`}>
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={action.onClick}
            disabled={action.disabled}
            title={action.title}
            className="rounded-md bg-moss text-paper px-3 py-1.5 text-xs font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {action.label}
          </button>
        ))}
      </div>
      )}
      {headerExtra}
    </div>
  )
}

// One card in the skill page's status layout (Know / Can Do) -- each axis
// gets its own status + actions, rather than the stage-linear single-file
// "Up Next" checklist implying the axes must progress in lockstep. Learn
// and Verify nest inside Know; Demonstrate and Validate nest inside Can Do
// (via `nested`), since they're the supporting evidence/verification for
// those axes rather than peer-level axes of their own.
export function SkillPanel({ title, accent, status, actions, nested }) {
  return (
    <div className="rounded-md border border-hairline bg-paper p-4">
      <ActionGroup
        title={title}
        accent={accent}
        headerExtra={status && <div className="mb-3">{status}</div>}
        actions={actions}
      />
      {nested && <div className="mt-4 pt-4 border-t border-hairline">{nested}</div>}
    </div>
  )
}

// Smaller variant of SkillPanel for a panel nested inside another (Learn
// and Verify inside Know; Demonstrate and Validate inside Can Do) -- same
// title/status/actions shape, lighter card so it reads as "part of" the
// parent rather than a sibling.
export function NestedSkillPanel({ title, accent, status, actions }) {
  return (
    <div className="rounded-md border border-hairline bg-card p-3">
      <ActionGroup
        title={title}
        accent={accent}
        headerExtra={status && <div>{status}</div>}
        actions={actions}
      />
    </div>
  )
}

// A panel's level, shown in place on the skill page: what the current level
// means, the confirmed level under a newer self-assessment (knowledge) or the
// target (application), and what to do next. Both axes reuse the per-skill
// AI guide their self-assess picker uses (see ensureKnowledgeLevelGuide /
// ensurePracticalLevelGuide); LEVEL_DESCRIPTIONS is only a fallback for the
// practical axis if generation hasn't completed or fails. The guide is only
// fetched when there's a level or target to describe.
export function LevelDetail({
  skill,
  axis,
  level,
  trustStatus,
  trustLabel,
  milestoneLevel = null,
  ringTargetLevel = null,
  currentTarget = null,
  onSelfAssess,
  onSetTarget = null,
  onAskToRate = null,
  onAssess = null,
  onInterview = null,
  onGuideGenerated,
}) {
  const { t } = useLanguage()
  const isKnowledge = axis === 'knowledge'
  const labels = isKnowledge ? KNOWLEDGE_LEVEL_LABELS : LEVEL_LABELS
  const needsGuide = Boolean(level || currentTarget)
  const [guideStatements, setGuideStatements] = useState([])
  const [guideLoading, setGuideLoading] = useState(needsGuide)

  useEffect(() => {
    if (!needsGuide) return
    let cancelled = false
    setGuideLoading(true)
    const ensureGuide = isKnowledge ? ensureKnowledgeLevelGuide : ensurePracticalLevelGuide
    ensureGuide(skill)
      .then((statements) => {
        if (!cancelled) setGuideStatements(statements)
        if (statements.length === 5) onGuideGenerated?.(statements)
      })
      .catch(() => {
        if (!cancelled) setGuideStatements([])
      })
      .finally(() => {
        if (!cancelled) setGuideLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per skill, axis and whether there's anything to describe
  }, [isKnowledge, skill.id, needsGuide])

  const description = level
    ? guideStatements[level - 1] ?? (!isKnowledge ? LEVEL_DESCRIPTIONS[level] : undefined)
    : null

  return (
    <div>
      <div className="flex items-center gap-3">
        {isKnowledge ? (
          <KnowledgeLevelBar
            level={level}
            size={28}
            color={TRUST_STATUS_COLORS[trustStatus]}
            milestoneLevel={milestoneLevel}
            milestoneColor={TRUST_STATUS_COLORS[TRUST_STATUS.CONFIRMED]}
          />
        ) : (
          <GrowthRing level={level} size={35} targetLevel={ringTargetLevel} color={TRUST_STATUS_COLORS[trustStatus]} />
        )}
        <div>
          <p className="text-base font-medium text-ink">{level ? labels[level] : t('skillDetail.notYetSelfAssessed')}</p>
          <p className="font-mono text-[10px] uppercase tracking-wide text-secondary/70 mt-0.5">{trustLabel}</p>
        </div>
      </div>

      {level ? (
        guideLoading && description == null ? (
          <p className="text-sm text-secondary mt-3">{t('skillDetail.loadingGuidance')}</p>
        ) : (
          description && <p className="text-sm text-secondary mt-3">{description}</p>
        )
      ) : (
        <p className="text-sm text-secondary mt-3">
          {isKnowledge ? t('skillDetail.knowledgeNotRatedYet') : t('skillDetail.practicalNotAssessedYet')}
        </p>
      )}

      {/* A newer self-assessment claiming higher than the last confirmed
          knowledge_level gets its own line, like the practical target. */}
      {isKnowledge && milestoneLevel && (
        <div className="mt-3">
          <p className="text-sm text-ink">
            <span className="font-mono text-[10px] uppercase tracking-wide text-secondary mr-2">{t('skillDetail.confirmed')}</span>
            {KNOWLEDGE_LEVEL_LABELS[milestoneLevel]}
          </p>
          {guideStatements[milestoneLevel - 1] && (
            <p className="text-sm text-secondary mt-1">{guideStatements[milestoneLevel - 1]}</p>
          )}
        </div>
      )}

      {currentTarget && (
        <div className="mt-3">
          <p className="text-sm text-ink">
            <span className="font-mono text-[10px] uppercase tracking-wide text-secondary mr-2">{t('skillDetail.target')}</span>
            {LEVEL_LABELS[currentTarget.target_level]}
            <span className="font-mono text-xs text-secondary/80">
              {' · '}{t('skillDetail.byPrefix')} {new Date(`${currentTarget.target_date}T00:00:00`).toLocaleDateString()}
            </span>
          </p>
          {(guideStatements[currentTarget.target_level - 1] ?? LEVEL_DESCRIPTIONS[currentTarget.target_level]) && (
            <p className="text-sm text-secondary mt-1">
              {guideStatements[currentTarget.target_level - 1] ?? LEVEL_DESCRIPTIONS[currentTarget.target_level]}
            </p>
          )}
          {currentTarget.comments && <p className="text-sm text-secondary mt-1 whitespace-pre-wrap">{currentTarget.comments}</p>}
        </div>
      )}

      {/* Every action for this level, one look: green like the rest of the page's
          main buttons. */}
      <div className="flex flex-wrap gap-2 mt-3">
        {[
          { label: isKnowledge ? t('skillDetail.rateCurrentLevel') : t('skillDetail.selfAssessCurrentLevel'), onClick: onSelfAssess },
          onAssess && { label: level ? t('skillDetail.assessMeAtThisLevel') : t('skillDetail.findMyLevel'), onClick: onAssess },
          onInterview && { label: t('skillDetail.interviewMe'), onClick: onInterview },
          onSetTarget && { label: t('skillDetail.setTargetAction'), onClick: onSetTarget },
          onAskToRate && { label: t('skillDetail.askToRateAbility'), onClick: onAskToRate },
        ]
          .filter(Boolean)
          .map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={action.onClick}
              className="rounded-md bg-moss text-paper py-1.5 px-3 text-xs font-medium hover:opacity-90"
            >
              {action.label}
            </button>
          ))}
      </div>
    </div>
  )
}
