import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const fixtures = vi.hoisted(() => ({ courses: [], links: [] }))

vi.mock('../lib/supabaseClient', () => {
  function query(table) {
    const rows = () => (table === 'courses' ? fixtures.courses : fixtures.links)
    const chain = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      then: (resolve, reject) => Promise.resolve({ data: rows(), error: null }).then(resolve, reject),
    }
    return chain
  }
  return { supabase: { from: query } }
})
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }))
vi.mock('../context/LanguageContext', () => import('../test/languageMock'))
vi.mock('../components/AppHeader', () => ({ default: () => null }))
vi.mock('../lib/courseContent', () => ({
  listCourseProgressByCatalogueId: () => Promise.resolve({ 'cat-2': { completed: 1, total: 4 } }),
}))
vi.mock('../lib/courseCatalogue', () => ({ listMyAssignedCourseEmployers: () => Promise.resolve(new Map()) }))

const { default: Learning } = await import('./Learning')

afterEach(cleanup)

const course = (id, name, extra = {}) => ({ id, name, provider: 'Academy', status: null, completed_date: null, catalogue_course_id: null, ...extra })

function renderPage() {
  return render(<MemoryRouter><Learning /></MemoryRouter>)
}

describe('your learning', () => {
  it('lists courses as rows under their status, with progress for a course under way', async () => {
    fixtures.courses = [
      course('c1', 'Golf basics', { completed_date: '2026-10-01' }),
      course('c2', 'Putting clinic', { catalogue_course_id: 'cat-2' }),
      course('c3', 'Short game', { status: 'planned' }),
    ]
    fixtures.links = [{ course_id: 'c2', skills: { id: 's1', name: 'Golf' } }]
    renderPage()
    const inProgress = await screen.findByRole('region', { name: 'In progress' })
    const row = within(inProgress).getByRole('link', { name: /Putting clinic/ })
    expect(row).toHaveAttribute('href', '/courses/c2/learn')
    expect(row).toHaveTextContent('25% complete · 1/4')
    expect(row).toHaveTextContent('Golf')
    expect(within(screen.getByRole('region', { name: 'Completed' })).getByRole('link', { name: /Golf basics/ })).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Planned' })).getByRole('link', { name: /Short game/ })).toHaveAttribute('href', '/training')
    // A list of rows, not tiles.
    expect(inProgress.querySelector('ul')).not.toBeNull()
  })

  it('filters to one status, counting each, and back to all', async () => {
    fixtures.courses = [
      course('c1', 'Golf basics', { completed_date: '2026-10-01' }),
      course('c4', 'Driving range', { completed_date: '2026-09-01' }),
      course('c2', 'Putting clinic'),
      course('c5', 'Bunker play', { status: 'cancelled', cancelled_at: '2026-11-02T10:00:00Z' }),
    ]
    fixtures.links = []
    renderPage()
    const filters = await screen.findByRole('group', { name: 'Show courses' })
    expect(within(filters).getAllByRole('button').map((b) => b.textContent)).toEqual(['All4', 'In progress1', 'Completed2', 'Cancelled1'])
    expect(within(filters).getByRole('button', { name: /All/ })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(within(filters).getByRole('button', { name: /Completed/ }))
    expect(screen.getByRole('region', { name: 'Completed' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'In progress' })).not.toBeInTheDocument()
    expect(screen.queryByText('Putting clinic')).not.toBeInTheDocument()
    expect(screen.getByText('Driving range')).toBeInTheDocument()

    fireEvent.click(within(filters).getByRole('button', { name: /All/ }))
    expect(screen.getByText('Putting clinic')).toBeInTheDocument()
    expect(screen.getByText('Bunker play')).toBeInTheDocument()
  })

  it('has no filter when all courses share a status', async () => {
    fixtures.courses = [course('c2', 'Putting clinic'), course('c6', 'Chipping')]
    fixtures.links = []
    renderPage()
    await screen.findByText('Putting clinic')
    expect(screen.queryByRole('group', { name: 'Show courses' })).not.toBeInTheDocument()
  })
})
