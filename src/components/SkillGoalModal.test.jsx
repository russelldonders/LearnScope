import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mySkills = [{ id: 'skill-run', name: 'Running' }]
const draftSkillGoal = vi.fn()
const createSkillGoal = vi.fn(() => Promise.resolve({ id: 'new-goal' }))
const listSkillGoals = vi.fn(() => Promise.resolve([]))
const findOrCreatePersonalSkill = vi.fn((userId, name) => Promise.resolve({ skill: { id: 'skill-new', name }, created: true }))

vi.mock('../lib/skillGoals', () => ({
  draftSkillGoal: (...args) => draftSkillGoal(...args),
  createSkillGoal: (...args) => createSkillGoal(...args),
  listSkillGoals: (...args) => listSkillGoals(...args),
  updateSkillGoal: vi.fn(),
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
    expect(draftSkillGoal).toHaveBeenCalledWith(expect.objectContaining({ skillName: null, skills: ['Running'] }))
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
