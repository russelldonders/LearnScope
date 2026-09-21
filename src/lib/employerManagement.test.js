import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
const from = vi.fn()
const relationshipQuery = {
  select: vi.fn(),
  eq: vi.fn(),
  order: vi.fn(),
}

vi.mock('./supabaseClient', () => ({ supabase: { from, rpc } }))

const {
  canManageEmployerMember,
  createEmployerManagementRelationship,
  endEmployerManagementRelationship,
  listEmployerDirectReports,
  listEmployerManagementRelationships,
  updateEmployerManagementRelationship,
} = await import('./employerManagement')

beforeEach(() => {
  rpc.mockReset()
  rpc.mockResolvedValue({ data: null, error: null })
  from.mockReset()
  relationshipQuery.select.mockReset().mockReturnValue(relationshipQuery)
  relationshipQuery.eq.mockReset().mockReturnValue(relationshipQuery)
  relationshipQuery.order.mockReset()
  from.mockReturnValue(relationshipQuery)
})

describe('employer management service', () => {
  it('lists an employer relationship roster through the RLS-protected table', async () => {
    relationshipQuery.order
      .mockReturnValueOnce(relationshipQuery)
      .mockResolvedValueOnce({ data: [{ id: 'relationship-1' }], error: null })

    await expect(listEmployerManagementRelationships('employer-1')).resolves.toEqual([{ id: 'relationship-1' }])

    expect(from).toHaveBeenCalledWith('employer_management_relationships')
    expect(relationshipQuery.select).toHaveBeenCalledWith('*')
    expect(relationshipQuery.eq).toHaveBeenCalledWith('employer_id', 'employer-1')
    expect(relationshipQuery.order).toHaveBeenNthCalledWith(1, 'valid_from', { ascending: false })
    expect(relationshipQuery.order).toHaveBeenNthCalledWith(2, 'created_at', { ascending: false })
  })

  it('creates a relationship through the guarded RPC and lets Postgres supply the start date', async () => {
    rpc.mockResolvedValueOnce({ data: 'relationship-1', error: null })

    const result = await createEmployerManagementRelationship({
      employerId: 'employer-1',
      managerMemberId: 'manager-member-1',
      employeeMemberId: 'employee-member-1',
      relationshipType: 'functional',
      accessScope: ['employment'],
    })

    expect(result).toBe('relationship-1')
    expect(rpc).toHaveBeenCalledWith('create_employer_management_relationship', {
      p_employer_id: 'employer-1',
      p_manager_member_id: 'manager-member-1',
      p_employee_member_id: 'employee-member-1',
      p_relationship_type: 'functional',
      p_is_primary: false,
      p_include_indirect_reports: false,
      p_access_scope: ['employment'],
      p_valid_until: null,
    })
  })

  it('ends a relationship using the database current date when none is supplied', async () => {
    await endEmployerManagementRelationship('relationship-1')

    expect(rpc).toHaveBeenCalledWith('end_employer_management_relationship', {
      p_relationship_id: 'relationship-1',
    })
  })

  it('normalizes a cleared optional end date before updating', async () => {
    await updateEmployerManagementRelationship('relationship-1', {
      relationshipType: 'project',
      isPrimary: false,
      includeIndirectReports: false,
      accessScope: ['training_assignments'],
      validFrom: '2026-09-21',
      validUntil: '',
    })

    expect(rpc).toHaveBeenCalledWith('update_employer_management_relationship', {
      p_relationship_id: 'relationship-1',
      p_relationship_type: 'project',
      p_is_primary: false,
      p_include_indirect_reports: false,
      p_access_scope: ['training_assignments'],
      p_valid_from: '2026-09-21',
      p_valid_until: null,
    })
  })

  it('returns caller-scoped report and manageability results', async () => {
    rpc
      .mockResolvedValueOnce({ data: [{ employee_member_id: 'employee-member-1' }], error: null })
      .mockResolvedValueOnce({ data: true, error: null })

    await expect(listEmployerDirectReports('employer-1')).resolves.toEqual([
      { employee_member_id: 'employee-member-1' },
    ])
    await expect(canManageEmployerMember('employee-member-1', 'employment', false)).resolves.toBe(true)

    expect(rpc).toHaveBeenNthCalledWith(1, 'list_employer_direct_reports', {
      p_employer_id: 'employer-1',
    })
    expect(rpc).toHaveBeenNthCalledWith(2, 'can_manage_employer_member', {
      p_employee_member_id: 'employee-member-1',
      p_scope: 'employment',
      p_allow_indirect: false,
    })
  })

  it('propagates database authorization failures', async () => {
    const error = new Error('Not authorised')
    rpc.mockResolvedValueOnce({ data: null, error })

    await expect(endEmployerManagementRelationship('relationship-1')).rejects.toBe(error)
  })
})
