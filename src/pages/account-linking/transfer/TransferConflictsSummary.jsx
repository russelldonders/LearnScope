import { LEVEL_LABELS } from '../../../lib/levels'
import { useLanguage } from '../../../context/LanguageContext'

// Read-only summary of potential conflicts between two verified accounts'
// profiles -- informational only, nothing here can be resolved, merged or
// edited from this view. Each category has its own empty state so "no
// conflicts found" reads distinctly from an actual list.
export default function TransferConflictsSummary({ conflicts }) {
  const { t } = useLanguage()
  return (
    <div className="bg-card border border-hairline rounded-lg p-6">
      <h3 className="font-display text-lg text-ink mb-1">{t('connectedAccounts.transferConflictsSummary.heading')}</h3>
      <p className="text-sm text-secondary mb-4">
        {t('connectedAccounts.transferConflictsSummary.description')}
      </p>

      <div className="space-y-4">
        <div>
          <p className="text-sm font-medium text-ink mb-1">{t('connectedAccounts.transferConflictsSummary.duplicateSkillsHeading', { count: conflicts.duplicateSkills.length })}</p>
          {conflicts.duplicateSkills.length === 0 ? (
            <p className="text-sm text-secondary">{t('connectedAccounts.transferConflictsSummary.noDuplicateSkills')}</p>
          ) : (
            <ul className="text-sm text-ink space-y-1">
              {conflicts.duplicateSkills.map((skill) => (
                <li key={skill.name}>
                  {t('connectedAccounts.transferConflictsSummary.duplicateSkillLine', {
                    name: skill.name,
                    levelA: LEVEL_LABELS[skill.levelA] ?? skill.levelA,
                    levelB: LEVEL_LABELS[skill.levelB] ?? skill.levelB,
                  })}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="text-sm font-medium text-ink mb-1">
            {t('connectedAccounts.transferConflictsSummary.overlappingCoursesHeading', { count: conflicts.overlappingCourses.length })}
          </p>
          {conflicts.overlappingCourses.length === 0 ? (
            <p className="text-sm text-secondary">{t('connectedAccounts.transferConflictsSummary.noOverlappingCourses')}</p>
          ) : (
            <ul className="text-sm text-ink space-y-1">
              {conflicts.overlappingCourses.map((course) => (
                <li key={course.title}>{course.title}</li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="text-sm font-medium text-ink mb-1">
            {t('connectedAccounts.transferConflictsSummary.duplicateExperienceHeading', { count: conflicts.possibleDuplicateExperience.length })}
          </p>
          {conflicts.possibleDuplicateExperience.length === 0 ? (
            <p className="text-sm text-secondary">{t('connectedAccounts.transferConflictsSummary.noDuplicateExperience')}</p>
          ) : (
            <ul className="text-sm text-ink space-y-1">
              {conflicts.possibleDuplicateExperience.map((pair, index) => (
                <li key={index}>
                  {t('connectedAccounts.transferConflictsSummary.duplicateExperienceLine', {
                    titleA: pair.titleA,
                    organizationA: pair.organizationA,
                    titleB: pair.titleB,
                    organizationB: pair.organizationB,
                  })}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
