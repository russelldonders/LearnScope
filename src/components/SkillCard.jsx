import GrowthRing from './GrowthRing'
import TrackingReasonIcon from './TrackingReasonIcon'
import { isSelfAssessmentDue } from '../lib/checkin'
import { TRACKING_REASON_LABELS } from '../lib/trackingReasons'
import { SKILL_LIFECYCLE_LABELS } from '../lib/skillLifecycle'
import { KNOWLEDGE_LEVEL_LABELS } from '../lib/levels'
import { TRUST_STATUS, TRUST_STATUS_COLORS, computeTrustStatus } from '../lib/skillProficiencyModel'
import LifecycleStageIcon from './LifecycleStageIcon'

export default function SkillCard({ skill, onEdit }) {
  const due = isSelfAssessmentDue(skill.next_checkin_date)
  // Falls back to the latest self-assessment when skill.level itself hasn't
  // moved yet (see displayedLevel in SkillsSection.jsx) -- matches the same
  // fallback the skill's own detail page uses, so this card doesn't sit on
  // "Not yet self-assessed" through the whole self-assess -> evaluate gap.
  const displayedLevel = skill.displayedLevel ?? skill.level

  // Lightweight per-axis trust badge -- the grid card only has the skills
  // row itself (no peer-rating/activity/quiz counts without a much heavier
  // batch query), so this is a coarser, more conservative read than the
  // full trust status shown on the skill's own detail page: practical can
  // still reach Validated (visible directly on lifecycle_stage), but
  // knowledge caps at Self-assessed here since "confirmed via quiz" isn't
  // knowable from this row alone.
  const practicalTrust = computeTrustStatus({
    axis: 'practical',
    // displayedLevelIsSelfAssessed (not just "is there a level") so a level
    // set by an AI assessment or completed course doesn't get badged as
    // Self-assessed just because something is shown on the icon -- see
    // SkillsSection.jsx for how it's derived.
    selfAssessedCount: skill.displayedLevelIsSelfAssessed ? 1 : 0,
    formallyValidated: ['validated', 'maintained'].includes(skill.lifecycle_stage),
  })
  const knowledgeTrust = computeTrustStatus({
    axis: 'knowledge',
    // skill.knowledge_level is only ever written by the Confirming Baseline
    // quiz (see ConfirmingBaselineQuizModal), never a plain self-assessment,
    // so whenever it's set the badge should read Confirmed, not Self-assessed.
    knowledgeConfirmed: Boolean(skill.knowledge_level),
  })

  return (
    <button
      onClick={() => onEdit(skill)}
      className="text-left bg-card border border-hairline rounded-lg p-4 flex gap-4 items-center hover:border-moss transition-colors w-full relative"
    >
      <GrowthRing
        level={displayedLevel}
        size={56}
        color={TRUST_STATUS_COLORS[practicalTrust]}
        targetLevel={skill.targetLevel}
        showLabel
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="font-display text-lg text-ink truncate min-w-0">{skill.name}</h3>
          {due && (
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-gold border border-gold rounded-full px-2 py-0.5">
              Self-assessment due
            </span>
          )}
        </div>
        {skill.lifecycle_stage && SKILL_LIFECYCLE_LABELS[skill.lifecycle_stage] && (
          <p className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide text-secondary mt-0.5">
            <LifecycleStageIcon stage={skill.lifecycle_stage} />
            {SKILL_LIFECYCLE_LABELS[skill.lifecycle_stage]}
          </p>
        )}
        {skill.knowledge_level && (
          <p className="flex items-center gap-1.5 text-xs text-secondary mt-1">
            <GrowthRing
              level={skill.knowledge_level}
              size={16}
              labels={KNOWLEDGE_LEVEL_LABELS}
              color={TRUST_STATUS_COLORS[knowledgeTrust]}
            />
            {KNOWLEDGE_LEVEL_LABELS[skill.knowledge_level]}
          </p>
        )}
        {/* Self-assessed is the common case on this grid (almost every
            tracked skill has one) so it reads as noise on every card here --
            only the rarer, more meaningful tiers get a badge. The skill's
            own detail page still shows Self-assessed where it's the only
            signal available. Knowledge has no separate badge here at all --
            the level shown just above (skill.knowledge_level, always the
            confirmed value) already says everything this tag would. */}
        {practicalTrust && practicalTrust !== TRUST_STATUS.SELF_ASSESSED && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            <span
              className={`font-mono text-[9px] uppercase tracking-wide rounded-full px-1.5 py-0.5 border ${
                practicalTrust === TRUST_STATUS.VALIDATED || practicalTrust === TRUST_STATUS.CONFIRMED
                  ? 'border-moss text-moss'
                  : 'border-hairline text-secondary'
              }`}
            >
              {practicalTrust}
            </span>
          </div>
        )}
        {skill.tracking_reason && (
          <span
            className="flex items-center gap-1 font-mono text-[10px] text-secondary mt-1"
            title={TRACKING_REASON_LABELS[skill.tracking_reason]}
          >
            <TrackingReasonIcon reason={skill.tracking_reason} size={12} />
            {TRACKING_REASON_LABELS[skill.tracking_reason]}
          </span>
        )}
      </div>
    </button>
  )
}
