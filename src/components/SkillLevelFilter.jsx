import { useLanguage } from '../context/LanguageContext'
import { LEVEL_LABELS } from '../lib/levels'

// "Skill level: Any level / Expert / Skilled or above / …" for a list of
// people with a skill (see peopleByLevel.js). value: the minimum level, 0 for
// any.
export default function SkillLevelFilter({ id, value, onChange, className = '' }) {
  const { t } = useLanguage()
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-xs text-secondary mb-1">
        {t('modals.peopleWithSkill.levelFilterLabel')}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
      >
        <option value={0}>{t('modals.peopleWithSkill.levelAny')}</option>
        {[5, 4, 3, 2].map((level) => (
          <option key={level} value={level}>
            {level === 5 ? LEVEL_LABELS[5] : t('modals.peopleWithSkill.levelAtLeast', { level: LEVEL_LABELS[level] })}
          </option>
        ))}
      </select>
    </div>
  )
}
