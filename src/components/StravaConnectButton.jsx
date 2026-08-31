export default function StravaConnectButton({ onClick, disabled, label = 'Connect Strava' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full flex items-center justify-center gap-2 rounded-md border border-hairline bg-card text-ink py-2 font-medium hover:bg-paper disabled:opacity-60"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="#FC4C02"
          d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066M13.828 10.172L11.762 6.02l-2.03 4.152H6.667L11.762 0l5.151 10.172z"
        />
      </svg>
      {label}
    </button>
  )
}
