import { useLanguage } from '../context/LanguageContext'
import TimelineRail from './TimelineRail'

// Timeline placeholder for training the learner is enrolled in but hasn't
// completed -- shown dashed so it reads as upcoming, not as a dated event.
export default function PendingTrainingEntry({ link, hasMore, isFirst = false, onClick }) {
  const { t } = useLanguage()
  return (
    <div className="flex gap-3">
      <TimelineRail isFirst={isFirst} isLast={!hasMore}>
      <div className="flex items-center justify-center w-8 h-8 rounded-full border-2 border-dashed border-hairline">
        <span className="w-1.5 h-1.5 rounded-full bg-secondary/40" />
      </div>
      </TimelineRail>
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onClick()
          }
        }}
        className="min-w-0 flex-1 mb-6 rounded-md border border-hairline bg-paper/60 p-3 cursor-pointer hover:border-moss/60 transition-colors"
      >
        <p className="text-sm text-secondary">
          {t('skillDetail.enrolledInPrefix')} <span className="text-ink font-medium">{link.courses.name}</span> — {t('skillDetail.inProgressSuffix')}
        </p>
      </div>
    </div>
  )
}
