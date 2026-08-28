// Every course tile gets a generated visual since there's no real course
// image anywhere in the data model -- deterministic (same course always
// gets the same look) rather than random, so it doesn't reshuffle on every
// reload, and free/instant rather than calling an image-generation API for
// a placeholder. Swap this out if real course images are ever introduced.
const GRADIENT_PAIRS = [
  ['#4a6741', '#3d5a73'], // moss -> slate
  ['#b8912a', '#4a6741'], // gold -> moss
  ['#3d5a73', '#8fb885'], // slate -> evidence green
  ['#8fb885', '#b8912a'], // evidence green -> gold
  ['#4a6741', '#b8912a'], // moss -> gold
  ['#3d5a73', '#b8912a'], // slate -> gold
]

function hashString(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

export default function CourseThumbnail({ name, provider, logoUrl, className = '' }) {
  const seed = `${name ?? ''}|${provider ?? ''}`
  const [from, to] = GRADIENT_PAIRS[hashString(seed) % GRADIENT_PAIRS.length]
  const initial = name?.trim()?.[0]?.toUpperCase() ?? '?'

  return (
    <div
      aria-hidden="true"
      className={`relative flex items-center justify-center ${className}`}
      style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
    >
      <span className="font-display text-3xl text-paper/90">{initial}</span>
      {logoUrl && (
        <div className="absolute bottom-1.5 left-1.5 w-7 h-7 rounded-md bg-paper border border-hairline/50 shadow-sm overflow-hidden flex items-center justify-center">
          <img src={logoUrl} alt="" className="w-full h-full object-contain p-0.5" />
        </div>
      )}
    </div>
  )
}
