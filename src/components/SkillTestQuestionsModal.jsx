import { useEffect, useState } from 'react'
import { getSkillDiagnosticQuestions } from '../lib/skillStats'
import { KNOWLEDGE_LEVEL_LABELS } from '../lib/levels'
import AccessibleDialog from './AccessibleDialog'

// Read-only viewer for the already-generated (cached) knowledge-check quiz
// questions for one level -- see skill_diagnostic_content (0049). Shows
// exactly what's cached today; it never generates new content itself, since
// generation is a paid, server-side-only call (api/generate-diagnostic-quiz.js).
export default function SkillTestQuestionsModal({ librarySkillId, skillName, level, onClose }) {
  const [row, setRow] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    getSkillDiagnosticQuestions(librarySkillId)
      .then((rows) => setRow(rows.find((r) => r.level === level) ?? null))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [librarySkillId, level])

  const questions = row?.content?.questions ?? []

  return (
    <AccessibleDialog
      labelledBy="skill-test-questions-dialog-title"
      onClose={onClose}
      panelClassName="w-full max-w-lg bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
      <div className="flex items-center justify-between mb-1">
        <h2 id="skill-test-questions-dialog-title" className="font-display text-2xl text-ink">
          Test questions — {skillName}
        </h2>
        <button type="button" onClick={onClose} className="text-secondary hover:text-ink text-sm shrink-0">
          Close
        </button>
      </div>
      <p className="text-xs text-secondary mb-4">
        {level}. {KNOWLEDGE_LEVEL_LABELS[level]} — the knowledge-check quiz questions already generated and cached
        for this level.
      </p>

      {loading ? (
        <p className="text-secondary text-sm">Loading…</p>
      ) : error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : !row ? (
        <p className="text-sm text-secondary">Not generated yet for this level.</p>
      ) : (
        <ol className="space-y-3 list-decimal list-inside">
          {questions.map((q) => (
            <li key={q.id} className="text-sm text-ink">
              {q.description?.['en-US']}
              <ul className="mt-1 ml-4 space-y-0.5 list-disc list-inside text-secondary text-xs">
                {q.choices?.map((c) => (
                  <li key={c.id} className={q.correctResponsesPattern?.[0] === c.id ? 'text-moss' : undefined}>
                    {c.description?.['en-US']}
                    {q.correctResponsesPattern?.[0] === c.id ? ' (correct)' : ''}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </AccessibleDialog>
  )
}
