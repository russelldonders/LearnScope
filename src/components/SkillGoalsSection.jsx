import { useEffect, useState } from 'react'
import SkillGoalEntriesModal from './SkillGoalEntriesModal'
import SkillGoalModal from './SkillGoalModal'
import { SkillGoalTile } from './SkillGoalsDashboardPanel'
import { useLanguage } from '../context/LanguageContext'
import { formatFullDate } from '../lib/dates'
import { computeGoalProgress, formatGoalValue, goalDueOn } from '../lib/skillGoalProgress'
import { listSkillGoals } from '../lib/skillGoals'

// A skill's goals on its page, each as the same tile Home shows. Values are
// read from the statements the page has already loaded, and saved as ordinary
// activities, so the rest of the page updates through its usual reload.
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
  const [openGoalId, setOpenGoalId] = useState(null)

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

      {/* The same tile as on Home, so a goal looks and works the same in
          both places. items-start: a tile opened for logging grows on its own. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start mt-3">
        {activeGoals.map((goal) => {
          const progress = computeGoalProgress(goal, statements)
          const item = { goal, skill, statements, progress, nextLog: goalDueOn(goal, progress) }
          return (
            <SkillGoalTile
              key={goal.id}
              item={item}
              user={user}
              actor={actor}
              open={openGoalId === goal.id}
              onToggle={() => setOpenGoalId((current) => (current === goal.id ? null : goal.id))}
              // The tile compares progress before and after a log for its
              // feedback, so it gets this goal back with the fresh activities.
              onChanged={async () => [{ goal, statements: (await onActivitiesChanged()) ?? statements }]}
              linkToSkill={false}
              onAddTarget={() => setEditingGoal(goal)}
              onEdit={() => setEditingGoal(goal)}
              onShowEntries={() => setEntriesGoalId(goal.id)}
            />
          )
        })}
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

