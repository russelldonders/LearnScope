import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ValidateRequest from './ValidateRequest'
import { LanguageProvider } from '../context/LanguageContext'

const selects = vi.hoisted(() => [])

const rows = vi.hoisted(() => ({
  skill_validation_requests: {
    id: 'request-1', skill_id: 'skill-1', requester_id: 'learner-1', validator_id: 'validator-1',
    target_level: 3, status: 'pending', decision_comments: null, created_at: '2026-11-01T10:00:00Z', decided_at: null,
  },
  profiles: [{ id: 'rater-1', full_name: 'Robin Rater' }],
  skills: { id: 'skill-1', name: 'Negotiation', level: 2 },
  skill_assessments: [],
  skill_peer_ratings: [{ id: 'rating-1', rater_id: 'rater-1', level: 3, comments: 'Solid', rated_at: '2026-10-01T10:00:00Z' }],
  skill_course_links: [],
}))

// Records every column list the page asks for, and answers each table with
// its fixture: single-row reads get an object, list reads an array.
vi.mock('../lib/supabaseClient', () => {
  function query(table) {
    const builder = {
      select(columns) { selects.push({ table, columns }); return builder },
      eq() { return builder },
      in() { return builder },
      order() { return builder },
      single() {
        const data = table === 'profiles' ? { full_name: 'Lee Learner' } : rows[table]
        return Promise.resolve({ data, error: null })
      },
      then(resolve) { return Promise.resolve({ data: rows[table] ?? [], error: null }).then(resolve) },
    }
    return builder
  }
  return { supabase: { from: query } }
})
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'validator-1' } }) }))
vi.mock('../context/PendingActionsContext', () => ({ usePendingActions: () => ({ refreshPendingActionCount: vi.fn() }) }))
vi.mock('../lib/activitySkillLinks', () => ({ fetchStatementsForSkill: () => Promise.resolve([]) }))
vi.mock('../components/AppHeader', () => ({ default: () => null }))

function renderPage() {
  return render(
    <LanguageProvider>
      <MemoryRouter initialEntries={['/validate/request-1']}>
        <Routes>
          <Route path="/validate/:requestId" element={<ValidateRequest />} />
        </Routes>
      </MemoryRouter>
    </LanguageProvider>
  )
}

describe('ValidateRequest', () => {
  afterEach(() => {
    cleanup()
    selects.length = 0
  })

  it("loads only the parts of the learner's record a validator is shown", async () => {
    renderPage()

    expect(await screen.findByText('Negotiation')).toBeInTheDocument()
    expect(await screen.findByText(/Robin Rater/)).toBeInTheDocument()

    expect(selects.every(({ columns }) => !columns.includes('*'))).toBe(true)
    const columnsFor = (table) => selects.find((s) => s.table === table).columns
    expect(columnsFor('skill_peer_ratings')).not.toMatch(/email|rater_name/)
    expect(columnsFor('skills')).not.toMatch(/notes|tracking_reason|checkin/)
  })
})
