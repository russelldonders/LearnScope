import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { usePendingActions } from '../context/PendingActionsContext'
import AppHeader from '../components/AppHeader'
import { LEVEL_LABELS } from '../lib/levels'
import { listIncomingRateInvites, listIncomingRecommendInvites, getProfiles } from '../lib/connections'
import { listIncomingPendingValidationRequests } from '../lib/skillValidationRequests'
import { listIncomingConnectionRequests, respondToConnectionRequest } from '../lib/skillDiscovery'
import { listMyPendingOrgInvites, decideOrgInvite } from '../lib/organisationInvites'
import { listMyPendingEmployerInvites, decideEmployerInvite, listMyPendingDataAccessRequests, decideEmployerDataAccessRequest } from '../lib/admin/employers'
import { listMyCourseAssignments, respondToCourseAssignment } from '../lib/courseCatalogue'

// Everything actually waiting on this learner to act -- the same sources
// PendingActionsContext counts for the header badge, just rendered in full
// here instead of as a number. Deliberately separate from Connections.jsx,
// which is about the learner's network/history, not open requests.
export default function Actions() {
  const { user, refreshOrganisationMemberships, refreshEmployerMemberships } = useAuth()
  const { refreshPendingActionCount } = usePendingActions()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [incomingRateInvites, setIncomingRateInvites] = useState([])
  const [incomingRecommendInvites, setIncomingRecommendInvites] = useState([])
  const [validationRequests, setValidationRequests] = useState([])
  const [incomingRequests, setIncomingRequests] = useState([])
  const [orgInvites, setOrgInvites] = useState([])
  const [orgInviteDecidingId, setOrgInviteDecidingId] = useState(null)
  const [orgInviteError, setOrgInviteError] = useState(null)
  const [employerInvites, setEmployerInvites] = useState([])
  const [employerInviteDecidingId, setEmployerInviteDecidingId] = useState(null)
  const [employerInviteError, setEmployerInviteError] = useState(null)
  const [dataAccessRequests, setDataAccessRequests] = useState([])
  const [dataAccessDecidingId, setDataAccessDecidingId] = useState(null)
  const [dataAccessError, setDataAccessError] = useState(null)
  const [courseAssignments, setCourseAssignments] = useState([])
  const [assignmentActingId, setAssignmentActingId] = useState(null)
  const [assignmentError, setAssignmentError] = useState(null)
  const [respondingId, setRespondingId] = useState(null)
  const [respondError, setRespondError] = useState(null)
  const [profiles, setProfiles] = useState({})

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [
        incomingRateInvitesData,
        incomingRecommendInvitesData,
        validationRequestsData,
        incomingRequestsData,
        orgInvitesData,
        employerInvitesData,
        dataAccessRequestsData,
        courseAssignmentsData,
      ] = await Promise.all([
        listIncomingRateInvites(),
        listIncomingRecommendInvites(),
        listIncomingPendingValidationRequests(user.id),
        listIncomingConnectionRequests(user.id),
        listMyPendingOrgInvites(user.id),
        listMyPendingEmployerInvites(user.id),
        listMyPendingDataAccessRequests(user.id),
        listMyCourseAssignments(user.id),
      ])
      setIncomingRateInvites(incomingRateInvitesData)
      setIncomingRecommendInvites(incomingRecommendInvitesData)
      setValidationRequests(validationRequestsData)
      setIncomingRequests(incomingRequestsData)
      setOrgInvites(orgInvitesData)
      setEmployerInvites(employerInvitesData)
      setDataAccessRequests(dataAccessRequestsData)
      setCourseAssignments(courseAssignmentsData)
      const requesterIds = validationRequestsData.map((r) => r.requester_id)
      const requestSenderIds = incomingRequestsData.map((r) => r.requester_id)
      setProfiles(await getProfiles([...requesterIds, ...requestSenderIds]))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleOrgInviteResponse(memberId, accept) {
    setOrgInviteError(null)
    setOrgInviteDecidingId(memberId)
    try {
      await decideOrgInvite(memberId, accept)
      setOrgInvites((prev) => prev.filter((i) => i.id !== memberId))
      refreshPendingActionCount()
      if (accept) refreshOrganisationMemberships()
    } catch (err) {
      setOrgInviteError({ id: memberId, message: err.message })
    } finally {
      setOrgInviteDecidingId(null)
    }
  }

  async function handleEmployerInviteResponse(memberId, accept) {
    setEmployerInviteError(null)
    setEmployerInviteDecidingId(memberId)
    try {
      await decideEmployerInvite(memberId, accept)
      setEmployerInvites((prev) => prev.filter((i) => i.id !== memberId))
      refreshPendingActionCount()
      // Accepting an 'admin' invite may have just granted org membership
      // too (decide_employer_invite's own upsert onto the employer's
      // attached provider org), so refresh both -- not just employer
      // memberships -- same reasoning as addEmployerMember's own eager
      // grant for the brand-new-account path.
      if (accept) {
        refreshEmployerMemberships()
        refreshOrganisationMemberships()
      }
    } catch (err) {
      setEmployerInviteError({ id: memberId, message: err.message })
    } finally {
      setEmployerInviteDecidingId(null)
    }
  }

  async function handleDataAccessResponse(requestId, accept) {
    setDataAccessError(null)
    setDataAccessDecidingId(requestId)
    try {
      await decideEmployerDataAccessRequest(requestId, accept)
      setDataAccessRequests((prev) => prev.filter((r) => r.id !== requestId))
      refreshPendingActionCount()
    } catch (err) {
      setDataAccessError({ id: requestId, message: err.message })
    } finally {
      setDataAccessDecidingId(null)
    }
  }

  // "Start" mirrors CourseCatalogue.jsx's own handleEnrol UX -- no
  // navigation, no toast, just the card leaving the list once enrolled
  // (same as accepting an invite above), since respondToCourseAssignment
  // marks the row 'enrolled' and it no longer matches the 'assigned' filter
  // listMyCourseAssignments queries on. "Dismiss" behaves identically minus
  // the real enrolInCatalogueCourse call underneath.
  async function handleAssignmentResponse(assignment, enrol) {
    setAssignmentError(null)
    setAssignmentActingId(assignment.id)
    try {
      await respondToCourseAssignment(user.id, assignment.id, { enrol, courseForEnrolment: assignment.course_catalogue })
      setCourseAssignments((prev) => prev.filter((a) => a.id !== assignment.id))
      refreshPendingActionCount()
    } catch (err) {
      setAssignmentError({ id: assignment.id, message: err.message })
    } finally {
      setAssignmentActingId(null)
    }
  }

  async function handleRequestResponse(requestId, accept) {
    setRespondError(null)
    setRespondingId(requestId)
    try {
      await respondToConnectionRequest(requestId, accept)
      setIncomingRequests((prev) => prev.filter((r) => r.id !== requestId))
      refreshPendingActionCount()
    } catch (err) {
      setRespondError({ id: requestId, message: err.message })
    } finally {
      setRespondingId(null)
    }
  }

  const hasNothingPending =
    !loading &&
    incomingRateInvites.length === 0 &&
    incomingRecommendInvites.length === 0 &&
    incomingRequests.length === 0 &&
    orgInvites.length === 0 &&
    employerInvites.length === 0 &&
    dataAccessRequests.length === 0 &&
    courseAssignments.length === 0 &&
    validationRequests.length === 0

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-10">
        <h1 className="font-display text-2xl text-ink">Actions</h1>

        {loading && <p className="text-secondary">Loading…</p>}
        {error && <p className="text-red-700 text-sm">{error}</p>}

        {hasNothingPending && (
          <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
            <p className="text-secondary">Nothing needs your attention right now.</p>
          </div>
        )}

        {incomingRateInvites.length > 0 && (
          <div>
            <h2 className="font-display text-xl text-ink mb-6">Invitations to rate</h2>
            <div className="space-y-3">
              {incomingRateInvites.map((invite) => (
                <Link
                  key={invite.id}
                  to={`/rate/${invite.share_code}`}
                  className="block bg-card border border-hairline rounded-lg p-4 hover:border-moss/60 transition-colors"
                >
                  <p className="text-sm text-ink">
                    <strong>{invite.inviter_name || 'Someone'}</strong> wants your rating on their skill:{' '}
                    <strong>{invite.skill_name}</strong>
                    {invite.skill_category ? ` (${invite.skill_category})` : ''}
                  </p>
                  <p className="font-mono text-xs text-secondary mt-0.5">
                    {new Date(invite.created_at).toLocaleDateString()}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        )}

        {incomingRecommendInvites.length > 0 && (
          <div>
            <h2 className="font-display text-xl text-ink mb-6">Skill recommendations</h2>
            <div className="space-y-3">
              {incomingRecommendInvites.map((invite) => (
                <Link
                  key={invite.id}
                  to={`/recommend/${invite.share_code}`}
                  className="block bg-card border border-hairline rounded-lg p-4 hover:border-moss/60 transition-colors"
                >
                  <p className="text-sm text-ink">
                    <strong>{invite.inviter_name || 'Someone'}</strong> recommends you start tracking:{' '}
                    <strong>{invite.skill_name}</strong>
                    {invite.skill_category ? ` (${invite.skill_category})` : ''}
                  </p>
                  <p className="font-mono text-xs text-secondary mt-0.5">
                    {new Date(invite.created_at).toLocaleDateString()}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        )}

        {incomingRequests.length > 0 && (
          <div>
            <h2 className="font-display text-xl text-ink mb-6">Connection requests</h2>
            <div className="space-y-3">
              {incomingRequests.map((request) => (
                <div key={request.id} className="bg-card border border-hairline rounded-lg p-4">
                  <p className="text-sm text-ink">
                    <strong>{profiles[request.requester_id]?.name || 'Someone'}</strong>
                    {request.skills?.name ? (
                      <>
                        {' '}wants to connect over <strong>{request.skills.name}</strong>
                      </>
                    ) : (
                      ' wants to connect'
                    )}
                  </p>
                  {request.message && <p className="text-sm text-secondary mt-1">{request.message}</p>}
                  <p className="font-mono text-xs text-secondary mt-1">
                    {new Date(request.created_at).toLocaleDateString()}
                  </p>
                  {respondError?.id === request.id && (
                    <p className="text-xs text-red-700 mt-1">{respondError.message}</p>
                  )}
                  <div className="flex items-center gap-2 mt-3">
                    <button
                      type="button"
                      onClick={() => handleRequestResponse(request.id, true)}
                      disabled={respondingId === request.id}
                      className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRequestResponse(request.id, false)}
                      disabled={respondingId === request.id}
                      className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {orgInvites.length > 0 && (
          <div>
            <h2 className="font-display text-xl text-ink mb-6">Provider invitations</h2>
            <div className="space-y-3">
              {orgInvites.map((invite) => (
                <div key={invite.id} className="bg-card border border-hairline rounded-lg p-4">
                  <p className="text-sm text-ink">
                    <strong>{invite.organisations?.name || 'A provider organisation'}</strong> wants to add you as{' '}
                    {invite.role === 'admin' ? 'an admin' : 'a trainer'}
                  </p>
                  <p className="font-mono text-xs text-secondary mt-1">
                    {new Date(invite.created_at).toLocaleDateString()}
                  </p>
                  {orgInviteError?.id === invite.id && (
                    <p className="text-xs text-red-700 mt-1">{orgInviteError.message}</p>
                  )}
                  <div className="flex items-center gap-2 mt-3">
                    <button
                      type="button"
                      onClick={() => handleOrgInviteResponse(invite.id, true)}
                      disabled={orgInviteDecidingId === invite.id}
                      className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOrgInviteResponse(invite.id, false)}
                      disabled={orgInviteDecidingId === invite.id}
                      className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {employerInvites.length > 0 && (
          <div>
            <h2 className="font-display text-xl text-ink mb-6">Employer invitations</h2>
            <div className="space-y-3">
              {employerInvites.map((invite) => (
                <div key={invite.id} className="bg-card border border-hairline rounded-lg p-4">
                  <p className="text-sm text-ink">
                    <strong>{invite.employers?.name || 'An employer'}</strong> wants to add you as{' '}
                    {invite.role === 'admin' ? 'an admin' : 'a member'}
                  </p>
                  <p className="font-mono text-xs text-secondary mt-1">
                    {new Date(invite.created_at).toLocaleDateString()}
                  </p>
                  {employerInviteError?.id === invite.id && (
                    <p className="text-xs text-red-700 mt-1">{employerInviteError.message}</p>
                  )}
                  <div className="flex items-center gap-2 mt-3">
                    <button
                      type="button"
                      onClick={() => handleEmployerInviteResponse(invite.id, true)}
                      disabled={employerInviteDecidingId === invite.id}
                      className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => handleEmployerInviteResponse(invite.id, false)}
                      disabled={employerInviteDecidingId === invite.id}
                      className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {dataAccessRequests.length > 0 && (
          <div>
            <h2 className="font-display text-xl text-ink mb-6">Data access requests</h2>
            <div className="space-y-3">
              {dataAccessRequests.map((request) => (
                <div key={request.id} className="bg-card border border-hairline rounded-lg p-4">
                  <p className="text-sm text-ink">
                    <strong>{request.employers?.name || 'An employer'}</strong> would like access to view your
                    skills profile
                  </p>
                  <p className="font-mono text-xs text-secondary mt-1">
                    {new Date(request.created_at).toLocaleDateString()}
                  </p>
                  {dataAccessError?.id === request.id && (
                    <p className="text-xs text-red-700 mt-1">{dataAccessError.message}</p>
                  )}
                  <div className="flex items-center gap-2 mt-3">
                    <button
                      type="button"
                      onClick={() => handleDataAccessResponse(request.id, true)}
                      disabled={dataAccessDecidingId === request.id}
                      className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDataAccessResponse(request.id, false)}
                      disabled={dataAccessDecidingId === request.id}
                      className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {courseAssignments.length > 0 && (
          <div>
            <h2 className="font-display text-xl text-ink mb-6">Assigned training</h2>
            <div className="space-y-3">
              {courseAssignments.map((assignment) => (
                <div key={assignment.id} className="bg-card border border-hairline rounded-lg p-4">
                  <p className="text-sm text-ink">
                    <strong>{assignment.employers?.name || 'An employer'}</strong> assigned you a course:{' '}
                    <strong>{assignment.course_catalogue?.name}</strong>
                  </p>
                  <p className="font-mono text-xs text-secondary mt-1">
                    {new Date(assignment.created_at).toLocaleDateString()}
                  </p>
                  {assignmentError?.id === assignment.id && (
                    <p className="text-xs text-red-700 mt-1">{assignmentError.message}</p>
                  )}
                  <div className="flex items-center gap-2 mt-3">
                    <button
                      type="button"
                      onClick={() => handleAssignmentResponse(assignment, true)}
                      disabled={assignmentActingId === assignment.id}
                      className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
                    >
                      Start
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAssignmentResponse(assignment, false)}
                      disabled={assignmentActingId === assignment.id}
                      className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {validationRequests.length > 0 && (
          <div>
            <h2 className="font-display text-xl text-ink mb-6">Requests to validate</h2>
            <div className="space-y-3">
              {validationRequests.map((request) => (
                <Link
                  key={request.id}
                  to={`/validate-request/${request.id}`}
                  className="block bg-card border border-hairline rounded-lg p-4 hover:border-moss/60 transition-colors"
                >
                  <p className="text-sm text-ink">
                    <strong>{profiles[request.requester_id]?.name || 'Someone'}</strong> asked you to confirm{' '}
                    they've reached <strong>{LEVEL_LABELS[request.target_level]}</strong> on{' '}
                    <strong>{request.skills?.name}</strong>
                  </p>
                  <p className="font-mono text-xs text-secondary mt-0.5">
                    {new Date(request.created_at).toLocaleDateString()}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
