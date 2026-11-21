import { useLanguage } from '../../context/LanguageContext'
import { LEVELS, LEVEL_LABELS } from '../../lib/levels'

// Skills an organisation or team leader suggested; adding one is the learner's choice.
export default function SkillSuggestionsSection({
  adoptForm,
  adoptingSuggestion,
  handleAdoptSuggestion,
  handleCancelAdopt,
  handleDismissSuggestion,
  handleOpenAdoptForm,
  setAdoptForm,
  skillSuggestions,
  suggestionActingId,
  suggestionError,
}) {
  const { t } = useLanguage()

  return (
    <div id="skill-suggestions">
      <h2 className="font-display text-xl text-ink mb-6">{t('actions.skillSuggestions')}</h2>
      <div className="space-y-3">
        {skillSuggestions.map((suggestion) => (
          <div key={suggestion.id} className="bg-card border border-hairline rounded-lg p-4">
            <p className="text-sm text-ink">
              <strong>{suggestion.sourceLabel}</strong> suggested you develop:{' '}
              <strong>{suggestion.skillName}</strong>
            </p>
            {(suggestion.suggestedTargetLevel || suggestion.targetDate) && (
              <p className="text-sm text-secondary mt-1">
                {suggestion.suggestedTargetLevel && `Suggested target: ${LEVEL_LABELS[suggestion.suggestedTargetLevel]}`}
                {suggestion.suggestedTargetLevel && suggestion.targetDate && ' by '}
                {suggestion.targetDate && new Date(`${suggestion.targetDate}T00:00:00`).toLocaleDateString()}
              </p>
            )}
            {suggestion.comments && <p className="text-sm text-secondary mt-1">{suggestion.comments}</p>}
            <p className="font-mono text-xs text-secondary mt-1">
              {new Date(suggestion.createdAt).toLocaleDateString()}
            </p>
            {suggestionError?.id === suggestion.id && (
              <p className="text-xs text-red-700 mt-1">{suggestionError.message}</p>
            )}

            {adoptingSuggestion === suggestion.id ? (
              <div className="mt-3 pt-3 border-t border-hairline space-y-3">
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={adoptForm.setTarget}
                    onChange={(e) => setAdoptForm((f) => ({ ...f, setTarget: e.target.checked }))}
                    className="size-4 accent-moss"
                  />
                  Also set a target
                </label>
                {adoptForm.setTarget && (
                  <div className="flex flex-wrap items-end gap-3">
                    <div>
                      <label className="block text-xs text-secondary mb-1" htmlFor={`adoptLevel-${suggestion.id}`}>
                        Target level
                      </label>
                      <select
                        id={`adoptLevel-${suggestion.id}`}
                        value={adoptForm.targetLevel}
                        onChange={(e) => setAdoptForm((f) => ({ ...f, targetLevel: e.target.value }))}
                        className="rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                      >
                        {LEVELS.map((l) => (
                          <option key={l} value={l}>{LEVEL_LABELS[l]}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-secondary mb-1" htmlFor={`adoptDate-${suggestion.id}`}>
                        Achieve by
                      </label>
                      <input
                        id={`adoptDate-${suggestion.id}`}
                        type="date"
                        value={adoptForm.targetDate}
                        onChange={(e) => setAdoptForm((f) => ({ ...f, targetDate: e.target.value }))}
                        className="rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                      />
                    </div>
                    <div className="flex-1 min-w-[180px]">
                      <label className="block text-xs text-secondary mb-1" htmlFor={`adoptComments-${suggestion.id}`}>
                        Comments
                      </label>
                      <input
                        id={`adoptComments-${suggestion.id}`}
                        value={adoptForm.comments}
                        onChange={(e) => setAdoptForm((f) => ({ ...f, comments: e.target.value }))}
                        className="w-full rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                      />
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleAdoptSuggestion(suggestion)}
                    disabled={suggestionActingId === suggestion.id}
                    className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
                  >
                    {suggestionActingId === suggestion.id ? 'Saving…' : 'Confirm and add'}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelAdopt}
                    disabled={suggestionActingId === suggestion.id}
                    className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => handleOpenAdoptForm(suggestion)}
                  disabled={suggestionActingId === suggestion.id}
                  className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
                >
                  Add to my skills
                </button>
                <button
                  type="button"
                  onClick={() => handleDismissSuggestion(suggestion)}
                  disabled={suggestionActingId === suggestion.id}
                  className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
