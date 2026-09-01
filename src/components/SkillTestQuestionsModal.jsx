import { useEffect, useState } from 'react'
import { getSkillDiagnosticQuestions } from '../lib/skillStats'
import { KNOWLEDGE_LEVEL_LABELS, LEVELS } from '../lib/levels'
import AccessibleDialog from './AccessibleDialog'

// Read-only viewer for the already-generated (cached) knowledge-check quiz
// questions per level -- see skill_diagnostic_content (0049). Shows exactly
// what's cached today; it never generates new content itself, since
// generation is a paid, server-side-only call (api/generate-diagnostic-quiz.js).
export default function SkillTestQuestionsModal({ librarySkillId, skillName, initialLevel = null, onClose }) {
  const [byLevel, setByLevel] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [openLevel, setOpenLevel] = useState(initialLevel)

  useEffect(() => {
    setLoading(true)
    setError(null)
    getSkillDiagnosticQuestions(librarySkillId)
      .then((rows) => setByLevel(new Map(rows.map((r) => [r.level, r]))))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [librarySkillId])

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
        The knowledge-check quiz questions already generated and cached for each level.
      </p>

      {loading ? (
        <p className="text-secondary text-sm">Loading…</p>
      ) : error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : (
        <ul className="divide-y divide-hairline border border-hairline rounded-md">
          {LEVELS.map((level) => {
            const row = byLevel.get(level)
            const questions = row?.content?.questions ?? []
            const isOpen = openLevel === level
            return (
              <li key={level} className="p-3 text-sm">
                <button
                  type="button"
                  disabled={!row}
                  onClick={() => setOpenLevel(isOpen ? null : level)}
                  className="w-full flex items-center justify-between gap-3 text-left disabled:cursor-default"
                >
                  <span className="text-ink font-medium">
                    {level}. {KNOWLEDGE_LEVEL_LABELS[level]}
                  </span>
                  <span className="text-xs text-secondary shrink-0">
                    {row
                      ? `${questions.length} question${questions.length === 1 ? '' : 's'}${isOpen ? ' ▲' : ' ▼'}`
                      : 'Not generated yet'}
                  </span>
                </button>
                {isOpen && (
                  <ol className="mt-3 space-y-3 list-decimal list-inside">
                    {questions.map((q) => (
                      <li key={q.id} className="text-ink">
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
              </li>
            )
          })}
        </ul>
      )}
    </AccessibleDialog>
  )
}
