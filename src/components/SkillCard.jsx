import GrowthRing from './GrowthRing'
import { isCheckinDue } from '../lib/checkin'

export default function SkillCard({ skill, onEdit }) {
  const due = isCheckinDue(skill.next_checkin_date)

  return (
    <button
      onClick={() => onEdit(skill)}
      className="text-left bg-card border border-hairline rounded-lg p-4 flex gap-4 items-center hover:border-moss transition-colors w-full relative"
    >
      <GrowthRing level={skill.level} size={56} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="font-display text-lg text-ink truncate">{skill.name}</h3>
          {due && (
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-gold border border-gold rounded-full px-2 py-0.5">
              Check-in due
            </span>
          )}
        </div>
        {skill.notes && <p className="text-sm text-secondary line-clamp-2 mt-0.5">{skill.notes}</p>}
        <p className="font-mono text-xs text-secondary mt-1">
          {new Date(skill.date_added).toLocaleDateString()}
        </p>
      </div>
    </button>
  )
}
