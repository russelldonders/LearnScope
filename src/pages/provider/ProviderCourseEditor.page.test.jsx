import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProviderCourseEditor from './ProviderCourseEditor'
import { getCatalogueCourse, updateProviderCourse } from '../../lib/admin/catalogue'

vi.mock('../../lib/supabaseClient', () => ({ supabase: {} }))
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, organisationMemberships: [{ organisation_id: 'org-1', role: 'admin' }] }),
}))
vi.mock('../../components/AppHeader', () => ({ default: () => null }))
vi.mock('./CourseSections', () => ({ CourseSections: () => <p>Content outline</p> }))
vi.mock('./CourseCohorts', () => ({ CourseCohorts: () => <p>Cohorts list</p>, TrainerPicker: () => null }))
vi.mock('../../lib/admin/catalogue', () => ({
  getCatalogueCourse: vi.fn(),
  updateProviderCourse: vi.fn().mockResolvedValue(),
  submitCatalogueCourseForApproval: vi.fn(),
  createDraftCourseVersion: vi.fn(),
  uploadCourseImage: vi.fn(),
  removeCourseImage: vi.fn(),
  listCurrentVersionCatalogues: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../lib/catalogues', () => ({ listPublicationCatalogueOptions: vi.fn().mockResolvedValue([]) }))
vi.mock('../../lib/admin/providerCatalogues', () => ({ assignProviderCourseToCatalogue: vi.fn(), requestProviderGlobalCataloguePublication: vi.fn() }))
vi.mock('../../lib/courseCatalogue', () => ({
  listCourseTrainers: vi.fn().mockResolvedValue([]),
  setCourseTrainers: vi.fn(),
  listOrganisationTrainerCandidates: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../lib/admin/skillCourseGeneration', () => ({ publishSystemCourseToGlobal: vi.fn() }))
vi.mock('../../lib/scormExport', () => ({ downloadCourseScormPackage: vi.fn() }))

const COURSE = {
  id: 'course-1',
  name: 'Coaching basics',
  organisation_id: 'org-1',
  version_number: 2,
  version_group_id: 'group-1',
  status: 'draft',
  synopsis: 'Learn to coach.',
  course_catalogue_publications: [],
  organisations: { is_system: false },
}

function Where() {
  const location = useLocation()
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>
}

function renderAt(url) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/organisation/training/:courseId" element={<><ProviderCourseEditor /><Where /></>} />
      </Routes>
    </MemoryRouter>
  )
}

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  getCatalogueCourse.mockResolvedValue(COURSE)
})

describe('ProviderCourseEditor', () => {
  it('names the course, version and status on the default Content tab', async () => {
    renderAt('/organisation/training/course-1')
    expect(await screen.findByRole('heading', { level: 1, name: 'Coaching basics' })).toBeInTheDocument()
    expect(screen.getByText(/Version 2/)).toBeInTheDocument()
    expect(screen.getByText('Content outline')).toBeInTheDocument()
  })

  it('opens the tab named in the URL and keeps the choice in the URL', async () => {
    renderAt('/organisation/training/course-1?org=org-1&tab=cohorts')
    expect(await screen.findByText('Cohorts list')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Info' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/organisation/training/course-1?org=org-1&tab=info')
  })

  it('only offers to save once the details have changed, and says so', async () => {
    renderAt('/organisation/training/course-1?tab=info')
    const save = await screen.findByRole('button', { name: 'Save details' })
    expect(save).toBeDisabled()
    expect(screen.getByText('Course details saved. Content changes save as you make them.')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/Synopsis/), { target: { value: 'Learn to coach well.' } })
    expect(screen.getByText('Unsaved changes to the course details on the Info tab.')).toBeInTheDocument()
    expect(save).toBeEnabled()

    getCatalogueCourse.mockResolvedValue({ ...COURSE, synopsis: 'Learn to coach well.' })
    fireEvent.click(save)
    await waitFor(() => expect(updateProviderCourse).toHaveBeenCalled())
    expect(await screen.findByText('Course details saved. Content changes save as you make them.')).toBeInTheDocument()
  })

  it('warns before leaving the page with unsaved details', async () => {
    renderAt('/organisation/training/course-1?tab=info')
    await screen.findByRole('button', { name: 'Save details' })
    fireEvent.change(screen.getByLabelText(/Synopsis/), { target: { value: 'Changed' } })
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })
})
