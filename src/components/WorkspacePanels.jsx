import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import { formatFullDate } from '../lib/dates'
import { LEVEL_LABELS } from '../lib/levels'
import { listOrganisationGoals, listOrganisationSkills } from '../lib/workspacePanels'
import AssignedPlansList from './AssignedPlansList'

// The LearnScope panels on an organisation's own workspace pages
// (PANEL_BLOCKS in pageBuilder.js): the signed-in member's goals and skills
// that belong to this organisation, never the rest of their record. The
// sample versions draw the same layout with made-up rows for the admin's
// editor and preview, so an admin never sees a member's records there.

function levelText(t, level) {
  return t('workspacePanels.level', { level, label: LEVEL_LABELS[level] ?? '' })
}

function PanelFrame({ title, children }) {
  return (
    <section className="not-prose my-6 rounded-lg border border-hairline bg-card p-5" aria-label={title}>
      <h2 className="font-display text-lg text-ink mb-3">{title}</h2>
      {children}
    </section>
  )
}

function GoalRows({ goals }) {
  const { t } = useLanguage()
  if (goals.length === 0) return <p className="text-sm text-secondary">{t('workspacePanels.noGoals')}</p>
  return (
    <ul className="divide-y divide-hairline">
      {goals.map((goal) => (
        <li key={goal.id} className="py-2.5 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-sm font-medium text-ink">{goal.skillName}</span>
            {goal.status === 'completed' && (
              <span className="font-mono text-[10px] uppercase tracking-wide text-moss">{t('workspacePanels.completed')}</span>
            )}
          </div>
          <p className="text-xs text-secondary mt-0.5">
            {t('workspacePanels.goalTarget', { level: levelText(t, goal.targetLevel), date: formatFullDate(goal.targetDate) })}
            {goal.currentLevel != null && <> · {t('workspacePanels.yourLevel', { level: levelText(t, goal.currentLevel) })}</>}
          </p>
        </li>
      ))}
    </ul>
  )
}

function SkillRows({ skills }) {
  const { t } = useLanguage()
  if (skills.length === 0) return <p className="text-sm text-secondary">{t('workspacePanels.noSkills')}</p>
  return (
    <ul className="divide-y divide-hairline">
      {skills.map((skill) => (
        <li key={skill.key} className="py-2.5 first:pt-0 last:pb-0">
          <span className="text-sm font-medium text-ink">{skill.skillName}</span>
          <p className="text-xs text-secondary mt-0.5">
            {[
              skill.ratedLevel != null && t('workspacePanels.rated', { level: levelText(t, skill.ratedLevel), date: formatFullDate(skill.ratedAt) }),
              skill.goalLevel != null && t('workspacePanels.goal', { level: levelText(t, skill.goalLevel) }),
              skill.currentLevel != null && t('workspacePanels.yourLevel', { level: levelText(t, skill.currentLevel) }),
            ].filter(Boolean).join(' · ')}
          </p>
        </li>
      ))}
    </ul>
  )
}

// Loads a panel's rows for the signed-in member, again whenever its
// settings change.
function usePanelRows(load, organisationId, block) {
  const { user } = useAuth()
  const [state, setState] = useState({ rows: null, error: false })
  const userId = user?.id
  const settingsKey = `${block.limit}:${block.show ?? ''}`
  useEffect(() => {
    if (!userId || !organisationId) return undefined
    let cancelled = false
    load(userId, organisationId, { limit: block.limit, show: block.show })
      .then((rows) => { if (!cancelled) setState({ rows, error: false }) })
      .catch(() => { if (!cancelled) setState({ rows: null, error: true }) })
    return () => { cancelled = true }
    // settingsKey stands for the block settings the loader reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, userId, organisationId, settingsKey])
  return state
}

function PanelBody({ state, children }) {
  const { t } = useLanguage()
  if (state.error) return <p className="text-sm text-red-700">{t('workspacePanels.loadError')}</p>
  if (!state.rows) return <p className="text-sm text-secondary">{t('workspacePanels.loading')}</p>
  return children(state.rows)
}

export function GoalsPanel({ block, organisationId }) {
  const { t } = useLanguage()
  const state = usePanelRows(listOrganisationGoals, organisationId, block)
  return (
    <PanelFrame title={block.title || t('workspacePanels.goalsTitle')}>
      <PanelBody state={state}>{(goals) => <GoalRows goals={goals} />}</PanelBody>
    </PanelFrame>
  )
}

export function SkillsPanel({ block, organisationId }) {
  const { t } = useLanguage()
  const state = usePanelRows(listOrganisationSkills, organisationId, block)
  return (
    <PanelFrame title={block.title || t('workspacePanels.skillsTitle')}>
      <PanelBody state={state}>{(skills) => <SkillRows skills={skills} />}</PanelBody>
    </PanelFrame>
  )
}

// The member's plans from this organisation: assigned (to start) and started.
export function PlansPanel({ block, organisationId, organisationName = null, framing = 'assigned' }) {
  const { t } = useLanguage()
  return (
    <PanelFrame title={block.title || t('workspacePanels.plansTitle')}>
      <AssignedPlansList organisationId={organisationId} organisationName={organisationName} framing={framing}
        limit={block.limit} emptyText={t('workspacePanels.noPlans')} />
    </PanelFrame>
  )
}

const SAMPLE_GOALS = [
  { id: 'sample-1', skillName: 'Giving feedback', targetLevel: 3, targetDate: '2027-03-31', status: 'active', currentLevel: 2 },
  { id: 'sample-2', skillName: 'Data analysis', targetLevel: 4, targetDate: '2027-06-30', status: 'active', currentLevel: 3 },
  { id: 'sample-3', skillName: 'Presenting', targetLevel: 2, targetDate: '2026-09-30', status: 'completed', currentLevel: 2 },
]
const SAMPLE_SKILLS = [
  { key: 'sample-1', skillName: 'Data analysis', ratedLevel: 3, ratedAt: '2026-11-02', goalLevel: 4, currentLevel: 3 },
  { key: 'sample-2', skillName: 'Giving feedback', ratedLevel: null, ratedAt: null, goalLevel: 3, currentLevel: 2 },
  { key: 'sample-3', skillName: 'Presenting', ratedLevel: 2, ratedAt: '2026-09-14', goalLevel: null, currentLevel: 2 },
]

function SampleNote() {
  const { t } = useLanguage()
  return <p className="mb-3 font-mono text-[10px] uppercase tracking-wide text-secondary">{t('workspacePanels.sample')}</p>
}

// Made-up rows in the same layout, for the admin's editor and preview.
export function SampleGoalsPanel({ block }) {
  const { t } = useLanguage()
  const goals = SAMPLE_GOALS.filter((goal) => block.show === 'all' || goal.status === 'active').slice(0, block.limit)
  return (
    <PanelFrame title={block.title || t('workspacePanels.goalsTitle')}>
      <SampleNote />
      <GoalRows goals={goals} />
    </PanelFrame>
  )
}

export function SampleSkillsPanel({ block }) {
  const { t } = useLanguage()
  return (
    <PanelFrame title={block.title || t('workspacePanels.skillsTitle')}>
      <SampleNote />
      <SkillRows skills={SAMPLE_SKILLS.slice(0, block.limit)} />
    </PanelFrame>
  )
}

const SAMPLE_PLANS = [
  { id: 'sample-1', title: 'New manager essentials', steps: 6, status: 'started', done: 2 },
  { id: 'sample-2', title: 'Safety refresher', steps: 3, status: 'assigned', done: 0 },
]

export function SamplePlansPanel({ block }) {
  const { t } = useLanguage()
  return (
    <PanelFrame title={block.title || t('workspacePanels.plansTitle')}>
      <SampleNote />
      <ul className="divide-y divide-hairline">
        {SAMPLE_PLANS.slice(0, block.limit).map((plan) => (
          <li key={plan.id} className="py-2.5 first:pt-0 last:pb-0">
            <span className="text-sm font-medium text-ink">{plan.title}</span>
            <p className="text-xs text-secondary mt-0.5">
              {t('assignedPlans.steps', { count: plan.steps })}
              {plan.status === 'started' && ` · ${t('assignedPlans.progress', { done: plan.done, total: plan.steps })}`}
            </p>
          </li>
        ))}
      </ul>
    </PanelFrame>
  )
}
