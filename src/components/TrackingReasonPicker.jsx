import TrackingReasonIcon from './TrackingReasonIcon'
import { TRACKING_REASONS } from '../lib/trackingReasons'
import { useLanguage } from '../context/LanguageContext'

export default function TrackingReasonPicker({ value, onChange, required = false }) {
  const { t } = useLanguage()
  return (
    <div>
      <span className="block text-sm text-secondary mb-2">
        {t('modals.trackingReasonPicker.whyTracking')}{!required && ` ${t('modals.trackingReasonPicker.optionalSuffix')}`}
      </span>
      <div className="grid grid-cols-2 gap-2">
        {TRACKING_REASONS.map((r) => (
          <button
            type="button"
            key={r.value}
            onClick={() => onChange(value === r.value ? null : r.value)}
            className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
              value === r.value
                ? 'border-moss bg-moss/10 text-ink'
                : 'border-hairline text-secondary hover:text-ink'
            }`}
          >
            <TrackingReasonIcon reason={r.value} size={18} />
            {r.label}
          </button>
        ))}
      </div>
    </div>
  )
}
