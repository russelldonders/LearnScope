// One card in a skill page's header -- what's due or coming up, and the
// recommended next action -- each with an icon, a small label, a title, a
// line of detail and, if there's something to do, a button.
//   tone: 'moss' (the recommended next action), 'gold' (something due) or
//         'neutral' (coming up).
//   children: anything more under the description (e.g. a stage's steps).
const TONES = {
  moss: {
    card: 'border-moss/30 bg-moss/5',
    icon: 'bg-moss/15 text-moss',
    label: 'text-moss',
    button: 'bg-moss text-paper hover:opacity-90 focus-visible:ring-moss',
  },
  gold: {
    card: 'border-gold/50 bg-gold/10',
    icon: 'bg-gold/20 text-gold',
    label: 'text-gold',
    button: 'border border-gold/70 bg-card text-ink hover:border-gold focus-visible:ring-gold',
  },
  neutral: {
    card: 'border-hairline bg-paper',
    icon: 'bg-hairline/30 text-moss',
    label: 'text-secondary',
    button: 'border border-hairline bg-card text-ink hover:border-moss/60 focus-visible:ring-moss',
  },
}

export default function SkillHeaderCard({ id, tone = 'neutral', icon, label, title, description = null, action = null, children = null }) {
  const style = TONES[tone] ?? TONES.neutral
  return (
    <section
      aria-labelledby={id}
      className={`h-full rounded-lg border p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4 ${style.card}`}
    >
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <span aria-hidden="true" className={`shrink-0 flex h-9 w-9 items-center justify-center rounded-full ${style.icon}`}>
          {icon}
        </span>
        <div className="min-w-0">
          <p className={`font-mono text-[10px] uppercase tracking-wide ${style.label}`}>{label}</p>
          <h2 id={id} className="font-display text-lg text-ink leading-snug mt-0.5 text-balance">{title}</h2>
          {description && <p className="text-sm text-secondary mt-0.5 text-pretty">{description}</p>}
          {children}
        </div>
      </div>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className={`self-start ml-12 sm:ml-0 sm:self-center shrink-0 inline-flex items-center gap-1.5 rounded-md text-sm font-medium px-4 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${style.button}`}
        >
          {action.label}
          <span aria-hidden="true">→</span>
        </button>
      )}
    </section>
  )
}

export function FlagIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 22V4" />
      <path d="M4 4h12l-2 4 2 4H4" />
    </svg>
  )
}

export function CalendarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  )
}

export function TargetIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </svg>
  )
}
