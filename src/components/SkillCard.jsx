import GrowthRing from './GrowthRing'

export default function SkillCard({ skill, onEdit }) {
  return (
    <button
      onClick={() => onEdit(skill)}
      className="text-left bg-card border border-hairline rounded-lg p-4 flex gap-4 items-center hover:border-moss transition-colors w-full"
    >
      <GrowthRing level={skill.level} size={56} />
      <div className="min-w-0 flex-1">
        <h3 className="font-display text-lg text-ink truncate">{skill.name}</h3>
        {skill.notes && <p className="text-sm text-secondary line-clamp-2 mt-0.5">{skill.notes}</p>}
        <p className="font-mono text-xs text-secondary mt-1">
          {new Date(skill.date_added).toLocaleDateString()}
        </p>
      </div>
    </button>
  )
}
