import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/supabaseClient', () => {
  const single = () => Promise.resolve({ data: { skills_profile_visible: true, allow_connection_skill_ratings: true } })
  return { supabase: { rpc: () => ({ select: () => ({ single }) }) } }
})
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' }, employerMemberships: [] }) }))
vi.mock('../context/LanguageContext', async () => {
  const { english } = await import('../lib/i18n/translations')
  const t = (key, params) => {
    const value = key.split('.').reduce((v, part) => v?.[part], english) ?? key
    return params ? value.replace(/\{(\w+)\}/g, (m, name) => (name in params ? params[name] : m)) : value
  }
  return { useLanguage: () => ({ language: 'en', setLanguage: vi.fn(), t }) }
})
vi.mock('../components/AppHeader', () => ({ default: () => <header>Header</header> }))
vi.mock('../lib/skillDiscovery', () => ({
  getSearchPrivacySettings: vi.fn().mockResolvedValue({ skill_search_visibility: 'all' }),
  updateSearchPrivacySettings: vi.fn(), listSearchableSkillIds: vi.fn(), setSkillSearchable: vi.fn(),
}))
vi.mock('../lib/admin/employers', () => ({
  listMyEmployerDataAccessStatus: vi.fn().mockResolvedValue([]), shareDataWithEmployer: vi.fn(),
  revokeEmployerDataAccess: vi.fn(), updateSharedEmployerSkills: vi.fn(), listSharedEmployerSkillIds: vi.fn(),
}))
vi.mock('../lib/profileShareLinks', () => ({
  listMyProfileShareLinks: vi.fn().mockResolvedValue([
    { id: 'l1', token: 'abc', share_skills: true, share_experience: true, expires_at: '2999-01-01T00:00:00Z', revoked_at: null },
  ]),
  createProfileShareLink: vi.fn(), revokeProfileShareLink: vi.fn(), profileShareLinkUrl: (token) => `/shared/${token}`,
}))
vi.mock('../lib/managerTeams', () => ({ listMyManagerShareableSkills: vi.fn().mockResolvedValue([]) }))

import ProfilePrivacy from './ProfilePrivacy'

describe('ProfilePrivacy', () => {
  it('renders every settings section from translation keys', async () => {
    render(<MemoryRouter><ProfilePrivacy /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Skills profile' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Privacy settings' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Show me for all my skills/ })).toBeChecked()
    expect(screen.getByRole('option', { name: '7 days' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '1 day' })).toBeInTheDocument()
    expect(await screen.findByText('Skills + Experience')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument()
  })
})
