import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { LanguageProvider } from '../context/LanguageContext'
import Actions from './Actions'
import { listIncomingRateInvites, listIncomingRecommendInvites, listUnseenPeerRatings, markPeerRatingsSeen, getProfiles } from '../lib/connections'
import { listIncomingPendingValidationRequests } from '../lib/skillValidationRequests'
import { listIncomingConnectionRequests, respondToConnectionRequest } from '../lib/skillDiscovery'
import { listMyPendingOrgInvites, decideOrgInvite } from '../lib/organisationInvites'
import { listMyPendingEmployerInvites, decideEmployerInvite, listMyPendingDataAccessRequests, decideEmployerDataAccessRequest } from '../lib/admin/employers'
import { listMyCourseAssignments, respondToCourseAssignment, listCourseCohorts, respondToCourseAssignmentWithCohort } from '../lib/courseCatalogue'
import { listMyManagerSkillSuggestions, adoptManagerSkillSuggestion, dismissManagerSkillSuggestion } from '../lib/managerSkillActions'
import { listMyManagerTeamInvites, decideManagerTeamInvite } from '../lib/managerTeams'
import { listIncomingPlanInvitations, respondToPlanInvitation } from '../lib/learnerPlans'
import { listMyPlanAssignments } from '../lib/organisationPlans'

const auth = vi.hoisted(() => ({
  refreshOrganisationMemberships: vi.fn(),
  refreshEmployerMemberships: vi.fn(),
  refreshPendingActionCount: vi.fn(),
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'me' },
    employerMemberships: [],
    refreshOrganisationMemberships: auth.refreshOrganisationMemberships,
    refreshEmployerMemberships: auth.refreshEmployerMemberships,
  }),
}))
vi.mock('../context/PendingActionsContext', () => ({
  usePendingActions: () => ({ refreshPendingActionCount: auth.refreshPendingActionCount }),
}))
vi.mock('../components/AppHeader', () => ({ default: () => null }))
vi.mock('../components/AssignedPlansList', () => ({
  default: ({ assignments }) => <p>{assignments.length} assigned plan(s)</p>,
}))
vi.mock('../components/EmployerDataAccessConsentDialog', () => ({
  default: ({ request, onConfirm, onClose }) => (
    <div role="dialog" aria-label="Share data">
      <p>Sharing with {request.employers.name}</p>
      <button type="button" onClick={() => onConfirm(['skill-1'], ['skills'])}>Share</button>
      <button type="button" onClick={onClose}>Close</button>
    </div>
  ),
}))
vi.mock('./manager/learner/ManagerTeamInviteCard', () => ({
  default: ({ invite, onAccept }) => <button type="button" onClick={onAccept}>Join {invite.team_name}</button>,
}))
vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [{ id: 'skill-1', name: 'SQL' }], error: null }) }) }) }),
  },
}))
vi.mock('../lib/employerRoleProfiles', () => ({ getEmployerLoginContext: vi.fn().mockResolvedValue(null) }))
vi.mock('../lib/connections', () => ({
  listIncomingRateInvites: vi.fn(), listIncomingRecommendInvites: vi.fn(), listUnseenPeerRatings: vi.fn(),
  markPeerRatingsSeen: vi.fn(), getProfiles: vi.fn(),
}))
vi.mock('../lib/skillValidationRequests', () => ({ listIncomingPendingValidationRequests: vi.fn() }))
vi.mock('../lib/skillDiscovery', () => ({ listIncomingConnectionRequests: vi.fn(), respondToConnectionRequest: vi.fn() }))
vi.mock('../lib/organisationInvites', () => ({ listMyPendingOrgInvites: vi.fn(), decideOrgInvite: vi.fn() }))
vi.mock('../lib/admin/employers', () => ({
  listMyPendingEmployerInvites: vi.fn(), decideEmployerInvite: vi.fn(),
  listMyPendingDataAccessRequests: vi.fn(), decideEmployerDataAccessRequest: vi.fn(),
}))
vi.mock('../lib/courseCatalogue', async (importOriginal) => ({
  ...await importOriginal(),
  listMyCourseAssignments: vi.fn(), respondToCourseAssignment: vi.fn(),
  listCourseCohorts: vi.fn(), respondToCourseAssignmentWithCohort: vi.fn(),
}))
vi.mock('../lib/managerSkillActions', () => ({
  listMyManagerSkillSuggestions: vi.fn(), adoptManagerSkillSuggestion: vi.fn(), dismissManagerSkillSuggestion: vi.fn(),
}))
vi.mock('../lib/managerTeams', () => ({ listMyManagerTeamInvites: vi.fn(), decideManagerTeamInvite: vi.fn() }))
vi.mock('../lib/learnerPlans', () => ({ listIncomingPlanInvitations: vi.fn(), respondToPlanInvitation: vi.fn() }))
vi.mock('../lib/organisationPlans', () => ({ listMyPlanAssignments: vi.fn() }))

const created_at = '2026-11-01T10:00:00Z'

function emptyInbox() {
  for (const fn of [
    listIncomingRateInvites, listIncomingRecommendInvites, listUnseenPeerRatings, listIncomingPendingValidationRequests,
    listIncomingConnectionRequests, listMyPendingOrgInvites, listMyPendingEmployerInvites, listMyPendingDataAccessRequests,
    listMyCourseAssignments, listMyManagerSkillSuggestions, listMyManagerTeamInvites, listIncomingPlanInvitations, listMyPlanAssignments,
  ]) fn.mockResolvedValue([])
  getProfiles.mockResolvedValue({})
}

beforeEach(() => {
  vi.clearAllMocks()
  emptyInbox()
  markPeerRatingsSeen.mockResolvedValue(undefined)
  for (const fn of [respondToConnectionRequest, decideOrgInvite, decideEmployerInvite, decideEmployerDataAccessRequest,
    respondToCourseAssignment, respondToCourseAssignmentWithCohort, adoptManagerSkillSuggestion, dismissManagerSkillSuggestion,
    decideManagerTeamInvite]) fn.mockResolvedValue(undefined)
  listCourseCohorts.mockResolvedValue([])
  respondToPlanInvitation.mockResolvedValue('plan-9')
})
afterEach(cleanup)

function renderPage(path = '/actions') {
  return render(
    <LanguageProvider>
      <MemoryRouter initialEntries={[path]}>
        <Actions />
      </MemoryRouter>
    </LanguageProvider>
  )
}

function section(heading) {
  return screen.getByRole('heading', { name: heading, level: 2 }).parentElement
}

describe('Actions', () => {
  it('says so when nothing needs attention', async () => {
    renderPage()
    expect(await screen.findByText('Nothing needs your attention right now.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Actions', level: 1 })).toBeInTheDocument()
  })

  it('lists every kind of waiting item and counts them', async () => {
    listIncomingRateInvites.mockResolvedValue([{ id: 'ri', share_code: 'rate-1', inviter_name: 'Ada', skill_name: 'Python', skill_category: 'Software', created_at }])
    listIncomingRecommendInvites.mockResolvedValue([{ id: 'rec', share_code: 'rec-1', inviter_name: null, skill_name: 'Rust', created_at }])
    listIncomingPendingValidationRequests.mockResolvedValue([{ id: 'val-1', requester_id: 'u-val', target_level: 3, skills: { name: 'SQL' }, created_at }])
    listIncomingConnectionRequests.mockResolvedValue([
      { id: 'conn', requester_id: 'u-conn', request_type: 'connect', skills: { name: 'Go' }, message: 'Hi', created_at },
      { id: 'acc', requester_id: 'u-acc', request_type: 'skill_access', created_at },
    ])
    listMyPendingOrgInvites.mockResolvedValue([{ id: 'org', role: 'trainer', organisations: { name: 'Academy' }, created_at }])
    listMyPendingEmployerInvites.mockResolvedValue([{ id: 'emp', role: 'admin', employers: { name: 'Acme' }, created_at }])
    listMyManagerTeamInvites.mockResolvedValue([{ id: 'team', team_name: 'Data team' }])
    listMyPlanAssignments.mockResolvedValue([{ id: 'pa', status: 'assigned' }, { id: 'pb', status: 'started' }])
    listIncomingPlanInvitations.mockResolvedValue([{ id: 'pi', inviter_name: 'Bo', plan_title: 'Grow', plan_description: 'A plan', created_at }])
    getProfiles.mockResolvedValue({ 'u-val': { name: 'Val' }, 'u-conn': { name: 'Cy' }, 'u-acc': { name: 'Ann' } })
    renderPage()

    expect(await screen.findByText('10 items need your response')).toBeInTheDocument()
    expect(within(section('Invitations to rate')).getByRole('link')).toHaveAttribute('href', '/rate/rate-1')
    expect(within(section('Invitations to rate')).getByRole('link')).toHaveTextContent('Ada wants your rating on their skill: Python (Software)')
    expect(within(section('Skill recommendations')).getByRole('link')).toHaveTextContent('Someone recommends you start tracking: Rust')
    expect(within(section('Requests to validate')).getByRole('link')).toHaveAttribute('href', '/validate-request/val-1')
    expect(within(section('Requests to validate')).getByRole('link')).toHaveTextContent('Val asked you to confirm they\'ve reached Capable on SQL')
    expect(section('Connection requests')).toHaveTextContent('Cy wants to connect over Go')
    expect(within(section('Skill access requests')).getByRole('link', { name: 'Manage sharing' })).toHaveAttribute('href', '/profile/privacy')
    expect(section('Provider invitations')).toHaveTextContent('Academy wants to add you as a trainer')
    expect(section('Employer invitations')).toHaveTextContent('Acme wants to add you as an admin')
    expect(within(section('Manager team invitations')).getByRole('button', { name: 'Join Data team' })).toBeInTheDocument()
    expect(section('Assigned plans')).toHaveTextContent('1 assigned plan(s)')
    expect(section('Plan invitations')).toHaveTextContent('Bo invited you to follow the plan Grow')
  })

  it('shows ratings received for information and marks them seen', async () => {
    listUnseenPeerRatings.mockResolvedValue([{ id: 'r1', skill_id: 'skill-1', rater_name: 'Robin', skill_name: 'SQL', level: 4, comments: 'Great', rated_at: created_at }])
    renderPage()
    expect(await screen.findByText('Nothing needs a response right now · 1 new rating received')).toBeInTheDocument()
    expect(within(section('Ratings received')).getByRole('link')).toHaveAttribute('href', '/skills/skill-1')
    expect(section('Ratings received')).toHaveTextContent('Robin rated your skill SQL: Skilled')
    await waitFor(() => expect(markPeerRatingsSeen).toHaveBeenCalled())
    await waitFor(() => expect(auth.refreshPendingActionCount).toHaveBeenCalled())
  })

  it('still shows what loaded when one source fails, and can try again', async () => {
    listMyPendingOrgInvites.mockRejectedValue(new Error('down'))
    listIncomingRateInvites.mockResolvedValue([{ id: 'ri', share_code: 'rate-1', inviter_name: 'Ada', skill_name: 'Python', created_at }])
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('Some actions could not be loaded (organisation invitations). Other actions are shown below.')
    expect(section('Invitations to rate')).toBeInTheDocument()
    listMyPendingOrgInvites.mockResolvedValue([])
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('accepts and declines invitations, removing each once answered', async () => {
    listIncomingConnectionRequests.mockResolvedValue([{ id: 'conn', requester_id: 'u', request_type: 'connect', created_at }])
    listMyPendingOrgInvites.mockResolvedValue([{ id: 'org', role: 'admin', organisations: { name: 'Academy' }, created_at }])
    listMyPendingEmployerInvites.mockResolvedValue([{ id: 'emp', role: 'member', employers: { name: 'Acme' }, created_at }])
    listMyManagerTeamInvites.mockResolvedValue([{ id: 'team', team_name: 'Data team' }])
    renderPage()

    fireEvent.click(within(await screen.findByRole('heading', { name: 'Connection requests' }).then((h) => h.parentElement)).getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(respondToConnectionRequest).toHaveBeenCalledWith('conn', true))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Connection requests' })).not.toBeInTheDocument())

    fireEvent.click(within(section('Provider invitations')).getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(decideOrgInvite).toHaveBeenCalledWith('org', true))
    await waitFor(() => expect(auth.refreshOrganisationMemberships).toHaveBeenCalled())

    fireEvent.click(within(section('Employer invitations')).getByRole('button', { name: 'Decline' }))
    await waitFor(() => expect(decideEmployerInvite).toHaveBeenCalledWith('emp', false))
    expect(auth.refreshEmployerMemberships).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Join Data team' }))
    await waitFor(() => expect(decideManagerTeamInvite).toHaveBeenCalledWith('team', true))
    expect(await screen.findByText('Nothing needs your attention right now.')).toBeInTheDocument()
    expect(auth.refreshPendingActionCount).toHaveBeenCalledTimes(4)
  })

  it('shows an error on the invitation it belongs to', async () => {
    listMyPendingOrgInvites.mockResolvedValue([{ id: 'org', role: 'admin', organisations: { name: 'Academy' }, created_at }])
    decideOrgInvite.mockRejectedValue(new Error('Invite expired'))
    renderPage()
    fireEvent.click(within(await screen.findByRole('heading', { name: 'Provider invitations' }).then((h) => h.parentElement)).getByRole('button', { name: 'Accept' }))
    expect(await within(section('Provider invitations')).findByText('Invite expired')).toBeInTheDocument()
  })

  it('shares chosen data with an employer, or declines without sharing', async () => {
    listMyPendingDataAccessRequests.mockResolvedValue([
      { id: 'dar-1', employers: { name: 'Acme' }, requested_data: ['skills'], request_comment: 'For reviews', created_at },
      { id: 'dar-2', employers: { name: 'Globex' }, requested_data: ['skills'], created_at },
    ])
    renderPage()
    const requests = (await screen.findByRole('heading', { name: 'Data access requests' })).parentElement
    expect(requests).toHaveTextContent('For reviews')
    fireEvent.click(within(requests).getAllByRole('button', { name: 'Review request' })[0])
    const dialog = screen.getByRole('dialog', { name: 'Share data' })
    expect(dialog).toHaveTextContent('Sharing with Acme')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Share' }))
    await waitFor(() => expect(decideEmployerDataAccessRequest).toHaveBeenCalledWith('dar-1', true, ['skill-1'], ['skills']))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    fireEvent.click(within(section('Data access requests')).getByRole('button', { name: 'Decline' }))
    await waitFor(() => expect(decideEmployerDataAccessRequest).toHaveBeenCalledWith('dar-2', false))
    expect(await screen.findByText('Nothing needs your attention right now.')).toBeInTheDocument()
  })

  it('starts assigned training directly, or through a cohort when the course runs in cohorts', async () => {
    const course = { id: 'cat-1', name: 'First aid' }
    listMyCourseAssignments.mockResolvedValue([
      { id: 'asg-1', employers: { name: 'Acme' }, course_catalogue: course, created_at },
      { id: 'asg-2', employers: { name: 'Acme' }, course_catalogue: { id: 'cat-2', name: 'Fire safety' }, created_at },
      { id: 'asg-3', employers: { name: 'Acme' }, course_catalogue: { id: 'cat-3', name: 'Lifting' }, created_at },
    ])
    renderPage()
    const training = (await screen.findByRole('heading', { name: 'Assigned training' })).parentElement
    expect(training).toHaveTextContent('Acme assigned you a course: First aid')

    fireEvent.click(within(training).getAllByRole('button', { name: 'Start' })[0])
    await waitFor(() => expect(respondToCourseAssignment).toHaveBeenCalledWith('me', 'asg-1', { enrol: true, courseForEnrolment: course }))
    await waitFor(() => expect(within(section('Assigned training')).queryByText(/First aid/)).not.toBeInTheDocument())

    listCourseCohorts.mockResolvedValue([{ id: 'cohort-1', name: 'January', start_date: null, capacity: null, enrolment_open: true, sessions: [] }])
    fireEvent.click(within(section('Assigned training')).getAllByRole('button', { name: 'Start' })[0])
    const picker = await screen.findByRole('dialog')
    fireEvent.click(within(picker).getByRole('button', { name: 'Enrol in this cohort' }))
    await waitFor(() => expect(respondToCourseAssignmentWithCohort).toHaveBeenCalledWith('asg-2', 'cohort-1'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    fireEvent.click(within(section('Assigned training')).getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(respondToCourseAssignment).toHaveBeenCalledWith('me', 'asg-3', { enrol: false, courseForEnrolment: { id: 'cat-3', name: 'Lifting' } }))
  })

  it('adds a suggested skill only after the learner reviews its target, or dismisses it', async () => {
    const suggestion = { id: 'sug-1', sourceLabel: 'Acme', skillName: 'SQL', suggestedTargetLevel: 3, targetDate: null, comments: 'For the project', createdAt: created_at }
    const other = { id: 'sug-2', sourceLabel: 'Your team leader', skillName: 'Excel', suggestedTargetLevel: null, targetDate: null, comments: null, createdAt: created_at }
    listMyManagerSkillSuggestions.mockResolvedValue([suggestion, other])
    renderPage()
    const suggestions = (await screen.findByRole('heading', { name: 'Skill suggestions' })).parentElement
    expect(suggestions).toHaveTextContent('Acme suggested you develop: SQL')
    expect(suggestions).toHaveTextContent('Suggested target: Capable')

    fireEvent.click(within(suggestions).getAllByRole('button', { name: 'Add to my skills' })[0])
    expect(within(suggestions).getByRole('checkbox', { name: 'Also set a target' })).toBeChecked()
    expect(within(suggestions).getByRole('textbox', { name: 'Comments' })).toHaveValue('For the project')
    fireEvent.click(within(suggestions).getByRole('button', { name: 'Confirm and add' }))
    expect(await within(suggestions).findByText('Target date is required when setting a target level.')).toBeInTheDocument()
    expect(adoptManagerSkillSuggestion).not.toHaveBeenCalled()

    fireEvent.change(within(suggestions).getByLabelText('Achieve by'), { target: { value: '2027-03-01' } })
    fireEvent.change(within(suggestions).getByRole('combobox', { name: 'Target level' }), { target: { value: '4' } })
    fireEvent.click(within(suggestions).getByRole('button', { name: 'Confirm and add' }))
    await waitFor(() => expect(adoptManagerSkillSuggestion).toHaveBeenCalledWith('me', suggestion, { targetLevel: 4, targetDate: '2027-03-01', comments: 'For the project' }))
    await waitFor(() => expect(section('Skill suggestions')).not.toHaveTextContent('SQL'))

    fireEvent.click(within(section('Skill suggestions')).getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(dismissManagerSkillSuggestion).toHaveBeenCalledWith(other))
  })

  it('adds a suggested skill without a target when the learner unticks it', async () => {
    const suggestion = { id: 'sug-1', sourceLabel: 'Acme', skillName: 'SQL', suggestedTargetLevel: 3, targetDate: '2027-01-01', comments: 'x', createdAt: created_at }
    listMyManagerSkillSuggestions.mockResolvedValue([suggestion])
    renderPage()
    const suggestions = (await screen.findByRole('heading', { name: 'Skill suggestions' })).parentElement
    fireEvent.click(within(suggestions).getByRole('button', { name: 'Add to my skills' }))
    fireEvent.click(within(suggestions).getByRole('checkbox', { name: 'Also set a target' }))
    fireEvent.click(within(suggestions).getByRole('button', { name: 'Confirm and add' }))
    await waitFor(() => expect(adoptManagerSkillSuggestion).toHaveBeenCalledWith('me', suggestion, { targetLevel: null, targetDate: null, comments: null }))
  })

  it('accepts a plan invitation and links to the plan it joined', async () => {
    listIncomingPlanInvitations.mockResolvedValue([{ id: 'pi', inviter_name: 'Bo', plan_title: 'Grow', created_at }])
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Accept and follow plan' }))
    await waitFor(() => expect(respondToPlanInvitation).toHaveBeenCalledWith('pi', true))
    expect(await screen.findByRole('status')).toHaveTextContent('“Grow” is now in your plans.')
    expect(screen.getByRole('link', { name: 'Review your plan' })).toHaveAttribute('href', '/plans/plan-9?mode=edit')
    expect(screen.queryByText('Nothing needs your attention right now.')).not.toBeInTheDocument()
  })
})
