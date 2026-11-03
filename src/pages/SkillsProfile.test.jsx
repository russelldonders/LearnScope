import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/supabaseClient', () => {
  const profile = { full_name: '', avatar_url: null, skills_profile_visible: false, profile_visible_to_skill_matches: false }
  const chain = { select: () => chain, eq: () => chain, single: () => Promise.resolve({ data: profile, error: null }) }
  return {
    supabase: {
      from: () => chain,
      rpc: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }),
    },
  }
})
vi.mock('../lib/connections', () => ({
  getMemberSince: vi.fn().mockResolvedValue('2024-03-01'),
  listConnectionRecentGrowth: vi.fn().mockResolvedValue([]),
  listMyRatingsGivenTo: vi.fn().mockResolvedValue({}),
  rateConnectionSkill: vi.fn(),
}))
vi.mock('../lib/skillDiscovery', () => ({ requestSkillAccess: vi.fn() }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }))
vi.mock('../context/LanguageContext', () => import('../test/languageMock'))
vi.mock('../components/AppHeader', () => ({ default: () => <header>Header</header> }))

import SkillsProfile from './SkillsProfile'

afterEach(cleanup)

describe('SkillsProfile', () => {
  it('shows the translated fallback name and hidden-profile state', async () => {
    render(
      <MemoryRouter initialEntries={['/people/other']}>
        <Routes><Route path="/people/:userId" element={<SkillsProfile />} /></Routes>
      </MemoryRouter>
    )
    expect(await screen.findByRole('heading', { name: 'This person' })).toBeInTheDocument()
    expect(screen.getByText("This person hasn't made their skills profile visible.")).toBeInTheDocument()
    expect(screen.getByText(/Member since/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Request skill access' })).toBeInTheDocument()
  })
})
