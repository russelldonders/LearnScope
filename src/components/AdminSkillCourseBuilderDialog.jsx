import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import AccessibleDialog from './AccessibleDialog'
import { KNOWLEDGE_LEVEL_LABELS, LEVELS } from '../lib/levels'
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
          const brief = buildSkillCourseBrief(task.skill, task.level, settings)
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
                  <input type="number" min="1" max="10000" value={settings.durationValue} onChange={(event) => setSettings((current) => ({ ...current, durationValue: Number(event.target.value) }))} className="mt-1 w-full rounded-md border border-hairline bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-gold" />
                </label>
                <label className="text-xs text-secondary">Unit
                  <select value={settings.durationUnit} onChange={(event) => setSettings((current) => ({ ...current, durationUnit: event.target.value }))} className="mt-1 w-full rounded-md border border-hairline bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-gold">
                    <option value="mins">Minutes</option><option value="hours">Hours</option>
                  </select>
                </label>
                <label className="text-xs text-secondary">Sections
                  <input type="number" min="1" max="8" value={settings.sectionCount} onChange={(event) => setSettings((current) => ({ ...current, sectionCount: Number(event.target.value) }))} className="mt-1 w-full rounded-md border border-hairline bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-gold" />
                </label>
                <label className="text-xs text-secondary">Pages each
                  <input type="number" min="1" max="6" value={settings.pagesPerSection} onChange={(event) => setSettings((current) => ({ ...current, pagesPerSection: Number(event.target.value) }))} className="mt-1 w-full rounded-md border border-hairline bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-gold" />
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
                <button type="button" onClick={() => handleBuild()} disabled={courseCount === 0} className="rounded-md bg-moss px-4 py-2 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-50">
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
