// One look per kind of tie between people, used wherever teams and
// management show up together (the Teams switcher, connection cards, a
// connection's page) so each kind reads the same at a glance:
//   organisation -- a reporting line at an employer: a building, in slate
//   teamLead     -- a team you lead (or co-lead): a flag, in moss
//   team         -- a team you're in: people, in moss
//   invited      -- a team invitation still waiting: an envelope, in gold
// Decorative only: the words beside it always say what the tie is.
const STYLES = {
  organisation: 'text-slate bg-slate/10 border-slate/30',
  teamLead: 'text-moss bg-moss/10 border-moss/30',
  team: 'text-moss bg-moss/10 border-moss/30',
  invited: 'text-gold bg-gold/10 border-gold/40',
}

const PATHS = {
  organisation: (
    <>
      <path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16" />
      <path d="M15 9h4a1 1 0 0 1 1 1v11M2 21h20M8 8h3M8 12h3M8 16h3" />
    </>
  ),
  teamLead: (
    <>
      <path d="M5 21V4" />
      <path d="M5 4h11l-2 4 2 4H5" />
    </>
  ),
  team: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M17 14c2.6 0 4.5 1.8 4.5 4.5" />
    </>
  ),
  invited: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </>
  ),
}

// size: 'sm' sits inline with text; 'list' and 'md' match the switcher's
// avatars in its list and on its button.
const SIZES = {
  sm: { box: 'w-5 h-5 rounded', glyph: 12 },
  list: { box: 'w-7 h-7 rounded-md', glyph: 15 },
  md: { box: 'w-9 h-9 rounded-md', glyph: 18 },
}

export default function TieIcon({ kind, size = 'sm' }) {
  const { box, glyph } = SIZES[size] ?? SIZES.sm
  return (
    <span aria-hidden="true" className={`${box} shrink-0 inline-flex items-center justify-center border ${STYLES[kind] ?? STYLES.team}`}>
      <svg width={glyph} height={glyph} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        {PATHS[kind] ?? PATHS.team}
      </svg>
    </span>
  )
}
