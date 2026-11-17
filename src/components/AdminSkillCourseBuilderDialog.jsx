import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import AccessibleDialog from './AccessibleDialog'
import { KNOWLEDGE_LEVEL_LABELS, LEVELS } from '../lib/levels'
import { INTERACTIVE_BLOCKS } from '../lib/pageBuilder'
import CourseElementsPicker from './CourseElementsPicker'
import {
  buildSkillCourseBrief,
  abortSkillCourseGeneration,
  generateSkillCourseDraft,
  getSystemProviderOrganisationId,
  saveGeneratedSkillCourseJob,
} from '../lib/admin/skillCourseGeneration'

const DEFAULT_SETTINGS = {
  durationValue: 60,
  durationUnit: 'mins',
  sectionCount: 3,
  pagesPerSection: 2,
  tone: 'Practical and encouraging',
  // Every interactive and visual element, used in balance, unless chosen otherwise.
  elements: Object.keys(INTERACTIVE_BLOCKS).filter((element) => element !== 'test_question'),
  elementAmount: 'balanced',
  assessmentEnabled: true,
  assessmentQuestionCount: 10,
  assessmentPassMark: 70,
  assessmentPointsPerQuestion: 1,
  assessmentQuestionTypes: ['single', 'multiple', 'true_false', 'short_text', 'number', 'ordering', 'matching'],
}

const ASSESSMENT_QUESTION_TYPES = [
  ['single', 'Single choice'], ['multiple', 'Multiple choice'], ['true_false', 'True or false'],
  ['short_text', 'Short answer'], ['number', 'Numeric'], ['ordering', 'Ordering'], ['matching', 'Matching'],
]

// The number fields hold what was typed (a string) while editing: turning it
// into a number on every keystroke made a cleared field 0, so typing "15"
// showed "015". A whole number within the field's range is used when the
// field is left (kept as text, so a number input showing "05" redraws as
// "5" -- React compares a number input's value loosely) and when the
// courses are built.
const NUMBER_FIELDS = {
  durationValue: { min: 1, max: 10000 },
  sectionCount: { min: 1, max: 8 },
  pagesPerSection: { min: 1, max: 6 },
  assessmentQuestionCount: { min: 1, max: 20 },
  assessmentPassMark: { min: 0, max: 100 },
  assessmentPointsPerQuestion: { min: 1, max: 100 },
}

function wholeNumberInRange(value, field) {
  const { min, max } = NUMBER_FIELDS[field]
  const parsed = Number.parseInt(String(value).trim(), 10)
  if (!Number.isFinite(parsed)) return DEFAULT_SETTINGS[field]
  return Math.min(max, Math.max(min, parsed))
}

function normalisedSettings(settings) {
  return Object.fromEntries(Object.entries(settings).map(([key, value]) => [
    key,
    key in NUMBER_FIELDS ? wholeNumberInRange(value, key) : value,
  ]))
}

function taskKey(skillId, level) {
  return `${skillId}:${level}`
}

export default function AdminSkillCourseBuilderDialog({ skills, onClose, onFinished }) {
  const eligibleSkills = useMemo(() => skills.filter((skill) => skill.status === 'active'), [skills])
  const inactiveSkills = useMemo(() => skills.filter((skill) => skill.status !== 'active'), [skills])
  const [levels, setLevels] = useState(LEVELS)
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [publishGlobal, setPublishGlobal] = useState(true)
  const [stage, setStage] = useState('setup')
  const [results, setResults] = useState([])
  const [error, setError] = useState(null)
  const [aborting, setAborting] = useState(false)
  const abortRequestedRef = useRef(false)
  const activeJobsRef = useRef(new Map())

  const courseCount = eligibleSkills.length * levels.length
  const completeCount = results.filter((result) => result.status === 'complete').length
  const failedCount = results.filter((result) => result.status === 'failed').length
  const cancelledCount = results.filter((result) => result.status === 'cancelled').length
  const busy = stage === 'building'

  function toggleLevel(level) {
    setLevels((current) => current.includes(level)
      ? current.filter((item) => item !== level)
      : [...current, level].sort((a, b) => a - b))
  }

  function updateResult(key, patch) {
    setResults((current) => current.map((result) => result.key === key ? { ...result, ...patch } : result))
  }

  async function runTasks(tasks, organisationId) {
    let nextIndex = 0
    const workerCount = Math.min(2, tasks.length)
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (nextIndex < tasks.length && !abortRequestedRef.current) {
        const task = tasks[nextIndex]
        nextIndex += 1
        updateResult(task.key, { status: 'building', error: null })
        try {
          const brief = buildSkillCourseBrief(task.skill, task.level, normalisedSettings(settings))
          const { jobId, draft } = await generateSkillCourseDraft(brief, organisationId, {
            skillId: task.skill.id,
            level: task.level,
            shouldAbort: () => abortRequestedRef.current,
            onJobCreated: (jobId) => {
              activeJobsRef.current.set(task.key, jobId)
            },
          })
          if (abortRequestedRef.current) throw Object.assign(new Error('Course build aborted.'), { code: 'COURSE_BUILD_ABORTED' })
          // Saved from the job, which an abort can still stop until this lands.
          const courseId = await saveGeneratedSkillCourseJob({ jobId, publishGlobal })
          updateResult(task.key, { status: 'complete', courseId, courseName: draft.name })
        } catch (taskError) {
          if (taskError.code === 'COURSE_BUILD_ABORTED' || abortRequestedRef.current) {
            updateResult(task.key, { status: 'cancelled', error: null })
          } else {
            updateResult(task.key, { status: 'failed', error: taskError.message })
          }
        } finally {
          activeJobsRef.current.delete(task.key)
        }
      }
    }))
  }

  async function handleBuild(tasksOverride = null) {
    const tasks = tasksOverride ?? eligibleSkills.flatMap((skill) => levels.map((level) => ({
      key: taskKey(skill.id, level),
      skill,
      level,
    })))
    if (tasks.length === 0) return

    abortRequestedRef.current = false
    activeJobsRef.current.clear()
    setAborting(false)
    setStage('building')
    setError(null)
    if (!tasksOverride) {
      setResults(tasks.map((task) => ({ ...task, status: 'queued', courseId: null, courseName: null, error: null })))
    } else {
      const retryKeys = new Set(tasks.map((task) => task.key))
      setResults((current) => current.map((result) => retryKeys.has(result.key)
        ? { ...result, status: 'queued', error: null }
        : result))
    }

    try {
      const organisationId = await getSystemProviderOrganisationId()
      await runTasks(tasks, organisationId)
      setStage('complete')
    } catch (buildError) {
      setError(buildError.message)
      setStage(tasksOverride ? 'complete' : 'setup')
    }
  }

  async function handleAbort() {
    if (abortRequestedRef.current) return
    abortRequestedRef.current = true
    setAborting(true)
    setResults((current) => current.map((result) => ['queued', 'building'].includes(result.status)
      ? { ...result, status: 'cancelled', error: null }
      : result))
    try {
      await abortSkillCourseGeneration([...activeJobsRef.current.values()])
    } catch (abortError) {
      setError(`${abortError.message} No further courses will be saved by this batch.`)
    } finally {
      setAborting(false)
    }
  }

  function handleClose() {
    if (busy) return
    if (completeCount > 0) onFinished?.()
    onClose()
  }

  const failedTasks = results
    .filter((result) => result.status === 'failed')
    .map(({ key, skill, level }) => ({ key, skill, level }))

  return (
    <AccessibleDialog
      labelledBy="skill-course-builder-title"
      describedBy="skill-course-builder-description"
      onClose={busy ? undefined : handleClose}
      closeOnBackdrop={!busy}
      panelClassName="w-full max-w-3xl max-h-[90dvh] overflow-y-auto overscroll-contain rounded-xl border border-hairline bg-card shadow-xl"
    >
      <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-hairline bg-card px-5 py-4 sm:px-6">
        <div>
          <h2 id="skill-course-builder-title" className="font-display text-xl text-ink">
            {stage === 'complete' && cancelledCount > 0 ? 'Course build stopped' : stage === 'complete' ? 'Course series ready' : 'Build courses from skills'}
          </h2>
          <p id="skill-course-builder-description" className="mt-1 max-w-2xl text-sm text-secondary">
            {stage === 'setup'
              ? 'Create one editable page-builder course for every selected knowledge level.'
              : stage === 'building'
                ? 'LearnScope is writing and assembling each course. Keep this window open until the batch finishes.'
                : cancelledCount > 0
                  ? `${completeCount} ${completeCount === 1 ? 'course was' : 'courses were'} completed before the build stopped.`
                  : `${completeCount} of ${results.length} courses were created${publishGlobal ? ' and published to the Global catalogue' : ' as editable drafts'}.`}
          </p>
        </div>
        {busy ? (
          <button
            type="button"
            onClick={handleAbort}
            disabled={aborting || abortRequestedRef.current}
            className="shrink-0 rounded-md border border-red-700 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            {aborting ? 'Aborting…' : abortRequestedRef.current ? 'Stopping…' : 'Abort build'}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleClose}
            className="shrink-0 rounded-md border border-hairline px-3 py-1.5 text-sm text-ink hover:bg-paper"
          >
            Close
          </button>
        )}
      </div>

      <div className="space-y-6 p-5 sm:p-6">
        {error && <p role="alert" className="rounded-md border border-red-700 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

        {stage === 'setup' ? (
          <>
            <section aria-labelledby="selected-skills-title">
              <div className="flex items-baseline justify-between gap-4">
                <h3 id="selected-skills-title" className="font-medium text-ink">Selected skills</h3>
                <span className="text-xs tabular-nums text-secondary">{eligibleSkills.length} active</span>
              </div>
              <ul className="mt-2 flex flex-wrap gap-2">
                {eligibleSkills.map((skill) => (
                  <li key={skill.id} className="rounded-full border border-hairline bg-paper px-3 py-1 text-sm text-ink">
                    {skill.name}
                  </li>
                ))}
              </ul>
              {inactiveSkills.length > 0 && (
                <p className="mt-2 text-xs text-secondary">
                  {inactiveSkills.length} inactive {inactiveSkills.length === 1 ? 'skill is' : 'skills are'} excluded. Reactivate them before building courses.
                </p>
              )}
            </section>

            <fieldset>
              <legend className="font-medium text-ink">Knowledge levels</legend>
              <p className="mt-1 text-sm text-secondary">All five levels are selected by default.</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-5">
                {LEVELS.map((level) => (
                  <label key={level} className={`cursor-pointer rounded-lg border px-3 py-3 ${levels.includes(level) ? 'border-moss bg-moss/10' : 'border-hairline bg-paper'}`}>
                    <span className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={levels.includes(level)}
                        onChange={() => toggleLevel(level)}
                        className="h-4 w-4 accent-moss"
                      />
                      <span className="font-mono text-xs tabular-nums text-secondary">L{level}</span>
                    </span>
                    <span className="mt-2 block text-sm font-medium text-ink">{KNOWLEDGE_LEVEL_LABELS[level]}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <CourseElementsPicker
              elements={settings.elements}
              amount={settings.elementAmount}
              excludedElements={['test_question']}
              onChange={(change) => setSettings((current) => ({
                ...current,
                ...(change.elements ? { elements: change.elements } : {}),
                ...(change.amount ? { elementAmount: change.amount } : {}),
              }))}
            />

            <fieldset className="rounded-lg border border-hairline bg-paper p-4">
              <div className="flex items-start gap-3">
                <input id="include-final-test" type="checkbox" checked={settings.assessmentEnabled} onChange={(event) => setSettings((current) => ({ ...current, assessmentEnabled: event.target.checked }))} className="mt-1 h-4 w-4 accent-moss" />
                <div className="min-w-0 flex-1">
                  <label htmlFor="include-final-test" className="font-medium text-ink">Include a final scored test</label>
                  <p className="mt-1 text-sm text-secondary">The final section will contain an auto-marked test and counts toward the section total below.</p>
                </div>
              </div>
              {settings.assessmentEnabled && (
                <div className="mt-4 space-y-4 border-t border-hairline pt-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <label className="text-xs text-secondary">Questions
                      <input type="number" min="1" max="20" value={settings.assessmentQuestionCount} onChange={(event) => setSettings((current) => ({ ...current, assessmentQuestionCount: event.target.value }))} onBlur={() => setSettings((current) => ({ ...current, assessmentQuestionCount: String(wholeNumberInRange(current.assessmentQuestionCount, 'assessmentQuestionCount')) }))} className="mt-1 w-full rounded-md border border-hairline bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-gold" />
                    </label>
                    <label className="text-xs text-secondary">Pass mark
                      <span className="relative mt-1 block"><input aria-label="Pass mark" type="number" min="0" max="100" value={settings.assessmentPassMark} onChange={(event) => setSettings((current) => ({ ...current, assessmentPassMark: event.target.value }))} onBlur={() => setSettings((current) => ({ ...current, assessmentPassMark: String(wholeNumberInRange(current.assessmentPassMark, 'assessmentPassMark')) }))} className="w-full rounded-md border border-hairline bg-card px-3 py-2 pr-8 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-gold" /><span className="absolute right-3 top-2 text-sm text-secondary">%</span></span>
                    </label>
                    <label className="text-xs text-secondary">Points per question
                      <input type="number" min="1" max="100" value={settings.assessmentPointsPerQuestion} onChange={(event) => setSettings((current) => ({ ...current, assessmentPointsPerQuestion: event.target.value }))} onBlur={() => setSettings((current) => ({ ...current, assessmentPointsPerQuestion: String(wholeNumberInRange(current.assessmentPointsPerQuestion, 'assessmentPointsPerQuestion')) }))} className="mt-1 w-full rounded-md border border-hairline bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-gold" />
                    </label>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-secondary">Question types the AI may use</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      {ASSESSMENT_QUESTION_TYPES.map(([value, label]) => <label key={value} className="flex items-center gap-2 rounded-md border border-hairline bg-card px-3 py-2 text-sm text-ink"><input type="checkbox" checked={settings.assessmentQuestionTypes.includes(value)} onChange={() => setSettings((current) => ({ ...current, assessmentQuestionTypes: current.assessmentQuestionTypes.includes(value) ? current.assessmentQuestionTypes.filter((type) => type !== value) : [...current.assessmentQuestionTypes, value] }))} className="h-4 w-4 accent-moss" />{label}</label>)}
                    </div>
                    {settings.assessmentQuestionTypes.length === 0 && <p role="alert" className="mt-2 text-xs text-red-700">Choose at least one question type.</p>}
                  </div>
                </div>
              )}
            </fieldset>

            <label className="flex items-start gap-3 border-y border-hairline py-4">
              <input
                type="checkbox"
                checked={publishGlobal}
                onChange={(event) => setPublishGlobal(event.target.checked)}
                className="mt-0.5 h-4 w-4 accent-moss"
              />
              <span>
                <span className="block text-sm font-medium text-ink">Publish automatically to the Global catalogue</span>
                <span className="mt-0.5 block text-xs text-secondary">
                  Turn this off to review the generated courses as drafts first. Published courses remain editable by creating their next version.
                </span>
              </span>
            </label>

            <details className="rounded-lg border border-hairline bg-paper px-4 py-3">
              <summary className="cursor-pointer text-sm font-medium text-ink">Course format</summary>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
                <label className="text-xs text-secondary">Duration
                  <input type="number" min="1" max="10000" inputMode="numeric" value={settings.durationValue} onChange={(event) => setSettings((current) => ({ ...current, durationValue: event.target.value }))} onBlur={() => setSettings((current) => ({ ...current, durationValue: String(wholeNumberInRange(current.durationValue, 'durationValue')) }))} className="mt-1 w-full rounded-md border border-hairline bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-gold" />
                </label>
                <label className="text-xs text-secondary">Unit
                  <select value={settings.durationUnit} onChange={(event) => setSettings((current) => ({ ...current, durationUnit: event.target.value }))} className="mt-1 w-full rounded-md border border-hairline bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-gold">
                    <option value="mins">Minutes</option><option value="hours">Hours</option>
                  </select>
                </label>
                <label className="text-xs text-secondary">Sections
                  <input type="number" min="1" max="8" inputMode="numeric" value={settings.sectionCount} onChange={(event) => setSettings((current) => ({ ...current, sectionCount: event.target.value }))} onBlur={() => setSettings((current) => ({ ...current, sectionCount: String(wholeNumberInRange(current.sectionCount, 'sectionCount')) }))} className="mt-1 w-full rounded-md border border-hairline bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-gold" />
                </label>
                <label className="text-xs text-secondary">Learning pages each
                  <input type="number" min="1" max="6" inputMode="numeric" value={settings.pagesPerSection} onChange={(event) => setSettings((current) => ({ ...current, pagesPerSection: event.target.value }))} onBlur={() => setSettings((current) => ({ ...current, pagesPerSection: String(wholeNumberInRange(current.pagesPerSection, 'pagesPerSection')) }))} className="mt-1 w-full rounded-md border border-hairline bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-gold" />
                </label>
                <label className="col-span-2 text-xs text-secondary sm:col-span-1">Style
                  <select value={settings.tone} onChange={(event) => setSettings((current) => ({ ...current, tone: event.target.value }))} className="mt-1 w-full rounded-md border border-hairline bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-gold">
                    <option>Practical and encouraging</option><option>Concise and professional</option><option>Detailed and academic</option>
                  </select>
                </label>
              </div>
            </details>

            <div className="flex flex-col gap-3 border-t border-hairline pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-secondary">
                <span className="font-medium text-ink tabular-nums">{courseCount}</span> {courseCount === 1 ? 'course' : 'courses'} will be created.
              </p>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <button type="button" onClick={handleClose} className="rounded-md border border-hairline px-4 py-2 text-sm font-medium text-ink hover:bg-paper">Cancel</button>
                <button type="button" onClick={() => handleBuild()} disabled={courseCount === 0 || (settings.assessmentEnabled && settings.assessmentQuestionTypes.length === 0)} className="rounded-md bg-moss px-4 py-2 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-50">
                  Build {courseCount} {courseCount === 1 ? 'course' : 'courses'}
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div aria-live="polite" role="status">
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="font-medium text-ink">{stage === 'building' ? 'Building course series' : 'Build complete'}</span>
                <span className="tabular-nums text-secondary">{completeCount + failedCount + cancelledCount} / {results.length}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-paper" aria-hidden="true">
                <div className="h-full bg-moss transition-[width] duration-200" style={{ width: `${results.length ? ((completeCount + failedCount + cancelledCount) / results.length) * 100 : 0}%` }} />
              </div>
            </div>

            <ol className="divide-y divide-hairline border-y border-hairline">
              {results.map((result) => (
                <li key={result.key} className="flex items-start justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{result.skill.name}</p>
                    <p className="mt-0.5 text-xs text-secondary">Level {result.level} — {KNOWLEDGE_LEVEL_LABELS[result.level]}</p>
                    {result.error && <p className="mt-1 text-xs text-red-700">{result.error}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    {result.status === 'complete' && result.courseId ? (
                      <Link to={`/admin/catalogue/${result.courseId}/edit`} className="text-xs font-medium text-moss hover:underline">Open course</Link>
                    ) : result.status === 'failed' && stage === 'complete' ? (
                      <span className="flex items-center justify-end gap-3">
                        <span className="text-xs text-red-700">Failed</span>
                        <button
                          type="button"
                          onClick={() => handleBuild([{ key: result.key, skill: result.skill, level: result.level }])}
                          aria-label={`Retry ${result.skill.name} level ${result.level}`}
                          className="rounded-md border border-hairline px-2.5 py-1 text-xs font-medium text-ink hover:border-moss hover:bg-paper"
                        >
                          Retry
                        </button>
                      </span>
                    ) : (
                      <span className={`text-xs ${result.status === 'failed' ? 'text-red-700' : 'text-secondary'}`}>
                        {result.status === 'building' ? 'Building…' : result.status === 'failed' ? 'Failed' : result.status === 'cancelled' ? 'Aborted' : 'Queued'}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ol>

            {stage === 'building' && (
              <p className="text-sm text-secondary">Completed courses are kept. Queued courses won’t start, and active results won’t be saved.</p>
            )}

            {stage === 'complete' && (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-secondary">
                  {cancelledCount > 0
                    ? `${cancelledCount} ${cancelledCount === 1 ? 'course was' : 'courses were'} not created.`
                    : failedCount > 0
                      ? `${failedCount} ${failedCount === 1 ? 'course needs' : 'courses need'} another attempt.`
                      : 'Every course is available in the course builder.'}
                </p>
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  {failedCount > 0 && <button type="button" onClick={() => handleBuild(failedTasks)} className="rounded-md border border-hairline px-4 py-2 text-sm font-medium text-ink hover:bg-paper">Retry failed</button>}
                  <button type="button" onClick={handleClose} className="rounded-md bg-moss px-4 py-2 text-sm font-medium text-paper hover:opacity-90">Done</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </AccessibleDialog>
  )
}
