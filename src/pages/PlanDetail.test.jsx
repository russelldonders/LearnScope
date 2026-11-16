import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
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
  startPlan: vi.fn(),
  getActorName: vi.fn(),
  getItemActivity: vi.fn(),
  activityHasLearnerContent: (row) => Boolean(row?.statement?.object?.definition?.description || row?.evidence_paths?.length || row?.evidence_url),
  updateItem: vi.fn(),
  updatePlan: vi.fn(),
  updateSection: vi.fn(),
  listPlans: vi.fn(),
  createPlan: vi.fn(),
  listPlanInvitations: vi.fn(),
  inviteConnectionsToPlan: vi.fn(),
}))

vi.mock('../lib/learnerPlans', () => lib)
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me', email: 'me@example.com' } }) }))
vi.mock('../components/AppHeader', () => ({ default: () => <header>Header</header> }))
vi.mock('../components/SetTargetModal', () => ({ default: ({ skill }) => <div role="dialog">Set target for {skill.name}</div> }))
const extra = vi.hoisted(() => ({ addResource: vi.fn(), listConnections: vi.fn() }))
vi.mock('../lib/skillResources', () => ({ addResource: extra.addResource }))
vi.mock('../lib/connections', () => ({ listConnections: extra.listConnections }))
vi.mock('../components/SkillGoalModal', () => ({
  default: ({ onSaved }) => (
    <div role="dialog" aria-label="Add a goal">
      <button type="button" onClick={() => onSaved({ id: 'g-new' })}>Save goal</button>
    </div>
  ),
}))
vi.mock('../components/SkillResourcesSection', () => ({
  ResourceForm: ({ hasLibrarySkill, submitLabel, onSubmit }) => (
    <div>
      <span>{hasLibrarySkill ? 'library skill' : 'own skill'}</span>
      <button type="button" onClick={() => onSubmit({ kind: 'link', title: 'Guide', url: 'https://example.com', audience: 'private' })}>{submitLabel}</button>
    </div>
  ),
}))
vi.mock('../components/SkillGoalsDashboardPanel', () => ({
  SkillGoalTile: ({ item, linkToSkill, onChanged }) => (
    <article aria-labelledby={`dashboard-goal-${item.goal.id}`}>
      <h3 id={`dashboard-goal-${item.goal.id}`}>{item.goal.title} tile</h3>
      <span>{linkToSkill ? 'links to skill' : 'no skill link'}</span>
      <button type="button" onClick={onChanged}>Log progress</button>
    </article>
  ),
}))
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
    { id: 'i2', section_id: 'sec1', item_type: 'skill', skill_id: 's1', plan_knowledge_level: null, plan_practical_level: null, skills: { id: 's1', name: 'Coaching', level: 2, knowledge_level: 2 } },
    { id: 'i3', section_id: 'sec1', item_type: 'skill', skill_id: 's2', plan_knowledge_level: null, plan_practical_level: 4, skills: { id: 's2', name: 'Feedback', level: 3, knowledge_level: 3 } },
    { id: 'i4', section_id: 'sec1', item_type: 'skill_goal', skill_goal_id: 'g1', skill_goals: { id: 'g1', title: 'Run 10k', skill_id: 's1' } },
    { id: 'i5', section_id: null, item_type: 'step', step_title: 'Shadow a senior lead', completed_on: null, target_on: '2026-11-10' },
    { id: 'i6', section_id: null, item_type: 'course', course_id: null, courses: null },
  ],
}

// Stands in for the course and skill pages: shows where their back link
// would go.
function WhereBack() {
  const { state } = useLocation()
  return <p>Back to {state?.backTo ?? 'nowhere'} as {state?.backLabel} / {state?.from} as {state?.fromLabel}</p>
}

function renderPage(path = '/plans/p1') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/plans/:planId" element={<PlanDetail />} />
        <Route path="/plans" element={<p>All plans</p>} />
        <Route path="/courses/:id/learn" element={<WhereBack />} />
        <Route path="/skills/:id" element={<WhereBack />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  lib.getPlan.mockResolvedValue(plan)
  lib.loadPlanContext.mockResolvedValue(context)
  lib.listPlannableRecords.mockResolvedValue({ course: [{ id: 'c9', name: 'Public speaking', provider: 'Acme' }], skill: [{ id: 's1', name: 'Coaching', library_skill_id: 'lib-1' }], skill_goal: [], skill_resource: [] })
  lib.getActorName.mockResolvedValue('Sam')
  extra.addResource.mockResolvedValue('r-new')
  extra.listConnections.mockResolvedValue([])
  lib.listPlanInvitations.mockResolvedValue([])
  lib.inviteConnectionsToPlan.mockResolvedValue([])
  for (const fn of ['addItem', 'addSection', 'deletePlan', 'removeItem', 'savePositions', 'setItemDone', 'setPlanStatus', 'startPlan', 'updateItem']) lib[fn].mockResolvedValue()
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
    expect(screen.getByText('40%')).toBeInTheDocument()
    expect(screen.getByText('2 completed')).toBeInTheDocument()
    expect(screen.getByText('3 remaining')).toBeInTheDocument()
    expect(screen.getByText((_, element) => element?.classList.contains('pt-3') && element.textContent.includes('Timeline: 4% elapsed'))).toBeInTheDocument()
    expect(screen.getByText('This Course was deleted')).toBeInTheDocument()
    expect(screen.getByText('Overdue: 1')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'What you’ll do' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Skills that this plan works on' })).toBeInTheDocument()
    const sectionHeadings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
    expect(sectionHeadings.indexOf('What you’ll do')).toBeLessThan(sectionHeadings.indexOf('Skills that this plan works on'))
    expect(screen.getAllByText('Plan target')).toHaveLength(2)
    expect(screen.getByText('Ability: Skilled')).toBeInTheDocument()
    expect(screen.getByText('Knowledge: Aware · Ability: Developing')).toBeInTheDocument()
  })

  it('invites one or more connections to follow their own copy', async () => {
    extra.listConnections.mockResolvedValue([
      { id: 'friend-1', name: 'Ari Friend', email: 'ari@example.com' },
      { id: 'friend-2', name: 'Bo Friend', email: 'bo@example.com' },
    ])
    lib.inviteConnectionsToPlan.mockResolvedValue([
      { recipient_id: 'friend-1', created: true },
      { recipient_id: 'friend-2', created: true },
    ])
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Invite connections' }))
    const dialog = await screen.findByRole('dialog', { name: 'Invite people to follow this plan' })
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Ari Friend/ }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Bo Friend/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send invitations' }))

    await waitFor(() => expect(lib.inviteConnectionsToPlan).toHaveBeenCalledWith('p1', ['friend-1', 'friend-2']))
    expect(await screen.findByText('Invitations sent: 2')).toBeInTheDocument()
  })

  it('marks a step done with a date and a comment', async () => {
    renderPage()
    const tileButton = await screen.findByRole('button', { name: 'Mark “Shadow a senior lead” done' })
    expect(tileButton).toHaveClass('absolute', 'inset-0')
    fireEvent.click(tileButton)
    expect(lib.setItemDone).not.toHaveBeenCalled()
    const form = screen.getByRole('form', { name: 'Mark this step done' })
    fireEvent.change(within(form).getByLabelText('Done on'), { target: { value: '2026-11-10' } })
    fireEvent.change(within(form).getByLabelText('Comment (optional)'), { target: { value: 'Sat in on two 1:1s' } })
    fireEvent.click(within(form).getByRole('button', { name: '+ Add evidence' }))
    fireEvent.click(within(form).getByRole('button', { name: 'Mark done' }))
    await waitFor(() => expect(lib.setItemDone).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'i5' }),
      true,
      expect.objectContaining({
        userId: 'me',
        actor: { name: 'Sam', email: 'me@example.com' },
        completedOn: '2026-11-10',
        comment: 'Sat in on two 1:1s',
        evidence: { evidenceUrl: '', files: [] },
      }),
    ))
  })

  it('refuses a done date in the future', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Mark “Shadow a senior lead” done' }))
    const form = screen.getByRole('form', { name: 'Mark this step done' })
    fireEvent.change(within(form).getByLabelText('Done on'), { target: { value: '2999-01-01' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Mark done' }))
    expect(await within(form).findByRole('alert')).toHaveTextContent('Choose today or an earlier day.')
    expect(lib.setItemDone).not.toHaveBeenCalled()
  })

  it('asks before unticking a step whose activity has the learner\'s comment or evidence', async () => {
    lib.getPlan.mockResolvedValue({
      ...plan,
      items: plan.items.map((item) => (item.id === 'i5' ? { ...item, completed_on: '2026-11-10', completion_statement_id: 'st1' } : item)),
    })
    lib.getItemActivity.mockResolvedValue({ id: 'st1', evidence_url: 'https://example.com' })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Mark “Shadow a senior lead” done' }))
    const choice = await screen.findByRole('group', { name: 'Untick this step' })
    expect(lib.setItemDone).not.toHaveBeenCalled()
    fireEvent.click(within(choice).getByRole('button', { name: 'Untick and keep the activity' }))
    await waitFor(() => expect(lib.setItemDone).toHaveBeenCalledWith(expect.objectContaining({ id: 'i5' }), false, expect.objectContaining({ removeActivity: false })))
  })

  it('unticks straight away when the activity has nothing of the learner\'s in it', async () => {
    lib.getPlan.mockResolvedValue({
      ...plan,
      items: plan.items.map((item) => (item.id === 'i5' ? { ...item, completed_on: '2026-11-10', completion_statement_id: 'st1' } : item)),
    })
    lib.getItemActivity.mockResolvedValue({ id: 'st1' })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Mark “Shadow a senior lead” done' }))
    await waitFor(() => expect(lib.setItemDone).toHaveBeenCalledWith(expect.objectContaining({ id: 'i5' }), false, expect.objectContaining({ removeActivity: undefined })))
    expect(screen.queryByRole('group', { name: 'Untick this step' })).not.toBeInTheDocument()
  })

  it('sets plan-specific skill levels without opening the learner skill target flow', async () => {
    renderPage()
    const coaching = (await screen.findByText('Coaching')).closest('li')
    fireEvent.click(within(coaching).getByRole('button', { name: 'Set plan target' }))
    expect(screen.getByText('Editing this plan')).toBeInTheDocument()
    fireEvent.change(within(coaching).getByLabelText('Knowledge target (optional)'), { target: { value: '3' } })
    fireEvent.click(within(coaching).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(lib.updateItem).toHaveBeenCalledWith('i2', expect.objectContaining({ planKnowledgeLevel: '3', planPracticalLevel: '' })))
  })

  it('adds one of the learner\'s courses to a section', async () => {
    renderPage('/plans/p1?mode=edit')
    fireEvent.click(await screen.findByRole('button', { name: 'Add to Foundations' }))
    fireEvent.change(await screen.findByLabelText('Choose a course'), { target: { value: 'c9' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(lib.addItem).toHaveBeenCalledWith('p1', expect.objectContaining({ itemType: 'course', recordId: 'c9', sectionId: 'sec1', position: 2 })))
  })

  it('removes an item only after confirming, and says the record stays', async () => {
    renderPage('/plans/p1?mode=edit')
    const step = (await screen.findByText('Shadow a senior lead')).closest('li')
    fireEvent.click(within(step).getByRole('button', { name: 'Remove' }))
    expect(screen.getByText(/isn’t changed/)).toBeInTheDocument()
    expect(lib.removeItem).not.toHaveBeenCalled()
    const buttons = screen.getAllByRole('button', { name: 'Remove' })
    fireEvent.click(buttons[buttons.length - 1])
    await waitFor(() => expect(lib.removeItem).toHaveBeenCalledWith('i5'))
  })

  it('opens an active goal as its own tile in a pop-up, not its skill page', async () => {
    const goalItem = { goal: { id: 'g1', title: 'Run 10k' }, skill: { id: 's1', name: 'Coaching' }, statements: [], progress: { reached: true }, nextLog: null }
    lib.loadPlanContext.mockResolvedValue({ ...context, goalItemsById: new Map([['g1', goalItem]]) })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Run 10k' }))
    const dialog = await screen.findByRole('dialog', { name: 'Run 10k tile' })
    expect(within(dialog).getByText('no skill link')).toBeInTheDocument()
    expect(screen.queryByText(/^Back to/)).not.toBeInTheDocument()

    // Logging from the tile reloads the plan.
    lib.getPlan.mockClear()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Log progress' }))
    await waitFor(() => expect(lib.getPlan).toHaveBeenCalled())

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close goal' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('still links a goal that has ended to its skill page', async () => {
    renderPage()
    expect(await screen.findByRole('link', { name: 'Run 10k' })).toHaveAttribute('href', '/skills/s1')
  })

  it('reorders items within a section', async () => {
    renderPage('/plans/p1?mode=edit')
    fireEvent.click(await screen.findByRole('button', { name: 'Move Run 10k up' }))
    await waitFor(() => expect(lib.savePositions).toHaveBeenCalledWith('learner_plan_items', [
      { id: 'i4', position: 0 }, { id: 'i1', position: 1 },
    ]))
  })

  it('reorders items by dragging their edit handles', async () => {
    renderPage('/plans/p1?mode=edit')
    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn() }
    const target = (await screen.findByText('Leading teams')).closest('li')
    fireEvent.dragStart(screen.getByTitle('Drag Run 10k'), { dataTransfer })
    fireEvent.dragOver(target, { dataTransfer })
    fireEvent.drop(target, { dataTransfer })
    await waitFor(() => expect(lib.savePositions).toHaveBeenCalledWith('learner_plan_items', [
      { id: 'i4', position: 0 }, { id: 'i1', position: 1 },
    ]))
  })

  it('reorders plan sections by dragging their edit handles', async () => {
    lib.getPlan.mockResolvedValue({
      ...plan,
      sections: [
        ...plan.sections,
        { id: 'sec2', title: 'Practice', position: 1, target_on: null },
      ],
    })
    renderPage('/plans/p1?mode=edit')
    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn() }
    const target = (await screen.findByRole('heading', { name: 'Foundations' })).closest('section')
    fireEvent.dragStart(screen.getByTitle('Drag Practice'), { dataTransfer })
    fireEvent.dragOver(target, { dataTransfer })
    fireEvent.drop(target, { dataTransfer })
    await waitFor(() => expect(lib.savePositions).toHaveBeenCalledWith('learner_plan_sections', [
      { id: 'sec2', position: 0 }, { id: 'sec1', position: 1 },
    ]))
  })

  it('adds a skill to the dedicated section with plan-specific levels', async () => {
    renderPage('/plans/p1?mode=edit')
    fireEvent.click(await screen.findByRole('button', { name: 'Add a skill' }))
    fireEvent.change(await screen.findByLabelText('Choose a skill'), { target: { value: 's1' } })
    fireEvent.change(screen.getByLabelText('Ability target (optional)'), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(lib.addItem).toHaveBeenCalledWith('p1', expect.objectContaining({
      itemType: 'skill', recordId: 's1', planKnowledgeLevel: '', planPracticalLevel: '4', sectionId: null,
    })))
  })

  it('marks the plan complete', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Mark plan complete' }))
    await waitFor(() => expect(lib.setPlanStatus).toHaveBeenCalledWith('p1', 'completed'))
  })

  it('creates a new goal from edit mode and adds it to the plan', async () => {
    renderPage('/plans/p1?mode=edit')
    fireEvent.click(await screen.findByRole('button', { name: 'Add to Foundations' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Goal' }))
    fireEvent.click(screen.getByRole('button', { name: '+ Create a new goal' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Add a goal' })).getByRole('button', { name: 'Save goal' }))
    await waitFor(() => expect(lib.addItem).toHaveBeenCalledWith('p1', expect.objectContaining({ itemType: 'skill_goal', recordId: 'g-new', sectionId: 'sec1' })))
  })

  it('creates a new resource on a chosen skill and adds it to the plan', async () => {
    renderPage('/plans/p1?mode=edit')
    fireEvent.click(await screen.findByRole('button', { name: 'Add to Foundations' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Resource' }))
    fireEvent.click(await screen.findByRole('button', { name: '+ Create a new resource' }))
    fireEvent.change(screen.getByLabelText('Which skill is it for?'), { target: { value: 's1' } })
    expect(screen.getByText('library skill')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create and add to plan' }))
    await waitFor(() => expect(extra.addResource).toHaveBeenCalledWith(expect.objectContaining({ userId: 'me', skillId: 's1', title: 'Guide' })))
    await waitFor(() => expect(lib.addItem).toHaveBeenCalledWith('p1', expect.objectContaining({ itemType: 'skill_resource', recordId: 'r-new' })))
  })

  it('lets a step name the skill it develops, and says ticking it is recorded', async () => {
    renderPage('/plans/p1?mode=edit')
    fireEvent.click(await screen.findByRole('button', { name: 'Add to Foundations' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Step' }))
    expect(screen.getByText(/also records it in your activity log/)).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Step' }), { target: { value: 'Run a team meeting' } })
    fireEvent.change(await screen.findByLabelText('Skill it develops (optional)'), { target: { value: 's1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(lib.addItem).toHaveBeenCalledWith('p1', expect.objectContaining({ itemType: 'step', stepTitle: 'Run a team meeting', stepSkillId: 's1' })))
  })

  it('keeps use mode free of anything that changes the plan', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Become a team lead' })
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add to Foundations' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add section' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete plan' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark “Shadow a senior lead” done' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('switches to edit mode and back, where steps are arranged rather than ticked', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit plan' }))
    expect(screen.getByText('Editing this plan')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add section' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Done editing' }))
    expect(screen.queryByText('Editing this plan')).not.toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })

  it('opens a plan still being prepared in edit mode, until it is made ready', async () => {
    lib.getPlan.mockResolvedValue({ ...plan, status: 'planning' })
    renderPage()
    expect(await screen.findByText('This plan is being prepared')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Done editing' })).not.toBeInTheDocument()
    lib.getPlan.mockResolvedValue({ ...plan, status: 'active' })
    fireEvent.click(screen.getByRole('button', { name: 'Ready to use' }))
    await waitFor(() => expect(lib.startPlan).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' })))
    expect(await screen.findByRole('progressbar')).toBeInTheDocument()
    expect(screen.queryByText('This plan is being prepared')).not.toBeInTheDocument()
  })

  it('cannot make an empty plan ready to use', async () => {
    lib.getPlan.mockResolvedValue({ ...plan, status: 'planning', sections: [], items: [] })
    renderPage()
    expect(await screen.findByRole('button', { name: 'Ready to use' })).toBeDisabled()
  })

  it('sends a course opened from the plan back to the plan', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('link', { name: 'Leading teams' }))
    expect(await screen.findByText(/^Back to \/plans\/p1 as Become a team lead/)).toBeInTheDocument()
  })

  it('sends a skill opened from the plan back to the plan, in the same mode', async () => {
    renderPage('/plans/p1?mode=edit')
    fireEvent.click(await screen.findByRole('link', { name: 'Coaching' }))
    expect(await screen.findByText('Back to /plans/p1?mode=edit as Become a team lead / /plans/p1?mode=edit as Become a team lead')).toBeInTheDocument()
  })

  it('says when a plan does not exist', async () => {
    lib.getPlan.mockResolvedValue(null)
    renderPage()
    expect(await screen.findByText(/doesn’t exist, or isn’t yours/)).toBeInTheDocument()
  })
})
