import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EmployerCataloguePanel from './EmployerCataloguePanel'

const listCoursesMock = vi.hoisted(() => vi.fn())
const enrolMock = vi.hoisted(() => vi.fn())

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../../components/CourseThumbnail', () => ({ default: () => <div data-testid="thumbnail" /> }))
vi.mock('../../components/CohortPickerModal', () => ({ default: () => null }))
vi.mock('../../lib/employerCatalogues', () => ({ listMyEmployerCatalogueCourses: listCoursesMock }))
vi.mock('../../lib/courseCatalogue', () => ({
  listEnrolledCatalogueIds: () => Promise.resolve(new Map()),
  listCourseCohorts: () => Promise.resolve([]),
  enrolInCatalogueCourse: enrolMock,
  enrolInCourseCohort: vi.fn(),
}))

beforeEach(() => {
  listCoursesMock.mockResolvedValue([{
    id: 'course-1',
    name: 'Lead safely',
    provider: 'Learning Co',
    synopsis: 'Practical safety leadership.',
    courseType: 'Online',
    course_type: 'Online',
    duration: '1 hour',
    imageUrl: null,
    catalogues: [{ id: 'catalogue-1', name: 'Leadership' }],
  }])
  enrolMock.mockResolvedValue({ id: 'enrolment-1', completed_date: null })
})

afterEach(cleanup)

describe('EmployerCataloguePanel', () => {
  it('shows and enrols into courses granted to this member', async () => {
    render(<EmployerCataloguePanel employerId="employer-1" employerName="Acme" employerLogoUrl={null} />)

    expect(await screen.findByRole('heading', { name: 'Lead safely' })).toBeInTheDocument()
    expect(screen.getByText('Leadership')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Enrol' }))
    expect(await screen.findByRole('button', { name: 'Enrolled ✓' })).toBeDisabled()
    expect(enrolMock).toHaveBeenCalledWith('user-1', expect.objectContaining({ id: 'course-1' }))
  })

  it('filters the granted catalogue without changing access', async () => {
    render(<EmployerCataloguePanel employerId="employer-1" employerName="Acme" employerLogoUrl={null} />)
    await screen.findByRole('heading', { name: 'Lead safely' })

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search catalogue' }), { target: { value: 'missing' } })
    expect(screen.getByText('No learning matches “missing”.')).toBeInTheDocument()
  })
})
