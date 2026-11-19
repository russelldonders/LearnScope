import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

// What the mocked database holds: the profile row, and skills per user.
const db = vi.hoisted(() => ({
  profile: { full_name: '', avatar_url: null, skills_profile_visible: false, profile_visible_to_skill_matches: false },
  skills: {},
}))

vi.mock('../lib/supabaseClient', () => {
  function query(table) {
    const filters = {}
    const chain = {
      select: () => chain,
      eq: (column, value) => { filters[column] = value; return chain },
      not: () => chain,
      order: () => chain,
      single: () => Promise.resolve({ data: db.profile, error: null }),
      then: (resolve) => resolve({ data: table === 'skills' ? db.skills[filters.user_id] ?? [] : [], error: null }),
    }
    return chain
  }
  return {
    supabase: {
      from: query,
      rpc: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }),
    },
  }
})
vi.mock('../lib/connections', () => ({
  getMemberSince: vi.fn().mockResolvedValue('2024-03-01'),
  listConnectionRecentGrowth: vi.fn().mockResolvedValue([]),
  listMyRatingsGivenTo: vi.fn().mockResolvedValue({}),
  listRatingsReceivedFrom: vi.fn().mockResolvedValue({ 'my-sql': { level: 3, ratedAt: '2026-10-01T00:00:00Z' } }),
  rateConnectionSkill: vi.fn(),
}))
vi.mock('../lib/skillDiscovery', () => ({ requestSkillAccess: vi.fn() }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }))
vi.mock('../context/LanguageContext', () => import('../test/languageMock'))
vi.mock('../components/AppHeader', () => ({ default: () => <header>Header</header> }))

import SkillsProfile from './SkillsProfile'

afterEach(cleanup)

function renderProfile() {
  return render(
    <MemoryRouter initialEntries={['/people/other']}>
      <Routes><Route path="/people/:userId" element={<SkillsProfile />} /></Routes>
    </MemoryRouter>
  )
}

describe('SkillsProfile', () => {
  it('shows the translated fallback name and hidden-profile state', async () => {
    renderProfile()
    expect(await screen.findByRole('heading', { name: 'This person' })).toBeInTheDocument()
    // Not a connection, so no tabs: the hidden-profile state shows on its own.
    expect(await screen.findByText("This person hasn't made their skills profile visible.")).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.getByText(/Member since/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Request skill access' })).toBeInTheDocument()
  })

  it('names each skill’s level and, for one you share, your level and their rating of yours', async () => {
    db.profile = { ...db.profile, full_name: 'Alex', skills_profile_visible: true }
    db.skills = {
      other: [
        { id: 'their-sql', name: 'SQL', level: 5, library_skill_id: 'lib-sql' },
        { id: 'their-go', name: 'Go', level: 2, library_skill_id: 'lib-go' },
        { id: 'their-rust', name: 'Rust', level: null, library_skill_id: 'lib-rust' },
      ],
      me: [
        { id: 'my-sql', level: 1, library_skill_id: 'lib-sql' },
        { id: 'my-rust', level: null, library_skill_id: 'lib-rust' },
      ],
    }
    renderProfile()
    expect(await screen.findByRole('heading', { name: 'SQL' })).toBeInTheDocument()
    expect(screen.getByText('Expert')).toBeInTheDocument()
    expect(screen.getByText('Your level: Beginner')).toBeInTheDocument()
    expect(screen.getByText('Alex rated yours: Capable')).toBeInTheDocument()
    // Neither of you has a level for Rust yet, and it says so.
    expect(screen.getByText('No level yet')).toBeInTheDocument()
    expect(screen.getByText('Your level: no level yet')).toBeInTheDocument()
    // Go is filtered out as not in common; switch to all to see it without a comparison.
    screen.getByRole('button', { name: /^All skills/ }).click()
    expect(await screen.findByRole('heading', { name: 'Go' })).toBeInTheDocument()
    expect(screen.getAllByText(/^Your level/)).toHaveLength(2)
  })
})
