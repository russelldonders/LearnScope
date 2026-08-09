import { formatMonthYear } from '../lib/dates'

export default function TimelineItem({ item, onEdit, isLast }) {
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center">
        <span
          className={`w-3 h-3 rounded-full mt-1.5 ${
            item.type === 'education' ? 'bg-gold' : 'bg-moss'
          }`}
        />
        {!isLast && <span className="w-px flex-1 bg-hairline mt-1" />}
      </div>
      <button
        onClick={() => onEdit(item)}
        className="text-left bg-card border border-hairline rounded-lg p-4 mb-6 hover:border-moss transition-colors w-full"
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="font-mono text-[10px] uppercase tracking-wide text-secondary">
            {item.type === 'education' ? 'Education' : 'Employment'}
          </span>
        </div>
        <h3 className="font-display text-lg text-ink">{item.title}</h3>
        <p className="text-sm text-secondary">{item.organization}</p>
        <p className="font-mono text-xs text-secondary mt-2">
          {formatMonthYear(item.start_date)} – {item.end_date ? formatMonthYear(item.end_date) : 'Present'}
        </p>
        {item.description && (
          <p className="text-sm text-ink mt-2 whitespace-pre-line">{item.description}</p>
        )}
      </button>
    </div>
  )
}
