// Small disclosure chevron; rotates to point up while its section is open.
export default function Chevron({ open, className = '' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''} ${className}`}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}
