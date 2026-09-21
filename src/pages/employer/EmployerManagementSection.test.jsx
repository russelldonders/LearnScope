import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createRelationship: vi.fn(),
  endRelationship: vi.fn(),
  listMembers: vi.fn(),
  listRelationships: vi.fn(),
  updateRelationship: vi.fn(),
}))

vi.mock('../../lib/admin/employers', () => ({
  listEmployerMembers: mocks.listMembers,
}))

vi.mock('../../lib/employerManagement', () => ({
  createEmployerManagementRelationship: mocks.createRelationship,
  endEmployerManagementRelationship: mocks.endRelationship,
  listEmployerManagementRelationships: mocks.listRelationships,
  updateEmployerManagementRelationship: mocks.updateRelationship,
}))

const { default: EmployerManagementSection } = await import('./EmployerManagementSection')
const { LanguageProvider } = await import('../../context/LanguageContext')

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}))

const members = [
  { id: 'manager-member', user_id: 'manager-user', email: 'manager@example.com', status: 'active' },
  { id: 'employee-member', user_id: 'employee-user', email: 'employee@example.com', status: 'active' },
  { id: 'uncovered-member', user_id: 'uncovered-user', email: 'uncovered@example.com', status: 'active' },
]

const relationships = [
  {
    id: 'relationship-1',
    employer_id: 'employer-1',
    manager_member_id: 'manager-member',
    employee_member_id: 'employee-member',
    relationship_type: 'primary',
    is_primary: true,
    include_indirect_reports: true,
    access_scope: ['employment', 'shared_skills'],
    valid_from: '2026-01-01',
    valid_until: null,
    created_at: '2026-01-01T00:00:00Z',
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  mocks.listMembers.mockResolvedValue(members)
  mocks.listRelationships.mockResolvedValue(relationships)
  mocks.createRelationship.mockResolvedValue('relationship-2')
  mocks.updateRelationship.mockResolvedValue(undefined)
  mocks.endRelationship.mockResolvedValue(undefined)
})

afterEach(cleanup)

it('shows reporting relationships and explains the learner data fence', async () => {
  render(<LanguageProvider><EmployerManagementSection employer={{ id: 'employer-1', name: 'Northstar' }} /></LanguageProvider>)

  expect(await screen.findByRole('heading', { name: 'Reporting & management' })).toBeVisible()
  expect(screen.getByText(/never grants access to a learner's full LearnScope profile/i)).toBeVisible()
  expect(screen.getByText('manager@example.com')).toBeVisible()
  expect(screen.getByText('employee@example.com')).toBeVisible()
  expect(screen.getByText('Active managers').previousSibling).toHaveTextContent('1')
  expect(screen.getByText('Active staff without a manager').previousSibling).toHaveTextContent('2')
})

it('creates a functional relationship with conservative default scopes', async () => {
  render(<LanguageProvider><EmployerManagementSection employer={{ id: 'employer-1', name: 'Northstar' }} /></LanguageProvider>)
  await screen.findByText('manager@example.com')

  fireEvent.click(screen.getByRole('button', { name: 'Add relationship' }))
  fireEvent.change(screen.getByLabelText('Manager'), { target: { value: 'manager-member' } })
  fireEvent.change(screen.getByLabelText('Employee'), { target: { value: 'uncovered-member' } })
  fireEvent.change(screen.getByLabelText(/^Relationship type/), { target: { value: 'functional' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add relationship' }))

  await waitFor(() => expect(mocks.createRelationship).toHaveBeenCalledTimes(1))
  expect(mocks.createRelationship).toHaveBeenCalledWith(expect.objectContaining({
    employerId: 'employer-1',
    managerMemberId: 'manager-member',
    employeeMemberId: 'uncovered-member',
    relationshipType: 'functional',
    isPrimary: false,
    includeIndirectReports: false,
    accessScope: ['employment', 'role_assignments', 'skill_management', 'shared_skills'],
  }))
})

it('updates relationship scope without changing its participants', async () => {
  render(<LanguageProvider><EmployerManagementSection employer={{ id: 'employer-1', name: 'Northstar' }} /></LanguageProvider>)
  await screen.findByText('manager@example.com')

  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  expect(screen.getByLabelText('Manager')).toBeDisabled()
  expect(screen.getByLabelText('Employee')).toBeDisabled()
  fireEvent.click(screen.getByLabelText(/Training assignments/i))
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

  await waitFor(() => expect(mocks.updateRelationship).toHaveBeenCalledWith(
    'relationship-1',
    expect.objectContaining({ accessScope: ['employment', 'shared_skills', 'training_assignments'] })
  ))
})

it('ends a relationship only after confirmation', async () => {
  render(<LanguageProvider><EmployerManagementSection employer={{ id: 'employer-1', name: 'Northstar' }} /></LanguageProvider>)
  await screen.findByText('manager@example.com')

  fireEvent.click(screen.getByRole('button', { name: 'End' }))
  expect(mocks.endRelationship).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'End relationship' }))

  await waitFor(() => expect(mocks.endRelationship).toHaveBeenCalledWith('relationship-1'))
})

it('marks relationships with inactive participants as non-active and offers no unsafe mutation', async () => {
  mocks.listMembers.mockResolvedValue(members.map((member) => (
    member.id === 'employee-member' ? { ...member, status: 'inactive' } : member
  )))
  render(<LanguageProvider><EmployerManagementSection employer={{ id: 'employer-1', name: 'Northstar' }} /></LanguageProvider>)
  await screen.findByRole('heading', { name: 'Reporting & management' })

  fireEvent.change(screen.getByLabelText('Filter by relationship status'), { target: { value: 'inactive' } })

  expect(await screen.findByText('inactive')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'End' })).toBeNull()
})
