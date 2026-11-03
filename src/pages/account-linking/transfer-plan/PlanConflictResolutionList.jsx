import MutationFeedback from '../../../components/MutationFeedback'
import { useLanguage } from '../../../context/LanguageContext'

// Every detected conflict needs an explicit resolution before the plan can
// be approved. Choosing one here only proposes it as part of the plan --
// it doesn't apply it. `options`/`resolution` come entirely from the
// caller (real wording, e.g. specific levels or dates, lives there); this
// component never invents conflict text itself -- it only shows a
// caller-supplied `descriptionKey`/`labelKey` in the viewer's language
// instead of the English text when one is given.
//
// `readOnly` locks every radio -- used once the current viewer's approval
// is on file for this plan version (see PlanApprovalPanel), so changing a
// resolution can't silently invalidate an approval without an explicit
// withdrawal first.
export default function PlanConflictResolutionList({ conflicts, readOnly = false, error = null, onSelectResolution }) {
  const { t } = useLanguage()
  return (
    <div className="bg-card border border-hairline rounded-lg p-6">
      <h3 className="font-display text-lg text-ink mb-1">{t('connectedAccounts.planConflictResolutionList.heading', { count: conflicts.length })}</h3>
      <p className="text-sm text-secondary mb-4">
        {t('connectedAccounts.planConflictResolutionList.description')}
      </p>

      {readOnly && (
        <p className="text-xs text-secondary mb-4 pb-4 border-b border-hairline">
          {t('connectedAccounts.planConflictResolutionList.readOnlyNotice')}
        </p>
      )}

      {conflicts.length === 0 ? (
        <p className="text-sm text-secondary py-2">{t('connectedAccounts.planConflictResolutionList.emptyState')}</p>
      ) : (
        <div className="space-y-5">
          {conflicts.map((conflict) => (
            <fieldset key={conflict.id} className="border-t border-hairline pt-4 first:border-0 first:pt-0">
              <legend className="text-sm text-ink mb-2">{conflict.descriptionKey ? t(conflict.descriptionKey, conflict.descriptionParams) : conflict.description}</legend>
              <div className="space-y-2">
                {conflict.options.map((option) => (
                  <label key={option.value} className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name={`conflict-${conflict.id}`}
                      value={option.value}
                      checked={conflict.resolution === option.value}
                      disabled={readOnly}
                      onChange={() => onSelectResolution?.(conflict.id, option.value)}
                      className="mt-0.5"
                    />
                    <span className="text-sm text-ink">{option.labelKey ? t(option.labelKey) : option.label}</span>
                  </label>
                ))}
              </div>
              {!conflict.resolution && <p className="text-xs text-red-700 mt-2">{t('connectedAccounts.planConflictResolutionList.notYetResolved')}</p>}
            </fieldset>
          ))}
        </div>
      )}

      <MutationFeedback status="error" message={error} className="mt-4" />
    </div>
  )
}
