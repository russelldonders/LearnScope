import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CourseCohorts } from './CourseCohorts'
import { createGoogleMeet, getGoogleConnection, getSessionAttendanceReview, listGoogleMeetDetails } from '../../lib/googleMeet'
import { listCohortTrainers, listCourseCohorts, listOrganisationTrainerCandidates } from '../../lib/courseCatalogue'

vi.mock('../../context/LanguageContext', () => ({ useLanguage: () => ({ t: (key) => key }) }))
vi.mock('../../lib/courseCatalogue', () => ({
  listCourseCohorts: vi.fn(),
  listOrganisationTrainerCandidates: vi.fn(),
  listCohortTrainers: vi.fn(),
  createCourseCohort: vi.fn(),
  updateCourseCohort: vi.fn(),
  deleteCourseCohort: vi.fn(),
  addCohortSession: vi.fn(),
  updateCohortSession: vi.fn(),
  deleteCohortSession: vi.fn(),
  setCohortTrainers: vi.fn(),
  cohortDisplayName: (cohort) => cohort.name,
  formatCohortDateRange: () => '21 Nov 2026',
}))
vi.mock('../../lib/googleMeet', () => ({
  createGoogleMeet: vi.fn(),
  getGoogleConnection: vi.fn(),
  getSessionAttendanceReview: vi.fn(),
  listGoogleMeetDetails: vi.fn(),
  startGoogleMeetConnection: vi.fn(),
  syncGoogleMeetAttendance: vi.fn(),
}))

const cohort = {
  id: 'cohort-1',
  name: 'November cohort',
  start_date: '2026-11-01T09:00:00Z',
  end_date: '2026-11-30T17:00:00Z',
  capacity: 20,
  enrolledCount: 1,
  seatsRemaining: 19,
  enrolment_open: true,
  sessions: [{
    id: 'session-1',
    title: 'Live workshop',
    starts_at: '2026-11-21T10:00:00Z',
    ends_at: '2026-11-21T11:00:00Z',
    location_or_link: null,
  }],
}

describe('CourseCohorts Google Meet controls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listCourseCohorts.mockResolvedValue([cohort])
    listOrganisationTrainerCandidates.mockResolvedValue([])
    listCohortTrainers.mockResolvedValue([])
    getGoogleConnection.mockResolvedValue({ provider: 'google', status: 'active' })
    listGoogleMeetDetails.mockResolvedValue(new Map())
    createGoogleMeet.mockResolvedValue({ meeting: { session_id: 'session-1' } })
  })

  it('creates a Google Meet for a scheduled session with an end time', async () => {
    render(<CourseCohorts courseCatalogueId="course-1" organisationId="org-1" canManage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Create Google Meet' }))
    await waitFor(() => expect(createGoogleMeet).toHaveBeenCalledWith('session-1'))
  })

  it('shows imported learner attendance for an existing meeting', async () => {
    listGoogleMeetDetails.mockResolvedValue(new Map([['session-1', {
      session_id: 'session-1', meeting_uri: 'https://meet.google.com/abc-defg-hij', sync_status: 'synced',
    }]]))
    getSessionAttendanceReview.mockResolvedValue({
      learners: [{
        user_id: 'learner-1', name: 'Ada Learner', attendance_percent: 75,
        attended_seconds: 2700, calculation_status: 'final',
      }],
      unresolved: [],
    })

    render(<CourseCohorts courseCatalogueId="course-1" organisationId="org-1" canManage />)
    fireEvent.click(await screen.findByRole('button', { name: 'View attendance' }))
    expect(await screen.findByText('Ada Learner')).toBeInTheDocument()
    expect(screen.getByText('75.0%')).toBeInTheDocument()
    expect(screen.getByText('45 min')).toBeInTheDocument()
  })
})
