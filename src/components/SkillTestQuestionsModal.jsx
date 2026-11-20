import { useEffect, useState } from 'react'
import { KNOWLEDGE_LEVEL_LABELS } from '../lib/levels'
import {
  QUESTION_TYPE_LABELS,
  addSkillQuestion,
  generateSkillQuestions,
  listSkillQuestions,
  newSkillQuestion,
  setSkillQuestionStatus,
  updateSkillQuestion,
} from '../lib/admin/skillQuestions'
import AccessibleDialog from './AccessibleDialog'
import PageInteractiveEditor from './PageInteractiveEditor'

const GENERATE_COUNTS = [1, 3, 5, 10, 15, 20]
const SOURCE_LABELS = { ai: 'AI', manual: 'Manual', imported: 'Imported' }

// A skill's knowledge-check question pool for one level (skill_questions,
// 0323), managed by a platform admin from the skill library: edit any
// question, add one by hand, generate more with AI, and deactivate or
// reactivate. Learners' quizzes draw 10 at a time from the active ones and
// grow the pool to 100 on their own; nothing here is limited by that cap.
export default function SkillTestQuestionsModal({ librarySkillId, skillName, level, userId, onClose, onCountsChange }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('active')
  const [editingId, setEditingId] = useState(null) // question id, or 'new'
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const [generateCount, setGenerateCount] = useState(5)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      setRows(await listSkillQuestions(librarySkillId, level))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reloads per skill and level
  }, [librarySkillId, level])

  function replaceRow(row) {
    setRows((prev) => prev.map((r) => (r.id === row.id ? row : r)))
  }

  function startEdit(row) {
    setEditingId(row.id)
    setDraft(structuredClone(row.question))
    setNotice(null)
    setError(null)
  }

  function startAdd() {
    setEditingId('new')
    setDraft(newSkillQuestion())
    setNotice(null)
    setError(null)
  }

  async function saveDraft() {
    setBusy(true)
    setError(null)
    try {
      if (editingId === 'new') {
        const row = await addSkillQuestion({ userId, librarySkillId, level, block: draft })
        setRows((prev) => [row, ...prev])
        setFilter((f) => (f === 'inactive' ? 'active' : f))
        setNotice('Question added.')
        onCountsChange?.()
      } else {
        replaceRow(await updateSkillQuestion(editingId, draft))
        setNotice('Question saved.')
      }
      setEditingId(null)
      setDraft(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function toggleStatus(row) {
    setBusy(true)
    setError(null)
    try {
      replaceRow(await setSkillQuestionStatus(row.id, row.status === 'active' ? 'inactive' : 'active'))
      onCountsChange?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function generate() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const added = await generateSkillQuestions({ librarySkillId, level, count: generateCount })
      await load()
      setNotice(added === 1 ? '1 question generated.' : `${added} questions generated.`)
      onCountsChange?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const activeCount = rows.filter((r) => r.status === 'active').length
  const inactiveCount = rows.length - activeCount
  const visible = rows.filter((r) => filter === 'all' || r.status === filter)

  return (
    <AccessibleDialog
      labelledBy="skill-test-questions-dialog-title"
      onClose={onClose}
      panelClassName="w-full max-w-2xl bg-card border border-hairline rounded-lg max-h-[90vh] flex flex-col overflow-hidden"
    >
      <div className="border-b border-hairline px-6 pt-5 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="skill-test-questions-dialog-title" className="font-display text-2xl text-ink">
              Test questions — {skillName}
            </h2>
            <p className="text-xs text-secondary mt-0.5">
              {level}. {KNOWLEDGE_LEVEL_LABELS[level]} · {activeCount} active
              {inactiveCount ? ` · ${inactiveCount} deactivated` : ''}. Learners get 10 at a time; their quizzes add
              more until there are 100.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-secondary hover:text-ink text-sm shrink-0">
            Close
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={startAdd}
            disabled={busy || editingId !== null}
            className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
          >
            Add question
          </button>
          <div className="flex items-center gap-1.5">
            <label htmlFor="generate-question-count" className="sr-only">
              Number of questions to generate
            </label>
            <select
              id="generate-question-count"
              value={generateCount}
              onChange={(e) => setGenerateCount(Number(e.target.value))}
              disabled={busy}
              className="rounded-md border border-hairline bg-paper px-2 py-1.5 text-sm text-ink"
            >
              {GENERATE_COUNTS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={generate}
              disabled={busy}
              className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
            >
              {busy && editingId === null ? 'Working…' : 'Generate with AI'}
            </button>
          </div>
          <div className="ml-auto flex rounded-md border border-hairline p-0.5 text-xs" role="group" aria-label="Show questions">
            {[
              ['active', 'Active'],
              ['inactive', 'Deactivated'],
              ['all', 'All'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                className={`rounded px-2.5 py-1 ${filter === value ? 'bg-paper text-ink font-medium' : 'text-secondary hover:text-ink'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {notice && (
          <p role="status" className="mt-2 text-sm text-moss">
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-2 text-sm text-red-700">
            {error}
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-4">
        {editingId === 'new' && draft && (
          <QuestionEditor draft={draft} setDraft={setDraft} busy={busy} onSave={saveDraft} onCancel={() => setEditingId(null)} heading="New question" />
        )}

        {loading ? (
          <p className="text-secondary text-sm">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-secondary">
            {rows.length === 0
              ? 'No questions yet for this level. They are generated the first time a learner takes this check, or you can add or generate some now.'
              : 'No questions in this view.'}
          </p>
        ) : (
          <ol className="space-y-3">
            {visible.map((row) =>
              editingId === row.id ? (
                <li key={row.id}>
                  <QuestionEditor draft={draft} setDraft={setDraft} busy={busy} onSave={saveDraft} onCancel={() => setEditingId(null)} heading="Edit question" />
                </li>
              ) : (
                <li
                  key={row.id}
                  className={`rounded-lg border border-hairline p-3 ${row.status === 'active' ? 'bg-card' : 'bg-paper opacity-75'}`}
                >
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="rounded-full border border-hairline px-2 py-0.5 text-secondary">
                      {QUESTION_TYPE_LABELS[row.question_type] ?? row.question_type}
                    </span>
                    <span className="rounded-full border border-hairline px-2 py-0.5 text-secondary">
                      {SOURCE_LABELS[row.source] ?? row.source}
                    </span>
                    {row.status !== 'active' && (
                      <span className="rounded-full bg-red-700/10 px-2 py-0.5 text-red-700">Deactivated</span>
                    )}
                  </div>
                  <p className="mt-1.5 text-sm text-ink">{row.question?.title}</p>
                  <AnswerSummary question={row.question} />
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => startEdit(row)}
                      disabled={busy || editingId !== null}
                      className="rounded-md border border-hairline text-ink py-1 px-2.5 text-xs font-medium hover:bg-paper disabled:opacity-60"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleStatus(row)}
                      disabled={busy || editingId !== null}
                      className="rounded-md border border-hairline text-ink py-1 px-2.5 text-xs font-medium hover:bg-paper disabled:opacity-60"
                    >
                      {row.status === 'active' ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </div>
                </li>
              )
            )}
          </ol>
        )}
      </div>
    </AccessibleDialog>
  )
}

function QuestionEditor({ draft, setDraft, busy, onSave, onCancel, heading }) {
  const merge = (changes) => setDraft((d) => ({ ...d, ...changes }))
  return (
    <div className="mb-4 rounded-lg border border-moss/60 bg-paper p-3">
      <p className="mb-2 text-sm font-medium text-ink">{heading}</p>
      <PageInteractiveEditor block={draft} onChange={merge} onChangeWithHistory={merge} />
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={busy}
          className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Save question'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm hover:bg-paper disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function AnswerSummary({ question }) {
  const items = question?.items ?? []
  if (['single', 'multiple', 'true_false'].includes(question?.layout)) {
    return (
      <ul className="mt-1 ml-4 list-disc text-xs text-secondary">
        {items.map((item) => (
          <li key={item.id} className={item.correct ? 'text-moss' : undefined}>
            {item.label}
            {item.correct ? ' (right)' : ''}
          </li>
        ))}
      </ul>
    )
  }
  if (question?.layout === 'short_text') {
    return <p className="mt-1 text-xs text-secondary">Accepted: {items.map((item) => item.label).filter(Boolean).join(', ')}</p>
  }
  if (question?.layout === 'number') {
    return (
      <p className="mt-1 text-xs text-secondary">
        Answer: {items[0]?.value}
        {question.tolerance ? ` (± ${question.tolerance})` : ''}
      </p>
    )
  }
  if (question?.layout === 'ordering') {
    return <p className="mt-1 text-xs text-secondary">Order: {items.map((item) => item.label).join(' → ')}</p>
  }
  if (question?.layout === 'matching') {
    return (
      <ul className="mt-1 ml-4 list-disc text-xs text-secondary">
        {items.map((item) => (
          <li key={item.id}>
            {item.label} → {item.detail}
          </li>
        ))}
      </ul>
    )
  }
  return null
}
