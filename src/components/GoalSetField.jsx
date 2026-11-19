import { useLanguage } from '../context/LanguageContext'

const INPUT_CLASS =
  'w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss'

// One further set (Set 2, Set 3, ...) of a goal done in sets, with a way to
// take it out again. Each set is saved as its own activity. Shared by the
// quick log's cards and a goal's own entry form, so adding sets works the
// same in both.
export default function GoalSetField({ id, goal, number, value, onChange, onRemove }) {
  const { t } = useLanguage()
  const isCount = goal.measure_kind === 'count'
  return (
    <div>
      <div className="flex items-baseline justify-between gap-1 mb-1">
        <label htmlFor={id} className="text-xs text-secondary">{t('quickLog.setLabel', { number })}</label>
        <button
          type="button"
          onClick={onRemove}
          aria-label={t('quickLog.removeSet', { number })}
          className="text-xs text-secondary hover:text-ink leading-none"
        >
          ×
        </button>
      </div>
      <input
        id={id}
        type="number"
        inputMode={isCount ? 'numeric' : 'decimal'}
        min="0"
        step={isCount ? '1' : 'any'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={INPUT_CLASS}
      />
    </div>
  )
}
