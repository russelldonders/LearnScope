import { useCallback, useEffect, useState } from 'react'
import ConfirmDialog from '../../components/ConfirmDialog'
import { formatFullDate } from '../../lib/dates'
import { LEVEL_LABELS, LEVELS } from '../../lib/levels'
import { listEmployerMembers } from '../../lib/admin/employers'
import {
  addOrganisationPlanStep,
  archiveOrganisationPlan,
  assignOrganisationPlan,
  createOrganisationPlan,
  deleteOrganisationPlan,
  getOrganisationPlan,
  listOrganisationPlanProgress,
  listOrganisationPlans,
  listPlanCatalogueCourses,
  removeOrganisationPlanStep,
  reorderOrganisationPlanSteps,
  searchPlanLibrarySkills,
  stepStatusesOf,
  updateOrganisationPlan,
  withdrawPlanAssignment,
} from '../../lib/organisationPlans'

// The organisation console's Plans section: the organisation's own plans
// (0328), built from its catalogue courses, skill library and plain steps,
// assigned to members, with each member's progress once they've started.

const FIELD = 'w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss'
const PRIMARY = 'rounded-md bg-moss text-paper px-3 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-60'
const SECONDARY = 'rounded-md border border-hairline text-ink px-3 py-2 text-sm font-medium hover:bg-paper disabled:opacity-60'

const STEP_STATUS_LABELS = {
  not_started: 'Not started',
  in_progress: 'In progress',
  done: 'Done',
  stopped: 'Stopped',
  removed: 'Removed',
  needs_target: 'No target',
}
const ASSIGNMENT_LABELS = { assigned: 'Assigned, not started', started: 'Started', dismissed: 'Dismissed' }

function stepTitle(item) {
  if (item.item_type === 'course') return item.course_catalogue?.name ?? 'Course no longer available'
  if (item.item_type === 'skill') return item.skill_library?.name ?? 'Skill no longer available'
  return item.step_title
}

function stepKind(item) {
  if (item.item_type === 'course') return 'Course'
  if (item.item_type === 'skill') return `Skill · reach ${LEVEL_LABELS[item.plan_practical_level] ?? 'a level'}`
  return 'Step'
}

export default function OrganisationPlansPanel({ organisationId }) {
  const [plans, setPlans] = useState(null)
  const [error, setError] = useState(null)
  const [openPlanId, setOpenPlanId] = useState(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      setPlans(await listOrganisationPlans(organisationId))
    } catch (err) {
      setError(err.message)
    }
  }, [organisationId])

  useEffect(() => { load() }, [load])

  if (openPlanId) {
    return (
      <OrganisationPlanDetail
        planId={openPlanId}
        organisationId={organisationId}
        onBack={() => { setOpenPlanId(null); load() }}
      />
    )
  }

  return (
    <section className="rounded-lg border border-hairline bg-card p-5" aria-labelledby="organisation-plans-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <p className="font-mono text-xs uppercase tracking-wide text-moss">Plans</p>
          <h2 id="organisation-plans-heading" className="font-display text-xl text-ink mt-1">Your organisation’s plans</h2>
          <p className="text-sm text-secondary mt-2">
            Build a plan from your catalogue courses, skills and steps, then assign it to members. Members choose to start it,
            and once they do you see their progress.
          </p>
        </div>
        {!creating && <button type="button" className={PRIMARY} onClick={() => setCreating(true)}>New plan</button>}
      </div>

      {creating && (
        <PlanDetailsForm
          submitLabel="Create plan"
          onCancel={() => setCreating(false)}
          onSubmit={async (values) => {
            const id = await createOrganisationPlan(organisationId, values)
            setCreating(false)
            setOpenPlanId(id)
          }}
        />
      )}

      {error && <p role="alert" className="text-sm text-red-700 mt-4">{error}</p>}
      {!plans && !error && <p className="text-sm text-secondary mt-5">Loading plans…</p>}
      {plans?.length === 0 && !creating && <p className="text-sm text-secondary mt-5">No plans yet.</p>}
      {plans?.length > 0 && (
        <ul className="mt-5 divide-y divide-hairline border-y border-hairline">
          {plans.map((plan) => (
            <li key={plan.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <button type="button" onClick={() => setOpenPlanId(plan.id)} className="font-medium text-ink hover:underline text-left">
                  {plan.title}
                </button>
                <p className="text-xs text-secondary mt-0.5">
                  {plan.stepCount} {plan.stepCount === 1 ? 'step' : 'steps'} · {plan.assignedCount} assigned · {plan.startedCount} started
                  {plan.status === 'archived' && ' · Archived'}
                </p>
              </div>
              <button type="button" className={SECONDARY} onClick={() => setOpenPlanId(plan.id)}>Open</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function PlanDetailsForm({ initial = {}, submitLabel, onSubmit, onCancel }) {
  const [title, setTitle] = useState(initial.title ?? '')
  const [description, setDescription] = useState(initial.description ?? '')
  const [targetOn, setTargetOn] = useState(initial.target_on ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  return (
    <form
      className="mt-5 grid gap-3 max-w-2xl"
      onSubmit={async (event) => {
        event.preventDefault()
        if (!title.trim()) return
        setBusy(true)
        setError(null)
        try {
          await onSubmit({ title, description, targetOn })
        } catch (err) {
          setError(err.message)
          setBusy(false)
        }
      }}
    >
      <label className="text-xs text-secondary">
        Plan name
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className={`mt-1 ${FIELD}`} required />
      </label>
      <label className="text-xs text-secondary">
        What it’s for (optional)
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} rows={3} className={`mt-1 ${FIELD}`} />
      </label>
      <label className="text-xs text-secondary sm:max-w-xs">
        Finish by (optional)
        <input type="date" value={targetOn ?? ''} onChange={(e) => setTargetOn(e.target.value)} className={`mt-1 ${FIELD}`} />
      </label>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className={PRIMARY} disabled={busy || !title.trim()}>{busy ? 'Saving…' : submitLabel}</button>
        <button type="button" className={SECONDARY} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

function OrganisationPlanDetail({ planId, organisationId, onBack }) {
  const [plan, setPlan] = useState(null)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [progressKey, setProgressKey] = useState(0)

  const load = useCallback(async () => {
    setError(null)
    try {
      setPlan(await getOrganisationPlan(planId))
    } catch (err) {
      setError(err.message)
    }
  }, [planId])

  useEffect(() => { load() }, [load])

  async function run(action) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function moveStep(index, direction) {
    const ids = plan.items.map((item) => item.id)
    const target = index + direction
    if (target < 0 || target >= ids.length) return
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    await run(() => reorderOrganisationPlanSteps(ids))
  }

  if (!plan) {
    return (
      <section className="rounded-lg border border-hairline bg-card p-5">
        <button type="button" onClick={onBack} className="text-sm text-moss hover:underline">← All plans</button>
        {error ? <p role="alert" className="text-sm text-red-700 mt-4">{error}</p> : <p className="text-sm text-secondary mt-4">Loading plan…</p>}
      </section>
    )
  }

  const archived = plan.status === 'archived'

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-hairline bg-card p-5" aria-labelledby="organisation-plan-heading">
        <button type="button" onClick={onBack} className="text-sm text-moss hover:underline">← All plans</button>
        {editing ? (
          <PlanDetailsForm
            initial={plan}
            submitLabel="Save"
            onCancel={() => setEditing(false)}
            onSubmit={async (values) => {
              await updateOrganisationPlan(plan.id, values)
              setEditing(false)
              await load()
            }}
          />
        ) : (
          <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
            <div className="max-w-2xl">
              <h2 id="organisation-plan-heading" className="font-display text-xl text-ink">{plan.title}</h2>
              {plan.description && <p className="text-sm text-secondary mt-1 whitespace-pre-wrap">{plan.description}</p>}
              {plan.target_on && <p className="text-xs text-secondary mt-1">Finish by {formatFullDate(plan.target_on)}</p>}
              {archived && <p className="text-xs text-secondary mt-1">Archived: it can’t be assigned, and members no longer see it as assigned.</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={SECONDARY} onClick={() => setEditing(true)}>Edit details</button>
              <button type="button" className={SECONDARY} disabled={busy} onClick={() => run(() => archiveOrganisationPlan(plan.id, !archived))}>
                {archived ? 'Restore' : 'Archive'}
              </button>
              <button type="button" className={`${SECONDARY} text-red-700`} onClick={() => setConfirmingDelete(true)}>Delete</button>
            </div>
          </div>
        )}
        {error && <p role="alert" className="text-sm text-red-700 mt-4">{error}</p>}
      </section>

      <section className="rounded-lg border border-hairline bg-card p-5" aria-labelledby="organisation-plan-steps-heading">
        <h3 id="organisation-plan-steps-heading" className="font-display text-lg text-ink">Steps</h3>
        {plan.items.length === 0 && <p className="text-sm text-secondary mt-2">No steps yet. Add a course, a skill or a step below.</p>}
        {plan.items.length > 0 && (
          <ol className="mt-3 divide-y divide-hairline border-y border-hairline">
            {plan.items.map((item, index) => (
              <li key={item.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm text-ink">{index + 1}. {stepTitle(item)}</p>
                  <p className="text-xs text-secondary">{stepKind(item)}{item.note ? ` · ${item.note}` : ''}</p>
                </div>
                <div className="flex gap-1">
                  <button type="button" className={SECONDARY} disabled={busy || index === 0} onClick={() => moveStep(index, -1)} aria-label={`Move ${stepTitle(item)} up`}>Up</button>
                  <button type="button" className={SECONDARY} disabled={busy || index === plan.items.length - 1} onClick={() => moveStep(index, 1)} aria-label={`Move ${stepTitle(item)} down`}>Down</button>
                  <button type="button" className={`${SECONDARY} text-red-700`} disabled={busy} onClick={() => run(() => removeOrganisationPlanStep(item.id))} aria-label={`Remove ${stepTitle(item)}`}>Remove</button>
                </div>
              </li>
            ))}
          </ol>
        )}
        <AddStepForm
          organisationId={organisationId}
          disabled={busy}
          onAdd={(step) => run(() => addOrganisationPlanStep(plan.id, step, plan.items.length))}
        />
      </section>

      {!archived && (
        <AssignPlanSection
          planId={plan.id}
          organisationId={organisationId}
          hasSteps={plan.items.length > 0}
          onAssigned={() => setProgressKey((key) => key + 1)}
        />
      )}

      <PlanProgressSection key={progressKey} plan={plan} />

      {confirmingDelete && (
        <ConfirmDialog
          message={`Delete “${plan.title}”? Members on it lose the plan and its progress. Their own courses and skills stay on their records.`}
          confirmLabel="Delete plan"
          onConfirm={async () => {
            setConfirmingDelete(false)
            try {
              await deleteOrganisationPlan(plan.id)
              onBack()
            } catch (err) {
              setError(err.message)
            }
          }}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  )
}

function AddStepForm({ organisationId, disabled, onAdd }) {
  const [type, setType] = useState('course')
  const [courses, setCourses] = useState(null)
  const [courseId, setCourseId] = useState('')
  const [skillQuery, setSkillQuery] = useState('')
  const [skillOptions, setSkillOptions] = useState([])
  const [skillId, setSkillId] = useState('')
  const [level, setLevel] = useState(3)
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState(null)

  useEffect(() => {
    if (type !== 'course' || courses) return
    listPlanCatalogueCourses(organisationId).then(setCourses).catch((err) => setError(err.message))
  }, [type, courses, organisationId])

  useEffect(() => {
    if (type !== 'skill') return undefined
    let cancelled = false
    const timer = setTimeout(() => {
      searchPlanLibrarySkills(organisationId, skillQuery)
        .then((rows) => { if (!cancelled) setSkillOptions(rows) })
        .catch((err) => { if (!cancelled) setError(err.message) })
    }, 250)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [type, skillQuery, organisationId])

  const ready = type === 'course' ? Boolean(courseId) : type === 'skill' ? Boolean(skillId) : Boolean(title.trim())

  return (
    <form
      className="mt-4 grid gap-3 max-w-2xl"
      aria-label="Add a step"
      onSubmit={async (event) => {
        event.preventDefault()
        if (!ready) return
        setError(null)
        await onAdd(type === 'course'
          ? { type, catalogueCourseId: courseId, note }
          : type === 'skill'
            ? { type, librarySkillId: skillId, practicalLevel: Number(level), note }
            : { type, title, note })
        setCourseId('')
        setSkillId('')
        setTitle('')
        setNote('')
      }}
    >
      <fieldset>
        <legend className="text-xs font-medium text-ink">Add</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {[['course', 'A course'], ['skill', 'A skill'], ['step', 'A step']].map(([value, label]) => (
            <label key={value} className={`cursor-pointer rounded-full border px-3 py-1.5 text-xs ${type === value ? 'border-moss bg-moss/10 text-ink' : 'border-hairline text-secondary'}`}>
              <input type="radio" name="step-type" value={value} checked={type === value} onChange={() => setType(value)} className="sr-only" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      {type === 'course' && (
        <label className="text-xs text-secondary">
          Course
          <select value={courseId} onChange={(e) => setCourseId(e.target.value)} className={`mt-1 ${FIELD}`}>
            <option value="">{courses ? 'Choose a course…' : 'Loading courses…'}</option>
            {(courses ?? []).map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
          </select>
          {courses?.length === 0 && <span className="block mt-1">No catalogue courses are available to your organisation yet.</span>}
        </label>
      )}
      {type === 'skill' && (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
          <div>
            <label className="text-xs text-secondary">
              Find a skill
              <input value={skillQuery} onChange={(e) => setSkillQuery(e.target.value)} placeholder="Search the skill library" className={`mt-1 ${FIELD}`} />
            </label>
            <label className="text-xs text-secondary mt-2 block">
              Skill
              <select value={skillId} onChange={(e) => setSkillId(e.target.value)} className={`mt-1 ${FIELD}`}>
                <option value="">Choose a skill…</option>
                {skillOptions.map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}
              </select>
            </label>
          </div>
          <label className="text-xs text-secondary">
            Level to reach
            <select value={level} onChange={(e) => setLevel(e.target.value)} className={`mt-1 ${FIELD}`}>
              {LEVELS.map((value) => <option key={value} value={value}>{value} · {LEVEL_LABELS[value]}</option>)}
            </select>
          </label>
        </div>
      )}
      {type === 'step' && (
        <label className="text-xs text-secondary">
          What to do
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="e.g. Meet your team" className={`mt-1 ${FIELD}`} />
        </label>
      )}
      <label className="text-xs text-secondary">
        Note for members (optional)
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} className={`mt-1 ${FIELD}`} />
      </label>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div>
        <button type="submit" className={PRIMARY} disabled={disabled || !ready}>Add step</button>
      </div>
    </form>
  )
}

function AssignPlanSection({ planId, organisationId, hasSteps, onAssigned }) {
  const [members, setMembers] = useState(null)
  const [chosen, setChosen] = useState(() => new Set())
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    listEmployerMembers(organisationId)
      .then((rows) => setMembers(rows.filter((row) => row.status === 'active')))
      .catch((err) => setError(err.message))
  }, [organisationId])

  const shown = (members ?? []).filter((member) => !filter.trim() || (member.email ?? '').toLowerCase().includes(filter.trim().toLowerCase()))

  return (
    <section className="rounded-lg border border-hairline bg-card p-5" aria-labelledby="organisation-plan-assign-heading">
      <h3 id="organisation-plan-assign-heading" className="font-display text-lg text-ink">Assign to members</h3>
      <p className="text-sm text-secondary mt-1">
        Members see it as assigned and choose whether to start it. Nothing is added to their record until they do,
        and they’re told you’ll see their progress.
      </p>
      {!hasSteps && <p className="text-sm text-secondary mt-3">Add at least one step before assigning.</p>}
      {hasSteps && (
        <>
          <label className="block text-xs text-secondary mt-3 max-w-sm">
            Filter members
            <input value={filter} onChange={(e) => setFilter(e.target.value)} className={`mt-1 ${FIELD}`} />
          </label>
          {!members && !error && <p className="text-sm text-secondary mt-3">Loading members…</p>}
          {members && (
            <fieldset className="mt-3">
              <legend className="sr-only">Members to assign</legend>
              <div className="max-h-64 overflow-y-auto divide-y divide-hairline border-y border-hairline">
                {shown.map((member) => (
                  <label key={member.user_id} className="flex items-center gap-2 py-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={chosen.has(member.user_id)}
                      onChange={() => setChosen((current) => {
                        const next = new Set(current)
                        if (next.has(member.user_id)) next.delete(member.user_id)
                        else next.add(member.user_id)
                        return next
                      })}
                    />
                    {member.email ?? member.userCode ?? 'Member'}
                  </label>
                ))}
                {shown.length === 0 && <p className="py-2 text-sm text-secondary">No members match.</p>}
              </div>
            </fieldset>
          )}
          {error && <p role="alert" className="text-sm text-red-700 mt-3">{error}</p>}
          {message && <p className="text-sm text-moss mt-3" role="status">{message}</p>}
          <button
            type="button"
            className={`${PRIMARY} mt-3`}
            disabled={busy || chosen.size === 0}
            onClick={async () => {
              setBusy(true)
              setError(null)
              setMessage(null)
              try {
                const count = await assignOrganisationPlan(planId, [...chosen])
                setChosen(new Set())
                setMessage(count === 0
                  ? 'Everyone chosen already has this plan.'
                  : `Assigned to ${count} ${count === 1 ? 'member' : 'members'}.`)
                onAssigned()
              } catch (err) {
                setError(err.message)
              } finally {
                setBusy(false)
              }
            }}
          >
            Assign{chosen.size > 0 ? ` to ${chosen.size}` : ''}
          </button>
        </>
      )}
    </section>
  )
}

function PlanProgressSection({ plan }) {
  const [people, setPeople] = useState(null)
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState(null)

  const load = useCallback(() => {
    listOrganisationPlanProgress(plan.id).then(setPeople).catch((err) => setError(err.message))
  }, [plan.id])

  useEffect(() => { load() }, [load])

  return (
    <section className="rounded-lg border border-hairline bg-card p-5" aria-labelledby="organisation-plan-progress-heading">
      <h3 id="organisation-plan-progress-heading" className="font-display text-lg text-ink">Progress</h3>
      {error && <p role="alert" className="text-sm text-red-700 mt-2">{error}</p>}
      {!people && !error && <p className="text-sm text-secondary mt-2">Loading progress…</p>}
      {people?.length === 0 && <p className="text-sm text-secondary mt-2">Nobody has this plan yet.</p>}
      {people?.length > 0 && (
        <ul className="mt-3 divide-y divide-hairline border-y border-hairline">
          {people.map((person) => {
            const statuses = stepStatusesOf(person)
            const open = expanded === person.user_id
            const started = Boolean(person.joined_at)
            return (
              <li key={person.user_id} className="py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm text-ink">{person.name}</p>
                    <p className="text-xs text-secondary">
                      {person.is_member === false ? 'Left the organisation' : started ? `Started ${formatFullDate(person.joined_at)}` : ASSIGNMENT_LABELS[person.assignment_status] ?? 'Left the plan'}
                      {person.progress_total != null && ` · ${person.progress_done} of ${person.progress_total} done`}
                      {started && person.progress_total == null && ' · No progress recorded yet'}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {person.assignment_status === 'assigned' && !started && (
                      <button
                        type="button"
                        className={SECONDARY}
                        onClick={() => withdrawPlanAssignment(person.assignment_id).then(load).catch((err) => setError(err.message))}
                      >
                        Withdraw
                      </button>
                    )}
                    {statuses.size > 0 && (
                      <button type="button" className={SECONDARY} aria-expanded={open} onClick={() => setExpanded(open ? null : person.user_id)}>
                        {open ? 'Hide steps' : 'Show steps'}
                      </button>
                    )}
                  </div>
                </div>
                {open && (
                  <ol className="mt-2 ml-4 space-y-1">
                    {plan.items.map((item) => (
                      <li key={item.id} className="text-xs text-secondary">
                        <span className="text-ink">{stepTitle(item)}</span>: {STEP_STATUS_LABELS[statuses.get(item.id)] ?? 'Not recorded'}
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
