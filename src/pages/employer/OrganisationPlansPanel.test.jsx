import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import OrganisationPlansPanel from './OrganisationPlansPanel'
import { listEmployerMembers } from '../../lib/admin/employers'
import {
  addOrganisationPlanSection,
  addOrganisationPlanStep,
  assignOrganisationPlan,
  createOrganisationPlan,
  getOrganisationPlan,
  listOrganisationPlanProgress,
  listOrganisationPlans,
  listPlanCatalogueCourses,
} from '../../lib/organisationPlans'

vi.mock('../../lib/supabaseClient', () => ({ supabase: {} }))
vi.mock('../../context/LanguageContext', () => import('../../test/languageMock'))
vi.mock('../../lib/admin/employers', () => ({ listEmployerMembers: vi.fn() }))
vi.mock('../../lib/planSettings', () => ({ getPlanPrerequisites: vi.fn().mockResolvedValue([]) }))
vi.mock('../../components/PlanSettingsDialog', () => ({ default: (props) => <div role="dialog" aria-label="Plan settings" data-plan={props.plan.id} /> }))
vi.mock('../../lib/organisationPlans', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    stepStatusesOf: actual.stepStatusesOf,
    listOrganisationPlans: vi.fn(),
    getOrganisationPlan: vi.fn(),
    createOrganisationPlan: vi.fn(),
    updateOrganisationPlan: vi.fn(),
    archiveOrganisationPlan: vi.fn(),
    deleteOrganisationPlan: vi.fn(),
    addOrganisationPlanStep: vi.fn().mockResolvedValue(),
    addOrganisationPlanSection: vi.fn().mockResolvedValue(),
    removeOrganisationPlanSection: vi.fn(),
    removeOrganisationPlanStep: vi.fn(),
    reorderOrganisationPlanSteps: vi.fn(),
    searchPlanLibrarySkills: vi.fn().mockResolvedValue([]),
    assignOrganisationPlan: vi.fn(),
    withdrawPlanAssignment: vi.fn(),
    listOrganisationPlanProgress: vi.fn(),
    listPlanCatalogueCourses: vi.fn(),
  }
})

const PLAN = {
  id: 'plan-1', title: 'New manager plan', description: null, status: 'active', target_on: null, sequence: 'none',
  sections: [{ id: 'section-1', title: 'First month', position: 0 }],
  items: [
    { id: 'item-1', item_type: 'course', position: 0, catalogue_course_id: 'course-1', course_catalogue: { name: 'Coaching basics' } },
    { id: 'item-2', item_type: 'step', position: 1, step_title: 'Meet your team', section_id: 'section-1' },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  listOrganisationPlans.mockResolvedValue([])
  getOrganisationPlan.mockResolvedValue(PLAN)
  createOrganisationPlan.mockResolvedValue('plan-1')
  listPlanCatalogueCourses.mockResolvedValue([{ id: 'course-2', name: 'Feedback that lands' }])
  listEmployerMembers.mockResolvedValue([
    { user_id: 'user-1', name: 'Sam Patel', email: 'sam@example.com', status: 'active' },
    { user_id: 'user-2', email: 'pending@example.com', status: 'pending' },
  ])
  assignOrganisationPlan.mockResolvedValue(1)
  listOrganisationPlanProgress.mockResolvedValue([
    {
      user_id: 'user-1', name: 'Sam', is_member: true, assignment_id: 'a-1', assignment_status: 'started', joined_at: '2026-11-20T10:00:00Z',
      progress_done: 1, progress_total: 2, progress_items: [{ item_id: 'item-2', status: 'done' }, { item_id: 'item-1', status: 'in_progress' }],
    },
  ])
})
afterEach(cleanup)

describe('OrganisationPlansPanel', () => {
  it('creates a plan for the organisation and opens it', async () => {
    render(<OrganisationPlansPanel organisationId="org-1" />)
    expect(await screen.findByText('No plans yet.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'New plan' }))
    fireEvent.change(screen.getByLabelText('Plan name'), { target: { value: 'New manager plan' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create plan' }))
    await waitFor(() => expect(createOrganisationPlan).toHaveBeenCalledWith('org-1', { title: 'New manager plan', description: '', targetOn: '' }))
    expect(await screen.findByRole('heading', { name: 'New manager plan' })).toBeInTheDocument()
  })

  it('adds a catalogue course as a step', async () => {
    listOrganisationPlans.mockResolvedValue([{ ...PLAN, stepCount: 2, assignedCount: 1, startedCount: 1 }])
    render(<OrganisationPlansPanel organisationId="org-1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }))
    expect(await screen.findByText('1. Coaching basics')).toBeInTheDocument()
    fireEvent.change(await screen.findByLabelText('Course'), { target: { value: 'course-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add step' }))
    await waitFor(() => expect(addOrganisationPlanStep).toHaveBeenCalledWith('plan-1', { type: 'course', catalogueCourseId: 'course-2', note: '' }, 2))
  })

  it('assigns to active members only and shows each member’s progress, step by step', async () => {
    listOrganisationPlans.mockResolvedValue([{ ...PLAN, stepCount: 2, assignedCount: 1, startedCount: 1 }])
    render(<OrganisationPlansPanel organisationId="org-1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }))
    const assign = await screen.findByRole('region', { name: 'Assign to members' })
    expect(await within(assign).findByLabelText('Sam Patel · sam@example.com')).toBeInTheDocument()
    expect(within(assign).queryByLabelText('pending@example.com')).not.toBeInTheDocument()
    fireEvent.click(within(assign).getByLabelText('Sam Patel · sam@example.com'))
    fireEvent.click(within(assign).getByRole('button', { name: 'Assign to 1' }))
    await waitFor(() => expect(assignOrganisationPlan).toHaveBeenCalledWith('plan-1', ['user-1']))
    expect(await within(assign).findByText('Assigned to 1 member.')).toBeInTheDocument()

    const progress = screen.getByRole('region', { name: 'Progress' })
    expect(await within(progress).findByText(/1 of 2 done/)).toBeInTheDocument()
    fireEvent.click(within(progress).getByRole('button', { name: 'Show steps' }))
    expect(within(progress).getByText('Meet your team').closest('li')).toHaveTextContent('Done')
    expect(within(progress).getByText('Coaching basics').closest('li')).toHaveTextContent('In progress')
  })

  it('groups steps by section, adds sections and steps into them, and opens order and prerequisites', async () => {
    listOrganisationPlans.mockResolvedValue([{ ...PLAN, stepCount: 2, assignedCount: 0, startedCount: 0 }])
    render(<OrganisationPlansPanel organisationId="org-1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }))
    expect(await screen.findByRole('heading', { name: 'First month' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'First month' }).parentElement.parentElement).toHaveTextContent('Meet your team')

    fireEvent.change(screen.getByLabelText('New section'), { target: { value: 'Second month' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add section' }))
    await waitFor(() => expect(addOrganisationPlanSection).toHaveBeenCalledWith('plan-1', 'Second month', 1))

    fireEvent.click(screen.getByLabelText('A step'))
    fireEvent.change(screen.getByLabelText('What to do'), { target: { value: 'Shadow a colleague' } })
    fireEvent.change(screen.getByLabelText('Section'), { target: { value: 'section-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add step' }))
    await waitFor(() => expect(addOrganisationPlanStep).toHaveBeenCalledWith('plan-1', { type: 'step', title: 'Shadow a colleague', note: '', sectionId: 'section-1' }, 2))

    fireEvent.click(screen.getByRole('button', { name: 'Order and prerequisites' }))
    expect(screen.getByRole('dialog', { name: 'Plan settings' })).toHaveAttribute('data-plan', 'plan-1')
  })
})
