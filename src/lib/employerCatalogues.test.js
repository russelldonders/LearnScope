import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getPublicEmployerCatalogueCourses,
  listEmployerCatalogueAccess,
  listMyEmployerCatalogueCourses,
  setEmployerCatalogueAccess,
} from './employerCatalogues'

const rpcMock = vi.hoisted(() => vi.fn())
vi.mock('./supabaseClient', () => ({ supabase: { rpc: rpcMock } }))

beforeEach(() => rpcMock.mockReset())

describe('employer catalogue RPC client', () => {
  it('saves role-profile access without creating a second catalogue', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null })

    await setEmployerCatalogueAccess('employer-1', 'catalogue-1', 'role_profiles', ['role-1'])

    expect(rpcMock).toHaveBeenCalledWith('set_employer_catalogue_access', {
      p_employer: 'employer-1',
      p_catalogue: 'catalogue-1',
      p_visibility: 'role_profiles',
      p_role_profile_ids: ['role-1'],
    })
  })

  it.each([
    ['list_employer_catalogue_access', listEmployerCatalogueAccess, { p_employer: 'employer-1' }],
    ['list_my_employer_catalogue_courses', listMyEmployerCatalogueCourses, { p_employer: 'employer-1' }],
    ['get_public_employer_catalogue_courses', getPublicEmployerCatalogueCourses, { p_slug: 'acme' }],
  ])('returns the JSON collection from %s', async (rpcName, invoke, params) => {
    rpcMock.mockResolvedValue({ data: [{ id: 'one' }], error: null })
    const value = rpcName === 'get_public_employer_catalogue_courses' ? 'acme' : 'employer-1'

    await expect(invoke(value)).resolves.toEqual([{ id: 'one' }])
    expect(rpcMock).toHaveBeenCalledWith(rpcName, params)
  })
})
