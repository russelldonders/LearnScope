// Falls back to a generated visual when a course has no uploaded image
// (0093's course_catalogue.image_url) -- deterministic (same course always
// gets the same look) rather than random, so it doesn't reshuffle on every
// reload, and free/instant rather than calling an image-generation API for
// a placeholder.
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

// gradientColors: [from, to] hex pair overriding the deterministic pair
// below -- used only by ProviderProfile.jsx to theme this fallback with an
// org's own Primary/Secondary brand colours on its public page, so every
// other caller (Dashboard.jsx, Learning.jsx, CourseCatalogue.jsx, etc.)
// keeps today's varied-by-course-name look untouched.
export default function CourseThumbnail({ name, provider, logoUrl, imageUrl, gradientColors, className = '' }) {
  const seed = `${name ?? ''}|${provider ?? ''}`
  const [defaultFrom, defaultTo] = GRADIENT_PAIRS[hashString(seed) % GRADIENT_PAIRS.length]
  const [from, to] = gradientColors ?? [defaultFrom, defaultTo]
  const initial = name?.trim()?.[0]?.toUpperCase() ?? '?'

  return (
    <div
      aria-hidden="true"
      className={`relative flex items-center justify-center ${className}`}
      style={imageUrl ? undefined : { background: `linear-gradient(135deg, ${from}, ${to})` }}
    >
      {imageUrl ? (
        <img src={imageUrl} alt="" className="w-full h-full object-cover" />
      ) : (
        // Same theme-flip reasoning as ProviderProfile.jsx's ctaTextClass --
        // a custom gradient has no dark-mode variant of its own, so it's
        // paired with fixed white rather than the theme-dependent text-paper.
        <span className={`font-display text-3xl ${gradientColors ? 'text-white/90' : 'text-paper/90'}`}>{initial}</span>
      )}
      {logoUrl && (
        <div className="absolute bottom-1.5 left-1.5 w-7 h-7 rounded-md bg-[var(--org-background,var(--color-paper))] border border-hairline/50 shadow-sm overflow-hidden flex items-center justify-center">
          <img src={logoUrl} alt="" className="w-full h-full object-contain p-0.5" />
        </div>
      )}
    </div>
  )
}
