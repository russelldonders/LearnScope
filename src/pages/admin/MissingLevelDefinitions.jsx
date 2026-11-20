import { useRef, useState } from 'react'
import ConfirmDialog from '../../components/ConfirmDialog'
import { generateLevelGuide, isCompleteLevelGuide, missingLevelDefinitionTasks } from '../../lib/levelGuide'

// Library skills created before definitions were generated at creation time
// may still have none. This fills the gaps in one go -- one AI call per
// missing axis, run one at a time so it stays well inside the per-user AI
// quota's pace and can be stopped part-way. Each call goes through
// api/generate-level-guide, which stores the result on the shared library
// row (only if still empty), exactly as a learner's first view would.
// Private (personal) entries are left alone: they belong to one learner and
// still get generated the first time that learner needs them.
export default function MissingLevelDefinitions({ skills, onSkillGuide }) {
  const tasks = missingLevelDefinitionTasks(skills)
  const [confirming, setConfirming] = useState(false)
  const [progress, setProgress] = useState(null) // { done, total, failed }
  const [message, setMessage] = useState(null)
  const stopRef = useRef(false)

  if (tasks.length === 0 && !progress) return null

  const skillCount = new Set(tasks.map((task) => task.skill.id)).size
  const running = Boolean(progress) && !message

  async function run() {
    setConfirming(false)
    setMessage(null)
    stopRef.current = false
    const queue = [...tasks]
    let done = 0
    let failed = 0
    setProgress({ done, total: queue.length, failed })
    for (const { skill, axis } of queue) {
      if (stopRef.current) break
      try {
        const statements = await generateLevelGuide(axis, skill.name, skill.id)
        if (isCompleteLevelGuide(statements)) onSkillGuide(skill.id, axis, statements)
        else failed += 1
      } catch (err) {
        failed += 1
        if (/limit/i.test(err.message)) {
          done += 1
          setProgress({ done, total: queue.length, failed })
          setMessage(`Stopped: ${err.message}`)
          return
        }
      }
      done += 1
      setProgress({ done, total: queue.length, failed })
    }
    setMessage(
      stopRef.current
        ? `Stopped after ${done} of ${queue.length}.`
        : failed
          ? `Finished with ${failed} that couldn't be generated — run it again to retry them.`
          : 'All missing level definitions have been generated.'
    )
  }

  return (
    <div className="rounded-lg border border-hairline bg-card px-4 py-3 text-sm" role="status">
      {running ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-ink">
            Generating level definitions… {progress.done} of {progress.total}
          </p>
          <div className="h-2 flex-1 min-w-[120px] rounded-full bg-paper overflow-hidden" aria-hidden="true">
            <div className="h-full bg-moss transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
          <button
            type="button"
            onClick={() => {
              stopRef.current = true
            }}
            className="rounded-md border border-hairline text-ink py-1 px-2.5 text-xs font-medium hover:bg-paper"
          >
            Stop
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-ink">
            {message ? (
              message
            ) : (
              <>
                {skillCount} {skillCount === 1 ? 'skill is' : 'skills are'} missing level definitions ({tasks.length} sets
                across knowledge and practical ability).
              </>
            )}
          </p>
          {tasks.length > 0 && (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="rounded-md bg-moss text-paper py-1.5 px-3 text-xs font-medium hover:opacity-90"
            >
              Generate missing definitions
            </button>
          )}
        </div>
      )}

      {confirming && (
        <ConfirmDialog
          message={`Generate ${tasks.length} sets of level definitions for ${skillCount} ${
            skillCount === 1 ? 'skill' : 'skills'
          }? This makes one AI request per set, counted against your daily AI allowance. Definitions that already exist are never replaced.`}
          confirmLabel="Generate"
          onConfirm={run}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  )
}
