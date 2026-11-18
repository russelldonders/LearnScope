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
  listPlanMembers: vi.fn(),
  recordPlanProgress: vi.fn(),
  getPlanShareLink: vi.fn(),
  replacePlanShareLink: vi.fn(),
  inviteEmailsToPlan: vi.fn(),
  withdrawPlanInvitation: vi.fn(),
  leavePlan: vi.fn(),
  linkPlanItemsForMe: vi.fn(),
  setPlanMemberRole: vi.fn(),
  removePlanMember: vi.fn(),
  PLAN_RESOURCE_VISIBILITIES: ['private', 'owners', 'members'],
}))

vi.mock('../lib/learnerPlans', () => lib)
const reflections = vi.hoisted(() => ({ saveReflection: vi.fn() }))
vi.mock('../lib/quickActivityLog', async (importOriginal) => ({ ...(await importOriginal()), ...reflections }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me', email: 'me@example.com' } }) }))
vi.mock('../components/AppHeader', () => ({ default: () => <header>Header</header> }))
vi.mock('../components/SetTargetModal', () => ({ default: ({ skill }) => <div role="dialog">Set target for {skill.name}</div> }))
const extra = vi.hoisted(() => ({ addResource: vi.fn(), listConnections: vi.fn(), getResourceFileUrl: vi.fn() }))
vi.mock('../lib/skillResources', () => ({ addResource: extra.addResource, getResourceFileUrl: extra.getResourceFileUrl }))
const settings = vi.hoisted(() => ({
  getPlanPrerequisites: vi.fn(),
  setPlanSequence: vi.fn(),
  addPrerequisiteGroup: vi.fn(),
  addPrerequisite: vi.fn(),
  removePrerequisite: vi.fn(),
  removePrerequisiteGroup: vi.fn(),
  setPrerequisiteGroupEnforcement: vi.fn(),
}))
vi.mock('../lib/planSettings', async (importOriginal) => ({ ...(await importOriginal()), ...settings }))
vi.mock('../lib/skillLibrary', () => ({ listLibrarySkills: vi.fn().mockResolvedValue([{ id: 'lib-9', name: 'Facilitation' }]) }))
vi.mock('../lib/courseCatalogue', () => ({ listCatalogueCourses: vi.fn().mockResolvedValue([{ id: 'cat-1', name: 'Safety basics', provider: 'Acme' }]) }))
vi.mock('../lib/connections', () => ({ listConnections: extra.listConnections, whatsappShareUrl: (text) => `https://wa.me/?text=${encodeURIComponent(text)}` }))
vi.mock('../components/SkillGoalModal', () => ({
  default: ({ onSaved }) => (
    <div role="dialog" aria-label="Add a goal">
      <button type="button" onClick={() => onSaved({ id: 'g-new' })}>Save goal</button>
    </div>
  ),
}))
vi.mock('../components/SkillResourcesSection', () => ({
  ResourceForm: ({ hasLibrarySkill, submitLabel, onSubmit, audienceSlot }) => (
    <div>
      <span>{hasLibrarySkill ? 'library skill' : 'own skill'}</span>
      {audienceSlot}
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
  id: 'p1', title: 'Become a team lead', description: 'Within a year', status: 'active', my_role: 'owner', is_creator: true,
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
  settings.getPlanPrerequisites.mockResolvedValue([])
  for (const fn of ['setPlanSequence', 'addPrerequisite', 'removePrerequisite', 'removePrerequisiteGroup', 'setPrerequisiteGroupEnforcement']) settings[fn].mockResolvedValue()
  settings.addPrerequisiteGroup.mockResolvedValue('grp-new')
  extra.addResource.mockResolvedValue('r-new')
  extra.listConnections.mockResolvedValue([])
  lib.listPlanInvitations.mockResolvedValue([])
  lib.inviteConnectionsToPlan.mockResolvedValue([])
  lib.listPlanMembers.mockResolvedValue([])
  lib.recordPlanProgress.mockResolvedValue(new Set())
  lib.getPlanShareLink.mockResolvedValue('http://localhost/plan-invite/abc')
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

    fireEvent.click(await screen.findByRole('button', { name: 'Manage users' }))
    const members = await screen.findByRole('dialog', { name: 'People following this plan' })
    expect(await within(members).findByText('You haven’t invited anyone to this plan yet.')).toBeInTheDocument()
    fireEvent.click(within(members).getByRole('button', { name: 'Invite people' }))
    const dialog = await screen.findByRole('dialog', { name: 'Invite people to follow this plan' })
    expect(within(dialog).getByText(/You’ll see how many items they’ve done/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Ari Friend/ }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Bo Friend/ }))
    lib.listPlanMembers.mockClear()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send invitations' }))

    await waitFor(() => expect(lib.inviteConnectionsToPlan).toHaveBeenCalledWith('p1', ['friend-1', 'friend-2']))
    expect(await screen.findByText('Invitations sent: 2')).toBeInTheDocument()
    // Back on the list of people, which reloads to include them.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Invite people to follow this plan' })).not.toBeInTheDocument())
    expect(screen.getByRole('dialog', { name: 'People following this plan' })).toBeInTheDocument()
    expect(lib.listPlanMembers).toHaveBeenCalledWith('p1')
  })

  it('lists everyone on the plan with their role and progress, and the invitations', async () => {
    lib.listPlanMembers.mockResolvedValue([
      { user_id: 'me', invitation_id: null, name: 'Sam Owner', role: 'owner', is_creator: true, status: 'member', via: 'creator', progress_done: 2, progress_total: 5, progress_updated_at: '2026-11-15T10:00:00Z' },
      { user_id: 'u1', invitation_id: 'v1', name: 'Ari Friend', role: 'follower', is_creator: false, status: 'member', via: 'connection', progress_done: 3, progress_total: 4, progress_updated_at: '2026-11-15T10:00:00Z' },
      { user_id: 'u3', invitation_id: 'v3', name: 'Cy Friend', role: 'owner', is_creator: false, status: 'member', via: 'connection', progress_done: null, progress_total: null, progress_updated_at: null },
      { user_id: 'u6', invitation_id: 'v6', name: 'Fay Friend', role: 'follower', is_creator: false, status: 'member', via: 'link', progress_done: 0, progress_total: 4, progress_updated_at: '2026-11-14T10:00:00Z' },
      { user_id: 'u2', invitation_id: 'v2', name: 'Bo Friend', role: null, is_creator: false, status: 'pending', via: 'connection', invited_at: '2026-11-12T10:00:00Z' },
      { user_id: 'u4', invitation_id: 'v4', name: 'Di Friend', role: null, is_creator: false, status: 'left', via: 'connection', invited_at: '2026-11-11T10:00:00Z' },
      { user_id: null, invitation_id: 'v5', name: 'ed@example.com', role: null, is_creator: false, status: 'pending', via: 'email', invited_at: '2026-11-11T10:00:00Z' },
    ])
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Manage users' }))
    const dialog = await screen.findByRole('dialog', { name: 'People following this plan' })
    const row = (name) => within(dialog).getByText(name).closest('li')

    expect(await within(dialog).findByText('Ari Friend')).toBeInTheDocument()
    expect(within(row('Sam Owner')).getByText('Owner (created it)')).toBeInTheDocument()
    expect(within(row('Sam Owner')).queryByRole('button', { name: /co-owner|follower/ })).not.toBeInTheDocument()
    expect(within(row('Ari Friend')).getByText('Following')).toBeInTheDocument()
    expect(within(row('Ari Friend')).getByRole('progressbar', { name: 'Ari Friend’s progress' })).toHaveAttribute('aria-valuenow', '75')
    expect(within(row('Ari Friend')).getByText('3 of 4 done (75%)')).toBeInTheDocument()
    expect(within(row('Cy Friend')).getByText('Co-owner')).toBeInTheDocument()
    expect(within(row('Cy Friend')).getByText('No progress shared yet. It appears once they open the plan.')).toBeInTheDocument()
    expect(within(row('Fay Friend')).getByText('Joined with the share link')).toBeInTheDocument()
    expect(within(row('Bo Friend')).getByText('Invited')).toBeInTheDocument()
    expect(within(row('Bo Friend')).queryByRole('progressbar')).not.toBeInTheDocument()
    expect(within(row('Di Friend')).getByText('Left the plan')).toBeInTheDocument()
    expect(within(row('ed@example.com')).getByText(/^Emailed /)).toBeInTheDocument()

    // Owners make followers co-owners, and co-owners followers again.
    lib.setPlanMemberRole.mockResolvedValue()
    lib.listPlanMembers.mockClear()
    fireEvent.click(within(row('Ari Friend')).getByRole('button', { name: 'Make Ari Friend a co-owner' }))
    await waitFor(() => expect(lib.setPlanMemberRole).toHaveBeenCalledWith('p1', 'u1', 'owner'))
    await waitFor(() => expect(lib.listPlanMembers).toHaveBeenCalledWith('p1'))
    fireEvent.click(within(row('Cy Friend')).getByRole('button', { name: 'Make Cy Friend a follower' }))
    await waitFor(() => expect(lib.setPlanMemberRole).toHaveBeenCalledWith('p1', 'u3', 'follower'))

    // Removing someone asks first, and never offers to remove the creator.
    expect(within(row('Sam Owner')).queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument()
    lib.removePlanMember.mockResolvedValue()
    fireEvent.click(within(row('Fay Friend')).getByRole('button', { name: 'Remove Fay Friend from the plan' }))
    expect(within(row('Fay Friend')).getByText(/They stop seeing it/)).toBeInTheDocument()
    expect(lib.removePlanMember).not.toHaveBeenCalled()
    fireEvent.click(within(row('Fay Friend')).getByRole('button', { name: 'Remove from plan' }))
    await waitFor(() => expect(lib.removePlanMember).toHaveBeenCalledWith('p1', 'u6'))

    // Only invitations still waiting can be withdrawn.
    expect(within(row('Ari Friend')).queryByRole('button', { name: /Withdraw/ })).not.toBeInTheDocument()
    lib.withdrawPlanInvitation.mockResolvedValue()
    fireEvent.click(within(row('ed@example.com')).getByRole('button', { name: 'Withdraw the invitation to ed@example.com' }))
    await waitFor(() => expect(lib.withdrawPlanInvitation).toHaveBeenCalledWith('v5'))
  })

  it('records its progress and, for a follower, says it is shared with the owners', async () => {
    lib.recordPlanProgress.mockResolvedValue(new Set(['p1']))
    renderPage()
    expect(await screen.findByText('How many items you’ve done on this plan is shared with its owners.')).toBeInTheDocument()
    expect(lib.recordPlanProgress).toHaveBeenCalledWith([{ planId: 'p1', done: 2, total: 5 }])
  })

  it('lets a follower work through the plan but not change it, invite people or manage it', async () => {
    lib.getPlan.mockResolvedValue({ ...plan, my_role: 'follower', is_creator: false })
    renderPage('/plans/p1?mode=edit')
    expect(await screen.findByText('You follow this plan')).toBeInTheDocument()
    for (const name of ['Edit plan', 'Manage users', 'Mark complete', 'Archive', 'Edit details', 'Add section']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }
    expect(screen.queryByText('Editing this plan')).not.toBeInTheDocument()
    // Ticking off is still theirs to do.
    expect(screen.getByRole('button', { name: 'Mark “Shadow a senior lead” done' })).toBeInTheDocument()

    lib.leavePlan.mockResolvedValue()
    fireEvent.click(screen.getByRole('button', { name: 'Leave plan' }))
    const confirm = await screen.findByRole('dialog')
    expect(within(confirm).getByText(/Your own courses, skills, goals and activities stay yours/)).toBeInTheDocument()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Leave plan' }))
    await waitFor(() => expect(lib.leavePlan).toHaveBeenCalledWith('p1'))
    expect(await screen.findByText('All plans')).toBeInTheDocument()
  })

  it('lets a co-owner manage the plan and leave it, but not delete it', async () => {
    lib.getPlan.mockResolvedValue({ ...plan, my_role: 'owner', is_creator: false })
    renderPage()
    expect(await screen.findByRole('button', { name: 'Manage users' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Leave plan' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit plan' }))
    expect(await screen.findByText('Editing this plan')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete plan' })).not.toBeInTheDocument()
  })

  it('names an item it hasn’t added to the viewer’s records yet, and adds them when asked', async () => {
    lib.getPlan.mockResolvedValue({
      ...plan,
      my_role: 'follower',
      is_creator: false,
      items: [...plan.items, { id: 'i7', section_id: null, item_type: 'course', course_id: null, courses: null, needs_link: true, source_title: 'Public speaking' }],
    })
    lib.linkPlanItemsForMe.mockResolvedValue(1)
    renderPage()
    expect(await screen.findByText('Items added to this plan that aren’t in your own records yet: 1')).toBeInTheDocument()
    expect(stateOf('Public speaking')).toBe('not_started')
    lib.getPlan.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Add them to my records' }))
    await waitFor(() => expect(lib.linkPlanItemsForMe).toHaveBeenCalledWith('p1'))
    await waitFor(() => expect(lib.getPlan).toHaveBeenCalled())
  })

  it('does not mention sharing on a plan that was not copied from an invitation', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Become a team lead' })).toBeInTheDocument()
    await waitFor(() => expect(lib.recordPlanProgress).toHaveBeenCalled())
    expect(screen.queryByText(/shared with the person who invited you/)).not.toBeInTheDocument()
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

  it('sets a plan’s skill levels only in edit mode, without opening the learner skill target flow', async () => {
    renderPage()
    const inUse = (await screen.findByText('Coaching')).closest('li')
    expect(within(inUse).getByText('Needs a target')).toBeInTheDocument()
    expect(within(inUse).queryByRole('button', { name: 'Set plan target' })).not.toBeInTheDocument()
    cleanup()

    renderPage('/plans/p1?mode=edit')
    const coaching = (await screen.findByText('Coaching')).closest('li')
    fireEvent.click(within(coaching).getByRole('button', { name: 'Edit' }))
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

  // Dragging is by pointer (mouse, touch or pen): whatever tile is under the
  // pointer is the drop target, which jsdom can't work out, so it's given.
  function dragTo(handle, target) {
    const original = document.elementFromPoint
    document.elementFromPoint = () => target
    try {
      fireEvent.pointerDown(handle, { pointerId: 1, button: 0, pointerType: 'touch' })
      fireEvent.pointerMove(handle, { pointerId: 1, pointerType: 'touch' })
      expect(target.className).toMatch(/ring-moss|outline-moss/)
      fireEvent.pointerUp(handle, { pointerId: 1, pointerType: 'touch' })
    } finally {
      document.elementFromPoint = original
    }
  }

  it('reorders items by dragging the grip on the left of the tile, by touch too', async () => {
    renderPage('/plans/p1?mode=edit')
    const target = (await screen.findByText('Leading teams')).closest('li')
    const handle = screen.getByRole('button', { name: 'Move “Run 10k”: drag, or use the up and down arrow keys' })
    // The grip leads the tile, before its title.
    expect(handle.closest('li').firstElementChild.contains(handle)).toBe(true)
    dragTo(handle, target)
    await waitFor(() => expect(lib.savePositions).toHaveBeenCalledWith('learner_plan_items', [
      { id: 'i4', position: 0 }, { id: 'i1', position: 1 },
    ]))
  })

  it('moves an item with the arrow keys on its grip', async () => {
    renderPage('/plans/p1?mode=edit')
    const handle = await screen.findByRole('button', { name: 'Move “Run 10k”: drag, or use the up and down arrow keys' })
    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    await waitFor(() => expect(lib.savePositions).toHaveBeenCalledWith('learner_plan_items', [
      { id: 'i4', position: 0 }, { id: 'i1', position: 1 },
    ]))
  })

  it('does not reorder when dropped outside the list', async () => {
    renderPage('/plans/p1?mode=edit')
    const handle = await screen.findByRole('button', { name: 'Move “Run 10k”: drag, or use the up and down arrow keys' })
    const original = document.elementFromPoint
    document.elementFromPoint = () => document.body
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, pointerType: 'mouse' })
    fireEvent.pointerUp(handle, { pointerId: 1, pointerType: 'mouse' })
    document.elementFromPoint = original
    expect(lib.savePositions).not.toHaveBeenCalled()
  })

  it('reorders plan sections by dragging their grip', async () => {
    lib.getPlan.mockResolvedValue({
      ...plan,
      sections: [
        ...plan.sections,
        { id: 'sec2', title: 'Practice', position: 1, target_on: null },
      ],
    })
    renderPage('/plans/p1?mode=edit')
    const target = (await screen.findByRole('heading', { name: 'Foundations' })).closest('section')
    dragTo(screen.getByRole('button', { name: 'Move the section “Practice”: drag, or use the up and down arrow keys' }), target)
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
    // Who on the plan sees it replaces the skill's own audience: everyone, unless chosen.
    expect(screen.getByRole('radio', { name: /Everyone following this plan/ })).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: /All owners of this plan/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Create and add to plan' }))
    await waitFor(() => expect(extra.addResource).toHaveBeenCalledWith(expect.objectContaining({ userId: 'me', skillId: 's1', title: 'Guide' })))
    await waitFor(() => expect(lib.addItem).toHaveBeenCalledWith('p1', expect.objectContaining({ itemType: 'skill_resource', recordId: 'r-new', visibility: 'owners' })))
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

  it('locks activities after the first unfinished one in a plan done in order', async () => {
    lib.getPlan.mockResolvedValue({ ...plan, sequence: 'plan' })
    renderPage()
    expect(await screen.findByRole('button', { name: 'Mark “Shadow a senior lead” done' })).toBeInTheDocument()
    expect(screen.getByText(/Worked through in order/)).toBeInTheDocument()
    // The course comes after the unfinished step: no link, marked locked.
    expect(screen.queryByRole('link', { name: 'Leading teams' })).not.toBeInTheDocument()
    expect(screen.getByText('Leading teams').closest('li').querySelector('[data-locked="sequence"]')).not.toBeNull()
  })

  it('shows prerequisites and locks the plan until required ones are met', async () => {
    settings.getPlanPrerequisites.mockResolvedValue([
      { id: 'grp1', position: 0, enforcement: 'required', options: [
        { id: 'o1', kind: 'skill', name: 'Facilitation', min_practical_level: 3, min_knowledge_level: null, met: false },
        { id: 'o2', kind: 'course', name: 'Safety basics', met: false },
      ] },
    ])
    renderPage()
    const panel = await screen.findByRole('region', { name: 'Before you start' })
    expect(panel).toHaveAttribute('data-prerequisites', 'blocked')
    expect(within(panel).getByText('Facilitation — Ability: Capable')).toBeInTheDocument()
    expect(within(panel).getByText('Completed Safety basics')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark “Shadow a senior lead” done' })).not.toBeInTheDocument()
    expect(screen.getByText('Shadow a senior lead').closest('li').querySelector('[data-locked="prerequisites"]')).not.toBeNull()
  })

  it('keeps the order and prerequisites behind a cog in edit mode', async () => {
    renderPage('/plans/p1?mode=edit')
    fireEvent.click(await screen.findByRole('button', { name: 'Plan settings' }))
    const dialog = await screen.findByRole('dialog', { name: 'Plan settings' })
    fireEvent.click(within(dialog).getByRole('radio', { name: /In order, within each section/ }))
    await waitFor(() => expect(settings.setPlanSequence).toHaveBeenCalledWith('p1', 'sections'))

    fireEvent.click(within(dialog).getByRole('button', { name: 'Add a prerequisite' }))
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Facilitation' }))
    fireEvent.change(within(dialog).getByLabelText('When not met'), { target: { value: 'required' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(settings.addPrerequisite).toHaveBeenCalledWith('p1', 'grp-new', expect.objectContaining({ kind: 'skill', librarySkillId: 'lib-9', minPracticalLevel: '3' })))
    expect(settings.addPrerequisiteGroup).toHaveBeenCalledWith('p1', { enforcement: 'required', position: 0 })
  })

  it('has no cog outside edit mode', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Become a team lead' })
    expect(screen.queryByRole('button', { name: 'Plan settings' })).not.toBeInTheDocument()
  })

  it('opens a resource in a new window and ticks it with the same dot as a step', async () => {
    lib.getPlan.mockResolvedValue({ ...plan, items: [
      { id: 'r1', section_id: null, item_type: 'skill_resource', skill_resource_id: 'sr1', completed_on: null, skill_resources: { id: 'sr1', title: 'Guide', url: 'https://example.com/guide', skill_id: 's1' } },
      { id: 'r2', section_id: null, item_type: 'skill_resource', skill_resource_id: 'sr2', completed_on: null, skill_resources: { id: 'sr2', title: 'Notes', url: null, skill_id: 's1' } },
    ] })
    renderPage()
    expect(await screen.findByRole('link', { name: 'Guide' })).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('link', { name: 'Notes' })).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('button', { name: 'Mark “Guide” done' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('shows a plan timed as a period from the viewer’s own start', async () => {
    lib.getPlan.mockResolvedValue({ ...plan, target_on: null, duration_amount: 6, duration_unit: 'months', starts_on: '2026-11-01', my_joined_on: '2026-11-05' })
    renderPage()
    expect(await screen.findByText(/6 months from when you start · by/)).toBeInTheDocument()
  })

  it('adds a reflection to a done step\'s activity, right on the plan', async () => {
    lib.getPlan.mockResolvedValue({
      ...plan,
      items: plan.items.map((item) => (item.id === 'i5' ? { ...item, completed_on: '2026-11-10', completion_statement_id: 'st1' } : item)),
    })
    const activity = { id: 'st1', statement: { object: { definition: { name: { 'en-US': 'Shadow a senior lead' } } } } }
    lib.getItemActivity.mockResolvedValue(activity)
    reflections.saveReflection.mockResolvedValue()
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Add a reflection' }))
    const answer = await screen.findByRole('textbox')
    // While reflecting, a click anywhere on the step doesn't untick it: only
    // its own small dot does.
    expect(screen.getByRole('button', { name: 'Mark “Shadow a senior lead” done' })).not.toHaveClass('inset-0')
    fireEvent.change(answer, { target: { value: 'Asking more questions helped' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to note' }))
    await waitFor(() => expect(reflections.saveReflection).toHaveBeenCalledWith(activity, expect.any(String), 'Asking more questions helped'))
    expect(lib.setItemDone).not.toHaveBeenCalled()
  })

  it('opens at a step from its activity, picking it out', async () => {
    renderPage('/plans/p1?item=i5')
    await screen.findByRole('button', { name: 'Mark “Shadow a senior lead” done' })
    await waitFor(() => expect(document.getElementById('plan-item-i5')).toHaveAttribute('data-highlighted'))
    expect(document.getElementById('plan-item-i1')).not.toHaveAttribute('data-highlighted')
  })
})
