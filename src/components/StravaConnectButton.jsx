import StravaIcon from './StravaIcon'
import { useLanguage } from '../context/LanguageContext'

export default function StravaConnectButton({ onClick, disabled, label = null }) {
  const { t } = useLanguage()
  const resolvedLabel = label ?? t('common.connectStrava')
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full flex items-center justify-center gap-2 rounded-md border border-hairline bg-card text-ink py-2 font-medium hover:bg-paper disabled:opacity-60"
    >
      <StravaIcon />
      {resolvedLabel}
    </button>
  )
}
