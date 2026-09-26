import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import EmployerAssignedTrainingPanel from './EmployerAssignedTrainingPanel'

const catalogueMock = vi.hoisted(() => ({
  list: vi.fn(),
  respond: vi.fn(),
}))
const courseRowsMock = vi.hoisted(() => ({ rows: [] }))

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../../lib/courseCatalogue', () => ({
  listMyCourseAssignmentsForEmployer: catalogueMock.list,
  respondToCourseAssignment: catalogueMock.respond,
}))
vi.mock('../../lib/supabaseClient', () => ({
  supabase: {
    from: () => ({
      select() { return this },
      eq() { return this },
      in: () => Promise.resolve({ data: courseRowsMock.rows, error: null }),
    }),
  },
}))

const assignments = [
  {
    id: 'assignment-1', catalogue_course_id: 'catalogue-1', status: 'enrolled',
    course_catalogue: { id: 'catalogue-1', name: 'Lead with confidence', provider: 'Acme Academy', course_type: 'Online', duration: '45 minutes' },
  },
  {
    id: 'assignment-2', catalogue_course_id: 'catalogue-2', status: 'assigned',
    course_catalogue: { id: 'catalogue-2', name: 'Inclusive meetings', provider: 'Acme Academy', course_type: 'Online', duration: '20 minutes' },
  },
  {
    id: 'assignment-3', catalogue_course_id: 'catalogue-3', status: 'enrolled',
    course_catalogue: { id: 'catalogue-3', name: 'Safety essentials', provider: 'Acme Academy', course_type: 'Online', duration: '15 minutes' },
  },
]

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  courseRowsMock.rows = []
})

describe('EmployerAssignedTrainingPanel', () => {
  it('prioritises active learning and separates what is next and completed', async () => {
    catalogueMock.list.mockResolvedValue(assignments)
    courseRowsMock.rows = [
      { id: 'learner-1', catalogue_course_id: 'catalogue-1', completed_date: null },
      { id: 'learner-3', catalogue_course_id: 'catalogue-3', completed_date: '2026-09-01' },
    ]

    render(
      <MemoryRouter initialEntries={['/employer/home?org=acme']}>
        <EmployerAssignedTrainingPanel employerId="employer-1" employerName="Acme" variant="home" viewAllHref="/employer/home?org=acme&section=learning" />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'Continue learning' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Lead with confidence' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Up next' })).toBeInTheDocument()
    expect(screen.getByText('Inclusive meetings')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Recently completed' })).toBeInTheDocument()
    expect(screen.getByText('Safety essentials')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View all' })).toHaveAttribute('href', '/employer/home?org=acme&section=learning')
  })

  it('enrols a not-started assignment and opens the real learner course', async () => {
    catalogueMock.list.mockResolvedValue([assignments[1]])
    catalogueMock.respond.mockResolvedValue({ id: 'learner-2', catalogue_course_id: 'catalogue-2' })

    render(
      <MemoryRouter initialEntries={['/employer/home?org=acme']}>
        <Routes>
          <Route path="/employer/home" element={<EmployerAssignedTrainingPanel employerId="employer-1" employerName="Acme" variant="home" />} />
          <Route path="/courses/:id/learn" element={<p>Course opened</p>} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Start learning' }))
    await waitFor(() => expect(catalogueMock.respond).toHaveBeenCalledWith(
      'user-1',
      'assignment-2',
      expect.objectContaining({ enrol: true, courseForEnrolment: assignments[1].course_catalogue }),
    ))
    expect(await screen.findByText('Course opened')).toBeInTheDocument()
  })
})
