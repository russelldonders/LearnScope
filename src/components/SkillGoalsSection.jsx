import { useEffect, useState } from 'react'
import SkillGoalChart from './SkillGoalChart'
import SkillGoalEntriesModal from './SkillGoalEntriesModal'
import SkillGoalEntryForm from './SkillGoalEntryForm'
import SkillGoalModal from './SkillGoalModal'
import { useLanguage } from '../context/LanguageContext'
import { formatFullDate } from '../lib/dates'
import { computeGoalProgress, formatGoalValue, goalShapeText } from '../lib/skillGoalProgress'
import { listSkillGoals, logGoalEntry } from '../lib/skillGoals'

// A goal's measure, target and tracker on a skill's page. Values are read from
// the statements the page has already loaded, and saved as ordinary activities,
// so the rest of the page updates through its usual reload.
// editGoalId opens that goal's edit form once it has loaded, e.g. from the
// dashboard's "Add a target"; onEditGoalOpened lets the page forget the
// request so going back or reloading doesn't open it again.
export default function SkillGoalsSection({
  skill,
  user,
  actor,
  statements,
  onActivitiesChanged,
  onSetLevelTarget,
  editGoalId = null,
  onEditGoalOpened,
}) {
  const { t } = useLanguage()
  const [goals, setGoals] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [adding, setAdding] = useState(false)
  const [editingGoal, setEditingGoal] = useState(null)
  const [entriesGoalId, setEntriesGoalId] = useState(null)
  const [pastOpen, setPastOpen] = useState(false)

  async function load() {
    try {
      setGoals(await listSkillGoals(skill.id))
      setLoadError(null)
    } catch (err) {
      setLoadError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reloads when the skill changes; load is recreated every render
  }, [skill.id])

  useEffect(() => {
    if (!editGoalId || loading) return
    const requested = goals.find((goal) => goal.id === editGoalId && goal.status === 'active')
    if (requested) setEditingGoal(requested)
    onEditGoalOpened?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once the goals arrive for a requested id
  }, [editGoalId, loading])

  const activeGoals = goals.filter((goal) => goal.status === 'active')
  const pastGoals = goals.filter((goal) => goal.status !== 'active')
  const entriesGoal = goals.find((goal) => goal.id === entriesGoalId) ?? null

  return (
    <section aria-labelledby="skill-goals-heading" className="mt-4 rounded-md border border-hairline bg-paper p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 id="skill-goals-heading" className="font-display text-xl text-ink">{t('skillGoals.title')}</h2>
          <p className="text-xs text-secondary">{t('skillGoals.privateNote')}</p>
        </div>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="rounded-md bg-moss text-paper text-xs font-medium px-3 py-1.5 hover:opacity-90"
        >
          {t('skillGoals.addButton')}
        </button>
      </div>

      {loadError && <p role="alert" className="text-sm text-red-700 mt-3">{loadError}</p>}
      {!loading && !loadError && activeGoals.length === 0 && (
        <p className="text-sm text-secondary mt-3">{t('skillGoals.empty')}</p>
      )}

      <div className="space-y-3 mt-3">
        {activeGoals.map((goal) => (
          <GoalCard
            key={goal.id}
            goal={goal}
            skill={skill}
            user={user}
            actor={actor}
            statements={statements}
            onActivitiesChanged={onActivitiesChanged}
            onEdit={() => setEditingGoal(goal)}
            onShowEntries={() => setEntriesGoalId(goal.id)}
          />
        ))}
      </div>

      {pastGoals.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            aria-expanded={pastOpen}
            onClick={() => setPastOpen((open) => !open)}
            className="text-xs text-moss font-medium hover:underline"
          >
            {t('skillGoals.pastGoals', { count: pastGoals.length })}
          </button>
          {pastOpen && (
            <ul className="mt-2 space-y-1">
              {pastGoals.map((goal) => (
                <li key={goal.id} className="text-sm text-secondary break-words">
                  <button
                    type="button"
                    onClick={() => setEntriesGoalId(goal.id)}
                    className="underline decoration-dotted underline-offset-2 hover:text-moss text-left"
                  >
                    {goal.title}
                  </button>
                  <span className="font-mono text-xs">
                    {' '}· {t(`skillGoals.status.${goal.status}`)} {formatFullDate(goal.closed_on)}
                    {goal.target_value != null ? ` · ${t('skillGoals.targetShort')} ${formatGoalValue(goal, goal.target_value)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {(adding || editingGoal) && (
        <SkillGoalModal
          skill={skill}
          goal={editingGoal}
          goals={goals}
          onSaved={async () => {
            await load()
            setAdding(false)
            setEditingGoal(null)
          }}
          onSetLevelTarget={() => {
            setAdding(false)
            onSetLevelTarget()
          }}
          onClose={() => {
            setAdding(false)
            setEditingGoal(null)
          }}
        />
      )}

      {entriesGoal && (
        <SkillGoalEntriesModal
          goal={entriesGoal}
          statements={statements}
          onChanged={onActivitiesChanged}
          onClose={() => setEntriesGoalId(null)}
        />
      )}
    </section>
  )
}

function GoalCard({ goal, skill, user, actor, statements, onActivitiesChanged, onEdit, onShowEntries }) {
  const { t } = useLanguage()
  const [savedNote, setSavedNote] = useState(null)
  const progress = computeGoalProgress(goal, statements)
  const currentLabelKey = goal.aggregation === 'best'
    ? 'skillGoals.bestSoFar'
    : goal.period
      ? `skillGoals.thisPeriod.${goal.period}`
      : 'skillGoals.totalSoFar'

  const shapeText = progress.sessions ? goalShapeText(goal, progress.sessions, t) : null
  const showSessions = shapeText && goal.period !== 'day'

  async function handleLog(values) {
    setSavedNote(null)
    try {
      await logGoalEntry({
        goal,
        skill,
        userId: user.id,
        actor,
        input: values.input,
        date: values.date,
        note: values.note,
        activityTitle: values.activityTitle,
        evidence: values.evidence,
      })
    } catch (err) {
      // The activity is saved before its files upload, so it may exist even
      // though this failed. Showing it stops a retry from adding it twice unseen.
      await onActivitiesChanged()
      throw err
    }
    await onActivitiesChanged()
    setSavedNote(values.date < goal.started_on ? 'skillGoals.savedBeforeStart' : 'skillGoals.saved')
  }

  return (
    <article className="rounded-md border border-hairline bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-medium text-ink break-words min-w-0">{goal.title}</h3>
        <button type="button" onClick={onEdit} className="text-xs text-moss font-medium hover:underline shrink-0">
          {t('skillGoals.edit')}
        </button>
      </div>

      <dl className="flex flex-wrap gap-x-4 gap-y-1 mt-1 font-mono text-xs text-secondary">
        {progress.current != null && (
          <div className="flex gap-1">
            <dt>{t(currentLabelKey)}</dt>
            <dd className="text-ink">{showSessions ? shapeText.done : formatGoalValue(goal, progress.current)}</dd>
          </div>
        )}
        {goal.target_value != null && (
          <div className="flex gap-1">
            <dt>{t('skillGoals.targetShort')}</dt>
            <dd className="text-ink">{shapeText ? shapeText.target : formatGoalValue(goal, goal.target_value)}</dd>
          </div>
        )}
        {goal.target_date && (
          <div className="flex gap-1">
            <dt>{t('skillGoals.byShort')}</dt>
            <dd className="text-ink">{formatFullDate(goal.target_date)}</dd>
          </div>
        )}
      </dl>

      {progress.percent != null && (
        <div
          role="progressbar"
          aria-label={t('skillGoals.progressLabel')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress.percent)}
          className="mt-2 h-1.5 rounded-full bg-hairline overflow-hidden"
        >
          <div className="h-full bg-moss" style={{ width: `${progress.percent}%` }} />
        </div>
      )}
      {shapeText && <p className="text-xs text-secondary mt-1">{shapeText.today}</p>}
      {progress.reached && <p className="text-xs font-medium text-moss mt-1">{t('skillGoals.targetReached')}</p>}

      <SkillGoalChart goal={goal} statements={statements} target={progress.target} />

      <div className="mt-3 pt-3 border-t border-hairline">
        <p className="text-sm text-ink mb-2">{goal.tracker_question}</p>
        <SkillGoalEntryForm
          goal={goal}
          statements={statements}
          idPrefix={`goal-${goal.id}`}
          submitLabel={t('skillGoals.save')}
          onSubmit={handleLog}
        />
        {savedNote && <p role="status" className="text-xs text-moss mt-2">{t(savedNote)}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-secondary">
        {progress.lastLogged && (
          <span>{t('skillGoals.lastLogged', { date: formatFullDate(progress.lastLogged.toISOString()) })}</span>
        )}
        <button type="button" onClick={onShowEntries} className="text-moss font-medium hover:underline">
          {t('skillGoals.seeEntries', { count: progress.entryCount })}
        </button>
      </div>
    </article>
  )
}
