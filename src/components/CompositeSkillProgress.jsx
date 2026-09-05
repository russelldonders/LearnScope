import { Link } from 'react-router-dom'
import { LEVEL_LABELS } from '../lib/levels'

export default function CompositeSkillProgress({ composite, loading = false, error = null }) {
  if (loading) {
    return <p role="status" className="mt-4 border-t border-hairline pt-4 text-sm text-secondary">Loading component progress…</p>
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
          <h3 id="component-progress-heading" className="font-display text-lg text-ink">Component progress</h3>
          <p className="mt-1 max-w-2xl text-sm text-secondary">
            Progress across the skills that make up this broader capability. This does not change your confirmed level.
          </p>
        </div>
        <div className="text-right">
          <p className="font-display text-2xl text-ink tabular-nums">{coverage.percentage}%</p>
          <p className="text-xs text-secondary">
            {coverage.requiredTotal > 0
              ? `${coverage.requiredMet} of ${coverage.requiredTotal} required targets met`
              : 'No required components'}
          </p>
        </div>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-paper" aria-hidden="true">
        <div className="h-full rounded-full bg-moss transition-[width]" style={{ width: `${coverage.percentage}%` }} />
      </div>
      <span className="sr-only">{coverage.percentage}% component coverage</span>

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
                {component.isRequired ? 'Required' : 'Optional'} · Target level {component.targetLevel}, {LEVEL_LABELS[component.targetLevel]}
              </p>
              {component.childComposite && (
                <p className="mt-1 text-xs text-secondary">
                  Also built from {component.childComposite.components.length} subskill{component.childComposite.components.length === 1 ? '' : 's'} ·{' '}
                  {component.childComposite.coverage.percentage}% subskill coverage
                </p>
              )}
            </div>
            <div className="sm:text-right">
              <p className={`text-sm font-medium ${component.targetMet ? 'text-moss' : 'text-ink'}`}>
                {component.targetMet
                  ? component.currentLevel != null && component.currentLevel >= component.targetLevel
                    ? 'Target met'
                    : 'Target met through subskills'
                  : component.currentLevel
                    ? `Level ${component.currentLevel} of ${component.targetLevel}`
                    : 'Not yet tracked'}
              </p>
              {!component.trackedSkillId && <p className="text-xs text-secondary">Add it from your Skills page to begin.</p>}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-secondary">Based on published component set version {composite.version}.</p>
    </section>
  )
}
