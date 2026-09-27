import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProviderProfile from './ProviderProfile'

const authMock = vi.hoisted(() => ({ value: {} }))
const profileMock = vi.hoisted(() => vi.fn())
const employerContextMock = vi.hoisted(() => vi.fn())
const publicEmployerCoursesMock = vi.hoisted(() => vi.fn())

vi.mock('../context/AuthContext', () => ({ useAuth: () => authMock.value }))
vi.mock('../components/AppHeader', () => ({ default: () => <header>App header</header> }))
vi.mock('../components/CohortPickerModal', () => ({ default: () => null }))
vi.mock('../lib/providerProfile', () => ({ getProviderProfile: profileMock }))
vi.mock('../lib/employerRoleProfiles', () => ({ getEmployerLoginContext: employerContextMock }))
vi.mock('../lib/employerCatalogues', () => ({ getPublicEmployerCatalogueCourses: publicEmployerCoursesMock }))
vi.mock('../lib/orgBranding', () => ({ orgBrandStyle: () => ({}) }))
vi.mock('../lib/courseCatalogue', () => ({
  listEnrolledCatalogueIds: () => Promise.resolve(new Map()),
  enrolInCatalogueCourse: vi.fn(),
  setPendingEnrolCourseId: vi.fn(),
  listCourseCohorts: vi.fn(),
  enrolInCourseCohort: vi.fn(),
}))

const publicProfile = {
  organisation: {
    name: 'Acme',
    logoUrl: null,
    url: null,
    about: null,
    brandPrimaryColor: null,
    brandSecondaryColor: null,
    brandHoverColor: null,
    brandBackgroundColor: null,
    brandTextColor: null,
  },
  skills: [],
  courses: [],
}

function Destination({ label }) {
  const location = useLocation()
  return <p>{label}: {location.pathname}{location.search}</p>
}

beforeEach(() => {
  vi.clearAllMocks()
  authMock.value = { user: null, loading: false, employerMemberships: [] }
  profileMock.mockResolvedValue(publicProfile)
  employerContextMock.mockResolvedValue({ id: 'employer-1', name: 'Acme' })
  publicEmployerCoursesMock.mockResolvedValue([])
})

afterEach(cleanup)

function renderProfile() {
  return render(
    <MemoryRouter initialEntries={['/providers/acme']}>
      <Routes>
        <Route path="/providers/:slug" element={<ProviderProfile />} />
        <Route path="/organisation/learning" element={<Destination label="Learner LMS" />} />
        <Route path="/login" element={<Destination label="Login" />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ProviderProfile canonical organisation URL', () => {
  it('routes a signed-in employer member from the organisation URL to the learner LMS', async () => {
    authMock.value = {
      user: { id: 'user-1' },
      loading: false,
      employerMemberships: [{ employer_id: 'employer-1', role: 'member' }],
    }

    renderProfile()

    expect(await screen.findByText('Learner LMS: /organisation/learning?org=acme')).toBeInTheDocument()
  })

  it('continues to show the public catalogue to a visitor', async () => {
    publicEmployerCoursesMock.mockResolvedValue([{
      id: 'course-public',
      name: 'Public employer course',
      provider: 'Acme',
      courseType: 'Online',
      duration: '1 hour',
      synopsis: null,
      imageUrl: null,
      catalogues: [{ id: 'catalogue-1', name: 'Acme essentials' }],
      skillEntries: [],
      tags: [],
    }])
    renderProfile()

    expect(await screen.findByRole('heading', { name: 'Skills offered' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Training offered' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Public employer course' })).toBeInTheDocument()
    expect(publicEmployerCoursesMock).toHaveBeenCalledWith('acme')
  })

  it('fails closed instead of exposing the provider catalogue when employer access cannot be loaded', async () => {
    profileMock.mockResolvedValue({
      ...publicProfile,
      courses: [{
        id: 'provider-only', name: 'Provider-only course', courseType: 'Online', duration: null,
        synopsis: null, imageUrl: null, catalogues: [], skillEntries: [], tags: [],
      }],
    })
    publicEmployerCoursesMock.mockRejectedValue(new Error('Access unavailable'))

    renderProfile()

    expect(await screen.findByRole('heading', { name: 'Training offered' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Provider-only course' })).not.toBeInTheDocument()
    expect(screen.getByText('No training listed yet.')).toBeInTheDocument()
  })

  it('sends a signed-out member to branded login when no public catalogue is enabled', async () => {
    profileMock.mockResolvedValue(null)

    renderProfile()

    expect(await screen.findByText('Login: /login?org=acme')).toBeInTheDocument()
  })
})
