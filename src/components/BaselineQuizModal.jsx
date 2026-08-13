import { useEffect, useState } from 'react'
import { generateQuiz, saveQuizResult } from '../lib/skillQuiz'

export default function BaselineQuizModal({ skill, user, onClose, onCompleted }) {
  const [questions, setQuestions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [index, setIndex] = useState(0)
  const [selected, setSelected] = useState(null)
  const [answers, setAnswers] = useState([])
  const [finished, setFinished] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    generateQuiz(skill.name)
      .then((qs) => {
        if (qs.length === 0) throw new Error("Couldn't generate any questions for this skill.")
        setQuestions(qs)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  async function finish(finalAnswers) {
    setFinished(true)
    setSaving(true)
    try {
      const withAnswers = questions.map((q, i) => ({ ...q, selectedIndex: finalAnswers[i] }))
      const score = questions.reduce(
        (acc, q, i) => acc + (finalAnswers[i] === q.correctIndex ? 1 : 0),
        0
      )
      await saveQuizResult(user.id, skill.id, withAnswers, score, questions.length)
      onCompleted?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  function next() {
    const updated = [...answers, selected]
    setAnswers(updated)
    setSelected(null)
    if (index + 1 < questions.length) {
      setIndex(index + 1)
    } else {
      finish(updated)
    }
  }

  const score = finished
    ? questions.reduce((acc, q, i) => acc + (answers[i] === q.correctIndex ? 1 : 0), 0)
    : 0

  return (
    <div className="fixed inset-0 bg-ink/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        className="w-full max-w-md bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-2xl text-ink mb-1">Baseline quiz</h2>
        <p className="text-sm text-secondary mb-4">{skill.name}</p>

        {loading && <p className="text-sm text-secondary">Generating questions…</p>}
        {error && <p className="text-sm text-red-700">{error}</p>}

        {!loading && !error && !finished && questions.length > 0 && (
          <div>
            <p className="font-mono text-xs uppercase tracking-wide text-secondary mb-2">
              Question {index + 1} of {questions.length}
            </p>
            <p className="text-sm text-ink mb-3">{questions[index].question}</p>
            <div className="space-y-2 mb-4">
              {questions[index].options.map((opt, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setSelected(i)}
                  className={`w-full text-left rounded-md border px-3 py-2 text-sm ${
                    selected === i
                      ? 'border-moss bg-moss/10 text-ink'
                      : 'border-hairline text-ink hover:bg-paper'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={next}
                disabled={selected === null}
                className="flex-1 rounded-md bg-moss text-paper py-2 font-medium hover:opacity-90 disabled:opacity-60"
              >
                {index + 1 < questions.length ? 'Next' : 'Finish'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-hairline text-ink py-2 px-4 hover:bg-paper"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {finished && (
          <div>
            <p className="text-sm text-ink mb-4">
              You scored <strong>{score} / {questions.length}</strong>.
            </p>
            <ul className="space-y-3 mb-4">
              {questions.map((q, i) => (
                <li key={i} className="text-sm">
                  <p className="text-ink">{q.question}</p>
                  <p className={answers[i] === q.correctIndex ? 'text-moss' : 'text-red-700'}>
                    Your answer: {q.options[answers[i]] ?? '—'}
                  </p>
                  {answers[i] !== q.correctIndex && (
                    <p className="text-secondary">Correct: {q.options[q.correctIndex]}</p>
                  )}
                </li>
              ))}
            </ul>
            {saving && <p className="text-xs text-secondary mb-2">Saving…</p>}
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-md bg-moss text-paper py-2 font-medium hover:opacity-90"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
