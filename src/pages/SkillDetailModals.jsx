import { useLanguage } from '../context/LanguageContext'
import AccessibleDialog from '../components/AccessibleDialog'
import ActivityTimeline from '../components/ActivityTimeline'
import GrowthRing from '../components/GrowthRing'
import KnowledgeLevelBar from '../components/KnowledgeLevelBar'
import SelfAssessSection from '../components/SelfAssessSection'
import { LEVEL_LABELS, KNOWLEDGE_LEVEL_LABELS } from '../lib/levels'

// Dialogs opened from the skill page (see SkillDetail.jsx).

// Lists just the logged-activity entries the "Demonstrate" panel counts, as
// the dashboard's activity timeline, so activities look the same everywhere. Selecting one hands off
// to TimelineDetailModal instead of stacking a second dialog on top of this
// one, so only one AccessibleDialog is ever mounted at a time.
export function ActivitiesModal({ statements, onSelect, onClose }) {
  const { t } = useLanguage()
  const sorted = [...statements].sort((a, b) => new Date(b.recorded_at) - new Date(a.recorded_at))
  return (
    <AccessibleDialog
      labelledBy="activities-dialog-title"
      onClose={onClose}
      panelClassName="w-full max-w-md bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
        <div className="flex items-center justify-between mb-4">
          <h2 id="activities-dialog-title" className="font-display text-2xl text-ink">
            {sorted.length} {sorted.length === 1 ? t('skillDetail.activityLoggedSingular') : t('skillDetail.activityLoggedPlural')}
          </h2>
          <button type="button" onClick={onClose} className="text-secondary hover:text-ink text-sm shrink-0">
            {t('skillDetail.close')}
          </button>
        </div>
        <ActivityTimeline rows={sorted} onOpen={(row) => onSelect({ type: 'activity', statement: row })} />
    </AccessibleDialog>
  )
}

export function SelfAssessModal({
  skill,
  user,
  axis = 'practical',
  currentLevel = null,
  history = [],
  onClose,
  onAssessed,
  onGuideGenerated,
}) {
  const { t } = useLanguage()
  return (
    <AccessibleDialog
      labelledBy="self-assess-dialog-title"
      onClose={onClose}
      panelClassName="w-full max-w-md bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
        <div className="flex items-center justify-between mb-4">
          <h2 id="self-assess-dialog-title" className="font-display text-2xl text-ink">
            {axis === 'knowledge' ? t('skillDetail.selfAssessKnowledgeTitle') : t('skillDetail.selfAssessTitle')}
          </h2>
          <button type="button" onClick={onClose} className="text-secondary hover:text-ink text-sm">
            {t('skillDetail.close')}
          </button>
        </div>
        <SelfAssessSection
          skill={skill}
          user={user}
          axis={axis}
          currentLevel={currentLevel}
          onAssessed={onAssessed}
          onGuideGenerated={onGuideGenerated}
        />
        {(() => {
          const axisHistory = history.filter((a) => a.axis === axis)
          const labels = axis === 'knowledge' ? KNOWLEDGE_LEVEL_LABELS : LEVEL_LABELS
          return (
            axisHistory.length > 0 && (
              <div className="mt-6 pt-4 border-t border-hairline opacity-50">
                <h3 className="font-mono text-[10px] uppercase tracking-wide text-secondary mb-2">
                  {axis === 'knowledge' ? t('skillDetail.knowledge') : t('skillDetail.selfAssessmentWord')} {t('skillDetail.historySuffix')}
                </h3>
                <ul className="space-y-2">
                  {axisHistory.map((a) => (
                    <li key={a.id} className="flex items-start gap-2 text-sm">
                      {axis === 'knowledge' ? (
                        <KnowledgeLevelBar level={a.level} size={28} />
                      ) : (
                        <GrowthRing level={a.level} size={28} />
                      )}
                      <div className="min-w-0">
                        <p className="text-ink">{labels[a.level]}</p>
                        <p className="font-mono text-xs text-secondary">
                          {new Date(a.assessed_at).toLocaleDateString()}
                        </p>
                        {a.comments && <p className="text-xs text-secondary mt-0.5">{a.comments}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )
          )
        })()}
    </AccessibleDialog>
  )
}
