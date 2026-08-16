export default function FilterRow({ label, value, onChange, options }) {
  if (options.length === 0) return null
  return (
    <div className="flex items-start gap-2">
      <span className="font-mono text-[10px] uppercase tracking-wide text-secondary w-28 shrink-0 pt-1.5">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
        <button
          type="button"
          onClick={() => onChange(null)}
          className={`font-mono text-xs uppercase tracking-wide rounded-full px-3 py-1 border transition-colors ${
            value === null ? 'bg-moss text-paper border-moss' : 'border-hairline text-secondary hover:text-ink'
          }`}
        >
          Any
        </button>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(value === o.value ? null : o.value)}
            className={`flex items-center gap-1.5 font-mono text-xs uppercase tracking-wide rounded-full px-3 py-1 border transition-colors ${
              value === o.value ? 'bg-moss text-paper border-moss' : 'border-hairline text-secondary hover:text-ink'
            }`}
          >
            {o.icon}
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}
