export default function TrackingReasonIcon({ reason, size = 18, className }) {
  const props = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className,
  }

  switch (reason) {
    case 'work':
      return (
        <svg {...props}>
          <rect x="2" y="7" width="20" height="14" rx="2" />
          <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
        </svg>
      )
    case 'career_development':
      // Ascending steps -- distinct from the lifecycle "Developing" stage's
      // trend-line icon, which this used to share a shape with.
      return (
        <svg {...props}>
          <path d="M3 21h4v-4h4v-4h4v-4h4V5" />
          <circle cx="19" cy="5" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'lifestyle':
      return (
        <svg {...props}>
          <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 21l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z" />
        </svg>
      )
    case 'personal_interest':
      return (
        <svg {...props}>
          <path d="M12 2l2.4 7.2H22l-6 4.4 2.3 7.2L12 16.8 5.7 20.8 8 13.6 2 9.2h7.6z" />
        </svg>
      )
    default:
      return null
  }
}
