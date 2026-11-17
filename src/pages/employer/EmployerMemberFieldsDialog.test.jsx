import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import EmployerMemberFieldsDialog from './EmployerMemberFieldsDialog'
import { listFieldDefinitionsForEmployer } from '../../lib/admin/employers'

vi.mock('../../lib/supabaseClient', () => ({ supabase: {} }))

vi.mock('../../lib/admin/employers', async (original) => ({
  ...await original(),
  listFieldDefinitionsForEmployer: vi.fn(),
  createFieldDefinition: vi.fn(),
  updateFieldDefinition: vi.fn(),
  deleteFieldDefinition: vi.fn(),
  reorderFieldDefinitions: vi.fn(),
}))

vi.mock('../../components/FieldDefinitionsManager', () => ({
  default: () => <div>Custom field manager</div>,
}))

const employer = { id: 'employer-1', name: 'Acme' }

beforeEach(() => {
  vi.clearAllMocks()
  listFieldDefinitionsForEmployer.mockResolvedValue([
    { id: 'base-email', employer_id: null, label: 'Email', field_type: 'email', required: true },
    { id: 'custom-team', employer_id: employer.id, label: 'Team', field_type: 'text', required: false, sort_order: 1000 },
  ])
})

afterEach(cleanup)

it('opens straight onto the member fields manager', async () => {
  render(<EmployerMemberFieldsDialog employer={employer} userId="admin-1" onClose={vi.fn()} />)
  expect(screen.getByRole('heading', { name: 'Member fields' })).toBeVisible()
  expect(await screen.findByText('Email')).toBeVisible()
  expect(screen.getByText('Custom field manager')).toBeVisible()
  expect(listFieldDefinitionsForEmployer).toHaveBeenCalledWith(employer.id)
})

it('closes from its Close button', () => {
  const onClose = vi.fn()
  render(<EmployerMemberFieldsDialog employer={employer} userId="admin-1" onClose={onClose} />)
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(onClose).toHaveBeenCalled()
})
