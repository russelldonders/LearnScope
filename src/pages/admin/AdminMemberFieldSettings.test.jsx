import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AdminMemberFieldSettings from './AdminMemberFieldSettings'
import { listGlobalFieldDefinitions } from '../../lib/admin/employers'

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'admin-1' } }),
}))

vi.mock('../../components/FieldDefinitionsManager', () => ({
  default: ({ fields, scopeLabel }) => (
    <div>
      <button type="button">+ Add {scopeLabel}</button>
      {fields.map((field) => <p key={field.id}>{field.label}</p>)}
    </div>
  ),
}))

vi.mock('../../lib/admin/employers', () => ({
  createFieldDefinition: vi.fn(),
  deleteFieldDefinition: vi.fn(),
  listGlobalFieldDefinitions: vi.fn(),
  reorderFieldDefinitions: vi.fn(),
  updateFieldDefinition: vi.fn(),
}))

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  listGlobalFieldDefinitions.mockResolvedValue([
    {
      id: 'field-1',
      key: 'department',
      label: 'Department',
      field_type: 'text',
      required: false,
      sort_order: 10,
    },
  ])
})

describe('AdminMemberFieldSettings', () => {
  it('loads platform-wide employer roster fields in Settings', async () => {
    render(<AdminMemberFieldSettings />)

    expect(screen.getByRole('heading', { name: 'Member field settings' })).toBeInTheDocument()
    expect(await screen.findByText('Department')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Add base field' })).toBeInTheDocument()
    expect(listGlobalFieldDefinitions).toHaveBeenCalledOnce()
  })
})
