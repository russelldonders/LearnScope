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
  assignCourseToManagedEmployerMember,
  canManageEmployerMember,
  confirmManagedEmployerSkillLevel,
  createEmployerManagementRelationship,
  endEmployerManagementRelationship,
  getMyEmployerTeamMemberSnapshot,
  listEmployerDirectReports,
  listEmployerManagementRelationships,
  listManagerAssignableCourses,
  listManagerSuggestibleSkills,
  listMyEmployerManagementContexts,
  listMyEmployerTeam,
  suggestSkillToManagedEmployerMember,
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

  it('maps caller-scoped manager contexts and team rows', async () => {
    rpc
      .mockResolvedValueOnce({
        data: [{
          employer_id: 'employer-1', employer_name: 'Acme', employer_slug: 'acme',
          manager_member_id: 'manager-1', direct_report_count: 2, indirect_report_count: 3,
        }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{
          employee_member_id: 'member-1', employee_user_id: 'user-1', full_name: 'Alex Example',
          avatar_url: null, report_depth: 2, access_scope: ['employment'],
          relationship_types: ['indirect'], is_primary: false,
        }],
        error: null,
      })

    await expect(listMyEmployerManagementContexts()).resolves.toEqual([{
      employerId: 'employer-1', employerName: 'Acme', employerSlug: 'acme',
      managerMemberId: 'manager-1', directReportCount: 2, indirectReportCount: 3,
    }])
    await expect(listMyEmployerTeam('employer-1')).resolves.toEqual([{
      employeeMemberId: 'member-1', employeeUserId: 'user-1', fullName: 'Alex Example',
      avatarUrl: null, reportDepth: 2, accessScope: ['employment'],
      relationshipTypes: ['indirect'], isPrimary: false,
    }])

    expect(rpc).toHaveBeenNthCalledWith(1, 'list_my_employer_management_contexts')
    expect(rpc).toHaveBeenNthCalledWith(2, 'list_my_employer_team', { p_employer_id: 'employer-1' })
  })

  it('loads a team-member snapshot through the strict employer-context RPC', async () => {
    const snapshot = { employeeMemberId: 'member-1', sharedSkills: [] }
    rpc.mockResolvedValueOnce({ data: snapshot, error: null })

    await expect(getMyEmployerTeamMemberSnapshot('employer-1', 'member-1')).resolves.toBe(snapshot)
    expect(rpc).toHaveBeenCalledWith('get_my_employer_team_member_snapshot', {
      p_employer_id: 'employer-1',
      p_employee_member_id: 'member-1',
    })
  })

  it('uses separately scope-checked RPCs for manager training actions', async () => {
    rpc
      .mockResolvedValueOnce({ data: [{ id: 'course-1', name: 'Safety' }], error: null })
      .mockResolvedValueOnce({ data: 'assignment-1', error: null })

    await expect(listManagerAssignableCourses('employer-1', 'member-1')).resolves.toEqual([
      { id: 'course-1', name: 'Safety' },
    ])
    await expect(assignCourseToManagedEmployerMember('employer-1', 'member-1', 'course-1'))
      .resolves.toBe('assignment-1')

    expect(rpc).toHaveBeenNthCalledWith(1, 'list_manager_assignable_courses', {
      p_employer_id: 'employer-1', p_employee_member_id: 'member-1',
    })
    expect(rpc).toHaveBeenNthCalledWith(2, 'assign_course_to_managed_employer_member', {
      p_employer_id: 'employer-1', p_employee_member_id: 'member-1', p_catalogue_course_id: 'course-1',
    })
  })

  it('normalizes scoped skill suggestion input and confirms a level', async () => {
    rpc
      .mockResolvedValueOnce({ data: [{ id: 'skill-1', name: 'Coaching' }], error: null })
      .mockResolvedValueOnce({ data: 'suggestion-1', error: null })
      .mockResolvedValueOnce({ data: 'confirmation-1', error: null })

    await expect(listManagerSuggestibleSkills('employer-1', 'member-1')).resolves.toHaveLength(1)
    await suggestSkillToManagedEmployerMember('employer-1', 'member-1', 'skill-1', {
      targetLevel: 4, targetDate: '', comments: '  Focus on facilitation  ',
    })
    await confirmManagedEmployerSkillLevel('employer-1', 'member-1', 'skill-1', 3)

    expect(rpc).toHaveBeenNthCalledWith(2, 'suggest_skill_to_managed_employer_member', {
      p_employer_id: 'employer-1', p_employee_member_id: 'member-1', p_skill_library_id: 'skill-1',
      p_target_level: 4, p_target_date: null, p_comments: 'Focus on facilitation',
    })
    expect(rpc).toHaveBeenNthCalledWith(3, 'confirm_managed_employer_skill_level', {
      p_employer_id: 'employer-1', p_employee_member_id: 'member-1',
      p_skill_library_id: 'skill-1', p_level: 3,
    })
  })
})
