import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AssignedPlansList from './AssignedPlansList'
import { listMyPlanAssignments, respondToPlanAssignment } from '../lib/organisationPlans'

vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
vi.mock('../context/LanguageContext', () => import('../test/languageMock'))
vi.mock('../lib/organisationPlans', () => ({ listMyPlanAssignments: vi.fn(), respondToPlanAssignment: vi.fn() }))

const ASSIGNED = {
  id: 'assignment-1', organisation_id: 'org-1', organisation_name: 'Acme', plan_id: 'plan-1',
  title: 'New manager plan', description: 'Your first 90 days', target_on: null, step_count: 3,
  status: 'assigned', progress_done: null, progress_total: null,
}
const STARTED = { ...ASSIGNED, id: 'assignment-2', plan_id: 'plan-2', title: 'Safety refresher', status: 'started', progress_done: 1, progress_total: 2 }

function renderList(props = {}) {
  render(
    <MemoryRouter initialEntries={['/organisation/learning']}>
      <Routes>
        <Route path="/organisation/learning" element={<AssignedPlansList organisationId="org-1" organisationName="Acme" {...props} />} />
        <Route path="/plans/:planId" element={<p>Plan page</p>} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  listMyPlanAssignments.mockResolvedValue([ASSIGNED, STARTED])
  respondToPlanAssignment.mockResolvedValue('plan-1')
})
afterEach(cleanup)

describe('AssignedPlansList', () => {
  it('lists this organisation’s plans for the member, with how far they are on started ones', async () => {
    renderList({ framing: 'required' })
    expect(await screen.findByText('New manager plan')).toBeInTheDocument()
    expect(screen.getByText('Required by Acme')).toBeInTheDocument()
    expect(screen.getByText(/1 of 2 done/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open plan' })).toHaveAttribute('href', '/plans/plan-2')
    expect(listMyPlanAssignments).toHaveBeenCalledWith('org-1')
  })

  it('tells the member the organisation will see their progress before they start', async () => {
    renderList()
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Acme will see your progress on this plan, step by step')
    expect(respondToPlanAssignment).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Start plan' }))
    await waitFor(() => expect(respondToPlanAssignment).toHaveBeenCalledWith('assignment-1', true))
    expect(await screen.findByText('Plan page')).toBeInTheDocument()
  })

  it('lets the member decline without starting', async () => {
    renderList()
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(respondToPlanAssignment).toHaveBeenCalledWith('assignment-1', false))
    expect(listMyPlanAssignments).toHaveBeenCalledTimes(2)
  })

  it('shows nothing as a workspace section until there is a plan', async () => {
    listMyPlanAssignments.mockResolvedValue([])
    renderList({ heading: 'Plans from Acme' })
    await waitFor(() => expect(listMyPlanAssignments).toHaveBeenCalled())
    expect(screen.queryByRole('heading', { name: 'Plans from Acme' })).not.toBeInTheDocument()
  })

  it('shows given assignments without loading, and asks for a refresh after a response (the Actions inbox)', async () => {
    const onChanged = vi.fn()
    renderList({ organisationId: null, organisationName: null, assignments: [ASSIGNED], onChanged })
    expect(screen.getByText('Assigned by Acme')).toBeInTheDocument()
    expect(listMyPlanAssignments).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('keeps to the chosen plans when given plan ids (a configured Plans panel)', async () => {
    renderList({ planIds: ['plan-2'] })
    expect(await screen.findByText('Safety refresher')).toBeInTheDocument()
    expect(screen.queryByText('New manager plan')).not.toBeInTheDocument()
  })
})
