import { useEffect, useState } from 'react'
import GrowthRing from './GrowthRing'
import { LEVEL_LABELS } from '../lib/levels'
import { activityName, verbLabel } from '../lib/xapiStatement'
import { fetchPeerRaterProgress, buildWeightedPeerRatings } from '../lib/baselineAssessment'
import { validateSkillAgainstTarget, saveValidationResult } from '../lib/skillValidation'
import AccessibleDialog from './AccessibleDialog'
import { useLanguage } from '../context/LanguageContext'

export default function ValidateSkillModal({
  skill,
  user,
  target,
  assessments,
  peerRatings,
  statements,
  onClose,
  onValidated,
}) {
  const { t } = useLanguage()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function run() {
      try {
        // axis === 'practical' -- see AssessBaselineModal for why this
        // matters: without it a knowledge self-assessment could leak into
        // this practical-only synthesis if it happened to be more recent.
        const latestSelf = assessments
          .filter((a) => (a.source === 'self' || !a.source) && a.axis === 'practical')
          .sort((a, b) => new Date(b.assessed_at) - new Date(a.assessed_at))[0]

        const raterProgress = peerRatings.length > 0 ? await fetchPeerRaterProgress(skill.id) : []
        const weightedPeerRatings = buildWeightedPeerRatings(peerRatings, raterProgress)

        const activities = statements.map((s) => ({
          verb: verbLabel(s.statement),
          activity: activityName(s.statement),
          description: s.statement.object?.definition?.description?.['en-US'] ?? null,
          date: new Date(s.recorded_at).toLocaleDateString(),
        }))

        const res = await validateSkillAgainstTarget({
          skill,
          targetLevel: target.target_level,
          selfLevel: latestSelf?.level ?? null,
          selfComments: latestSelf?.comments,
          activities,
          peerRatings: weightedPeerRatings,
        })
        setResult(res)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    run()
  }, [])

  async function handleConfirm(goToDeveloping) {
    setSaving(true)
    try {
      await saveValidationResult(user, skill, result, goToDeveloping)
      onValidated()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <AccessibleDialog
      labelledBy="ai-assessment-dialog-title"
      onClose={onClose}
      panelClassName="w-full max-w-md bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
        <h2 id="ai-assessment-dialog-title" className="font-display text-2xl text-ink mb-1">{t('modals.validateSkill.title')}</h2>
        <p className="text-sm text-secondary mb-4">
          {t('modals.validateSkill.subtitle', { skillName: skill.name, level: LEVEL_LABELS[target.target_level] })}
        </p>

        {loading && (
          <p className="text-sm text-secondary">
            {t('modals.validateSkill.weighing')}
          </p>
        )}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

        {result && !loading && (
          <div>
            <div className="flex items-center gap-3 mb-3">
              <GrowthRing level={result.level} size={48} />
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wide text-secondary">{t('modals.validateSkill.currentLevel')}</p>
                <p className="text-ink font-medium">{LEVEL_LABELS[result.level]}</p>
              </div>
            </div>

            <p
              className={`font-mono text-xs uppercase tracking-wide rounded-full px-2.5 py-1 inline-block mb-3 border ${
                result.passed ? 'text-moss border-moss bg-moss/10' : 'text-gold border-gold bg-gold/10'
              }`}
            >
              {result.passed ? t('modals.validateSkill.targetReached') : t('modals.validateSkill.targetNotYetReached')}
            </p>

            <p className="text-sm text-ink mb-4">{result.feedback}</p>

            {result.passed ? (
              <>
                <p className="text-xs text-secondary mb-4">
                  {t('modals.validateSkill.confirmingWillMoveToMaintaining')}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleConfirm(false)}
                    disabled={saving}
                    className="flex-1 rounded-md bg-moss text-paper py-2 font-medium hover:opacity-90 disabled:opacity-60"
                  >
                    {saving ? t('modals.validateSkill.saving') : t('modals.validateSkill.confirmAndMoveToMaintaining')}
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-md border border-hairline text-ink py-2 px-4 hover:bg-paper"
                  >
                    {t('modals.validateSkill.cancel')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-xs text-secondary mb-4">
                  {t('modals.validateSkill.saveKeepTryingDescription')}
                </p>
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => handleConfirm(false)}
                    disabled={saving}
                    className="w-full rounded-md bg-moss text-paper py-2 font-medium hover:opacity-90 disabled:opacity-60"
                  >
                    {saving ? t('modals.validateSkill.saving') : t('modals.validateSkill.saveFeedbackKeepTrying')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleConfirm(true)}
                    disabled={saving}
                    className="w-full rounded-md border border-hairline text-ink py-2 font-medium hover:bg-paper disabled:opacity-60"
                  >
                    {t('modals.validateSkill.saveFeedbackGoBackToDeveloping')}
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={saving}
                    className="w-full text-sm text-secondary hover:text-ink py-1"
                  >
                    {t('modals.validateSkill.cancel')}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
    </AccessibleDialog>
  )
}
