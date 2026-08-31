import StravaIcon from './StravaIcon'

export default function StravaConnectButton({ onClick, disabled, label = 'Connect Strava' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full flex items-center justify-center gap-2 rounded-md border border-hairline bg-card text-ink py-2 font-medium hover:bg-paper disabled:opacity-60"
    >
      <StravaIcon />
      {label}
    </button>
  )
}
