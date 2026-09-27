import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabaseClient', () => ({ supabase: {} }))

import { chooseActiveWorkspace, toWorkspaceViewModel } from './workspaces'

const personal = {
  id: 'personal',
  kind: 'personal',
  status: 'active',
  allowedActions: ['workspace:enter'],
}

const organisation = {
  id: 'organisation',
  kind: 'organisation',
  status: 'active',
  allowedActions: ['workspace:enter'],
}

describe('toWorkspaceViewModel', () => {
  it('maps the canonical organisation owner', () => {
    expect(toWorkspaceViewModel({
      access_role: 'member',
      status: 'active',
      workspaces: {
        id: 'workspace-id',
        workspace_type: 'organisation',
        organisation_id: 'organisation-id',
        name: 'Acme',
        status: 'active',
      },
    })).toEqual({
      id: 'workspace-id',
      kind: 'organisation',
      organisationId: 'organisation-id',
      name: 'Acme',
      role: 'member',
      status: 'active',
      requiresReauthentication: false,
      allowedActions: ['workspace:enter'],
    })
  })
})

describe('chooseActiveWorkspace', () => {
  it('uses an accessible preferred workspace', () => {
    expect(chooseActiveWorkspace([personal, organisation], 'organisation')).toBe(organisation)
  })

  it('falls back to the personal workspace', () => {
    expect(chooseActiveWorkspace([organisation, personal], 'missing')).toBe(personal)
  })

  it('does not select a suspended or inaccessible workspace', () => {
    const suspended = { ...personal, status: 'suspended' }
    const blocked = { ...organisation, allowedActions: [] }
    expect(chooseActiveWorkspace([suspended, blocked])).toBeNull()
  })
})
