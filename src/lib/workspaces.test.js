import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabaseClient', () => ({ supabase: {} }))

import { chooseActiveWorkspace, toWorkspaceViewModel } from './workspaces'

const personal = {
  id: 'personal',
  kind: 'personal',
  status: 'active',
  allowedActions: ['workspace:enter'],
}

const employer = {
  id: 'employer',
  kind: 'organisation',
  status: 'active',
  allowedActions: ['workspace:enter'],
}

describe('toWorkspaceViewModel', () => {
  it('maps database ownership fields without treating employer_id as a personal organisation', () => {
    expect(toWorkspaceViewModel({
      access_role: 'employee',
      status: 'active',
      workspaces: {
        id: 'workspace-id',
        workspace_type: 'organisation',
        employer_id: 'employer-id',
        name: 'Acme',
        status: 'active',
      },
    })).toEqual({
      id: 'workspace-id',
      kind: 'organisation',
      organisationId: 'employer-id',
      name: 'Acme',
      role: 'employee',
      status: 'active',
      requiresReauthentication: false,
      allowedActions: ['workspace:enter'],
    })
  })
})

describe('chooseActiveWorkspace', () => {
  it('uses an accessible preferred workspace', () => {
    expect(chooseActiveWorkspace([personal, employer], 'employer')).toBe(employer)
  })

  it('falls back to the personal workspace', () => {
    expect(chooseActiveWorkspace([employer, personal], 'missing')).toBe(personal)
  })

  it('does not select a suspended or inaccessible workspace', () => {
    const suspended = { ...personal, status: 'suspended' }
    const blocked = { ...employer, allowedActions: [] }
    expect(chooseActiveWorkspace([suspended, blocked])).toBeNull()
  })
})
