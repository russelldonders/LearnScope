import { Link } from 'react-router-dom'
import { LEVEL_LABELS } from '../lib/levels'
import { useLanguage } from '../context/LanguageContext'

export default function CompositeSkillProgress({
  composite,
  loading = false,
  error = null,
  onStartComponent,
  startingComponentId = null,
  startError = null,
}) {
  const { t } = useLanguage()
  if (loading) {
    return <p role="status" className="mt-4 border-t border-hairline pt-4 text-sm text-secondary">{t('modals.compositeSkillProgress.loadingComponentProgress')}</p>
  }
  if (error) {
    return <p role="alert" className="mt-4 border-t border-hairline pt-4 text-sm text-red-700">{error}</p>
  }
  if (!composite) return null

  const { coverage, components } = composite
  return (
    <section aria-labelledby="component-progress-heading" className="mt-4 border-t border-hairline pt-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 id="component-progress-heading" className="font-display text-lg text-ink">{t('modals.compositeSkillProgress.heading')}</h3>
          <p className="mt-1 max-w-2xl text-sm text-secondary">
            {t('modals.compositeSkillProgress.description')}
          </p>
        </div>
        <div className="text-right">
          <p className="font-display text-2xl text-ink tabular-nums">{coverage.percentage}%</p>
          <p className="text-xs text-secondary">
            {coverage.requiredTotal > 0
              ? t('modals.compositeSkillProgress.requiredTargetsMet', { met: coverage.requiredMet, total: coverage.requiredTotal })
              : t('modals.compositeSkillProgress.noRequiredComponents')}
          </p>
        </div>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-paper" aria-hidden="true">
        <div className="h-full rounded-full bg-moss transition-[width]" style={{ width: `${coverage.percentage}%` }} />
      </div>
      <span className="sr-only">{t('modals.compositeSkillProgress.componentCoverageSr', { percentage: coverage.percentage })}</span>

      {startError && <p role="alert" className="mt-3 text-sm text-red-700">{startError}</p>}

      <ul className="mt-4 divide-y divide-hairline border-y border-hairline">
        {components.map((component) => (
          <li key={component.id} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="min-w-0">
              {component.trackedSkillId ? (
                <Link to={`/skills/${component.trackedSkillId}`} className="text-sm font-medium text-ink hover:text-moss hover:underline underline-offset-2">
                  {component.name}
                </Link>
              ) : (
                <p className="text-sm font-medium text-ink">{component.name}</p>
              )}
              <p className="mt-0.5 text-xs text-secondary">
                {component.isRequired ? t('modals.compositeSkillProgress.required') : t('modals.compositeSkillProgress.optional')} ·{' '}
                {t('modals.compositeSkillProgress.targetLevelLabel', { level: component.targetLevel, label: LEVEL_LABELS[component.targetLevel] })}
              </p>
              {component.childComposite && (
                <p className="mt-1 text-xs text-secondary">
                  {component.childComposite.components.length === 1
                    ? t('modals.compositeSkillProgress.alsoBuiltFromSingular', {
                        count: component.childComposite.components.length,
                        percentage: component.childComposite.coverage.percentage,
                      })
                    : t('modals.compositeSkillProgress.alsoBuiltFromPlural', {
                        count: component.childComposite.components.length,
                        percentage: component.childComposite.coverage.percentage,
                      })}
                </p>
              )}
            </div>
            <div className="sm:text-right">
              <p className={`text-sm font-medium ${component.targetMet ? 'text-moss' : 'text-ink'}`}>
                {component.targetMet
                  ? component.currentLevel != null && component.currentLevel >= component.targetLevel
                    ? t('modals.compositeSkillProgress.targetMet')
                    : t('modals.compositeSkillProgress.targetMetThroughSubskills')
                  : component.currentLevel
                    ? t('modals.compositeSkillProgress.levelOfLevel', { current: component.currentLevel, target: component.targetLevel })
                    : t('modals.compositeSkillProgress.notYetTracked')}
              </p>
              {!component.trackedSkillId && (
                <button
                  type="button"
                  onClick={() => onStartComponent?.(component)}
                  disabled={startingComponentId === component.id}
                  className="text-xs font-medium text-moss hover:underline disabled:opacity-60"
                >
                  {startingComponentId === component.id ? t('modals.compositeSkillProgress.starting') : t('modals.compositeSkillProgress.startWorkingNow')}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-secondary">{t('modals.compositeSkillProgress.basedOnVersion', { version: composite.version })}</p>
    </section>
  )
}
