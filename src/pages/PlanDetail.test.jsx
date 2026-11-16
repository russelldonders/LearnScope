import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const lib = vi.hoisted(() => ({
  getPlan: vi.fn(),
  loadPlanContext: vi.fn(),
  listPlannableRecords: vi.fn(),
  addItem: vi.fn(),
  addSection: vi.fn(),
  deletePlan: vi.fn(),
  deleteSection: vi.fn(),
  removeItem: vi.fn(),
  savePositions: vi.fn(),
  setItemDone: vi.fn(),
  setPlanStatus: vi.fn(),
  updateItem: vi.fn(),
  updatePlan: vi.fn(),
  updateSection: vi.fn(),
  listPlans: vi.fn(),
  createPlan: vi.fn(),
}))

vi.mock('../lib/learnerPlans', () => lib)
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }))
vi.mock('../components/AppHeader', () => ({ default: () => <header>Header</header> }))
vi.mock('../components/SetTargetModal', () => ({ default: ({ skill }) => <div role="dialog">Set target for {skill.name}</div> }))
vi.mock('../context/LanguageContext', async () => {
  const { english } = await import('../lib/i18n/translations')
  const t = (key, params) => {
    const value = key.split('.').reduce((v, part) => v?.[part], english) ?? key
    return params ? value.replace(/\{(\w+)\}/g, (m, name) => (name in params ? params[name] : m)) : value
  }
  return { useLanguage: () => ({ language: 'en', setLanguage: vi.fn(), t }) }
})

const { default: PlanDetail } = await import('./PlanDetail')

const context = {
  today: '2026-11-16',
  latestTargetBySkill: new Map([['s2', { target_level: 4 }]]),
  goalsById: new Map([['g1', { id: 'g1', title: 'Run 10k', status: 'active', skill_id: 's1' }]]),
  replacedBy: new Map(),
  goalProgressById: new Map([['g1', { reached: true }]]),
}

const plan = {
  id: 'p1', title: 'Become a team lead', description: 'Within a year', status: 'active',
  starts_on: '2026-11-01', target_on: '2027-11-01', completed_on: null,
  sections: [{ id: 'sec1', title: 'Foundations', position: 0, target_on: null }],
  items: [
    { id: 'i1', section_id: 'sec1', item_type: 'course', course_id: 'c1', courses: { id: 'c1', name: 'Leading teams', completed_date: '2026-11-10', status: null } },
    { id: 'i2', section_id: 'sec1', item_type: 'skill', skill_id: 's1', skills: { id: 's1', name: 'Coaching', level: 2 } },
    { id: 'i3', section_id: 'sec1', item_type: 'skill', skill_id: 's2', skills: { id: 's2', name: 'Feedback', level: 3 } },
    { id: 'i4', section_id: 'sec1', item_type: 'skill_goal', skill_goal_id: 'g1', skill_goals: { id: 'g1', title: 'Run 10k', skill_id: 's1' } },
    { id: 'i5', section_id: null, item_type: 'step', step_title: 'Shadow a senior lead', completed_on: null, target_on: '2026-11-10' },
    { id: 'i6', section_id: null, item_type: 'course', course_id: null, courses: null },
  ],
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/plans/p1']}>
      <Routes>
        <Route path="/plans/:planId" element={<PlanDetail />} />
        <Route path="/plans" element={<p>All plans</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  lib.getPlan.mockResolvedValue(plan)
  lib.loadPlanContext.mockResolvedValue(context)
  lib.listPlannableRecords.mockResolvedValue({ course: [{ id: 'c9', name: 'Public speaking', provider: 'Acme' }], skill: [], skill_goal: [], skill_resource: [] })
  for (const fn of ['addItem', 'addSection', 'deletePlan', 'removeItem', 'savePositions', 'setItemDone', 'setPlanStatus', 'updateItem']) lib[fn].mockResolvedValue()
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const stateOf = (title) => screen.getByText(title).closest('li').querySelector('[data-state]').getAttribute('data-state')

describe('PlanDetail', () => {
  it('shows each item\'s state from its own record, and overall progress', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Become a team lead' })).toBeInTheDocument()
    expect(stateOf('Leading teams')).toBe('done')
    expect(stateOf('Coaching')).toBe('needs_target')
    expect(stateOf('Feedback')).toBe('in_progress')
    expect(stateOf('Run 10k')).toBe('done')
    expect(stateOf('Shadow a senior lead')).toBe('not_started')
    // 2 done of 5 counted: the deleted course is left out.
    expect(screen.getByText('2 of 5 done')).toBeInTheDocument()
    expect(screen.getByText('This Course was deleted')).toBeInTheDocument()
    expect(screen.getByText('Overdue: 1')).toBeInTheDocument()
    expect(screen.getByText('Now Developing · set a target to measure progress')).toBeInTheDocument()
  })

  it('ticks off a step', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Mark “Shadow a senior lead” done' }))
    await waitFor(() => expect(lib.setItemDone).toHaveBeenCalledWith('i5', true))
  })

  it('opens the skill target dialog for a skill with no target', async () => {
    renderPage()
    const coaching = (await screen.findByText('Coaching')).closest('li')
    fireEvent.click(within(coaching).getByRole('button', { name: 'Set a target' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Set target for Coaching')
  })

  it('adds one of the learner\'s courses to a section', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Add to Foundations' }))
    fireEvent.change(await screen.findByLabelText('Choose a course'), { target: { value: 'c9' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(lib.addItem).toHaveBeenCalledWith('p1', expect.objectContaining({ itemType: 'course', recordId: 'c9', sectionId: 'sec1', position: 4 })))
  })

  it('removes an item only after confirming, and says the record stays', async () => {
    renderPage()
    const step = (await screen.findByText('Shadow a senior lead')).closest('li')
    fireEvent.click(within(step).getByRole('button', { name: 'Remove' }))
    expect(screen.getByText(/isn’t changed/)).toBeInTheDocument()
    expect(lib.removeItem).not.toHaveBeenCalled()
    const buttons = screen.getAllByRole('button', { name: 'Remove' })
    fireEvent.click(buttons[buttons.length - 1])
    await waitFor(() => expect(lib.removeItem).toHaveBeenCalledWith('i5'))
  })

  it('reorders items within a section', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Move Coaching up' }))
    await waitFor(() => expect(lib.savePositions).toHaveBeenCalledWith('learner_plan_items', [
      { id: 'i2', position: 0 }, { id: 'i1', position: 1 }, { id: 'i3', position: 2 }, { id: 'i4', position: 3 },
    ]))
  })

  it('marks the plan complete', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Mark plan complete' }))
    await waitFor(() => expect(lib.setPlanStatus).toHaveBeenCalledWith('p1', 'completed'))
  })

  it('says when a plan does not exist', async () => {
    lib.getPlan.mockResolvedValue(null)
    renderPage()
    expect(await screen.findByText(/doesn’t exist, or isn’t yours/)).toBeInTheDocument()
  })
})
