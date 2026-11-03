import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Every table read resolves to one sample row (or the profile), so each
// section renders its translated line rather than only the empty state.
vi.mock('../lib/supabaseClient', () => {
  const rows = {
    experience: [{ id: 'e1', title: 'Analyst', organization: 'Acme', type: 'job', start_date: '2024-01-01', end_date: null }],
    courses: [],
    skills: [{ id: 's1', name: 'SQL', level: 3, lifecycle_stage: 'developing' }],
    skill_assessments: [{ id: 'a1', skill_id: 's1', level: 3, assessed_at: '2025-01-01' }],
    skill_targets: [],
    skill_tags: [],
    skill_peer_ratings: [],
    skill_validation_requests: [],
    connections: [{ id: 'c1', created_at: '2025-02-01', source: 'peer_rating' }],
  }
  const query = (table) => {
    const result = Promise.resolve({ data: rows[table] ?? [], error: null })
    const chain = { select: () => chain, eq: () => chain, or: () => chain, order: () => result }
    chain.then = result.then.bind(result)
    return chain
  }
  return {
    supabase: {
      from: query,
      rpc: () => ({ select: () => ({ single: () => Promise.resolve({ data: { first_name: 'Ada' }, error: null }) }) }),
    },
  }
})
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me', email: 'ada@example.com' } }) }))
vi.mock('../context/LanguageContext', () => import('../test/languageMock'))
vi.mock('../components/AppHeader', () => ({ default: () => <header>Header</header> }))

import ProfileExport from './ProfileExport'

afterEach(cleanup)

describe('ProfileExport', () => {
  it('renders every section from translation keys', async () => {
    render(<MemoryRouter><ProfileExport /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Employment & education (1)' })).toBeInTheDocument()
    expect(screen.getByText('Your data')).toBeInTheDocument()
    expect(screen.getByText(/Present/)).toBeInTheDocument()
    expect(screen.getByText(/Current level 3/)).toBeInTheDocument()
    expect(screen.getByText(/— level 3/)).toBeInTheDocument()
    expect(screen.getByText(/\(via peer rating\)/)).toBeInTheDocument()
    expect(screen.getAllByText('Nothing here.').length).toBeGreaterThan(0)
  })
})
