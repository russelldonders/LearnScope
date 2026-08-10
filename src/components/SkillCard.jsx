import GrowthRing from './GrowthRing'
import TrackingReasonIcon from './TrackingReasonIcon'
import { isSelfAssessmentDue } from '../lib/checkin'
import { TRACKING_REASON_LABELS } from '../lib/trackingReasons'

export default function SkillCard({ skill, onEdit }) {
  const due = isSelfAssessmentDue(skill.next_checkin_date)

  return (
    <button
      onClick={() => onEdit(skill)}
      className="text-left bg-card border border-hairline rounded-lg p-4 flex gap-4 items-center hover:border-moss transition-colors w-full relative"
    >
      <GrowthRing level={skill.level} size={56} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="font-display text-lg text-ink truncate">{skill.name}</h3>
          {!skill.level && (
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-secondary border border-hairline rounded-full px-2 py-0.5">
              Not yet self-assessed
            </span>
          )}
          {due && (
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-gold border border-gold rounded-full px-2 py-0.5">
              Self-assessment due
            </span>
          )}
        </div>
        {skill.notes && <p className="text-sm text-secondary line-clamp-2 mt-0.5">{skill.notes}</p>}
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
