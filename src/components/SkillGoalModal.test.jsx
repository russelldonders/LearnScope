import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mySkills = [{ id: 'skill-run', name: 'Running' }, { id: 'skill-weight', name: 'Weight loss' }]
const updateSkillGoal = vi.fn(() => Promise.resolve())
const moveSkillGoal = vi.fn(() => Promise.resolve(3))
const draftSkillGoal = vi.fn()
const createSkillGoal = vi.fn(() => Promise.resolve({ id: 'new-goal' }))
const listSkillGoals = vi.fn(() => Promise.resolve([]))
const findOrCreatePersonalSkill = vi.fn((userId, name) => Promise.resolve({ skill: { id: 'skill-new', name }, created: true }))

vi.mock('../lib/skillGoals', () => ({
  draftSkillGoal: (...args) => draftSkillGoal(...args),
  createSkillGoal: (...args) => createSkillGoal(...args),
  listSkillGoals: (...args) => listSkillGoals(...args),
  updateSkillGoal: (...args) => updateSkillGoal(...args),
  moveSkillGoal: (...args) => moveSkillGoal(...args),
  stopSkillGoal: vi.fn(),
  deleteSkillGoal: vi.fn(),
}))
vi.mock('../lib/skillLibrary', () => ({ findOrCreatePersonalSkill: (...args) => findOrCreatePersonalSkill(...args) }))
vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: mySkills }) }) }),
    }),
  },
}))
vi.mock('../context/LanguageContext', async () => {
  const { english } = await import('../lib/i18n/translations')
  const t = (key, params) => {
    const value = key.split('.').reduce((v, part) => v?.[part], english) ?? key
    return typeof value === 'string' && params ? value.replace(/\{(\w+)\}/g, (m, name) => (name in params ? params[name] : m)) : value
  }
  return { useLanguage: () => ({ language: 'en', setLanguage: vi.fn(), t }) }
})

const { default: SkillGoalModal } = await import('./SkillGoalModal')

const weightGoal = {
  title: 'Get down to 96 kg',
  metric: 'weight',
  measure_kind: 'number',
  unit: 'kg',
  direction: 'lower',
  aggregation: 'best',
  period: null,
  target_value: 96,
  target_date: '2027-02-04',
  tracker_question: 'What did you weigh?',
  log_every_days: 7,
  per_set: null,
  sets_per_session: null,
  sessions_per_period: null,
}

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

async function draftFromHome(goal) {
  draftSkillGoal.mockResolvedValueOnce({ outcome: 'goal', goal })
  const onSaved = vi.fn()
  render(<SkillGoalModal userId="me" onSaved={onSaved} onClose={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('What do you want to achieve?'), { target: { value: 'Get down to 96kg in 12 weeks' } })
  // The learner's skills are loaded before drafting, so AI can choose one.
  await waitFor(() => expect(screen.getByRole('button', { name: 'Suggest a goal' })).toBeEnabled())
  await new Promise((resolve) => setTimeout(resolve, 0))
  fireEvent.click(screen.getByRole('button', { name: 'Suggest a goal' }))
  await screen.findByLabelText('Skill')
  return onSaved
}

describe('adding a goal from Home, without a skill', () => {
  it('asks AI to place the goal among the learner skills', async () => {
    await draftFromHome({ ...weightGoal, skill_name: 'Weight management', skill_is_new: true })
    expect(draftSkillGoal).toHaveBeenCalledWith(expect.objectContaining({ skillName: null, skills: ['Running', 'Weight loss'] }))
  })

  it('creates the suggested new skill on save, then the goal on it', async () => {
    const onSaved = await draftFromHome({ ...weightGoal, skill_name: 'Weight management', skill_is_new: true })
    expect(screen.getByLabelText('Skill')).toHaveValue('Weight management')
    expect(screen.getByText(/“Weight management” is new/)).toBeInTheDocument()
    expect(findOrCreatePersonalSkill).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm goal' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ id: 'new-goal' }))
    expect(findOrCreatePersonalSkill).toHaveBeenCalledWith('me', 'Weight management')
    expect(createSkillGoal).toHaveBeenCalledWith('skill-new', expect.objectContaining({ title: 'Get down to 96 kg', target_date: '2027-02-04' }), [])
  })

  it('uses an existing skill without creating one', async () => {
    const onSaved = await draftFromHome({ ...weightGoal, skill_name: 'Running', skill_is_new: false })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm goal' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(findOrCreatePersonalSkill).not.toHaveBeenCalled()
    expect(listSkillGoals).toHaveBeenCalledWith('skill-run')
    expect(createSkillGoal).toHaveBeenCalledWith('skill-run', expect.anything(), [])
  })

  it('needs a skill before saving', async () => {
    await draftFromHome({ ...weightGoal, skill_name: 'Running', skill_is_new: false })
    fireEvent.change(screen.getByLabelText('Skill'), { target: { value: '  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm goal' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose the skill this goal develops.')
    expect(createSkillGoal).not.toHaveBeenCalled()
  })
})

describe('editing a goal', () => {
  const running = { id: 'skill-run', name: 'Running', user_id: 'me' }
  const goal = { ...weightGoal, id: 'goal-1', skill_id: 'skill-run', started_on: '2026-11-01' }

  function renderEdit() {
    const onSaved = vi.fn()
    render(<SkillGoalModal skill={running} goal={goal} goals={[goal]} onSaved={onSaved} onClose={vi.fn()} />)
    return onSaved
  }

  it("moves a goal set on the wrong skill, then saves the rest on the skill it's now on", async () => {
    const onSaved = renderEdit()
    const skillInput = await screen.findByLabelText('Skill')
    expect(skillInput).toHaveValue('Running')
    expect(screen.getByText('On the wrong skill? Choose another of your skills, or type a new one.')).toBeInTheDocument()
    fireEvent.change(skillInput, { target: { value: 'weight loss' } })
    expect(screen.getByText('This goal moves to “Weight loss” when you save, with the entries logged for it.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(moveSkillGoal).toHaveBeenCalledWith('goal-1', 'skill-weight')
    expect(updateSkillGoal).toHaveBeenCalledWith(expect.objectContaining({ id: 'goal-1', skill_id: 'skill-weight' }), expect.anything())
    expect(moveSkillGoal.mock.invocationCallOrder[0]).toBeLessThan(updateSkillGoal.mock.invocationCallOrder[0])
  })

  it("leaves the skill alone when it isn't changed", async () => {
    const onSaved = renderEdit()
    await screen.findByLabelText('Skill')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(moveSkillGoal).not.toHaveBeenCalled()
    expect(updateSkillGoal).toHaveBeenCalledWith(goal, expect.anything())
  })
})

describe('a limit', () => {
  const coffeeLimit = {
    ...weightGoal,
    title: 'No more than 2 coffees a day',
    metric: 'coffees',
    measure_kind: 'count',
    unit: 'coffees',
    direction: 'lower',
    aggregation: 'total',
    period: 'day',
    target_value: 2,
    target_date: null,
    tracker_question: 'How many coffees did you have?',
    log_every_days: 1,
    skill_name: 'Running',
    skill_is_new: false,
  }

  it('keeps a drafted limit, asks for the limit instead of a target, and offers no sets', async () => {
    const onSaved = await draftFromHome(coffeeLimit)
    expect(screen.getByLabelText('A target or a limit?')).toHaveValue('lower')
    expect(screen.getByLabelText('Limit (coffees)')).toHaveValue('2')
    expect(screen.queryByText(/sets/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm goal' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(createSkillGoal).toHaveBeenCalledWith('skill-run', expect.objectContaining({ direction: 'lower', aggregation: 'total', period: 'day', target_value: 2, per_set: null }), [])
  })

  it('turns back into a target when the total stops repeating', async () => {
    await draftFromHome(coffeeLimit)
    fireEvent.change(screen.getByLabelText('Total for each'), { target: { value: '' } })
    expect(screen.queryByLabelText('A target or a limit?')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Target (coffees)')).toBeInTheDocument()
  })
})
